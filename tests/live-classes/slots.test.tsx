import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { prerenderToNodeStream } from "react-dom/static.node";
import { closeDb } from "@/db/client";
import liveClasses from "@/modules/live-classes";
import { joinClass } from "@/modules/live-classes/join";
import { startClass } from "@/modules/live-classes/staff";
import { courseTarget, universityLite, withTenant } from "@/server/core";
import { setTestModules, slotsInReach, visibleSlots } from "@/server/registry";
import { makeDepartment, person } from "../fixtures";
import { liveSetup } from "./helpers";

afterEach(() => setTestModules([]));
afterAll(closeDb);

async function html(node: ReactNode) {
  const { prelude } = await prerenderToNodeStream(<>{node}</>);
  let out = "";
  for await (const chunk of prelude) out += chunk.toString();
  return out.replaceAll("<!-- -->", "");
}

describe("live-classes: slots", () => {
  it("registers the reserved keys and orders", () => {
    expect(liveClasses.adminCourseTabs?.map((t) => [t.key, t.order, t.action])).toEqual([["live", 200, "attendance.view"]]);
    expect(liveClasses.adminBatchSections?.map((t) => [t.key, t.order, t.action])).toEqual([["attendance", 200, "attendance.view"]]);
    expect(liveClasses.learnerCourseTabs?.map((t) => [t.key, t.order, t.action])).toEqual([["live", 200, "self.join_class"]]);
    expect(liveClasses.learnerHomeCards?.map((t) => [t.key, t.order, t.action])).toEqual([["join-next", 200, "self.join_class"]]);
    expect(liveClasses.dashboardCards?.map((t) => [t.key, t.order, t.action])).toEqual([["attendance-today", 200, "attendance.view"]]);
  });

  it("staff of the batch see the batch section and course tab; another department's HOD and students don't", async () => {
    setTestModules([liveClasses], { only: true });
    const ctx = await liveSetup("Slots Staff U", { students: 1 });
    const target = await withTenant(ctx.hod, (tx) => courseTarget(tx, ctx.uni.id, ctx.course.id));
    const mkt = await makeDepartment(ctx.uni.id, "MKT", "Marketing");
    const otherHod = await (await person("Other Hod", "hod", { universityId: ctx.uni.id, departmentId: mkt.id })).actor();
    for (const who of [ctx.hod, ctx.faculty, ctx.admin]) {
      expect(visibleSlots("adminCourseTabs", who, target).map((t) => t.key)).toEqual(["live"]);
      expect(visibleSlots("adminBatchSections", who, target).map((t) => t.key)).toEqual(["attendance"]);
    }
    for (const who of [otherHod, ctx.students[0]]) {
      expect(visibleSlots("adminCourseTabs", who, target)).toEqual([]);
      expect(visibleSlots("adminBatchSections", who, target)).toEqual([]);
    }
    expect(slotsInReach("dashboardCards", ctx.faculty, ctx.uni.id).map((t) => t.key)).toEqual(["attendance-today"]);
    expect(slotsInReach("dashboardCards", ctx.students[0], ctx.uni.id)).toEqual([]);
  });

  it("students see the learner tab and home card; parents don't", async () => {
    setTestModules([liveClasses], { only: true });
    const ctx = await liveSetup("Slots Learner U", { students: 1 });
    const own = { universityId: ctx.uni.id, ownerUserId: ctx.students[0].userId, batchIds: [ctx.batch.id], departmentIds: [ctx.dept.id] };
    expect(visibleSlots("learnerCourseTabs", ctx.students[0], own).map((t) => t.key)).toEqual(["live"]);
    expect(visibleSlots("learnerHomeCards", ctx.students[0], own).map((t) => t.key)).toEqual(["join-next"]);
    const parent = await (await person("Parent Pari", "parent", { universityId: ctx.uni.id })).actor();
    expect(visibleSlots("learnerHomeCards", parent, { universityId: ctx.uni.id, ownerUserId: parent.userId })).toEqual([]);
  });

  it("the components render real data", async () => {
    const ctx = await liveSetup("Slots Render U", { students: 2 });
    // Today's class in real time: the batch in setupCourse starts in 2030, so render what exists.
    const university = await withTenant(ctx.hod, (tx) => universityLite(tx));
    const course = { id: ctx.course.id, title: "Data Analytics", departmentId: ctx.dept.id, programId: null, status: "published" as const, certificateEnabled: true, pricePaise: 0 };
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
      target: { universityId: ctx.uni.id, departmentIds: [ctx.dept.id], batchIds: [ctx.batch.id] },
    };
    const base = { uni: university.slug, university };

    const tab = liveClasses.adminCourseTabs![0].component;
    const tabHtml = await html(await tab({ ...base, actor: ctx.hod, course, target: batch.target, searchParams: {} }));
    expect(tabHtml).toContain("Weekday morning");
    expect(tabHtml).toContain("meet.google.com/live-test");

    const section = liveClasses.adminBatchSections![0].component;
    const sectionHtml = await html(await section({ ...base, actor: ctx.faculty, batch, course, target: batch.target }));
    expect(sectionHtml).toContain("Attendance");
    expect(sectionHtml).toContain("No classes held yet");

    const learner = liveClasses.learnerCourseTabs![0].component;
    const learnerHtml = await html(
      await learner({
        ...base,
        actor: ctx.students[0],
        enrolment: { enrolmentId: ctx.enrolments[0], courseId: ctx.course.id, batchId: ctx.batch.id, status: "active" },
        course,
        batch,
        target: { ...batch.target, ownerUserId: ctx.students[0].userId },
        searchParams: {},
      }),
    );
    expect(learnerHtml).toContain("Your attendance");
    expect(learnerHtml).toContain("Minimum 75%");

    // Nothing within two hours (the batch starts in 2030): the home card renders nothing.
    const card = liveClasses.learnerHomeCards![0].component;
    expect(await card({ ...base, actor: ctx.students[0], today: "2026-10-29" })).toBeNull();

    const dash = liveClasses.dashboardCards![0].component;
    expect(await html(await dash({ ...base, actor: ctx.faculty, today: "2026-10-29" }))).toContain("Attendance today");
  });

  it("join and start leave the expected trail for the dashboard card", async () => {
    // Uses fixed instants: the service functions take `now`, the components use the clock.
    const ctx = await liveSetup("Slots Trail U", { students: 1 });
    const { ist, MON } = await import("./helpers");
    await startClass(ctx.faculty, { batchId: ctx.batch.id, date: MON }, ist(MON, "08:55"));
    await joinClass(ctx.students[0], ctx.batch.id, MON, null, ist(MON, "09:00"));
    const { todaysClasses } = await import("@/modules/live-classes/overview");
    const t = await todaysClasses(ctx.faculty, ist(MON, "09:30"));
    expect(t.classes[0]).toMatchObject({ present: 1, total: 1, recorded: true });
  });
});
