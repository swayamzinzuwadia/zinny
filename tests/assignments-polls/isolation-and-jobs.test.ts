import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { courses, notifications, users } from "@/db/schema";
import { systemActorFor } from "@/server/core";
import { expectTenantIsolated } from "../helpers/isolation";
import { makeDepartment, uniqueCode } from "../fixtures";
import {
  asgnAssignmentBatches,
  asgnAssignments,
  asgnFiles,
  asgnSubmissions,
  asgnSubmissionVersions,
  pollOptions,
  pollPolls,
  pollVoters,
  pollVotes,
} from "@/modules/assignments-polls/schema";
import { createAssignment, remindDueSoon, submitAssignment } from "@/modules/assignments-polls/service/assignments";
import { applyPenalty, parseMarks } from "@/modules/assignments-polls/lib/grading";
import { calendarDaysUntil, dueLabel, instantToZoned, zonedToInstant } from "@/modules/assignments-polls/lib/time";
import { T, assignmentInput, twoBatches } from "./setup";

afterAll(closeDb);

type Uni = { id: string };

async function course(uni: Uni) {
  const dept = await makeDepartment(uni.id, uniqueCode(), "Computer Science");
  const [c] = await systemDb().insert(courses).values({ universityId: uni.id, departmentId: dept.id, title: "Isolated" }).returning();
  return { dept, course: c };
}

async function assignment(uni: Uni) {
  const { dept, course: c } = await course(uni);
  const [a] = await systemDb()
    .insert(asgnAssignments)
    .values({ universityId: uni.id, courseId: c.id, departmentId: dept.id, title: "Iso", dueAt: new Date("2030-01-01"), points: 10 })
    .returning();
  return a;
}

async function batch(uni: Uni, courseId: string, departmentId: string) {
  const { batches } = await import("@/db/schema");
  const [b] = await systemDb()
    .insert(batches)
    .values({ universityId: uni.id, courseId, departmentId, name: "B", startDate: "2030-01-01", endDate: "2030-02-01", seatLimit: 5 })
    .returning();
  return b;
}

async function student() {
  const [u] = await systemDb().insert(users).values({ name: "Iso Student", email: `iso.${uniqueCode().toLowerCase()}@test.zinny` }).returning();
  return u;
}

async function submission(uni: Uni) {
  const a = await assignment(uni);
  const b = await batch(uni, a.courseId, a.departmentId);
  const s = await student();
  const [row] = await systemDb().insert(asgnSubmissions).values({ universityId: uni.id, assignmentId: a.id, userId: s.id, batchId: b.id }).returning();
  return row;
}

async function poll(uni: Uni) {
  const { dept, course: c } = await course(uni);
  const [p] = await systemDb()
    .insert(pollPolls)
    .values({ universityId: uni.id, courseId: c.id, departmentId: dept.id, question: "Iso?", opensAt: new Date("2030-01-01"), closesAt: new Date("2030-01-02") })
    .returning();
  return p;
}

describe("tenant isolation of every assignments-polls table", () => {
  it("asgn_assignments", () => expectTenantIsolated(asgnAssignments, async (uni) => {
    const { dept, course: c } = await course(uni);
    return { universityId: uni.id, courseId: c.id, departmentId: dept.id, title: "Iso", dueAt: new Date("2030-01-01"), points: 10 };
  }));

  it("asgn_assignment_batches", () => expectTenantIsolated(asgnAssignmentBatches, async (uni) => {
    const a = await assignment(uni);
    const b = await batch(uni, a.courseId, a.departmentId);
    return { universityId: uni.id, assignmentId: a.id, batchId: b.id };
  }));

  it("asgn_submissions", () => expectTenantIsolated(asgnSubmissions, async (uni) => {
    const a = await assignment(uni);
    const b = await batch(uni, a.courseId, a.departmentId);
    return { universityId: uni.id, assignmentId: a.id, userId: (await student()).id, batchId: b.id };
  }));

  it("asgn_submission_versions", () => expectTenantIsolated(asgnSubmissionVersions, async (uni) => {
    const s = await submission(uni);
    return { universityId: uni.id, submissionId: s.id, version: 1, textAnswer: "hi" };
  }));

  it("asgn_files", () => expectTenantIsolated(asgnFiles, async (uni) => {
    const id = crypto.randomUUID();
    return { id, universityId: uni.id, purpose: "attachment" as const, storageKey: `${uni.id}/assignments-polls/files/${id}/a.pdf`, fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 3 };
  }));

  it("poll_polls", () => expectTenantIsolated(pollPolls, async (uni) => {
    const { dept, course: c } = await course(uni);
    return { universityId: uni.id, courseId: c.id, departmentId: dept.id, question: "Iso?", opensAt: new Date("2030-01-01"), closesAt: new Date("2030-01-02") };
  }));

  it("poll_options", () => expectTenantIsolated(pollOptions, async (uni) => ({ universityId: uni.id, pollId: (await poll(uni)).id, label: "Yes", position: 0 })));

  it("poll_votes", () => expectTenantIsolated(pollVotes, async (uni) => {
    const p = await poll(uni);
    const [o] = await systemDb().insert(pollOptions).values({ universityId: uni.id, pollId: p.id, label: "Yes", position: 0 }).returning();
    return { universityId: uni.id, pollId: p.id, optionId: o.id, userId: null };
  }));

  it("poll_voters", () => expectTenantIsolated(pollVoters, async (uni) => ({ universityId: uni.id, pollId: (await poll(uni)).id, userId: (await student()).id })));
});

