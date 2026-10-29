"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/forms";
import { attempt, str } from "@/server/action";
import { spaceContext } from "@/server/context";
import { ValidationError } from "@/server/errors";
import { attendanceHref } from "./links";
import { lockRegister, markAttendance, setAttendanceThreshold, unlockRegister, updateSessionLinks, type Mark } from "./staff";
import { ATTENDANCE_STATUSES, type AttendanceStatus } from "./time";

async function ctx(data: FormData) {
  const uni = str(data, "uni");
  const { actor } = await spaceContext(uni);
  const ref = { batchId: str(data, "batchId"), date: str(data, "date"), startTime: str(data, "start") || null };
  return { uni, actor, ref };
}

function refresh(uni: string, batchId: string) {
  revalidatePath(attendanceHref(uni, batchId), "layout");
  revalidatePath(`/${uni}/admin/products/batches/${batchId}`);
  revalidatePath(`/${uni}/admin`);
}

/**
 * The register form sends, per student, the status shown (`was:`), the status picked
 * (`status:`) and the note (`note:` / `wasNote:`). Only rows someone changed are saved, so
 * saving never turns an automatic status into a staff mark by accident.
 */
export async function saveRegisterAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor, ref } = await ctx(data);
  return attempt(async () => {
    const marks: Mark[] = [];
    for (const userId of data.getAll("student").map(String)) {
      const status = str(data, `status:${userId}`);
      const note = str(data, `note:${userId}`);
      if (status === str(data, `was:${userId}`) && note === str(data, `wasNote:${userId}`)) continue;
      if (!status) {
        if (note) throw new ValidationError("Pick present, late or absent for each student you add a note for, then save.");
        continue;
      }
      if (!ATTENDANCE_STATUSES.includes(status as AttendanceStatus)) throw new ValidationError("Pick present, late or absent.");
      marks.push({ userId, status: status as AttendanceStatus, note });
    }
    if (marks.length === 0) return "Nothing changed.";
    const { changed } = await markAttendance(actor, ref, marks);
    refresh(uni, ref.batchId);
    return changed === 1 ? "Saved 1 change." : `Saved ${changed} changes.`;
  });
}

export async function lockRegisterAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor, ref } = await ctx(data);
  return attempt(async () => {
    const r = await lockRegister(actor, ref);
    refresh(uni, ref.batchId);
    if (r.status === "already_locked") return "This register was already locked.";
    return r.absent ? `Register locked. ${r.absent} student${r.absent === 1 ? "" : "s"} without a status marked absent.` : "Register locked.";
  });
}

export async function unlockRegisterAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor, ref } = await ctx(data);
  return attempt(async () => {
    await unlockRegister(actor, ref);
    refresh(uni, ref.batchId);
    return "Register unlocked. Faculty can change it again.";
  });
}

export async function saveLinksAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor, ref } = await ctx(data);
  return attempt(async () => {
    await updateSessionLinks(actor, ref, {
      meetingUrl: data.has("meetingUrl") ? str(data, "meetingUrl") : undefined,
      recordingUrl: data.has("recordingUrl") ? str(data, "recordingUrl") : undefined,
    });
    refresh(uni, ref.batchId);
    return "Links saved.";
  });
}

export async function setThresholdAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  const { actor } = await spaceContext(uni);
  return attempt(async () => {
    const raw = str(data, "threshold").replace("%", "");
    const value = await setAttendanceThreshold(actor, raw === "" ? NaN : Number(raw));
    revalidatePath(`/${uni}/admin`, "layout");
    return `Threshold set to ${value}%. Students below it are highlighted and alerted each week.`;
  });
}
