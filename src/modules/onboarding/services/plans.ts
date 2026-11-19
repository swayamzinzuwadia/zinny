/**
 * Choosing and paying for a plan (/[uni]/admin/choose-plan): during the trial, or after it
 * froze the institute. Payment goes through the core payment gateway; once it is confirmed,
 * the Zinny team panel's services make the licence and Zinny's GST invoice (marked paid with
 * the payment reference), and a frozen institute is active again.
 */
import { and, desc, eq } from "drizzle-orm";
import { assertCan, audit, gateway, systemActorFor, withTenant, type Actor } from "@/server/core";
import { testPaymentsAllowed } from "@/server/payments/gateway";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { formatDate } from "@/server/lib/dates";
import { gstFor, markInvoicePaid } from "@/modules/zinny-team-panel/services/billing";
import { saveLicence } from "@/modules/zinny-team-panel/services/licences";
import { activeLicence, buyablePlans, termEndFor, zinnyCheckoutActor } from "../lib/zinny-billing";
import { onbPlanOrders } from "../schema";
import { hasUsablePan, listDocuments, type DocumentRow } from "./documents";
import { trialInfo, unfreezeAfterPayment, type TrialInfo } from "./trial";

export type PlanCard = {
  key: string;
  name: string;
  description: string;
  billingMonths: number;
  studentCap: number;
  staffCap: number;
  modules: string[];
  gstRateBp: number;
  basePaise: number;
  gstPaise: number;
  totalPaise: number;
};

export type PlanOrder = typeof onbPlanOrders.$inferSelect;

export type ChoosePlanView = {
  trial: TrialInfo;
  plans: PlanCard[];
  documents: DocumentRow[];
  panOnFile: boolean;
  /** "test": the mock gateway in development or a demo. "unavailable": no way to pay online here yet. */
  payment: "test" | "unavailable";
  lastPaid: PlanOrder | null;
};

function uni(actor: Actor) {
  if (!actor.universityId) throw new ForbiddenError("No institute selected.");
  return actor.universityId;
}

const toCard = (p: Awaited<ReturnType<typeof buyablePlans>>[number]): PlanCard => {
  const gstPaise = gstFor(p.pricePaise, p.gstRateBp);
  return {
    key: p.key,
    name: p.name,
    description: p.description,
    billingMonths: p.billingMonths,
    studentCap: p.studentCap,
    staffCap: p.staffCap,
    modules: p.modules,
    gstRateBp: p.gstRateBp,
    basePaise: p.pricePaise,
    gstPaise,
    totalPaise: p.pricePaise + gstPaise,
  };
};

export async function planCards(): Promise<PlanCard[]> {
  return (await buyablePlans()).map(toCard);
}

/** Everything the choose-plan page shows. Needs settings.manage. */
export async function choosePlanView(actor: Actor, now = new Date()): Promise<ChoosePlanView> {
  assertCan(actor, "settings.manage", { universityId: uni(actor) });
  const [trial, plans, documents, lastPaid] = await Promise.all([
    trialInfo(actor, now),
    planCards(),
    listDocuments(actor),
    withTenant(actor, (tx) =>
      tx.select().from(onbPlanOrders).where(eq(onbPlanOrders.status, "paid")).orderBy(desc(onbPlanOrders.paidAt)).limit(1),
    ).then((r) => r[0] ?? null),
  ]);
  return { trial, plans, documents, panOnFile: hasUsablePan(documents), payment: testPaymentsAllowed() ? "test" : "unavailable", lastPaid };
}

/**
 * Starts paying for a plan: checks the plan, the PAN card and that no licence already covers
 * today, then creates the gateway order. Returns the order to pay.
 */
