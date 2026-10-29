/**
 * Course polls (PRD page 7: "Polls can be added to a course").
 *
 * A single-choice question for a whole course or one batch, open between two times.
 * Staff with `poll.manage` create, close and delete polls and always see the results.
 * Students in the course (or that batch) vote once while it's open, and see the results
 * after it closes when the poll allows it. On an anonymous poll the ballot is stored
 * without the voter; poll_voters only records that they voted, so they can't vote twice.
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { enrolments } from "@/db/schema";
import {
  assertCan,
  audit,
  batchStudentIds,
  can,
  getCourseLite,
  listCourseBatches,
  notify,
  peopleLite,
  reach,
  universityLite,
  withTenant,
  type Actor,
} from "@/server/core";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { batchesWhere, canOnAll, courseBatchIds, deptTarget, learnerSeats, names, ownTarget, uni, type LearnerSeat } from "../access";
import { formatWhen, zonedToInstant } from "../lib/time";
import { pollOptions, pollPolls, pollVoters, pollVotes } from "../schema";

export type PollRow = typeof pollPolls.$inferSelect;
export type PollState = "upcoming" | "open" | "closed";

export const MAX_OPTIONS = 10;
type Opts = { now?: Date };

export type PollInput = {
  courseId: string;
  /** Null or "" for every batch of the course. */
  batchId: string | null;
  question: string;
  options: string[];
  anonymous: boolean;
  resultsToStudents: boolean;
  opensDate: string;
  opensTime: string;
  closesDate: string;
  closesTime: string;
};

export function pollState(p: Pick<PollRow, "opensAt" | "closesAt">, now = new Date()): PollState {
  if (now.getTime() < p.opensAt.getTime()) return "upcoming";
  if (now.getTime() < p.closesAt.getTime()) return "open";
  return "closed";
}

/** The batches a poll reaches: its one batch, or every batch of the course. */
async function pollBatchIds(tx: Tx, p: Pick<PollRow, "courseId" | "batchId">) {
  return p.batchId ? [p.batchId] : courseBatchIds(tx, p.courseId);
}

/** May manage (and see results of) this poll: on its batch, or on every batch of a course-wide poll. */
function canManagePoll(actor: Actor, p: Pick<PollRow, "departmentId">, batchIds: string[]) {
  return canOnAll(actor, "poll.manage", p.departmentId, batchIds);
}

/** Sees the poll at all: holds poll.manage on at least one batch it reaches (or the department). */
function canSeePoll(actor: Actor, p: Pick<PollRow, "departmentId">, batchIds: string[]) {
  if (batchIds.length === 0) return can(actor, "poll.manage", deptTarget(uni(actor), p.departmentId));
  return batchesWhere(actor, "poll.manage", p.departmentId, batchIds).length > 0;
}

async function announce(tx: Tx, actor: Actor, p: PollRow) {
  const bs = await pollBatchIds(tx, p);
  const students = [...new Set((await Promise.all(bs.map((b) => batchStudentIds(tx, b)))).flat())];
  const u = await universityLite(tx);
  const course = await getCourseLite(tx, p.courseId);
  await notify(tx, uni(actor), students, {
    kind: "poll.open",
    title: `New poll in ${course.title}`,
    body: `${p.question} Vote by ${formatWhen(p.closesAt, u.timezone)}.`,
    data: { pollId: p.id, href: `/${u.slug}/learn/polls` },
  });
  await tx.update(pollPolls).set({ announcedAt: new Date() }).where(eq(pollPolls.id, p.id));
}

/* ───────────────────────────── Staff ───────────────────────────── */

