/**
 * Demo data for the Demo University (contracts.md section 6).
 *
 *   1. Sensible default XP rules and badges, set up by Asha (admin) and the two HODs.
 *   2. Three weeks of learning for the seeded students, emitted as the events other modules
 *      emit (lesson.completed, test.submitted, attendance.marked, assignment.*). A type is only
 *      emitted when no module has seeded it yet, so real demo activity is never doubled.
 *   3. Every rule applied to past events through the same idempotent path as live delivery,
 *      which also picks up events that earlier module seeds emitted. The seed runner then
 *      drains, which finds nothing new to award.
 *   4. Challenges: one running per batch and per course, one upcoming, and one that ended
 *      yesterday with its winners frozen.
 *
 * Everything is deterministic: re-seeding gives the same leaderboards.
 */
import { createHash } from "node:crypto";
import { inArray } from "drizzle-orm";
import type { SeedContext } from "@/contracts/module";
import { domainEvents } from "@/db/schema";
import { audit, batchLite, emit, expandSessions, scheduledBatches, studentEnrolments, withTenant } from "@/server/core";
import { createBadge } from "./badges";
import { SOURCE_EVENTS } from "./catalog";
import { closeEndedChallenges, createChallenge } from "./challenges";
import { applyAllRulesToPast, createRule, setRuleActive, type RuleInput } from "./rules";
import { gamChallenges } from "./schema";
import { addDays, weekStart } from "./util";

