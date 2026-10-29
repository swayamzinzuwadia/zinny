import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { prerenderToNodeStream } from "react-dom/static.node";
import { closeDb } from "@/db/client";
import type { ZinnyModule } from "@/contracts/module";
import { SlotList, SlotOutlet } from "@/components/slots";
import { loadActor } from "@/server/actor";
import type { Actor } from "@/server/authz/engine";
import { universityLite, withTenant } from "@/server/core";
import { generatedModules } from "@/generated/registry";
import { MODULE_IDS, SLOT_NAMES } from "@/contracts/module";
import {
  eventHandlers,
  jobs,
  mailTransport,
  modules,
  paymentGateway,
  reports,
  seeds,
  setTestModules,
  slot,
  slotsInReach,
  smsTransport,
  visibleSlots,
} from "@/server/registry";
import { gateway } from "@/server/payments/gateway";
import { runJobs } from "@/server/jobs-runner";
import { setupCourse } from "../fixtures";

async function html(node: ReactNode) {
  const { prelude } = await prerenderToNodeStream(<>{node}</>);
  let out = "";
  for await (const chunk of prelude) out += chunk.toString();
  return out.replaceAll("<!-- -->", "");
}

/**
 * A module that exists only in this test: it fills every slot, registers a report, a job,
 * a seed and every transport, so we can prove core renders and uses all of them.
 */
const jobRuns: string[] = [];
const fake: ZinnyModule = {
  id: "assessments",
  adminCourseTabs: [
    { key: "zz-late", label: "Late tab", order: 900, action: "course.view", component: () => <p>late tab body</p> },
    { key: "zz-tests", label: "Fake tests", order: 400, action: "assess.manage", component: ({ course }) => <p>tests for {course.title}</p> },
    {
      key: "zz-broken",
      label: "Broken",
      order: 450,
      action: "course.view",
      component: () => {
        throw new Error("kaboom");
      },
    },
  ],
  adminBatchSections: [{ key: "zz-attendance", order: 200, action: "attendance.view", component: async ({ batch }) => <p>attendance for {batch.name}</p> }],
  learnerCourseTabs: [{ key: "zz-lessons", label: "Lessons", order: 100, action: "self.learn", component: ({ course }) => <p>lessons of {course.title}</p> }],
  learnerHubSections: [{ key: "zz-results", order: 400, action: "self.take_test", component: ({ enrolments }) => <p>{enrolments.length} results</p> }],
  learnerHomeCards: [
    { key: "zz-xp", order: 600, action: "self.view_xp", component: () => <p>xp card</p> },
    { key: "zz-continue", order: 100, action: "self.learn", component: ({ today }) => <p>continue {today}</p> },
    { key: "zz-empty", order: 300, action: "self.learn", component: () => null },
  ],
  dashboardCards: [{ key: "zz-grade", order: 400, action: "assess.grade", component: ({ university }) => <p>to grade at {university.name}</p> }],
  reports: [
    {
      id: "assessments.fake",
      label: "Fake scores",
      description: "Test report",
      action: "assess.view_results",
      filters: ["dateRange"],
      run: async () => ({ columns: [{ key: "n", label: "N", type: "number" }], rows: [{ n: 1 }] }),
    },
  ],
  jobs: [{ id: "assessments.fake-job", every: "hour", run: async (actor) => void jobRuns.push(actor.universityId!) }],
  seed: async () => {},
  eventHandlers: [{ id: "assessments.fake-handler", on: ["test.submitted"], handle: async () => {} }],
  mailTransport: { name: "fake-mail", send: async () => ({}) },
  smsTransport: { name: "fake-sms", send: async () => ({}) },
  paymentGateway: { name: "fake-gw", createOrder: async () => ({ gatewayOrderId: "x", checkout: {} }), verifyPayment: () => true, verifyWebhook: () => true, refund: async () => ({ gatewayRefundId: "r", status: "processed" }) },
};

let ctx: Awaited<ReturnType<typeof setupCourse>>;
let faculty: Actor;
let student: Actor;
let enrolmentId: string;

beforeAll(async () => {
  ctx = await setupCourse({ name: "Slots University" });
  faculty = await loadActor(ctx.facultyUserId, ctx.uni.id);
  student = await ctx.student("Slot Student");
  const { holdSeat } = await import("@/server/services/enrolment");
  enrolmentId = ((await holdSeat(student, { batchId: ctx.batch.id })) as { enrolmentId: string }).enrolmentId;
});
afterEach(() => setTestModules([]));
afterAll(closeDb);