export async function createPoll(actor: Actor, input: PollInput, opts: Opts = {}): Promise<PollRow> {
  const now = opts.now ?? new Date();
  return withTenant(actor, async (tx) => {
    const course = await getCourseLite(tx, input.courseId);
    const courseBatches = await courseBatchIds(tx, course.id);
    const batchId = input.batchId || null;
    if (batchId && !courseBatches.includes(batchId)) throw new NotFoundError("Batch");
    const scope = batchId ? [batchId] : courseBatches;
    if (!canManagePoll(actor, course, scope)) {
      throw new ForbiddenError(batchId ? "You can only add polls to batches you teach." : "You can only add a poll for every batch when you teach all of them. Pick your batch instead.");
    }
    const question = (input.question ?? "").trim().replace(/\s+/g, " ");
    if (question.length < 3) throw new ValidationError("Write the question, at least 3 characters.");
    if (question.length > 300) throw new ValidationError("Keep the question under 300 characters.");
    const labels = (input.options ?? []).map((o) => (o ?? "").trim().replace(/\s+/g, " ")).filter(Boolean);
    if (labels.length < 2) throw new ValidationError("Give at least two options to choose from.");
    if (labels.length > MAX_OPTIONS) throw new ValidationError(`A poll can have at most ${MAX_OPTIONS} options.`);
    if (labels.some((l) => l.length > 120)) throw new ValidationError("Keep each option under 120 characters.");
    if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length) throw new ValidationError("Two options are the same. Make each option different.");
    const tz = (await universityLite(tx)).timezone;
    const opensAt = zonedToInstant(input.opensDate, input.opensTime, tz, "opening");
    const closesAt = zonedToInstant(input.closesDate, input.closesTime, tz, "closing");
    if (closesAt.getTime() <= opensAt.getTime()) throw new ValidationError("The poll must close after it opens.");
    if (closesAt.getTime() <= now.getTime()) throw new ValidationError("Pick a closing time in the future.");

    const [p] = await tx
      .insert(pollPolls)
      .values({
        universityId: uni(actor),
        courseId: course.id,
        departmentId: course.departmentId,
        batchId,
        question,
        anonymous: !!input.anonymous,
        resultsToStudents: !!input.resultsToStudents,
        opensAt,
        closesAt,
        createdBy: actor.userId || null,
      })
      .returning();
    await tx.insert(pollOptions).values(labels.map((label, position) => ({ universityId: uni(actor), pollId: p.id, label, position })));
    await audit(tx, actor, "poll.create", "poll", p.id, { courseId: course.id, batchId, question, options: labels.length, anonymous: p.anonymous });
    if (opensAt.getTime() <= now.getTime()) await announce(tx, actor, p);
    return p;
  });
}

async function loadManaged(tx: Tx, actor: Actor, pollId: string) {
  const [p] = await tx.select().from(pollPolls).where(eq(pollPolls.id, pollId)).for("update");
  if (!p) throw new NotFoundError("Poll");
  const bs = await pollBatchIds(tx, p);
  if (!canSeePoll(actor, p, bs)) throw new NotFoundError("Poll");
  if (!canManagePoll(actor, p, bs)) throw new ForbiddenError("Only staff who teach every batch of this poll can change it.");
  return p;
}

/** Closes an open poll now (or cancels one that hasn't opened). */
export async function closePoll(actor: Actor, pollId: string, opts: Opts = {}) {
  const now = opts.now ?? new Date();
  return withTenant(actor, async (tx) => {
    const p = await loadManaged(tx, actor, pollId);
    if (pollState(p, now) === "closed") throw new ConflictError("This poll has already closed.");
    const opensAt = p.opensAt.getTime() > now.getTime() ? new Date(now.getTime() - 1) : p.opensAt;
    const [closed] = await tx.update(pollPolls).set({ opensAt, closesAt: now }).where(eq(pollPolls.id, p.id)).returning();
    await audit(tx, actor, "poll.close", "poll", p.id, { scheduledClose: p.closesAt.toISOString() });
    return closed;
  });
}

