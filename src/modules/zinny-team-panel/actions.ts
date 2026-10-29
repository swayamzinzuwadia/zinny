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
import { parseRupees } from "./lib/format";
import { addRole, inviteMember, removeRole } from "./services/team";
import { createInvoice, markInvoicePaid, markInvoiceUnpaid } from "./services/billing";
import { flagCourse, markReviewed, resolveFlag } from "./services/content";
import { acknowledgeAlert, saveLicence, syncAllAlerts, type LicenceInput } from "./services/licences";
import { addContact, addNote, createPartner, makePrimaryContact, removeContact, updatePartner } from "./services/partners";
import { forceEndSupport, leaveSupport, startSupport } from "./services/support";
import { createUniversityWithLicence, setUniversityStatus, updateBasics } from "./services/universities";
import { PLATFORM_ROLE_LABELS, isPlatformRole } from "./lib/constants";
import { ValidationError } from "@/server/errors";

/** A whole number from a form field, allowing "1,000". NaN when it isn't one. */
function whole(data: FormData, key: string) {
  const v = str(data, key).replace(/[,\s]/g, "");
  return /^\d+$/.test(v) ? Number(v) : Number.NaN;
}

function licenceFrom(data: FormData): LicenceInput {
  return {
    plan: str(data, "plan"),
    studentCap: whole(data, "studentCap"),
    staffCap: whole(data, "staffCap"),
    modules: data.getAll("modules").map(String),
    startDate: str(data, "startDate"),
    endDate: str(data, "endDate"),
    notes: str(data, "notes"),
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
      invoicePrefix: str(data, "invoicePrefix"),
      licence: data.get("withLicence") === "on" ? licenceFrom(data) : null,
    });
    id = uni.id;
  });
  if (id) {
    revalidatePath("/platform", "layout");
    redirect(`/platform/universities/${id}?created=1`);
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
    return "Saved. The change is in the university's audit log.";
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
    await saveLicence(actor, id, licenceFrom(data));
    revalidatePath("/platform", "layout");
    return "Licence saved. Warnings are up to date.";
  });
}

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
    return r.forced ? "Session ended. They are out of the university on their next click." : "You have left support mode.";
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
    return "Flag added. Account Managers can see it on the university's page.";
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

/* ── Partners ── */

function partnerFrom(data: FormData) {
  return {
    name: str(data, "name"),
    kind: str(data, "kind"),
    status: str(data, "status"),
    website: str(data, "website"),
    industry: str(data, "industry"),
    city: str(data, "city"),
    summary: str(data, "summary"),
    ownerUserId: str(data, "ownerUserId"),
  };
}

export async function createPartnerAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  let id = "";
  const res = await attempt(async () => {
    const p = await createPartner(actor, partnerFrom(data));
    const contactName = str(data, "contactName");
    if (contactName) {
      await addContact(actor, p.id, { name: contactName, title: str(data, "contactTitle"), email: str(data, "contactEmail"), phone: str(data, "contactPhone") });
    }
    id = p.id;
  });
  if (id) {
    revalidatePath("/platform/partners");
    redirect(`/platform/partners/${id}`);
  }
  return res;
}

export async function updatePartnerAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  const id = str(data, "partnerId");
  return attempt(async () => {
    await updatePartner(actor, id, partnerFrom(data));
    revalidatePath("/platform/partners", "layout");
    return "Partner saved.";
  });
}

export async function addContactAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  const id = str(data, "partnerId");
  return attempt(async () => {
    await addContact(actor, id, {
      name: str(data, "name"),
      title: str(data, "title"),
      email: str(data, "email"),
      phone: str(data, "phone"),
      isPrimary: data.get("isPrimary") === "on",
    });
    revalidatePath("/platform/partners", "layout");
    return "Contact added.";
  });
}

export async function makePrimaryContactAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  return attempt(async () => {
    await makePrimaryContact(actor, str(data, "contactId"));
    revalidatePath("/platform/partners", "layout");
    return "Primary contact changed.";
  });
}

export async function removeContactAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  return attempt(async () => {
    await removeContact(actor, str(data, "contactId"));
    revalidatePath("/platform/partners", "layout");
    return "Contact removed.";
  });
}

export async function addNoteAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  const id = str(data, "partnerId");
  return attempt(async () => {
    await addNote(actor, id, str(data, "body"));
    revalidatePath(`/platform/partners/${id}`);
    return "Note added.";
  });
}

/* ── Zinny billing ── */

export async function createInvoiceAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  let id = "";
  const res = await attempt(async () => {
    const basePaise = parseRupees(str(data, "amount"));
    if (!Number.isFinite(basePaise)) throw new ValidationError("Enter the amount before GST in rupees, like 45000 or 45,000.50.");
    const inv = await createInvoice(actor, {
      universityId: str(data, "universityId"),
      periodStart: str(data, "periodStart"),
      periodEnd: str(data, "periodEnd"),
      description: str(data, "description"),
      basePaise,
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
    return `Added as ${isPlatformRole(role) ? PLATFORM_ROLE_LABELS[role] : role}. New people get an email to set their password.`;
  });
}

export async function addRoleAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  return attempt(async () => {
    const role = str(data, "role");
    await addRole(actor, str(data, "userId"), role);
    revalidatePath("/platform/team");
    return `${isPlatformRole(role) ? PLATFORM_ROLE_LABELS[role] : role} role added.`;
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
