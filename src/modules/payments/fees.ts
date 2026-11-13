/**
 * Day-to-day fee work from the dashboard:
 *
 *  - "Record a fee payment": a student paid in cash, by UPI or cheque. One step issues an
 *    invoice in the Course fees category and marks it paid, in one transaction, so the
 *    student gets a numbered receipt and the books match. The course's price and GST
 *    rate are the defaults.
 *  - "Remind overdue fees": one notification to every student with an unpaid invoice past
 *    its due date, at most once a day per invoice.
 *
 * Both need `finance.manage`; the overdue summary needs `finance.view`. Every write is audited.
 */
import { and, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { courses, notifications, roleAssignments, users } from "@/db/schema";
import { assertCan, audit, can, notify, todayIn, withTenant, type Actor } from "@/server/core";
import { ValidationError } from "@/server/errors";
import { COURSE_FEES_ID } from "./categories";
import { UUID_RE, uni, universityRow } from "./internal";
import { MODE_LABEL, createManualInvoiceTx, recordManualPaymentTx, type ManualInvoiceRow } from "./manual-invoices";
import { inr } from "./money";
import { PAYMENT_MODES, payManualInvoices, type PaymentMode } from "./schema";

export type FeeInput = {
  /** The student who paid: someone with a role here, by id or by email. */
  userId?: string | null;
  email?: string | null;
  /** What the fee was for. The course's title names the line when no description is given. */
  courseId?: string | null;
  description?: string | null;
  /** Before GST when the institute charges GST. Left out: the course's price. */
  amountPaise?: number | null;
  mode: string;
  reference?: string | null;
  /** "YYYY-MM-DD"; today when left out. */
  paidOn?: string | null;
};

export type FeeResult = { invoiceId: string; number: string; totalPaise: number };

/** Records a payment that came in outside checkout, inside a transaction the caller holds. Needs `finance.manage`. */
export async function recordFeeTx(tx: Tx, actor: Actor, input: FeeInput): Promise<FeeResult> {
  assertCan(actor, "finance.manage", { universityId: uni(actor) });
  if (!(PAYMENT_MODES as readonly string[]).includes(input.mode)) throw new ValidationError("Pick how it was paid: cash, UPI, bank transfer, cheque, card or other.");
  let userId = input.userId ?? null;
  if (!userId) {
    // "Asha Rao · asha@example.com" from the form's suggestions, or a bare email.
    const email = (input.email ?? "").trim().toLowerCase().split(/\s+/).pop() ?? "";
    if (!email) throw new ValidationError("Pick the student who paid.");
    const [p] = await tx
      .select({ id: users.id })
      .from(users)
      .innerJoin(roleAssignments, and(eq(roleAssignments.userId, users.id), eq(roleAssignments.universityId, uni(actor)), isNull(roleAssignments.revokedAt)))
      .where(eq(sql`lower(${users.email})`, email))
      .limit(1);
    if (!p) throw new ValidationError(`Nobody here signs in with ${email}. Pick the student from the suggestions, or add them first.`);
    userId = p.id;
  }
  let course: { title: string; pricePaise: number; gstRateBp: number } | null = null;
  if (input.courseId) {
    const [c] = UUID_RE.test(input.courseId)
      ? await tx.select({ title: courses.title, pricePaise: courses.pricePaise, gstRateBp: courses.gstRateBp }).from(courses).where(eq(courses.id, input.courseId))
      : [];
    if (!c) throw new ValidationError("Pick the course from the list, or leave it empty and say what the fee is for.");
    course = c;
  }
  const amountPaise = input.amountPaise ?? course?.pricePaise ?? null;
  if (amountPaise === null || !Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new ValidationError(course ? `${course.title} is free. Enter the amount that was paid.` : "Enter the amount that was paid, like 3500.");
  }
  const description = (input.description ?? "").replace(/\s+/g, " ").trim() || (course ? `${course.title} fee` : "");
  if (!description) throw new ValidationError("Say what the fee is for, or pick a course.");
  const u = await universityRow(tx);
  const today = todayIn(u.timezone);
  const inv = await createManualInvoiceTx(tx, actor, {
    categoryId: COURSE_FEES_ID,
    userId,
    lines: [{ description, quantity: 1, unitPricePaise: amountPaise }],
    gstRateBp: course && u.gstEnabled ? course.gstRateBp : undefined,
    issueDate: input.paidOn?.trim() || today,
  });
  const paid = await recordManualPaymentTx(tx, actor, inv.id, { paidOn: input.paidOn?.trim() || today, mode: input.mode, reference: input.reference ?? undefined });
  return { invoiceId: paid.id, number: paid.number, totalPaise: paid.totalPaise };
}

/** "Record a fee payment": an invoice for the fee, marked paid, in one step. Needs `finance.manage`. */
export async function recordFeePayment(actor: Actor, input: FeeInput): Promise<FeeResult> {
  assertCan(actor, "finance.manage", { universityId: uni(actor) });
  return withTenant(actor, (tx) => recordFeeTx(tx, actor, input));
}

export type OverdueSummary = { count: number; totalPaise: number; reachable: number };

/** Unpaid invoices past their due date: how many, how much, and how many students can be reminded here. Needs `finance.view`. */
export async function overdueFees(actor: Actor): Promise<OverdueSummary> {
  assertCan(actor, "finance.view", { universityId: uni(actor) });
  return withTenant(actor, async (tx) => {
    const today = todayIn((await universityRow(tx)).timezone);
    const [r] = await tx
      .select({
        count: sql<number>`count(*)::int`,
        totalPaise: sql<number>`coalesce(sum(${payManualInvoices.totalPaise}), 0)::int`,
        reachable: sql<number>`count(*) filter (where ${payManualInvoices.userId} is not null)::int`,
      })
      .from(payManualInvoices)
      .where(and(eq(payManualInvoices.status, "unpaid"), lt(payManualInvoices.dueDate, today)));
    return r;
  });
}

export const REMINDER_KIND = "payments.fee_reminder";

/**
 * Reminds every student with an overdue invoice. An invoice billed to someone without an
 * account here can't be reminded in the app; one reminded in the last 20 hours is skipped.
 */
export async function remindOverdueFees(actor: Actor, now = new Date()): Promise<{ sent: number; skipped: number }> {
  assertCan(actor, "finance.manage", { universityId: uni(actor) });
  return withTenant(actor, async (tx) => {
    const today = todayIn((await universityRow(tx)).timezone, now);
    const due = await tx
      .select()
      .from(payManualInvoices)
      .where(and(eq(payManualInvoices.status, "unpaid"), lt(payManualInvoices.dueDate, today), isNotNull(payManualInvoices.userId)));
    if (due.length === 0) return { sent: 0, skipped: 0 };
    const recent = await tx
      .select({ id: sql<string>`${notifications.data}->>'manualInvoiceId'` })
      .from(notifications)
      .where(and(eq(notifications.kind, REMINDER_KIND), gte(notifications.createdAt, new Date(now.getTime() - 20 * 3_600_000))));
    const done = new Set(recent.map((r) => r.id));
    // Only people who still belong here get the reminder.
    const members = new Set(
      (
        await tx
          .select({ userId: roleAssignments.userId })
          .from(roleAssignments)
          .where(and(inArray(roleAssignments.userId, due.map((d) => d.userId!)), eq(roleAssignments.universityId, uni(actor)), isNull(roleAssignments.revokedAt)))
      ).map((r) => r.userId),
    );
    let sent = 0;
    for (const inv of due) {
      if (done.has(inv.id) || !members.has(inv.userId!)) continue;
      await notify(tx, uni(actor), [inv.userId!], {
        kind: REMINDER_KIND,
        title: `Invoice ${inv.number} is overdue`,
        body: `${inr(inv.totalPaise)} was due on ${inv.dueDate}. Please pay at the office, or reply to the institute if you already have.`,
        data: { manualInvoiceId: inv.id, number: inv.number },
      });
      await audit(tx, actor, "manual_invoice.remind", "pay_manual_invoice", inv.id, { number: inv.number, userId: inv.userId });
      sent++;
    }
    return { sent, skipped: due.length - sent };
  });
}

export type FeeChoices = {
  gstEnabled: boolean;
  courses: { id: string; title: string; pricePaise: number }[];
  students: { id: string; name: string; email: string }[];
  modes: { value: PaymentMode; label: string }[];
};

/** What the "Record a fee payment" form offers. Empty for people without `finance.manage`. */
export async function feeChoices(actor: Actor): Promise<FeeChoices | null> {
  if (!can(actor, "finance.manage", { universityId: uni(actor) })) return null;
  return withTenant(actor, async (tx) => {
    const u = await universityRow(tx);
    const list = await tx
      .select({ id: courses.id, title: courses.title, pricePaise: courses.pricePaise })
      .from(courses)
      .where(sql`${courses.status} <> 'archived'`)
      .orderBy(courses.title);
    const students = await tx
      .selectDistinct({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .innerJoin(roleAssignments, and(eq(roleAssignments.userId, users.id), eq(roleAssignments.universityId, uni(actor)), isNull(roleAssignments.revokedAt)))
      .where(eq(roleAssignments.role, "student"))
      .orderBy(users.name)
      .limit(2000);
    return {
      gstEnabled: u.gstEnabled,
      courses: list,
      students,
      modes: PAYMENT_MODES.map((m) => ({ value: m, label: MODE_LABEL[m] })),
    };
  });
}

export type { ManualInvoiceRow };