describe("the daily reminder", () => {
  it("reminds students who haven't handed in, the day before the due date, once", async () => {
    const c = await twoBatches("Reminder U");
    const a = await createAssignment(c.hod, assignmentInput(c.course.id, { title: "Remind me" }), { now: T.before });
    await submitAssignment(c.riya, { assignmentId: a.id, text: "done early" }, { now: T.before });
    const sys = systemActorFor(c.uni.id);
    const remindersFor = async () =>
      (await systemDb().select().from(notifications).where(and(eq(notifications.kind, "assignment.due_soon"), eq(notifications.universityId, c.uni.id))))
        .filter((n) => (n.data as { assignmentId?: string }).assignmentId === a.id)
        .map((n) => n.userId)
        .sort();
    // Three days before: too early.
    await remindDueSoon(sys, new Date("2030-11-11T19:00:00Z"));
    expect(await remindersFor()).toEqual([]);
    // The morning of 13 Nov IST: due tomorrow.
    await remindDueSoon(sys, new Date("2030-11-13T01:00:00Z"));
    expect(await remindersFor()).toEqual([c.kabir.userId, c.zoya.userId].sort());
    const [n] = await systemDb().select().from(notifications).where(and(eq(notifications.kind, "assignment.due_soon"), eq(notifications.userId, c.kabir.userId)));
    expect(n.title).toBe("Remind me is due tomorrow at 11:59 pm");
    // Running again sends nothing more.
    await remindDueSoon(sys, new Date("2030-11-14T01:00:00Z"));
    expect(await remindersFor()).toHaveLength(2);
  });

  it("the job is registered daily, with the poll announcer hourly", async () => {
    const m = (await import("@/modules/assignments-polls")).default;
    expect(m.jobs?.map((j) => [j.id, j.every])).toEqual([
      ["assignments-polls.daily", "day"],
      ["assignments-polls.announce-polls", "hour"],
    ]);
  });
});

describe("helpers", () => {
  it("converts deadlines between the university's wall clock and instants", () => {
    const at = zonedToInstant("2030-11-14", "23:59", "Asia/Kolkata");
    expect(at.toISOString()).toBe("2030-11-14T18:29:00.000Z");
    expect(instantToZoned(at, "Asia/Kolkata")).toEqual({ date: "2030-11-14", time: "23:59" });
    // Across a daylight saving change.
    expect(zonedToInstant("2030-03-31", "09:00", "Europe/London").toISOString()).toBe("2030-03-31T08:00:00.000Z");
    expect(calendarDaysUntil(at, "Asia/Kolkata", new Date("2030-11-13T20:00:00Z"))).toBe(0);
    expect(dueLabel(at, "Asia/Kolkata", new Date("2030-11-14T04:00:00Z"))).toBe("Due today at 11:59 pm");
    expect(dueLabel(at, "Asia/Kolkata", new Date("2030-11-15T04:00:00Z"))).toBe("Was due yesterday at 11:59 pm");
  });

  it("applies late penalties and parses marks", () => {
    expect(applyPenalty(8, 10, false, 20)).toEqual({ penaltyPct: 0, finalMarks: 8, scorePercent: 80 });
    expect(applyPenalty(8, 10, true, 25)).toEqual({ penaltyPct: 25, finalMarks: 6, scorePercent: 60 });
    expect(applyPenalty(7, 30, true, 10)).toEqual({ penaltyPct: 10, finalMarks: 6.3, scorePercent: 21 });
    expect(parseMarks(" 7,5 ", 10)).toBe(7.5);
    expect(() => parseMarks("-1", 10)).toThrow();
    expect(() => parseMarks("7.555", 10)).toThrow();
  });
});