export async function startPlanOrder(actor: Actor, planKey: string, now = new Date()): Promise<PlanOrder> {
  const universityId = uni(actor);
  assertCan(actor, "settings.manage", { universityId });
  const plan = (await planCards()).find((p) => p.key === planKey);
  if (!plan) throw new ValidationError("Pick one of the plans on this page.");
  if (!hasUsablePan(await listDocuments(actor))) {
    throw new ValidationError("Upload your institute's PAN card before choosing a plan. You can do it on the Documents page.", "pan_required");
  }
  const trial = await trialInfo(actor, now);
  const current = await activeLicence(universityId, trial.today);
  if (current) throw new ConflictError(`You already have a plan until ${formatDate(current.endDate)}. Write to the Zinny team to change it.`, "has_plan");

  const order = await gateway().createOrder({
    amountPaise: plan.totalPaise,
    receipt: `onb-${universityId.slice(0, 8)}-${Date.now().toString(36)}`,
    notes: { universityId, plan: plan.key, purpose: "zinny_plan" },
  });
  return withTenant(actor, async (tx) => {
    const [row] = await tx
      .insert(onbPlanOrders)
      .values({
        universityId,
        planKey: plan.key,
        planName: plan.name,
        basePaise: plan.basePaise,
        gstPaise: plan.gstPaise,
        totalPaise: plan.totalPaise,
        gateway: gateway().name,
        gatewayOrderId: order.gatewayOrderId,
        createdBy: actor.userId || null,
      })
      .returning();
    await audit(tx, actor, "onboarding.plan.order", "onb_plan_order", row.id, { plan: plan.key, totalPaise: plan.totalPaise });
    return row;
  });
}

/**
 * The payment for an order came through (signature checked by the gateway): makes the licence
 * for the plan's term from today and its invoice, marks the invoice paid with the payment id,
 * marks the order paid and unfreezes the institute. Idempotent: a paid order is returned as is.
 */
export async function confirmPlanPayment(
  universityId: string,
  input: { gatewayOrderId: string; gatewayPaymentId: string; signature: string },
  now = new Date(),
): Promise<PlanOrder> {
  const system = systemActorFor(universityId);
  if (!gateway().verifyPayment(input)) throw new ValidationError("The payment couldn't be verified, so nothing was charged to your plan. Try again.");
  const [order] = await withTenant(system, (tx) =>
    tx.select().from(onbPlanOrders).where(and(eq(onbPlanOrders.gatewayOrderId, input.gatewayOrderId), eq(onbPlanOrders.universityId, universityId))),
  );
  if (!order) throw new NotFoundError("Order");
  if (order.status === "paid") return order;

  const plan = (await buyablePlans()).find((p) => p.key === order.planKey);
  if (!plan) throw new ValidationError("That plan is no longer on sale. Write to the Zinny team and we'll sort out your payment.");
  const today = (await trialInfo(system, now)).today;
  const checkout = zinnyCheckoutActor();
  const saved = await saveLicence(
    checkout,
    universityId,
    {
      plan: plan.key,
      studentCap: plan.studentCap,
      staffCap: plan.staffCap,
      modules: plan.modules,
      startDate: today,
      endDate: termEndFor(today, plan.billingMonths),
      pricePaise: order.basePaise,
      notes: "Bought by the institute from its choose-plan page.",
      invoice: { issueDate: today, dueDate: today, gstRateBp: plan.gstRateBp },
    },
    today,
  );
  if (saved.invoice) await markInvoicePaid(checkout, saved.invoice.id, { paidOn: today, reference: input.gatewayPaymentId }, today);

  const paid = await withTenant(system, async (tx) => {
    const [row] = await tx
      .update(onbPlanOrders)
      .set({ status: "paid", gatewayPaymentId: input.gatewayPaymentId, paidAt: now, licenceId: saved.id, invoiceNumber: saved.invoice?.number ?? null })
      .where(eq(onbPlanOrders.id, order.id))
      .returning();
    await audit(tx, system, "onboarding.plan.paid", "onb_plan_order", order.id, {
      plan: plan.key,
      totalPaise: order.totalPaise,
      gatewayPaymentId: input.gatewayPaymentId,
      invoiceNumber: saved.invoice?.number ?? null,
    });
    return row;
  });
  await unfreezeAfterPayment(universityId, order.id);
  return paid;
}

/** Test mode only (mock gateway, development or demo): pays an order without money moving. */
export async function payPlanTestMode(actor: Actor, planKey: string, now = new Date()): Promise<PlanOrder> {
  if (!testPaymentsAllowed()) throw new ValidationError("Online payment for plans isn't switched on here yet. Write to the Zinny team and we'll send you a payment link.");
  const order = await startPlanOrder(actor, planKey, now);
  return confirmPlanPayment(uni(actor), { gatewayOrderId: order.gatewayOrderId, gatewayPaymentId: `mock_pay_${crypto.randomUUID().slice(0, 12)}`, signature: "mock" }, now);
}
