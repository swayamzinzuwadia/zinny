import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { seedDemo } from "@/db/seed";
import { setTestModules } from "@/server/registry";
import assignmentsPolls from "@/modules/assignments-polls";
import { asgnAssignments, asgnFiles, asgnSubmissions, pollPolls, pollVotes } from "@/modules/assignments-polls/schema";
import { makePdf } from "@/modules/assignments-polls/seed";
import { storage } from "@/server/core";
import { tempStorage } from "./setup";

const store = tempStorage();
afterAll(async () => {
  setTestModules([]);
  store.cleanup();
  await closeDb();
});

describe("assignments-polls seed", () => {
  it("adds two assignments per running batch, a mix of work, files and a closed poll with results", async () => {
    setTestModules([assignmentsPolls], { only: true });
    const quiet = console.log;
    console.log = () => {};
    let ctx;
    try {
      ctx = await seedDemo();
    } finally {
      console.log = quiet;
    }
    const uni = ctx.universityId;
    const list = await systemDb().select().from(asgnAssignments).where(eq(asgnAssignments.universityId, uni));
    expect(list).toHaveLength(8);
    const [counts] = await systemDb()
      .select({
        graded: sql<number>`count(*) filter (where ${asgnSubmissions.gradedAt} is not null)::int`,
        waiting: sql<number>`count(*) filter (where ${asgnSubmissions.submittedAt} is not null and ${asgnSubmissions.gradedAt} is null)::int`,
        late: sql<number>`count(*) filter (where ${asgnSubmissions.late})::int`,
        zero: sql<number>`count(*) filter (where ${asgnSubmissions.submittedAt} is null)::int`,
      })
      .from(asgnSubmissions)
      .where(eq(asgnSubmissions.universityId, uni));
    expect(counts.graded).toBeGreaterThanOrEqual(5);
    expect(counts.waiting).toBeGreaterThanOrEqual(5);
    expect(counts.late).toBeGreaterThanOrEqual(2);
    expect(counts.zero).toBe(1);
    const files = await systemDb().select().from(asgnFiles).where(eq(asgnFiles.universityId, uni));
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const f of files) expect(f.storageKey.startsWith(`${uni}/assignments-polls/`)).toBe(true);
    expect((await storage().get(files[0].storageKey))?.body.subarray(0, 5).toString()).toBe("%PDF-");
    const polls = await systemDb().select().from(pollPolls).where(eq(pollPolls.universityId, uni));
    const closed = polls.filter((p) => p.closesAt < new Date());
    expect(closed).toHaveLength(1);
    expect(await systemDb().select().from(pollVotes).where(eq(pollVotes.pollId, closed[0].id))).toHaveLength(7);
  });

  it("generates valid one-page PDFs locally", () => {
    const pdf = makePdf("Title (with) brackets", ["Line one", "Line two"]).toString();
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("\\(with\\)");
    const xref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(xref, xref + 4)).toBe("xref");
  });
});
