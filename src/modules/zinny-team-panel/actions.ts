"use server";

/**
 * Server actions for /platform. Each one builds the platform actor from the session and
 * calls a service; the services check permissions and log every change.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { attempt, str } from "@/server/action";
import { platformContext } from "@/server/context";
import { deleteRole, resetRole, roleDraft, saveRole } from "@/server/core";
import { currentSession } from "@/server/auth/session";
import { formatDate, formatINR, parseRupees } from "./lib/format";
import { setPersonPassword, startImpersonation, stopImpersonation } from "./services/accounts";
import { addRole, inviteMember, removeRole } from "./services/team";
import { createInvoice, markInvoicePaid, markInvoiceUnpaid, reviseInvoice } from "./services/billing";
import { archivePlan, createPlan, deletePlan, restorePlan, updatePlan, type PlanInput } from "./services/plans";
import { flagCourse, markReviewed, resolveFlag } from "./services/content";
import { acknowledgeAlert, saveLicence, syncAllAlerts, type LicenceInput } from "./services/licences";
import { forceEndSupport, leaveSupport, startSupport } from "./services/support";
import { startViewAs, stopViewAs } from "./services/view-as";
import { clearViewAs, readViewAs, writeViewAs } from "@/server/auth/view-as";
import { createUniversityWithLicence, setUniversityStatus, updateBasics } from "./services/universities";
import { PLATFORM_ROLE_LABELS, isPlatformRole } from "./lib/constants";
import { ValidationError } from "@/server/errors";

/** A whole number from a form field, allowing "1,000". NaN when it isn't one. */
function whole(data: FormData, key: string) {
  const v = str(data, key).replace(/[,\s]/g, "");
  return /^\d+$/.test(v) ? Number(v) : Number.NaN;
}

/** Rupees from a form field as paise. Empty is `empty`; anything that isn't an amount throws with `message`. */
function rupees(data: FormData, key: string, message: string, empty = 0) {
  const raw = str(data, key);
  if (!raw) return empty;
  const paise = parseRupees(raw);
  if (!Number.isFinite(paise)) throw new ValidationError(message);
  return paise;
}

/**
 * The licence form: plan, caps, modules, term, the price and discount, and the invoice to
 * raise with it. "Don't create an invoice" ticked sends `invoice: false`.
 */
function licenceFrom(data: FormData): LicenceInput {
  const base = {
    plan: str(data, "plan"),
    studentCap: whole(data, "studentCap"),
    staffCap: whole(data, "staffCap"),
    modules: data.getAll("modules").map(String),
    startDate: str(data, "startDate"),
    endDate: str(data, "endDate"),
    notes: str(data, "notes"),
  };
  // A form without the charge fields (an older page still open) leaves the price to the service.
  if (!data.has("price")) return base;
  return {
    ...base,
    pricePaise: rupees(data, "price", "Enter the price before GST in rupees, like 720000 or 7,20,000."),
    discountPaise: rupees(data, "discount", "Enter the discount in rupees, like 20000, or leave it empty."),
    discountNote: str(data, "discountNote"),
    invoice: data.get("noInvoice") === "on" ? false : { issueDate: str(data, "invoiceDate") || undefined, dueDate: str(data, "invoiceDueDate") || undefined },
  };
}

function planFrom(data: FormData): PlanInput {
  return {
    key: str(data, "key"),
    name: str(data, "name"),
    description: str(data, "description"),
    pricePaise: rupees(data, "price", "Enter the price before GST in rupees, like 720000 or 7,20,000.", Number.NaN),
    billingMonths: whole(data, "billingMonths"),
    studentCap: whole(data, "studentCap"),
    staffCap: whole(data, "staffCap"),
    modules: data.getAll("modules").map(String),
    gstRateBp: Math.round(Number(str(data, "gst")) * 100),
    sortOrder: str(data, "sortOrder") ? whole(data, "sortOrder") : undefined,
  };
}

/* ── Universities ── */

