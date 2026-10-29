import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { prerenderToNodeStream } from "react-dom/static.node";
import { closeDb } from "@/db/client";
import { todayFor, universityLite, withTenant, type UniversityLite } from "@/server/core";
import { setTestModules, slotsInReach, visibleSlots } from "@/server/registry";
import gamification from "@/modules/gamification";
import { createBadge } from "@/modules/gamification/badges";
import { createChallenge } from "@/modules/gamification/challenges";
import { createRule } from "@/modules/gamification/rules";
import { addDays } from "@/modules/gamification/util";
import { fakeId, world, type World } from "./world";

async function html(node: ReactNode) {
  const { prelude } = await prerenderToNodeStream(<>{node}</>);
  let out = "";
  for await (const chunk of prelude) out += chunk.toString();
  return out.replaceAll("<!-- -->", "");
}

let w: World;
let university: UniversityLite;
let today: string;
let riya: Awaited<ReturnType<World["enrolled"]>>;

beforeAll(async () => {
  w = await world("Slots Gamification University");
  university = await withTenant(w.sys, (tx) => universityLite(tx));
  today = await withTenant(w.sys, (tx) => todayFor(tx));
  await createRule(w.admin, { name: "Lesson finished", trigger: "lesson", points: 10 });
  await createBadge(w.admin, { name: "Bookworm", icon: "book", metric: "lessons_completed", threshold: 2 });
  await createBadge(w.admin, { name: "Ten lessons", icon: "star", metric: "lessons_completed", threshold: 10 });
  riya = await w.enrolled("Riya Sharma", [w.batch.id]);
  const kabir = await w.enrolled("Kabir Mehta", [w.batch.id]);
  await createChallenge(w.hod, { title: "Lesson sprint", scope: `batch:${w.batch.id}`, metric: "lessons_completed", target: 4, startDate: today, endDate: addDays(today, 3) });
  for (let i = 0; i < 3; i++) await w.send("lesson.completed", { userId: riya.id, courseId: w.course.id, lessonId: fakeId() });
  await w.send("lesson.completed", { userId: kabir.id, courseId: w.course.id, lessonId: fakeId() });
  await w.drain();
});
afterEach(() => setTestModules([]));
afterAll(closeDb);

const own = () => ({ universityId: w.uni.id, ownerUserId: riya.id });

describe("gamification slots", () => {
  it("registers the reserved keys, orders and actions", () => {
    expect(gamification.learnerCourseTabs?.map((s) => [s.key, s.order, s.action, s.label])).toEqual([["leaderboard", 600, "self.view_xp", "Leaderboard"]]);
    expect(gamification.learnerHubSections?.map((s) => [s.key, s.order, s.action])).toEqual([["xp", 600, "self.view_xp"]]);
    expect(gamification.learnerHomeCards?.map((s) => [s.key, s.order, s.action])).toEqual([["xp", 600, "self.view_xp"]]);
    expect(gamification.dashboardCards?.map((s) => [s.key, s.order, s.action])).toEqual([["top-learners", 600, "leaderboard.view"]]);
  });

  it("shows learner slots to students and staff slots to staff only", () => {
    setTestModules([gamification], { only: true });
    expect(visibleSlots("learnerHomeCards", riya.actor, own()).map((s) => s.key)).toEqual(["xp"]);
    expect(visibleSlots("learnerHomeCards", w.admin, { universityId: w.uni.id, ownerUserId: w.admin.userId })).toEqual([]);
    expect(slotsInReach("dashboardCards", w.hod, w.uni.id).map((s) => s.key)).toEqual(["top-learners"]);
    expect(slotsInReach("dashboardCards", w.faculty, w.uni.id).map((s) => s.key)).toEqual(["top-learners"]);
    expect(slotsInReach("dashboardCards", riya.actor, w.uni.id)).toEqual([]);
  });

  it("learner home card: XP, rank and the running challenge", async () => {
    const Card = gamification.learnerHomeCards![0].component;
    const out = await html(await Card({ uni: "u", actor: riya.actor, university, today }));
    expect(out).toContain("Your XP");
    expect(out).toContain(">30<");
    expect(out).toMatch(/1st<\/span> of 2 in Data Analytics, Weekday morning/);
    expect(out).toContain("Lesson sprint");
    expect(out).toContain("3 of 4 lessons");
  });

  it("My learning section: XP, ranks and badges", async () => {
    const Section = gamification.learnerHubSections![0].component;
    const out = await html(await Section({ uni: "u", actor: riya.actor, university, enrolments: [] }));
    expect(out).toContain("XP and badges");
    expect(out).toContain("Bookworm");
    expect(out).toContain(`/u/learn/my/${riya.enrolments[w.batch.id]}?tab=leaderboard`);
  });

  it("course hub tab: the batch leaderboard with the viewer marked, names as the university chose", async () => {
    const Tab = gamification.learnerCourseTabs![0].component;
    const batch = { id: w.batch.id, courseId: w.course.id, departmentId: w.dept.id, name: "Weekday morning", startDate: "2030-11-04", endDate: "2031-01-31", seatLimit: 20, status: "open" as const, meetingUrl: null, target: { universityId: w.uni.id, departmentIds: [w.dept.id], batchIds: [w.batch.id] } };
    const out = await html(
      await Tab({
        uni: "u",
        actor: riya.actor,
        university,
        enrolment: { enrolmentId: riya.enrolments[w.batch.id], courseId: w.course.id, batchId: w.batch.id, status: "active" },
        course: { id: w.course.id, title: "Data Analytics", departmentId: w.dept.id, programId: null, status: "published", certificateEnabled: true, pricePaise: 0 },
        batch,
        target: { ...batch.target, ownerUserId: riya.id },
        searchParams: { tab: "leaderboard", period: "all" },
      }),
    );
    expect(out).toContain("Riya S.");
    expect(out).toContain("Kabir M.");
    expect(out).not.toContain("Kabir Mehta");
    expect(out).toContain(">You<");
    expect(out).toMatch(/You&#x27;re <span[^>]*>1st<\/span> of 2/);
  });

  it("dashboard card: top learners in the viewer's reach, full names", async () => {
    const Card = gamification.dashboardCards![0].component;
    const out = await html(await Card({ uni: "u", actor: w.hod, university, today }));
    expect(out).toContain("Top learners this month");
    expect(out).toContain("Riya Sharma");
    const mkt = await html(await Card({ uni: "u", actor: w.hodMkt, university, today }));
    expect(mkt).toContain("No XP earned this month yet.");
  });
});