export async function deletePoll(actor: Actor, pollId: string) {
  return withTenant(actor, async (tx) => {
    const p = await loadManaged(tx, actor, pollId);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(pollVoters).where(eq(pollVoters.pollId, p.id));
    await tx.delete(pollPolls).where(eq(pollPolls.id, p.id));
    await audit(tx, actor, "poll.delete", "poll", p.id, { question: p.question, votes: n });
  });
}

export type PollResult = {
  id: string;
  courseId: string;
  courseTitle: string;
  batchId: string | null;
  batchName: string | null;
  question: string;
  anonymous: boolean;
  resultsToStudents: boolean;
  opensAt: Date;
  closesAt: Date;
  state: PollState;
  totalVotes: number;
  /** Students the poll reaches now (active seats). */
  eligible: number;
  options: { id: string; label: string; votes: number; percent: number; voters: string[] }[];
  canManage: boolean;
};

async function results(tx: Tx, actor: Actor | null, list: PollRow[], now: Date, withNames: boolean): Promise<PollResult[]> {
  if (list.length === 0) return [];
  const ids = list.map((p) => p.id);
  const opts = await tx.select().from(pollOptions).where(inArray(pollOptions.pollId, ids)).orderBy(asc(pollOptions.position));
  const counts = await tx
    .select({ optionId: pollVotes.optionId, n: sql<number>`count(*)::int` })
    .from(pollVotes)
    .where(inArray(pollVotes.pollId, ids))
    .groupBy(pollVotes.optionId);
  const named = withNames ? await tx.select().from(pollVotes).where(and(inArray(pollVotes.pollId, ids), sql`${pollVotes.userId} is not null`)) : [];
  const people = new Map((await peopleLite(tx, named.map((v) => v.userId!))).map((p) => [p.id, p.name]));
  const n = await names(tx, list.map((p) => p.courseId), list.flatMap((p) => (p.batchId ? [p.batchId] : [])));
  const out: PollResult[] = [];
  for (const p of list) {
    const bs = await pollBatchIds(tx, p);
    const eligible = new Set((await Promise.all(bs.map((b) => batchStudentIds(tx, b)))).flat()).size;
    // Names only for students in batches the viewer manages.
    let visibleVoters: Set<string> | null = null;
    if (withNames && actor && !p.anonymous) {
      const managed = batchesWhere(actor, "poll.manage", p.departmentId, bs);
      const seats = managed.length
        ? await tx.select({ userId: enrolments.userId }).from(enrolments).where(and(inArray(enrolments.batchId, managed), inArray(enrolments.status, ["active", "completed"])))
        : [];
      visibleVoters = new Set(seats.map((s) => s.userId));
    }
    const mine = opts.filter((o) => o.pollId === p.id);
    const total = mine.reduce((sum, o) => sum + (counts.find((c) => c.optionId === o.id)?.n ?? 0), 0);
    out.push({
      id: p.id,
      courseId: p.courseId,
      courseTitle: n.course.get(p.courseId) ?? "",
      batchId: p.batchId,
      batchName: p.batchId ? (n.batch.get(p.batchId) ?? "") : null,
      question: p.question,
      anonymous: p.anonymous,
      resultsToStudents: p.resultsToStudents,
      opensAt: p.opensAt,
      closesAt: p.closesAt,
      state: pollState(p, now),
      totalVotes: total,
      eligible,
      options: mine.map((o) => {
        const votes = counts.find((c) => c.optionId === o.id)?.n ?? 0;
        return {
          id: o.id,
          label: o.label,
          votes,
          percent: total ? Math.round((votes / total) * 1000) / 10 : 0,
          voters: visibleVoters
            ? named
                .filter((v) => v.optionId === o.id && visibleVoters!.has(v.userId!))
                .map((v) => people.get(v.userId!) ?? "")
                .filter(Boolean)
                .sort()
            : [],
        };
      }),
      canManage: actor ? canManagePoll(actor, p, bs) : false,
    });
  }
  return out;
}

