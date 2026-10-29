import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { prerenderToNodeStream } from "react-dom/static.node";
import { closeDb } from "@/db/client";
import { SlotList, SlotOutlet } from "@/components/slots";
import { universityLite, withTenant, type UniversityLite } from "@/server/core";
import { setTestModules, slot, slotsInReach, visibleSlots } from "@/server/registry";
import assignmentsPolls from "@/modules/assignments-polls";
import { createAssignment, gradeSubmission, submitAssignment } from "@/modules/assignments-polls/service/assignments";
import { createPoll } from "@/modules/assignments-polls/service/polls";
import { person } from "../fixtures";
import { assignmentInput, tempStorage, twoBatches, type Two } from "./setup";

const store = tempStorage();
let c: Two;
let university: UniversityLite;
const DAY = 86_400_000;

async function html(node: ReactNode) {
  const { prelude } = await prerenderToNodeStream(<>{node}</>);
  let out = "";
  for await (const chunk of prelude) out += chunk.toString();
  return out.replaceAll("<!-- -->", "");
}

/** Dates relative to now, as the slot components show real time. */
function dueIn(days: number) {
  const d = new Date(Date.now() + days * DAY);
  return { dueDate: d.toISOString().slice(0, 10), dueTime: "23:59" };
}

beforeAll(async () => {
  setTestModules([assignmentsPolls], { only: true });
  c = await twoBatches("Slots Assignments U");
  university = await withTenant(c.admin, (tx) => universityLite(tx));
  const now = new Date();
  const soon = await createAssignment(c.hod, assignmentInput(c.course.id, { title: "Due very soon", ...dueIn(1) }), { now });
  const later = await createAssignment(c.hod, assignmentInput(c.course.id, { title: "Graded essay", ...dueIn(5) }), { now });
  await submitAssignment(c.riya, { assignmentId: later.id, text: "My essay" }, { now });
  await gradeSubmission(c.farah, { assignmentId: later.id, studentId: c.riya.userId, marks: 9, feedback: "Good" });
  await submitAssignment(c.kabir, { assignmentId: soon.id, text: "Kabir's work" }, { now });
  const open = new Date(Date.now() - DAY);
  await createPoll(
    c.hod,
    {
      courseId: c.course.id,
      batchId: null,
      question: "Pick a revision day",
      options: ["Friday", "Saturday"],
      anonymous: false,
      resultsToStudents: true,
      opensDate: open.toISOString().slice(0, 10),
      opensTime: "00:00",
      closesDate: new Date(Date.now() + 3 * DAY).toISOString().slice(0, 10),
      closesTime: "18:00",
    },
    { now: new Date(open.getTime() - DAY) },
  );
});
afterEach(() => setTestModules([assignmentsPolls], { only: true }));
afterAll(async () => {
  setTestModules([]);
  store.cleanup();
  await closeDb();
});

const courseTarget = () => ({ universityId: c.uni.id, departmentIds: [c.dept.id], batchIds: [c.batchA.id, c.batchB.id] });
const course = () => ({ id: c.course.id, title: c.course.title, departmentId: c.dept.id, programId: null, status: "published" as const, certificateEnabled: true, pricePaise: 0 });

describe("slots registered by assignments-polls", () => {
  it("uses the reserved keys and orders from contracts section 3", () => {
    expect(slot("adminCourseTabs").map((t) => [t.key, t.order, t.label])).toEqual([
      ["assignments", 300, "Assignments"],
      ["polls", 310, "Polls"],
    ]);
    expect(slot("adminBatchSections").map((t) => [t.key, t.order])).toEqual([["assignments", 300]]);
    expect(slot("learnerCourseTabs").map((t) => [t.key, t.order, t.label])).toEqual([["assignments", 300, "Assignments"]]);
    expect(slot("learnerHubSections").map((t) => [t.key, t.order])).toEqual([["assignment-grades", 300]]);
    expect(slot("learnerHomeCards").map((t) => [t.key, t.order])).toEqual([["due-soon", 300]]);
    expect(slot("dashboardCards").map((t) => [t.key, t.order])).toEqual([["to-grade-assignments", 300]]);
  });

  it("course tabs: staff see Assignments, only managers see Polls; students and accounts see neither", async () => {
    const keys = (a: Parameters<typeof visibleSlots>[1]) => visibleSlots("adminCourseTabs", a, courseTarget()).map((t) => t.key);
    expect(keys(c.hod)).toEqual(["assignments", "polls"]);
    expect(keys(c.farah)).toEqual(["assignments", "polls"]);
    const board = await (await person("Board Slot", "board_owner", { universityId: c.uni.id })).actor();
    expect(keys(board)).toEqual(["assignments"]);
    const accounts = await (await person("Accounts Slot", "accounts_fees", { universityId: c.uni.id })).actor();
    expect(keys(accounts)).toEqual([]);
    expect(keys(c.riya)).toEqual([]);
  });

  it("the batch section shows for that batch's faculty but not another batch's", () => {
    const target = { universityId: c.uni.id, departmentIds: [c.dept.id], batchIds: [c.batchB.id] };
    expect(visibleSlots("adminBatchSections", c.omar, target).map((s) => s.key)).toEqual(["assignments"]);
    expect(visibleSlots("adminBatchSections", c.farah, target)).toEqual([]);
  });

  it("learner slots show for students on their own records only", () => {
    const own = { universityId: c.uni.id, ownerUserId: c.riya.userId };
    expect(visibleSlots("learnerHomeCards", c.riya, own).map((s) => s.key)).toEqual(["due-soon"]);
    expect(visibleSlots("learnerHomeCards", c.kabir, own)).toEqual([]);
    expect(visibleSlots("learnerHubSections", c.farah, { universityId: c.uni.id, ownerUserId: c.farah.userId })).toEqual([]);
  });

  it("the to-grade card shows for graders, not for students", () => {
    expect(slotsInReach("dashboardCards", c.farah, c.uni.id).map((s) => s.key)).toEqual(["to-grade-assignments"]);
    expect(slotsInReach("dashboardCards", c.riya, c.uni.id)).toEqual([]);
  });
});