export async function createUniversityAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  let id = "";
  const res = await attempt(async () => {
    const uni = await createUniversityWithLicence(actor, {
      name: str(data, "name"),
      slug: str(data, "slug"),
      adminName: str(data, "adminName"),
      adminEmail: str(data, "adminEmail"),
      // Not trimmed: a password is used exactly as typed.
      adminPassword: String(data.get("adminPassword") ?? "") || null,
      invoicePrefix: str(data, "invoicePrefix"),
      licence: data.get("withLicence") === "on" ? licenceFrom(data) : null,
    });
    id = uni.id;
  });
  if (id) {
    revalidatePath("/platform", "layout");
    redirect(`/platform/institutes/${id}?created=1`);
  }
  return res;
}

export async function updateBasicsAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  const id = str(data, "universityId");
  return attempt(async () => {
    await updateBasics(actor, id, {
      name: str(data, "name"),
      slug: str(data, "slug"),
      timezone: str(data, "timezone"),
      gstin: str(data, "gstin"),
      legalName: str(data, "legalName"),
      address: str(data, "address"),
      stateCode: str(data, "stateCode"),
      invoicePrefix: str(data, "invoicePrefix"),
    });
    revalidatePath("/platform", "layout");
    return "Saved. The change is in the institute's audit log with your name.";
  });
}

export async function setStatusAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  const id = str(data, "universityId");
  const status = str(data, "status") === "suspended" ? "suspended" : "active";
  return attempt(async () => {
    const u = await setUniversityStatus(actor, id, status, str(data, "reason"));
    revalidatePath("/platform", "layout");
    return status === "suspended" ? `${u.name} is suspended.` : `${u.name} is active again.`;
  });
}

/* ── Licences ── */

export async function saveLicenceAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  const id = str(data, "universityId");
  return attempt(async () => {
    const saved = await saveLicence(actor, id, licenceFrom(data));
    revalidatePath("/platform", "layout");
    return saved.invoice
      ? `Licence saved. Invoice ${saved.invoice.number} for ${formatINR(saved.invoice.totalPaise)} is raised and due on ${formatDate(saved.invoice.dueDate)}.`
      : "Licence saved. No invoice was created.";
  });
}

/* ── Plans ── */

/** Creates a plan, or changes the one named by `planId`. */
export async function savePlanAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  const id = str(data, "planId");
  let created = "";
  const res = await attempt(async () => {
    if (id) {
      const p = await updatePlan(actor, id, planFrom(data));
      revalidatePath("/platform", "layout");
      return `${p.name} saved. Licences and invoices made from now on use it; existing ones keep their price.`;
    }
    created = (await createPlan(actor, planFrom(data))).id;
  });
  if (created) {
    revalidatePath("/platform", "layout");
    redirect("/platform/plans?created=1");
  }
  return res;
}

export async function archivePlanAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  return attempt(async () => {
    const p = await archivePlan(actor, str(data, "planId"));
    revalidatePath("/platform", "layout");
    return `${p.name} is archived. Institutes already on it keep it.`;
  });
}

export async function deletePlanAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  let deleted = false;
  const res = await attempt(async () => {
    await deletePlan(actor, str(data, "planId"));
    deleted = true;
  });
  if (deleted) {
    revalidatePath("/platform", "layout");
    redirect("/platform/plans?deleted=1");
  }
  return res;
}

export async function restorePlanAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  return attempt(async () => {
    const p = await restorePlan(actor, str(data, "planId"));
    revalidatePath("/platform", "layout");
    return `${p.name} can be chosen for new licences again.`;
  });
}

/* ── Accounts: set a password, sign in as someone ── */

export async function setPasswordAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  const session = await currentSession();
  return attempt(async () => {
    const r = await setPersonPassword(actor, str(data, "userId"), {
      // Not trimmed: a password is used exactly as typed.
      password: String(data.get("password") ?? ""),
      confirm: String(data.get("confirm") ?? ""),
      signOutEverywhere: data.get("signOutEverywhere") === "on",
      keepSessionId: session?.sessionId,
    });
    revalidatePath("/platform", "layout");
    const ended = r.signedOutEverywhere ? ` They are signed out everywhere (${r.sessionsEnded} session${r.sessionsEnded === 1 ? "" : "s"} ended).` : " Their open sessions stay signed in.";
    return `Password set for ${r.name}.${ended} Pass it on safely: it isn't shown again.`;
  });
}

