import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, notifications } from "@/db/schema";
import { systemActorFor } from "@/server/core";
import { person } from "../fixtures";
import { announceOpenedPolls, closePoll, createPoll, deletePoll, listCoursePolls, myPolls, vote, type PollInput } from "@/modules/assignments-polls/service/polls";
import { pollVoters, pollVotes } from "@/modules/assignments-polls/schema";
import { twoBatches, type Two } from "./setup";

afterAll(closeDb);

let c: Two;
beforeAll(async () => {
  c = await twoBatches("Polls U");
});

// 10 Nov 2030 09:00 to 12 Nov 2030 18:00 IST
const OPEN = new Date("2030-11-10T05:00:00Z");
const BEFORE = new Date("2030-11-09T05:00:00Z");
const AFTER = new Date("2030-11-13T05:00:00Z");

function input(over: Partial<PollInput> = {}): PollInput {
  return {
    courseId: c.course.id,
    batchId: null,
    question: "Which day suits the extra class?",
    options: ["Saturday", "Sunday", "Either"],
    anonymous: false,
    resultsToStudents: true,
    opensDate: "2030-11-10",
    opensTime: "09:00",
    closesDate: "2030-11-12",
    closesTime: "18:00",
    ...over,
  };
}

describe("creating polls", () => {
  it("HOD adds a course-wide poll; faculty add one for their own batch only", async () => {
    const p = await createPoll(c.hod, input(), { now: BEFORE });
    expect(p.batchId).toBeNull();
    const mine = await createPoll(c.farah, input({ batchId: c.batchA.id, question: "Morning batch question" }), { now: BEFORE });
    expect(mine.batchId).toBe(c.batchA.id);
    await expect(createPoll(c.farah, input({ batchId: c.batchB.id }), { now: BEFORE })).rejects.toThrow(/batches you teach/);
    await expect(createPoll(c.farah, input({ batchId: null }), { now: BEFORE })).rejects.toThrow(/teach all of them/);
    await expect(createPoll(c.riya, input(), { now: BEFORE })).rejects.toThrow(/teach all of them/);
    const board = await (await person("Board Polly", "board_owner", { universityId: c.uni.id })).actor();
    await expect(createPoll(board, input({ batchId: c.batchA.id }), { now: BEFORE })).rejects.toThrow(/batches you teach/);
  });

  it("validates the question, options and window", async () => {
    await expect(createPoll(c.hod, input({ options: ["Only one"] }), { now: BEFORE })).rejects.toThrow(/at least two/);
    await expect(createPoll(c.hod, input({ options: ["Same", "same"] }), { now: BEFORE })).rejects.toThrow(/same/);
    await expect(createPoll(c.hod, input({ closesDate: "2030-11-09" }), { now: BEFORE })).rejects.toThrow(/close after it opens/);
    await expect(createPoll(c.hod, input(), { now: AFTER })).rejects.toThrow(/future/);
    await expect(createPoll(c.hod, input({ question: "?" }), { now: BEFORE })).rejects.toThrow(/question/);
  });

  it("students are told when a poll opens: at once, or by the hourly job", async () => {
    const now = await createPoll(c.hod, input({ question: "Open right away?" }), { now: OPEN });
    const later = await createPoll(c.hod, input({ question: "Opens later?" }), { now: BEFORE });
    const count = async (pollId: string) =>
      (await systemDb().select().from(notifications).where(and(eq(notifications.kind, "poll.open"), eq(notifications.universityId, c.uni.id)))).filter(
        (n) => (n.data as { pollId?: string }).pollId === pollId,
      ).length;
    expect(await count(now.id)).toBe(3);
    expect(await count(later.id)).toBe(0);
    await announceOpenedPolls(systemActorFor(c.uni.id), OPEN);
    expect(await count(later.id)).toBe(3);
    await announceOpenedPolls(systemActorFor(c.uni.id), OPEN);
    expect(await count(later.id)).toBe(3);
  });
});