/** Polls of a course the actor manages in at least one batch, with full results. */
export async function listCoursePolls(actor: Actor, courseId: string, opts: Opts = {}): Promise<PollResult[]> {
  const now = opts.now ?? new Date();
  return withTenant(actor, async (tx) => {
    await getCourseLite(tx, courseId);
    const list = await tx.select().from(pollPolls).where(eq(pollPolls.courseId, courseId));
    const visible: PollRow[] = [];
    for (const p of list) if (canSeePoll(actor, p, await pollBatchIds(tx, p))) visible.push(p);
    const rank = { open: 0, upcoming: 1, closed: 2 } as const;
    return (await results(tx, actor, visible, now, true)).sort(
      (a, b) => rank[a.state] - rank[b.state] || (a.state === "closed" ? b.closesAt.getTime() - a.closesAt.getTime() : a.closesAt.getTime() - b.closesAt.getTime()),
    );
  });
}

/** Batches the actor can add a poll to, and whether they can add one for the whole course. */
export async function pollFormOptions(actor: Actor, courseId: string) {
  return withTenant(actor, async (tx) => {
    const course = await getCourseLite(tx, courseId);
    const bs = await listCourseBatches(tx, courseId);
    const manageable = bs.filter((b) => can(actor, "poll.manage", b.target));
    return {
      batches: manageable.map((b) => ({ id: b.id, name: b.name })),
      canAll: canOnAll(actor, "poll.manage", course.departmentId, bs.map((b) => b.id)),
      timezone: (await universityLite(tx)).timezone,
    };
  });
}

/* ───────────────────────────── Students ───────────────────────────── */

export type LearnerPoll = {
  id: string;
  courseId: string;
  courseTitle: string;
  question: string;
  anonymous: boolean;
  state: PollState;
  opensAt: Date;
  closesAt: Date;
  options: { id: string; label: string }[];
  voted: boolean;
  /** The option the student chose (named polls only). */
  myOptionId: string | null;
  canVote: boolean;
  /** Shown after the poll closes, when the poll allows it. Totals only, never names. */
  results: { totalVotes: number; options: { id: string; label: string; votes: number; percent: number }[] } | null;
};

function reaches(p: PollRow, seats: LearnerSeat[]) {
  return seats.filter((s) => s.courseId === p.courseId && (!p.batchId || p.batchId === s.batchId));
}

/** Polls in the student's courses: open ones first, then upcoming, then closed (newest first). */
export async function myPolls(actor: Actor, opts: Opts & { courseId?: string } = {}): Promise<LearnerPoll[]> {
  assertCan(actor, "self.vote", ownTarget(actor));
  const now = opts.now ?? new Date();
  return withTenant(actor, async (tx) => {
    const seats = (await learnerSeats(tx, actor.userId)).filter((s) => !opts.courseId || s.courseId === opts.courseId);
    if (seats.length === 0) return [];
    const candidates = await tx.select().from(pollPolls).where(inArray(pollPolls.courseId, [...new Set(seats.map((s) => s.courseId))]));
    const list = candidates.filter((p) => reaches(p, seats).length > 0);
    if (list.length === 0) return [];
    const ids = list.map((p) => p.id);
    const options = await tx.select().from(pollOptions).where(inArray(pollOptions.pollId, ids)).orderBy(asc(pollOptions.position));
    const voted = new Set((await tx.select({ pollId: pollVoters.pollId }).from(pollVoters).where(and(eq(pollVoters.userId, actor.userId), inArray(pollVoters.pollId, ids)))).map((v) => v.pollId));
    const mine = await tx.select({ pollId: pollVotes.pollId, optionId: pollVotes.optionId }).from(pollVotes).where(and(eq(pollVotes.userId, actor.userId), inArray(pollVotes.pollId, ids)));
    const shown = list.filter((p) => pollState(p, now) === "closed" && p.resultsToStudents);
    const full = await results(tx, null, shown, now, false);
    const n = await names(tx, list.map((p) => p.courseId), []);
    const rank = { open: 0, upcoming: 1, closed: 2 } as const;
    return list
      .map((p): LearnerPoll => {
        const state = pollState(p, now);
        const active = reaches(p, seats).some((s) => s.status === "active");
        const r = full.find((x) => x.id === p.id);
        return {
          id: p.id,
          courseId: p.courseId,
          courseTitle: n.course.get(p.courseId) ?? "",
          question: p.question,
          anonymous: p.anonymous,
          state,
          opensAt: p.opensAt,
          closesAt: p.closesAt,
          options: options.filter((o) => o.pollId === p.id).map((o) => ({ id: o.id, label: o.label })),
          voted: voted.has(p.id),
          myOptionId: mine.find((m) => m.pollId === p.id)?.optionId ?? null,
          canVote: state === "open" && active && !voted.has(p.id),
          results: r ? { totalVotes: r.totalVotes, options: r.options.map(({ id, label, votes, percent }) => ({ id, label, votes, percent })) } : null,
        };
      })
      .sort((a, b) => rank[a.state] - rank[b.state] || (a.state === "closed" ? b.closesAt.getTime() - a.closesAt.getTime() : a.closesAt.getTime() - b.closesAt.getTime()));
  });
}