/** A stable UUID for demo records that only exist in event payloads. */
function demoId(name: string): string {
  const h = createHash("sha1").update(`zinny-gamification:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** A stable number in [0, 1) for a key. */
function chance(key: string): number {
  return createHash("sha1").update(key).digest().readUInt32BE(0) / 2 ** 32;
}

/** How keen each demo student is (0–1). Riya is the PRD's example learner. */
const KEEN: Record<string, number> = {
  "riya@demo.edu": 0.9,
  "tara@demo.edu": 0.93,
  "ishaan@demo.edu": 0.86,
  "meera@demo.edu": 0.8,
  "diya@demo.edu": 0.74,
  "zoya@demo.edu": 0.66,
  "kabir@demo.edu": 0.5,
};

function keenness(email: string, courseId: string) {
  const base = KEEN[email] ?? 0.45 + chance(email) * 0.4;
  return Math.max(0.3, Math.min(0.97, base + (chance(`${email}|${courseId}`) - 0.5) * 0.16));
}

const RULES: RuleInput[] = [
  { name: "Lesson finished", trigger: "lesson", points: 10, dailyCap: 10 },
  { name: "Test passed", trigger: "test-passed", points: 50 },
  { name: "Top score on a test", trigger: "test-score", minScore: 90, points: 25 },
  { name: "Live class attended", trigger: "class-present", points: 15, dailyCap: 3 },
  { name: "Assignment on time", trigger: "assignment-on-time", points: 20 },
  { name: "Strong assignment grade", trigger: "assignment-score", minScore: 80, points: 30 },
  { name: "Course completed", trigger: "course-completed", points: 200 },
];

/** Emits three weeks of learning for every active enrolment in a running batch. */
async function emitDemoActivity(ctx: SeedContext) {
  const sys = ctx.systemActor;
  const yesterday = addDays(ctx.today, -1);
  const emailOf = new Map(Object.entries(ctx.ids.users).map(([email, id]) => [id, email]));
  const studentIds = [...new Set(Object.keys(ctx.ids.enrolments).map((k) => ctx.ids.users[k.split(" / ")[0]]).filter(Boolean))];

  return withTenant(sys, async (tx) => {
    // Real demo activity from other modules' seeds wins: only fill in what's missing.
    const seeded = new Set(
      (await tx.selectDistinct({ type: domainEvents.type }).from(domainEvents).where(inArray(domainEvents.type, [...SOURCE_EVENTS]))).map((r) => r.type),
    );
    const want = (type: string) => !seeded.has(type);

    const enrolments = (await Promise.all(studentIds.map(async (u) => (await studentEnrolments(tx, u)).map((e) => ({ ...e, userId: u })))))
      .flat()
      .filter((e) => e.status === "active");
    const batches = (await scheduledBatches(tx, [...new Set(enrolments.map((e) => e.batchId))])).filter((b) => b.startDate <= yesterday);
    let n = 0;

    for (const b of batches) {
      const members = enrolments.filter((e) => e.batchId === b.batchId);
      const weeksIn = Math.floor((Date.parse(yesterday) - Date.parse(b.startDate)) / (7 * 86_400_000)) + 1;

      // Live classes so far, marked by the faculty.
      if (want("attendance.marked")) {
        for (const s of expandSessions([b], b.startDate, yesterday)) {
          for (const m of members) {
            const keen = keenness(emailOf.get(m.userId)!, b.courseId);
            const roll = chance(`att|${m.userId}|${s.batchId}|${s.date}|${s.startTime}`);
            const status = roll < Math.min(0.97, keen + 0.08) ? "present" : roll < Math.min(0.99, keen + 0.16) ? "late" : "absent";
            await emit(tx, sys, "attendance.marked", { batchId: b.batchId, date: s.date, startTime: s.startTime.slice(0, 5), userId: m.userId, status });
            n++;
          }
        }
      }

      for (const m of members) {
        const email = emailOf.get(m.userId)!;
        const keen = keenness(email, b.courseId);
        // Lessons: the course has 24; keen students are a third of the way in.
        if (want("lesson.completed")) {
          const done = Math.round(keen * 3 * weeksIn);
          for (let i = 0; i < Math.min(done, 24); i++) {
            await emit(tx, sys, "lesson.completed", { userId: m.userId, courseId: b.courseId, lessonId: demoId(`lesson|${b.courseId}|${i}`) });
            n++;
          }
        }
        // A quiz per two weeks of teaching.
        if (want("test.submitted")) {
          for (let t = 0; t < Math.max(1, Math.floor(weeksIn / 2)); t++) {
            const score = Math.max(20, Math.min(100, Math.round(42 + keen * 52 + (chance(`test|${m.userId}|${b.courseId}|${t}`) - 0.5) * 18)));
            await emit(tx, sys, "test.submitted", {
              attemptId: demoId(`attempt|${m.userId}|${b.courseId}|${t}`),
              testId: demoId(`test|${b.courseId}|${t}`),
              userId: m.userId,
              courseId: b.courseId,
              batchId: b.batchId,
              scorePercent: score,
              passed: score >= 50,
            });
            n++;
          }
        }
        // Two assignments per batch, set by the faculty.
        for (let a = 0; a < Math.min(2, weeksIn); a++) {
          const assignmentId = demoId(`assignment|${b.batchId}|${a}`);
          const submissionId = demoId(`submission|${b.batchId}|${a}|${m.userId}`);
          if (chance(`submit|${submissionId}`) > keen + 0.15) continue;
          if (want("assignment.submitted")) {
            await emit(tx, sys, "assignment.submitted", { submissionId, assignmentId, userId: m.userId, batchId: b.batchId, late: chance(`late|${submissionId}`) > keen });
            n++;
          }
          if (want("assignment.graded")) {
            const score = Math.max(30, Math.min(100, Math.round(55 + keen * 40 + (chance(`grade|${submissionId}`) - 0.5) * 16)));
            await emit(tx, sys, "assignment.graded", { submissionId, assignmentId, userId: m.userId, batchId: b.batchId, scorePercent: score });
            n++;
          }
        }
      }
    }
    return n;
  });
}

export async function seed(ctx: SeedContext) {
  const asha = await ctx.actorFor("asha@demo.edu");
  const hema = await ctx.actorFor("hema@demo.edu");
  const mehul = await ctx.actorFor("mehul@demo.edu");
  const cs = ctx.ids.departments.CS;
  const mkt = ctx.ids.departments.MKT;

  // 1. Rules and badges.
  for (const r of RULES) await createRule(asha, r);
  const quiet = await createRule(asha, { name: "Test submitted", trigger: "test-any", points: 5 });
  await setRuleActive(asha, quiet.id, false); // tried once, turned off: shows how a paused rule looks
  await createRule(hema, { name: "Computer Science test bonus", trigger: "test-passed", points: 20, departmentId: cs });
  await createRule(mehul, { name: "Campaign brief on time", trigger: "assignment-on-time", points: 10, departmentId: mkt });

  await createBadge(asha, { name: "First test passed", description: "Passed your first test.", icon: "check", metric: "tests_passed", threshold: 1 });
  await createBadge(asha, { name: "Bookworm", description: "Finished 10 lessons.", icon: "book", metric: "lessons_completed", threshold: 10 });
  await createBadge(asha, { name: "Regular", description: "Attended every class for four weeks in a row.", icon: "flame", metric: "attendance_streak_weeks", threshold: 4 });
  await createBadge(asha, { name: "500 XP club", description: "Earned 500 XP.", icon: "star", metric: "xp", threshold: 500 });
  await createBadge(asha, { name: "Course finisher", description: "Completed a whole course.", icon: "trophy", metric: "courses_completed", threshold: 1 });
  await createBadge(mehul, { name: "Campaign ready", description: "Submitted two marketing assignments on time.", icon: "target", metric: "assignments_on_time", threshold: 2, departmentId: mkt });

  // 2 and 3. Learning activity, then XP for everything that happened.
  const emitted = await emitDemoActivity(ctx);
  const replay = await applyAllRulesToPast(asha);
  console.log(`  ${emitted} learning events, ${replay.points.toLocaleString("en-IN")} XP to ${replay.students} students, ${replay.badges} badges`);

  // 4. Challenges.
  const pyWeekend = ctx.ids.batches["Python Basics / Weekend"];
  const mlCourse = ctx.ids.courses["Machine Learning Foundations"];
  const dmCourse = ctx.ids.courses["Digital Marketing"];
  const daMorning = ctx.ids.batches["Data Analytics / Weekday morning"];
  const monday = weekStart(ctx.today);
  const started = await withTenant(asha, async (tx) => (await batchLite(tx, ctx.ids.batches["Machine Learning Foundations / Morning"])).startDate);

  await createChallenge(hema, {
    title: "Weekend sprint",
    description: "Six lessons before the next weekend class.",
    scope: `batch:${pyWeekend}`,
    metric: "lessons_completed",
    target: 6,
    startDate: addDays(monday, -7),
    endDate: addDays(ctx.today, 6),
  });
  await createChallenge(hema, {
    title: "Show up for ML",
    description: "Attend 12 live classes before the deadline.",
    scope: `course:${mlCourse}`,
    metric: "classes_attended",
    target: 12,
    startDate: started,
    endDate: addDays(ctx.today, 10),
  });
  await createChallenge(hema, {
    title: "First week, full house",
    description: "Attend all five classes in your first week.",
    scope: `batch:${daMorning}`,
    metric: "classes_attended",
    target: 5,
    startDate: addDays(monday, 7),
    endDate: addDays(monday, 11),
  });
  // Ended yesterday. The service only sets challenges that haven't ended, so the seed writes
  // this one to its own table directly; the hourly job then freezes its winners.
  await withTenant(mehul, async (tx) => {
    const [c] = await tx
      .insert(gamChallenges)
      .values({
        universityId: ctx.universityId,
        departmentId: mkt,
        scope: "course",
        courseId: dmCourse,
        title: "Marketing kickoff",
        description: "Attend five live classes in the first weeks of term.",
        metric: "classes_attended",
        target: 5,
        startDate: started,
        endDate: addDays(ctx.today, -1),
        createdBy: mehul.userId,
      })
      .returning();
    await audit(tx, mehul, "gamification.challenge_create", "gam_challenge", c.id, { title: c.title, seeded: true });
  });
  await closeEndedChallenges(ctx.systemActor);
}