describe("slot rendering", () => {
  it("the Assignments tab lists the course's work with counts and a New assignment button", async () => {
    const tab = visibleSlots("adminCourseTabs", c.hod, courseTarget()).find((t) => t.key === "assignments")!;
    const out = await html(<SlotOutlet slot="adminCourseTabs" entry={tab} props={{ uni: c.uni.slug, actor: c.hod, university, course: course(), target: courseTarget(), searchParams: {} }} />);
    expect(out).toContain("Due very soon");
    expect(out).toContain("Graded essay");
    expect(out).toContain("New assignment");
    expect(out).toContain("1 to grade");
    expect(out).not.toContain("couldn&#x27;t load");
  });

  it("the Polls tab shows results and the add form to managers", async () => {
    const tab = visibleSlots("adminCourseTabs", c.hod, courseTarget()).find((t) => t.key === "polls")!;
    const out = await html(<SlotOutlet slot="adminCourseTabs" entry={tab} props={{ uni: c.uni.slug, actor: c.hod, university, course: course(), target: courseTarget(), searchParams: {} }} />);
    expect(out).toContain("Pick a revision day");
    expect(out).toContain("Add a poll");
    expect(out).toContain("0 of 3 students voted");
  });

  it("the to-grade card lists waiting work for its grader only", async () => {
    const entries = slotsInReach("dashboardCards", c.farah, c.uni.id);
    const farahView = await html(<SlotList slot="dashboardCards" entries={entries} props={{ uni: c.uni.slug, actor: c.farah, university, today: "2030-01-01" }} />);
    expect(farahView).toContain("Assignments to grade");
    expect(farahView).toContain("Due very soon");
    const omarView = await html(<SlotList slot="dashboardCards" entries={entries} props={{ uni: c.uni.slug, actor: c.omar, university, today: "2030-01-01" }} />);
    expect(omarView).toContain("Nothing to grade");
  });

  it("the learner tab, home card and grades section show the student's own work", async () => {
    const target = { universityId: c.uni.id, departmentIds: [c.dept.id], batchIds: [c.batchA.id], ownerUserId: c.riya.userId };
    const tab = visibleSlots("learnerCourseTabs", c.riya, target)[0];
    const batch = { id: c.batchA.id, courseId: c.course.id, departmentId: c.dept.id, name: "Weekday morning", startDate: "2030-11-04", endDate: "2031-01-31", seatLimit: 20, status: "open" as const, meetingUrl: null, target };
    const enrolment = { enrolmentId: c.riyaEnrolment, courseId: c.course.id, batchId: c.batchA.id, status: "active" as const };
    const tabHtml = await html(<SlotOutlet slot="learnerCourseTabs" entry={tab} props={{ uni: c.uni.slug, actor: c.riya, university, enrolment, course: course(), batch, target, searchParams: {} }} />);
    expect(tabHtml).toContain("Due very soon");
    expect(tabHtml).toContain("Pick a revision day");
    expect(tabHtml).toContain("Graded");

    const own = { universityId: c.uni.id, ownerUserId: c.riya.userId };
    const home = await html(<SlotList slot="learnerHomeCards" entries={visibleSlots("learnerHomeCards", c.riya, own)} props={{ uni: c.uni.slug, actor: c.riya, university, today: "2030-01-01" }} />);
    expect(home).toContain("Due soon");
    expect(home).toContain("Due very soon");
    expect(home).not.toContain("Graded essay");

    const hub = await html(<SlotList slot="learnerHubSections" entries={visibleSlots("learnerHubSections", c.riya, own)} props={{ uni: c.uni.slug, actor: c.riya, university, enrolments: [enrolment] }} />);
    expect(hub).toContain("Assignment grades");
    expect(hub).toContain("Graded essay");

    // Zoya (evening batch) has nothing graded, so the grades section stays out of the way.
    const zoyaOwn = { universityId: c.uni.id, ownerUserId: c.zoya.userId };
    const empty = await html(<SlotList slot="learnerHubSections" entries={visibleSlots("learnerHubSections", c.zoya, zoyaOwn)} props={{ uni: c.uni.slug, actor: c.zoya, university, enrolments: [] }} />);
    expect(empty).toBe("");
  });
});