const courseLite = () => ({
  id: ctx.course.id,
  title: ctx.course.title,
  departmentId: ctx.dept.id,
  programId: null,
  status: "published" as const,
  certificateEnabled: true,
  pricePaise: 0,
});
const courseTarget = () => ({ universityId: ctx.uni.id, departmentIds: [ctx.dept.id], batchIds: [ctx.batch.id] });

describe("contracts section 3: slots", () => {
  it("the generated registry holds the twelve modules, each under its own id", () => {
    expect(Object.keys(generatedModules).sort()).toEqual([...MODULE_IDS].sort());
    for (const [folder, m] of Object.entries(generatedModules)) expect(m.id).toBe(folder);
  });

  it("with no modules registered, every list is empty and core falls back to its own transports", () => {
    setTestModules([], { only: true });
    for (const name of SLOT_NAMES) expect(slot(name)).toEqual([]);
    expect(reports()).toEqual([]);
    expect(jobs()).toEqual([]);
    expect(eventHandlers()).toEqual([]);
    expect(seeds()).toEqual([]);
    expect(mailTransport()).toBeNull();
    expect(smsTransport()).toBeNull();
    expect(paymentGateway()).toBeNull();
    expect(gateway().name).toBe("mock");
  });

  it("every slot area renders nothing when nothing is registered", async () => {
    setTestModules([], { only: true });
    const university = await withTenant(ctx.admin, (tx) => universityLite(tx));
    const out = await html(
      <>
        <SlotList slot="dashboardCards" entries={slotsInReach("dashboardCards", ctx.admin, ctx.uni.id)} props={{ uni: "x", actor: ctx.admin, university, today: "2030-01-01" }} />
        <SlotList slot="learnerHomeCards" entries={visibleSlots("learnerHomeCards", student, { universityId: ctx.uni.id, ownerUserId: student.userId })} props={{ uni: "x", actor: student, university, today: "2030-01-01" }} />
      </>,
    );
    expect(out).toBe("");
  });

  it("a test-only module's entries are merged, sorted by order and filtered by permission", async () => {
    setTestModules([fake], { only: true });
    expect(modules().map((m) => m.id)).toEqual(["assessments"]);
    expect(slot("adminCourseTabs").map((t) => t.key)).toEqual(["zz-tests", "zz-broken", "zz-late"]);
    // Faculty of the batch hold assess.manage there; a student doesn't hold course.view at all.
    expect(visibleSlots("adminCourseTabs", faculty, courseTarget()).map((t) => t.key)).toEqual(["zz-tests", "zz-broken", "zz-late"]);
    // Faculty of another batch see neither the course tabs nor the batch section.
    expect(visibleSlots("adminCourseTabs", faculty, { universityId: ctx.uni.id, departmentIds: [ctx.dept.id], batchIds: ["other-batch"] })).toEqual([]);
    expect(visibleSlots("adminCourseTabs", ctx.admin, { universityId: ctx.uni.id, departmentIds: ["other"], batchIds: [] }).map((t) => t.key)).toEqual([
      "zz-tests",
      "zz-broken",
      "zz-late",
    ]);
    expect(visibleSlots("adminCourseTabs", student, courseTarget())).toEqual([]);
    // The Board has no assess.grade, so the dashboard card is hidden for them.
    expect(slotsInReach("dashboardCards", faculty, ctx.uni.id).map((c) => c.key)).toEqual(["zz-grade"]);
    expect(slotsInReach("dashboardCards", student, ctx.uni.id)).toEqual([]);
    expect(reports().map((r) => r.id)).toEqual(["assessments.fake"]);
    expect(eventHandlers().map((h) => h.id)).toEqual(["assessments.fake-handler"]);
    expect(seeds().map((s) => s.id)).toEqual(["assessments"]);
    expect(mailTransport()?.name).toBe("fake-mail");
    expect(smsTransport()?.name).toBe("fake-sms");
    expect(gateway().name).toBe("fake-gw");
  });

  it("renders admin course tabs, batch sections, learner tabs, hub sections, home cards and dashboard cards", async () => {
    setTestModules([fake], { only: true });
    const university = await withTenant(ctx.admin, (tx) => universityLite(tx));
    const base = { uni: ctx.uni.slug, university };
    const own = { universityId: ctx.uni.id, ownerUserId: student.userId };
    const batch = {
      id: ctx.batch.id,
      courseId: ctx.course.id,
      departmentId: ctx.dept.id,
      name: "Weekday morning",
      startDate: "2030-11-04",
      endDate: "2031-01-31",
      seatLimit: 20,
      status: "open" as const,
      meetingUrl: null,
      target: courseTarget(),
    };
    const tab = visibleSlots("adminCourseTabs", faculty, courseTarget()).find((t) => t.key === "zz-tests")!;
    const studentTab = visibleSlots("learnerCourseTabs", student, { ...courseTarget(), ownerUserId: student.userId })[0];
    const out = await html(
      <>
        <SlotOutlet slot="adminCourseTabs" entry={tab} props={{ ...base, actor: faculty, course: courseLite(), target: courseTarget(), searchParams: {} }} />
        <SlotList slot="adminBatchSections" entries={visibleSlots("adminBatchSections", faculty, courseTarget())} props={{ ...base, actor: faculty, batch, course: courseLite(), target: courseTarget() }} />
        <SlotOutlet
          slot="learnerCourseTabs"
          entry={studentTab}
          props={{
            ...base,
            actor: student,
            enrolment: { enrolmentId, courseId: ctx.course.id, batchId: ctx.batch.id, status: "active" },
            course: courseLite(),
            batch,
            target: { ...courseTarget(), ownerUserId: student.userId },
            searchParams: {},
          }}
        />
        <SlotList
          slot="learnerHubSections"
          entries={visibleSlots("learnerHubSections", student, own)}
          props={{ ...base, actor: student, enrolments: [{ enrolmentId, courseId: ctx.course.id, batchId: ctx.batch.id, status: "active" }] }}
        />
        <SlotList slot="learnerHomeCards" entries={visibleSlots("learnerHomeCards", student, own)} props={{ ...base, actor: student, today: "2030-11-04" }} />
        <SlotList slot="dashboardCards" entries={slotsInReach("dashboardCards", faculty, ctx.uni.id)} props={{ ...base, actor: faculty, today: "2030-11-04" }} />
      </>,
    );
    expect(out).toContain("tests for Data Analytics");
    expect(out).toContain("attendance for Weekday morning");
    expect(out).toContain("lessons of Data Analytics");
    expect(out).toContain("1 results");
    expect(out).toContain("to grade at Slots University");
    // Home cards in order; the card that renders nothing leaves no wrapper behind.
    expect(out.indexOf("continue 2030-11-04")).toBeLessThan(out.indexOf("xp card"));
    expect(out).not.toContain('data-slot-key="zz-empty"');
  });

  it("a failing module shows a short notice instead of breaking the page", async () => {
    setTestModules([fake], { only: true });
    const university = await withTenant(ctx.admin, (tx) => universityLite(tx));
    const broken = slot("adminCourseTabs").find((t) => t.key === "zz-broken")!;
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void errors.push(a);
    try {
      const out = await html(
        <SlotOutlet
          slot="adminCourseTabs"
          entry={broken}
          props={{ uni: "x", actor: ctx.admin, university, course: courseLite(), target: courseTarget(), searchParams: {} }}
        />,
      );
      expect(out).toContain("couldn&#x27;t load");
      expect(out).toContain("kaboom");
    } finally {
      console.error = orig;
    }
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("contracts section 5: jobs", () => {
  it("runs each job once per university as its system actor", async () => {
    setTestModules([fake], { only: true });
    jobRuns.length = 0;
    const report = await runJobs("hour", { universityId: ctx.uni.id });
    expect(report.map((r) => [r.jobId, r.ok])).toEqual([["assessments.fake-job", true]]);
    expect(jobRuns).toEqual([ctx.uni.id]);
    const daily = await runJobs("day", { universityId: ctx.uni.id });
    expect(daily.map((r) => [r.jobId, r.ok])).toEqual([["core.daily-housekeeping", true]]);
  });

  it("one failing job doesn't stop the others", async () => {
    const order: string[] = [];
    setTestModules([
      {
        id: "gamification",
        jobs: [
          {
            id: "gamification.a",
            every: "minute",
            run: async () => {
              order.push("a");
              throw new Error("a broke");
            },
          },
          { id: "gamification.b", every: "minute", run: async () => void order.push("b") },
        ],
      },
    ], { only: true });
    const errors = console.error;
    console.error = () => {};
    try {
      const report = await runJobs("minute", { universityId: ctx.uni.id });
      expect(report.map((r) => [r.jobId, r.ok])).toEqual([
        ["gamification.a", false],
        ["gamification.b", true],
      ]);
    } finally {
      console.error = errors;
    }
    expect(order).toEqual(["a", "b"]);
  });
});
