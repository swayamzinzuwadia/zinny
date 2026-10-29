import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { prerenderToNodeStream } from "react-dom/static.node";
import { closeDb } from "@/db/client";
import assessments from "@/modules/assessments";
import { startAttempt, submitAttempt, paperFor, saveAnswer } from "@/modules/assessments/attempts";
import { jobs, reports, setTestModules, slotsInReach, visibleSlots } from "@/server/registry";
import { runJobs } from "@/server/jobs-runner";
import { universityLite, withTenant } from "@/server/core";
import { SlotList, SlotOutlet } from "@/components/slots";
import { eq } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { assessAttempts } from "@/modules/assessments/schema";
import { quiz, single, world, type World } from "./setup";

afterEach(() => setTestModules([]));
afterAll(closeDb);

async function html(node: ReactNode) {
  const { prelude } = await prerenderToNodeStream(<>{node}</>);
  let out = "";
  for await (const chunk of prelude) out += chunk.toString();
  return out.replaceAll("<!-- -->", "");
}

const courseLite = (w: World) => ({
  id: w.course.id,
  title: w.course.title,
  departmentId: w.dept.id,
  programId: null,
  status: "published" as const,
  certificateEnabled: true,
  pricePaise: 0,
});

describe("assessments: slots", () => {
  it("registers every reserved slot key and order", () => {
    expect(assessments.adminCourseTabs).toMatchObject([{ key: "tests", order: 400, label: "Tests" }]);
    expect(assessments.adminBatchSections).toMatchObject([{ key: "tests", order: 400 }]);
    expect(assessments.learnerCourseTabs).toMatchObject([{ key: "tests", order: 400, label: "Tests" }]);
    expect(assessments.learnerHubSections).toMatchObject([{ key: "test-results", order: 400 }]);
    expect(assessments.learnerHomeCards).toMatchObject([{ key: "upcoming-tests", order: 400 }]);
    expect(assessments.dashboardCards).toMatchObject([{ key: "to-grade-tests", order: 400 }]);
  });

  it("the course Tests tab lists the course's tests for staff, and not for students", async () => {
    setTestModules([assessments], { only: true });
    const w = await world("Slot Course U");
    await quiz(w, [single("Slot question")], { title: "Slot quiz" });
    const target = { universityId: w.uni.id, departmentIds: [w.dept.id], batchIds: [w.morning.id, w.evening.id] };
    const tab = visibleSlots("adminCourseTabs", w.farah, target).find((t) => t.key === "tests")!;
    expect(tab).toBeTruthy();
    expect(visibleSlots("adminCourseTabs", w.riya, target)).toEqual([]);
    const university = await withTenant(w.admin, (tx) => universityLite(tx));
    const out = await html(
      <SlotOutlet slot="adminCourseTabs" entry={tab} props={{ uni: w.uni.slug, actor: w.hod, university, course: courseLite(w), target, searchParams: {} }} />,
    );
    expect(out).toContain("Slot quiz");
    expect(out).toContain("New test");
  });

  it("the batch section shows tests for that batch", async () => {
    setTestModules([assessments], { only: true });
    const w = await world("Slot Batch U");
    await quiz(w, [single("Evening slot question")], { by: w.neil, allBatches: false, batchIds: [w.evening.id], title: "Evening only" });
    await quiz(w, [single("Course slot question")], { title: "Whole course" });
    const university = await withTenant(w.admin, (tx) => universityLite(tx));
    const morningTarget = { universityId: w.uni.id, departmentIds: [w.dept.id], batchIds: [w.morning.id] };
    const entries = visibleSlots("adminBatchSections", w.hod, morningTarget);
    const batch = { ...w.morning, courseId: w.course.id, departmentId: w.dept.id, meetingUrl: null, target: morningTarget, status: "open" as const };
    const out = await html(<SlotList slot="adminBatchSections" entries={entries} props={{ uni: w.uni.slug, actor: w.hod, university, batch, course: courseLite(w), target: morningTarget }} />);
    expect(out).toContain("Whole course");
    expect(out).not.toContain("Evening only");
  });

  it("learner slots: course tab, home card and hub results for the student's own batch", async () => {
    setTestModules([assessments], { only: true });
    const w = await world("Slot Learner U");
    const { test } = await quiz(w, [single("Learner slot question")], { title: "Learner quiz" });
    await quiz(w, [single("Other batch question")], { by: w.neil, allBatches: false, batchIds: [w.evening.id], title: "Not for Riya" });
    const university = await withTenant(w.admin, (tx) => universityLite(tx));
    const own = { universityId: w.uni.id, ownerUserId: w.riya.userId };
    const home = await html(
      <SlotList slot="learnerHomeCards" entries={visibleSlots("learnerHomeCards", w.riya, own)} props={{ uni: w.uni.slug, actor: w.riya, university, today: "2030-11-04" }} />,
    );
    expect(home).toContain("Learner quiz");
    expect(home).not.toContain("Not for Riya");

    const { attemptId } = await startAttempt(w.riya, test.id);
    const p = await paperFor(w.riya, attemptId);
    if (p.state === "in_progress") await saveAnswer(w.riya, attemptId, p.paper.items[0].id, { option: p.paper.items[0].options[0].id });
    await submitAttempt(w.riya, attemptId);
    const enrolments = [{ enrolmentId: "e", courseId: w.course.id, batchId: w.morning.id, status: "active" as const }];
    const hub = await html(<SlotList slot="learnerHubSections" entries={visibleSlots("learnerHubSections", w.riya, own)} props={{ uni: w.uni.slug, actor: w.riya, university, enrolments }} />);
    expect(hub).toContain("Test results");
    expect(hub).toContain("Learner quiz");

    const batchTarget = { universityId: w.uni.id, departmentIds: [w.dept.id], batchIds: [w.morning.id], ownerUserId: w.riya.userId };
    const tab = visibleSlots("learnerCourseTabs", w.riya, batchTarget).find((t) => t.key === "tests")!;
    const batch = { ...w.morning, courseId: w.course.id, departmentId: w.dept.id, meetingUrl: null, target: batchTarget, status: "open" as const };
    const courseTab = await html(
      <SlotOutlet
        slot="learnerCourseTabs"
        entry={tab}
        props={{ uni: w.uni.slug, actor: w.riya, university, enrolment: enrolments[0], course: courseLite(w), batch, target: batchTarget, searchParams: {} }}
      />,
    );
    expect(courseTab).toContain("Learner quiz");
    expect(courseTab).not.toContain("Not for Riya");
    // Staff don't get learner slots.
    expect(visibleSlots("learnerHomeCards", w.hod, { universityId: w.uni.id, ownerUserId: w.hod.userId })).toEqual([]);
  });

  it("the dashboard card shows short answers waiting, only to people who can grade them", async () => {
    setTestModules([assessments], { only: true });
    const w = await world("Slot Dashboard U");
    const { test } = await quiz(w, [{ type: "short", prompt: "Explain a primary key.", marks: 2 }], { title: "Keys quiz" });
    const { attemptId } = await startAttempt(w.tara, test.id); // evening batch: Neil's
    const p = await paperFor(w.tara, attemptId);
    if (p.state === "in_progress") await saveAnswer(w.tara, attemptId, p.paper.items[0].id, { text: "Unique id for a row" });
    await submitAttempt(w.tara, attemptId);
    const university = await withTenant(w.admin, (tx) => universityLite(tx));
    const render = async (actor: World["hod"]) =>
      html(<SlotList slot="dashboardCards" entries={slotsInReach("dashboardCards", actor, w.uni.id)} props={{ uni: w.uni.slug, actor, university, today: "2030-11-04" }} />);
    expect(await render(w.neil)).toContain("Keys quiz");
    const farahView = await render(w.farah);
    expect(farahView).toContain("No short answers waiting");
    expect(farahView).not.toContain("Keys quiz");
    expect(slotsInReach("dashboardCards", w.riya, w.uni.id)).toEqual([]);
  });
});