/**
 * Signs the Super Admin in as someone and goes to where that person lands. The redirect
 * comes from the server, so the next page is rendered with the new session straight away.
 */
export async function signInAsAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  let landing = "";
  const res = await attempt(async () => {
    landing = (await startImpersonation(actor, str(data, "userId"), { universityId: str(data, "universityId") || null })).landing;
  });
  if (landing) redirect(landing);
  return res;
}

/** Ends "sign in as" and goes back to the Super Admin's own session, on the person's page in the panel. */
export async function returnToPanelAction(): Promise<ActionState> {
  let next = "";
  const res = await attempt(async () => {
    next = (await stopImpersonation()).next;
  });
  if (next) redirect(next);
  return res;
}

/* ── Licence warnings ── */

export async function acknowledgeAlertAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  return attempt(async () => {
    await acknowledgeAlert(actor, str(data, "alertId"));
    revalidatePath("/platform", "layout");
    return "Marked as handled. It comes back if it gets worse.";
  });
}

export async function checkLicencesAction(): Promise<ActionState> {
  const actor = await platformContext();
  return attempt(async () => {
    const r = await syncAllAlerts(actor);
    revalidatePath("/platform", "layout");
    const parts = [r.raised && `${r.raised} new`, r.updated && `${r.updated} updated`, r.resolved && `${r.resolved} cleared`].filter(Boolean);
    return parts.length ? `Checked every licence: ${parts.join(", ")}.` : "Checked every licence. Nothing changed.";
  });
}

/* ── Support ── */

export async function startSupportAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  let slug = "";
  const res = await attempt(async () => {
    ({ slug } = await startSupport(actor, str(data, "universityId"), str(data, "reason")));
  });
  if (slug) redirect(`/${slug}/admin`);
  return res;
}

/** Starts viewing the learner app as one person, read only. `ok` is the page to open next. */
export async function viewAsAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  const universityId = str(data, "universityId");
  const userId = str(data, "userId");
  return attempt(async () => {
    const { slug } = await startViewAs(actor, universityId, userId);
    await writeViewAs({ universityId, userId });
    return `/${slug}/learn`;
  });
}

/** Ends a view. Uses platformContext, not spaceContext, which refuses actions while viewing. */
export async function stopViewAsAction() {
  const actor = await platformContext();
  const target = await readViewAs();
  await clearViewAs();
  if (target) await stopViewAs(actor, target.universityId, target.userId);
  redirect(target ? `/platform/people/${target.userId}` : "/platform/people");
}

export async function leaveSupportAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  return attempt(async () => {
    await leaveSupport(actor, str(data, "sessionId"));
    revalidatePath("/platform", "layout");
    return "You have left support mode.";
  });
}

export async function forceEndSupportAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  return attempt(async () => {
    const r = await forceEndSupport(actor, str(data, "sessionId"), str(data, "endReason"));
    revalidatePath("/platform", "layout");
    return r.forced ? "Session ended. They are out of the institute on their next click." : "You have left support mode.";
  });
}

/* ── Content review ── */

export async function markReviewedAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  return attempt(async () => {
    await markReviewed(actor, str(data, "courseId"), str(data, "note"));
    revalidatePath("/platform", "layout");
    return "Marked as reviewed with no issues.";
  });
}

export async function flagCourseAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  return attempt(async () => {
    await flagCourse(actor, str(data, "courseId"), { category: str(data, "category"), note: str(data, "note") });
    revalidatePath("/platform", "layout");
    return "Flag added. Account Managers can see it on the institute's page.";
  });
}