/** Records the student's vote. One vote per student per poll, even when two requests race. */
export async function vote(actor: Actor, pollId: string, optionId: string, opts: Opts = {}) {
  assertCan(actor, "self.vote", ownTarget(actor));
  const now = opts.now ?? new Date();
  return withTenant(actor, async (tx) => {
    const [p] = await tx.select().from(pollPolls).where(eq(pollPolls.id, pollId));
    if (!p) throw new NotFoundError("Poll");
    const seats = reaches(p, await learnerSeats(tx, actor.userId));
    if (seats.length === 0) throw new NotFoundError("Poll");
    if (!seats.some((s) => s.status === "active")) throw new ValidationError("This course has ended, so you can't vote in its polls.");
    const state = pollState(p, now);
    if (state === "upcoming") throw new ValidationError("This poll hasn't opened yet.");
    if (state === "closed") throw new ValidationError("This poll has closed.");
    const [option] = await tx.select().from(pollOptions).where(and(eq(pollOptions.id, optionId), eq(pollOptions.pollId, p.id)));
    if (!option) throw new ValidationError("Pick one of the options.");
    const [first] = await tx
      .insert(pollVoters)
      .values({ universityId: uni(actor), pollId: p.id, userId: actor.userId, votedAt: now })
      .onConflictDoNothing()
      .returning();
    if (!first) throw new ConflictError("You've already voted in this poll.", "already_voted");
    await tx.insert(pollVotes).values({ universityId: uni(actor), pollId: p.id, optionId: option.id, userId: p.anonymous ? null : actor.userId });
    // The audit entry never names the option, so anonymous ballots stay anonymous.
    await audit(tx, actor, "poll.vote", "poll", p.id, {});
    return { pollId: p.id };
  });
}

/* ───────────────────────────── Jobs ───────────────────────────── */

/** Hourly: tells students about polls that have opened since the last run. */
export async function announceOpenedPolls(actor: Actor, now = new Date()) {
  return withTenant(actor, async (tx) => {
    const due = await tx
      .select()
      .from(pollPolls)
      .where(and(isNull(pollPolls.announcedAt), sql`${pollPolls.opensAt} <= ${now.toISOString()}::timestamptz`, sql`${pollPolls.closesAt} > ${now.toISOString()}::timestamptz`));
    for (const p of due) await announce(tx, actor, p);
    return due.length;
  });
}

/** Whether the actor manages polls anywhere (for showing the Polls tab's create form). */
export function managesPolls(actor: Actor) {
  const r = reach(actor, "poll.manage", uni(actor));
  return r.all || r.departmentIds.size > 0 || r.batchIds.size > 0;
}