describe("assessments: the test-scores report", () => {
  it("is registered with date, course and batch filters, and scoped by reach", async () => {
    setTestModules([assessments], { only: true });
    const report = reports().find((r) => r.id === "assessments.test-scores")!;
    expect(report).toMatchObject({ label: "Test scores", action: "assess.view_results", filters: ["dateRange", "course", "batch"] });

    const w = await world("Report U");
    const { test } = await quiz(w, [single("Report question")], { title: "Report quiz" });
    for (const s of [w.riya, w.tara]) {
      const { attemptId } = await startAttempt(s, test.id);
      await submitAttempt(s, attemptId);
    }
    const all = await report.run(w.hod, {});
    expect(all.rows.map((r) => r.student).sort()).toEqual(["Riya Student", "Tara Student"]);
    expect(all.columns.find((c) => c.key === "percent")?.type).toBe("percent");
    expect((await report.run(w.farah, {})).rows.map((r) => r.student)).toEqual(["Riya Student"]);
    expect((await report.run(w.hod, { batchId: w.evening.id })).rows.map((r) => r.student)).toEqual(["Tara Student"]);
    expect((await report.run(w.hod, { courseId: w.course.id })).rows).toHaveLength(2);
    expect((await report.run(w.hod, { from: "2099-01-01", to: "2099-12-31" })).rows).toHaveLength(0);
    expect((await report.run(w.mktHod, {})).rows).toHaveLength(0);
    expect((await report.run(w.riya, {})).rows).toHaveLength(0);
  });
});

describe("assessments: the expiry job", () => {
  it("is registered every minute and closes timed-out attempts through the job runner", async () => {
    setTestModules([assessments], { only: true });
    expect(jobs("minute").map((j) => j.id)).toContain("assessments.close-expired-attempts");
    const w = await world("Job Runner U");
    const { test } = await quiz(w, [single("Job runner question")], { proctoring: { timeLimitMinutes: 5 } });
    const { attemptId } = await startAttempt(w.riya, test.id);
    await systemDb().update(assessAttempts).set({ endsAt: new Date(Date.now() - 60_000) }).where(eq(assessAttempts.id, attemptId));
    const report = await runJobs("minute", { universityId: w.uni.id });
    expect(report.find((r) => r.jobId === "assessments.close-expired-attempts")?.ok).toBe(true);
    const [row] = await systemDb().select().from(assessAttempts).where(eq(assessAttempts.id, attemptId));
    expect(row.status).toBe("graded");
  });
});
