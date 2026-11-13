"use server";

/**
 * The dashboard's quick actions and inline answers: today's classes, adding a student,
 * recording a fee, announcements, fee reminders, join requests and bulk placement.
 * Each one calls a service; the rules live there.
 */
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/forms";
import { attempt, rupeesToPaise, str } from "@/server/action";
import { spaceContext } from "@/server/context";
import { ValidationError } from "@/server/errors";
import { addSessionOverride } from "@/server/services/batches";
import { addStudentQuickly, addStudentsToBatch, placementSummary, sendAnnouncement } from "@/server/services/daily";
import { decideJoinRequest } from "@/modules/identity/joining";
import { recordFeePayment, remindOverdueFees } from "@/modules/payments/fees";
import { inr } from "@/modules/payments/money";

async function ctx(data: FormData) {
  const uni = str(data, "uni");
  const { actor } = await spaceContext(uni);
  return { uni, actor };
}

function refresh(uni: string, batchId?: string) {
  revalidatePath(`/${uni}/admin`, "layout");
  if (batchId) revalidatePath(`/${uni}/admin/products/batches/${batchId}`);
}

const fmt = (d: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${d}T00:00:00Z`));

/* ── Today's classes ── */

export async function cancelClassAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const batchId = str(data, "batchId");
  return attempt(async () => {
    await addSessionOverride(actor, batchId, { date: str(data, "date"), kind: "cancelled", note: str(data, "note") || undefined });
    refresh(uni, batchId);
    return "Class cancelled. Its students were told.";
  });
}

export async function moveClassAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const batchId = str(data, "batchId");
  return attempt(async () => {
    const newDate = str(data, "newDate");
    if (!newDate) throw new ValidationError("Pick the day to move the class to.");
    if (newDate < str(data, "date")) throw new ValidationError("Move the class to today or a later day.");
    await addSessionOverride(actor, batchId, {
      date: str(data, "date"),
      kind: "rescheduled",
      newDate,
      startTime: str(data, "startTime"),
      endTime: str(data, "endTime"),
      note: str(data, "note") || undefined,
    });
    refresh(uni, batchId);
    return `Class moved to ${fmt(newDate)}. Its students were told.`;
  });
}

export async function extraClassAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const batchId = str(data, "batchId");
  return attempt(async () => {
    if (!batchId) throw new ValidationError("Pick the batch the extra class is for.");
    const date = str(data, "date");
    if (!date) throw new ValidationError("Pick the day of the extra class.");
    await addSessionOverride(actor, batchId, { date, kind: "extra", startTime: str(data, "startTime"), endTime: str(data, "endTime"), note: str(data, "note") || undefined });
    refresh(uni, batchId);
    return `Extra class added on ${fmt(date)}. Its students were told.`;
  });
}

/* ── People and money ── */

export async function quickAddStudentAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    const paid = data.get("paid") === "on";
    const amount = str(data, "amount");
    const r = await addStudentQuickly(actor, {
      name: str(data, "name"),
      email: str(data, "email"),
      phone: str(data, "phone"),
      batchId: str(data, "batchId") || null,
      departmentId: str(data, "departmentId") || null,
      fee: paid ? { amountPaise: amount ? rupeesToPaise(amount) : null, mode: str(data, "mode"), reference: str(data, "reference") } : null,
    });
    refresh(uni, str(data, "batchId") || undefined);
    const name = str(data, "name");
    const placed = r.placement
      ? r.placement.added.length
        ? `${name} is in ${r.placement.courseTitle}, ${r.placement.batchName}.`
        : `${name} was already in ${r.placement.batchName}.`
      : `${name} is added and sees their department's courses.`;
    return [placed, r.invoiceNumber ? `Fee recorded on invoice ${r.invoiceNumber}.` : "", "They get an email to set their password."].filter(Boolean).join(" ");
  });
}

export async function recordFeeAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    const amount = str(data, "amount");
    const r = await recordFeePayment(actor, {
      email: str(data, "student"),
      courseId: str(data, "courseId") || null,
      description: str(data, "description") || null,
      amountPaise: amount ? rupeesToPaise(amount) : null,
      mode: str(data, "mode"),
      reference: str(data, "reference"),
    });
    refresh(uni);
    revalidatePath(`/${uni}/admin/finance/invoices`);
    return `Payment of ${inr(r.totalPaise)} recorded on invoice ${r.number}. The student can download it under Invoices.`;
  });
}

export async function remindOverdueAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    const r = await remindOverdueFees(actor);
    refresh(uni);
    if (r.sent === 0) return r.skipped ? "Everyone with an overdue invoice was reminded today already, or has no account here." : "No overdue invoices to remind.";
    return `Reminder sent to ${r.sent} student${r.sent === 1 ? "" : "s"}.${r.skipped ? ` ${r.skipped} skipped: reminded today already, or no account here.` : ""}`;
  });
}

export async function announceAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    const r = await sendAnnouncement(actor, { batchIds: data.getAll("batchId").map(String).filter(Boolean), title: str(data, "title"), body: str(data, "body") });
    refresh(uni);
    return `Sent to ${r.students} student${r.students === 1 ? "" : "s"}${r.batches > 1 ? ` in ${r.batches} batches` : ""}.`;
  });
}

/* ── Requests and bulk ── */

export async function decideJoinInlineAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    const accept = str(data, "choice") === "accept";
    const departmentIds = data.getAll("departmentId").map(String).filter(Boolean);
    if (accept && departmentIds.length === 0) throw new ValidationError("Pick the department this student joins.");
    await decideJoinRequest(actor, str(data, "requestId"), { accept, departmentIds });
    refresh(uni);
    const who = str(data, "name") || "The student";
    return accept ? `${who} is in. They've been told.` : `Declined. ${who} has been told by email.`;
  });
}

export async function addToBatchAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const batchId = str(data, "batchId");
  return attempt(async () => {
    if (!batchId) throw new ValidationError("Pick the batch to add them to.");
    const r = await addStudentsToBatch(actor, batchId, data.getAll("userId").map(String));
    refresh(uni, batchId);
    revalidatePath(`/${uni}/admin/users/students`);
    return placementSummary(r);
  });
}