export async function resolveFlagAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  return attempt(async () => {
    await resolveFlag(actor, str(data, "flagId"), str(data, "resolution"));
    revalidatePath("/platform", "layout");
    return "Flag resolved.";
  });
}

/* ── Zinny billing ── */

export async function createInvoiceAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  let id = "";
  const res = await attempt(async () => {
    const inv = await createInvoice(actor, {
      universityId: str(data, "universityId"),
      periodStart: str(data, "periodStart"),
      periodEnd: str(data, "periodEnd"),
      description: str(data, "description"),
      listPricePaise: rupees(data, "amount", "Enter the amount before GST in rupees, like 45000 or 45,000.50.", Number.NaN),
      discountPaise: rupees(data, "discount", "Enter the discount in rupees, like 5000, or leave it empty."),
      discountNote: str(data, "discountNote"),
      gstRateBp: Math.round(Number(str(data, "gst")) * 100),
      issueDate: str(data, "issueDate"),
      dueDate: str(data, "dueDate"),
    });
    id = inv.id;
  });
  if (id) {
    revalidatePath("/platform", "layout");
    redirect(`/platform/billing/${id}`);
  }
  return res;
}

export async function reviseInvoiceAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  const id = str(data, "invoiceId");
  return attempt(async () => {
    const inv = await reviseInvoice(actor, id, {
      description: str(data, "description"),
      periodStart: str(data, "periodStart"),
      periodEnd: str(data, "periodEnd"),
      listPricePaise: rupees(data, "amount", "Enter the amount before GST in rupees, like 45000 or 45,000.50.", Number.NaN),
      discountPaise: rupees(data, "discount", "Enter the discount in rupees, like 5000, or leave it empty."),
      discountNote: str(data, "discountNote"),
      issueDate: str(data, "issueDate"),
      dueDate: str(data, "dueDate"),
    });
    revalidatePath("/platform", "layout");
    return `${inv.number} revised. The total is now ${formatINR(inv.totalPaise)}.`;
  });
}

export async function markPaidAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  const id = str(data, "invoiceId");
  return attempt(async () => {
    const inv = await markInvoicePaid(actor, id, { paidOn: str(data, "paidOn"), reference: str(data, "reference") });
    revalidatePath("/platform", "layout");
    return `${inv.number} is marked paid.`;
  });
}

export async function markUnpaidAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  const id = str(data, "invoiceId");
  return attempt(async () => {
    const inv = await markInvoiceUnpaid(actor, id, str(data, "reason"));
    revalidatePath("/platform", "layout");
    return `${inv.number} is unpaid again.`;
  });
}

/* ── Team ── */

export async function inviteMemberAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  return attempt(async () => {
    const role = str(data, "role");
    await inviteMember(actor, { name: str(data, "name"), email: str(data, "email"), role });
    revalidatePath("/platform/team");
    return `Added${isPlatformRole(role) ? ` as ${PLATFORM_ROLE_LABELS[role]}` : ""}. New people get an email to set their password.`;
  });
}

export async function addRoleAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  return attempt(async () => {
    const role = str(data, "role");
    await addRole(actor, str(data, "userId"), role);
    revalidatePath("/platform/team");
    return `${isPlatformRole(role) ? `${PLATFORM_ROLE_LABELS[role]} role` : "Role"} added.`;
  });
}

export async function saveTeamRoleAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  return attempt(async () => {
    const saved = await saveRole(actor, null, roleDraft(data));
    revalidatePath("/platform", "layout");
    return saved;
  });
}

export async function resetTeamRoleAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  return attempt(async () => {
    const done = await resetRole(actor, null, str(data, "role"));
    revalidatePath("/platform", "layout");
    return done;
  });
}

export async function deleteTeamRoleAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  return attempt(async () => {
    const done = await deleteRole(actor, null, str(data, "id"));
    revalidatePath("/platform", "layout");
    return done;
  });
}

export async function removeRoleAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  return attempt(async () => {
    await removeRole(actor, str(data, "assignmentId"));
    revalidatePath("/platform/team");
    return "Role removed.";
  });
}