describe("voting", () => {
  it("students vote once while the poll is open; voting twice is refused", async () => {
    const p = await createPoll(c.hod, input({ question: "Vote once?" }), { now: BEFORE });
    const mine = (await myPolls(c.riya, { now: OPEN })).find((x) => x.id === p.id)!;
    expect(mine).toMatchObject({ state: "open", canVote: true, voted: false });
    await expect(vote(c.riya, p.id, mine.options[0].id, { now: BEFORE })).rejects.toThrow(/hasn't opened/);
    await vote(c.riya, p.id, mine.options[0].id, { now: OPEN });
    await expect(vote(c.riya, p.id, mine.options[1].id, { now: OPEN })).rejects.toThrow(/already voted/);
    const after = (await myPolls(c.riya, { now: OPEN })).find((x) => x.id === p.id)!;
    expect(after).toMatchObject({ voted: true, canVote: false, myOptionId: mine.options[0].id });
    await expect(vote(c.kabir, p.id, mine.options[0].id, { now: AFTER })).rejects.toThrow(/closed/);
  });

  it("two votes racing at once still count once", async () => {
    const p = await createPoll(c.hod, input({ question: "Race?" }), { now: BEFORE });
    const opt = (await myPolls(c.kabir, { now: OPEN })).find((x) => x.id === p.id)!.options[1].id;
    const results = await Promise.allSettled([vote(c.kabir, p.id, opt, { now: OPEN }), vote(c.kabir, p.id, opt, { now: OPEN }), vote(c.kabir, p.id, opt, { now: OPEN })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await systemDb().select().from(pollVotes).where(eq(pollVotes.pollId, p.id))).toHaveLength(1);
  });

  it("a student never sees or votes in another batch's poll, or with an option from another poll", async () => {
    const forB = await createPoll(c.omar, input({ batchId: c.batchB.id, question: "Evening only?" }), { now: BEFORE });
    expect((await myPolls(c.riya, { now: OPEN })).map((x) => x.id)).not.toContain(forB.id);
    const zoyaPoll = (await myPolls(c.zoya, { now: OPEN })).find((x) => x.id === forB.id)!;
    await expect(vote(c.riya, forB.id, zoyaPoll.options[0].id, { now: OPEN })).rejects.toThrow(/not found/);
    const other = await createPoll(c.hod, input({ question: "Another?" }), { now: BEFORE });
    await expect(vote(c.zoya, other.id, zoyaPoll.options[0].id, { now: OPEN })).rejects.toThrow(/Pick one of the options/);
    await expect(vote(c.farah, forB.id, zoyaPoll.options[0].id, { now: OPEN })).rejects.toThrow(/access/);
  });

  it("anonymous polls store ballots without the voter; staff see totals but no names", async () => {
    const p = await createPoll(c.hod, input({ question: "Anonymous?", anonymous: true }), { now: BEFORE });
    const opts = (await myPolls(c.riya, { now: OPEN })).find((x) => x.id === p.id)!.options;
    await vote(c.riya, p.id, opts[2].id, { now: OPEN });
    await vote(c.zoya, p.id, opts[2].id, { now: OPEN });
    const ballots = await systemDb().select().from(pollVotes).where(eq(pollVotes.pollId, p.id));
    expect(ballots.map((b) => b.userId)).toEqual([null, null]);
    expect(await systemDb().select().from(pollVoters).where(eq(pollVoters.pollId, p.id))).toHaveLength(2);
    const log = await systemDb().select().from(auditLog).where(and(eq(auditLog.entityId, p.id), eq(auditLog.action, "poll.vote")));
    expect(log.every((l) => JSON.stringify(l.data) === "{}")).toBe(true);
    const r = (await listCoursePolls(c.hod, c.course.id, { now: OPEN })).find((x) => x.id === p.id)!;
    expect(r.options[2]).toMatchObject({ votes: 2, percent: 100, voters: [] });
    expect((await myPolls(c.riya, { now: OPEN })).find((x) => x.id === p.id)!.myOptionId).toBeNull();
    await expect(vote(c.riya, p.id, opts[0].id, { now: OPEN })).rejects.toThrow(/already voted/);
  });
});

describe("results", () => {
  it("staff always see results; named votes show names for the batches they manage only", async () => {
    const p = await createPoll(c.hod, input({ question: "Named results?" }), { now: BEFORE });
    const opts = (await myPolls(c.riya, { now: OPEN })).find((x) => x.id === p.id)!.options;
    await vote(c.riya, p.id, opts[0].id, { now: OPEN });
    await vote(c.zoya, p.id, opts[0].id, { now: OPEN });
    const hodView = (await listCoursePolls(c.hod, c.course.id, { now: OPEN })).find((x) => x.id === p.id)!;
    expect(hodView.options[0]).toMatchObject({ votes: 2, voters: ["Riya Student", "Zoya Student"] });
    expect(hodView).toMatchObject({ totalVotes: 2, eligible: 3, canManage: true });
    const farahView = (await listCoursePolls(c.farah, c.course.id, { now: OPEN })).find((x) => x.id === p.id)!;
    expect(farahView.options[0]).toMatchObject({ votes: 2, voters: ["Riya Student"] });
    expect(farahView.canManage).toBe(false);
  });

  it("students see results only after the poll closes, and only when allowed", async () => {
    const shown = await createPoll(c.hod, input({ question: "Shown after close?", resultsToStudents: true }), { now: BEFORE });
    const hidden = await createPoll(c.hod, input({ question: "Kept from students?", resultsToStudents: false }), { now: BEFORE });
    const o = (await myPolls(c.riya, { now: OPEN })).find((x) => x.id === shown.id)!.options;
    await vote(c.riya, shown.id, o[1].id, { now: OPEN });
    expect((await myPolls(c.riya, { now: OPEN })).find((x) => x.id === shown.id)!.results).toBeNull();
    const closed = await myPolls(c.kabir, { now: AFTER });
    expect(closed.find((x) => x.id === shown.id)!.results).toMatchObject({ totalVotes: 1, options: [{ votes: 0 }, { votes: 1, percent: 100 }, { votes: 0 }] });
    expect(JSON.stringify(closed.find((x) => x.id === shown.id))).not.toContain("Riya");
    expect(closed.find((x) => x.id === hidden.id)!.results).toBeNull();
  });

  it("managers close a poll early and delete it; others can't", async () => {
    const p = await createPoll(c.hod, input({ question: "Close early?" }), { now: BEFORE });
    await expect(closePoll(c.farah, p.id, { now: OPEN })).rejects.toThrow(/teach every batch/);
    await expect(closePoll(c.riya, p.id, { now: OPEN })).rejects.toThrow(/not found/);
    const closed = await closePoll(c.hod, p.id, { now: OPEN });
    expect(closed.closesAt.toISOString()).toBe(OPEN.toISOString());
    await expect(closePoll(c.hod, p.id, { now: OPEN })).rejects.toThrow(/already closed/);
    const mine = await createPoll(c.farah, input({ batchId: c.batchA.id, question: "Farah deletes?" }), { now: BEFORE });
    await expect(deletePoll(c.omar, mine.id)).rejects.toThrow(/not found/);
    await deletePoll(c.farah, mine.id);
    expect((await listCoursePolls(c.hod, c.course.id, { now: OPEN })).map((x) => x.id)).not.toContain(mine.id);
  });
});
