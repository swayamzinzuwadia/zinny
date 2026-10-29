/**
 * Demo data (contracts.md section 6): three weeks of live classes for the running batches,
 * created through the real services as the real people, so every row, audit entry and
 * `attendance.marked` event is what the product itself would produce.
 *
 * - Machine Learning Foundations / Morning (link on the batch): Farah starts each class,
 *   students join through Zinny (some late), she marks the no-shows absent and locks
 *   registers older than this week. Rohan and Zoya end up below 75%.
 * - Python Basics / Weekend and Digital Marketing / Evening (no batch link): faculty take
 *   attendance in the register. Neil ends up below 75%. Upcoming classes get their own links.
 * - Recording links on a few past classes, and the weekly alerts sent for this week.
 */
import type { SeedContext } from "@/contracts/module";
import { batchStudentIds, scheduledBatches, withTenant, type Actor } from "@/server/core";
import { clockFor, sessionsOf, type ClassSession } from "./engine";
import { joinClass } from "./join";
import { sendWeeklyAlerts } from "./jobs";
import { lockRegister, markAttendance, startClass, updateSessionLinks, type Mark } from "./staff";
import { addDays, weekStart } from "./time";

const MINUTE = 60_000;

/** Who misses or is late for which class (by index), so the numbers are the same on every seed. */
type Habit = { miss: (i: number) => boolean; late: (i: number) => boolean };
const steady = (k: number): Habit => ({ miss: (i) => (i + k) % 11 === 0, late: (i) => (i + k) % 6 === 0 });
const HABITS: Record<string, Habit> = {
  "rohan@demo.edu": { miss: (i) => i % 5 === 1 || i % 5 === 3, late: (i) => i % 4 === 0 },
  "zoya@demo.edu": { miss: (i) => i % 2 === 0, late: (i) => i % 3 === 1 },
  "neil@demo.edu": { miss: (i) => i % 3 === 0, late: () => false },
  "riya@demo.edu": { miss: () => false, late: (i) => i === 2 },
};
const habitOf = (email: string, k: number) => HABITS[email] ?? steady(k);

const RUNNING = [
  { key: "Machine Learning Foundations / Morning", faculty: "farah@demo.edu", mode: "join" as const },
  { key: "Python Basics / Weekend", faculty: "farah@demo.edu", mode: "register" as const, link: "https://meet.google.com/demo-python-weekend" },
  { key: "Digital Marketing / Evening", faculty: "neel@demo.edu", mode: "register" as const, link: "https://meet.google.com/demo-marketing" },
];

export async function seed(ctx: SeedContext): Promise<void> {
  const now = new Date();
  const from = addDays(weekStart(ctx.today), -21);
  const emailOf = new Map(Object.entries(ctx.ids.users).map(([email, id]) => [id, email]));
  const actors = new Map<string, Actor>();
  const actor = async (email: string) => {
    let a = actors.get(email);
    if (!a) actors.set(email, (a = await ctx.actorFor(email)));
    return a;
  };

  for (const run of RUNNING) {
    const batchId = ctx.ids.batches[run.key];
    if (!batchId) continue;
    const faculty = await actor(run.faculty);
    const { sessions, studentIds } = await withTenant(ctx.systemActor, async (tx) => {
      const scheds = await scheduledBatches(tx, [batchId]);
      const clock = await clockFor(tx, now);
      return { sessions: sessionsOf(scheds, from, addDays(ctx.today, 14), clock), studentIds: await batchStudentIds(tx, batchId) };
    });
    const students = studentIds.map((id) => emailOf.get(id)).filter((e): e is string => !!e).sort();
    const past = sessions.filter((s) => s.state === "ended");
    const thisWeek = weekStart(ctx.today);

    for (const [i, s] of past.entries()) {
      if (run.mode === "join") await runThroughZinny(s, i, students, faculty, actor);
      else await takeRegister(s, i, students, faculty, studentIds, emailOf);
      const ref = { batchId, date: s.date, startTime: s.startTime };
      // A recording for every other class.
      if (i % 2 === 1) {
        const rec = `https://drive.google.com/file/d/demo-${run.key.split(" ")[0].toLowerCase()}-${s.date}/view`;
        await updateSessionLinks(faculty, ref, { recordingUrl: rec }, after(s, 30));
      }
      if (s.date < thisWeek) await lockRegister(faculty, ref, after(s, 60));
    }

    // Classes without a batch link get their own link for the next two weeks.
    if (run.link) {
      for (const s of sessions.filter((x) => x.state !== "ended")) {
        await updateSessionLinks(faculty, { batchId, date: s.date, startTime: s.startTime }, { meetingUrl: run.link }, now);
      }
    }
  }

  await sendWeeklyAlerts(ctx.systemActor, { now });
}

const at = (s: ClassSession, minutes: number) => new Date(s.window.startsAt.getTime() + minutes * MINUTE);
const after = (s: ClassSession, minutes: number) => new Date(s.window.endsAt.getTime() + minutes * MINUTE);

/** Farah starts the class, students join (on time, a little early, or late), she marks the rest absent. */
async function runThroughZinny(s: ClassSession, i: number, students: string[], faculty: Actor, actor: (email: string) => Promise<Actor>) {
  const ref = { batchId: s.batchId, date: s.date, startTime: s.startTime };
  await startClass(faculty, ref, at(s, -6));
  const absent: Mark[] = [];
  for (const [k, email] of students.entries()) {
    const h = habitOf(email, k);
    const student = await actor(email);
    if (h.miss(i)) {
      absent.push({ userId: student.userId, status: "absent" });
      continue;
    }
    const minute = h.late(i) ? 12 + ((i + k) % 4) * 5 : -5 + ((i * 3 + k * 2) % 14);
    await joinClass(student, s.batchId, s.date, s.startTime, at(s, minute));
    // Some students drop out and come back.
    if ((i + k) % 7 === 3) await joinClass(student, s.batchId, s.date, s.startTime, at(s, minute + 34));
  }
  if (absent.length) await markAttendance(faculty, ref, absent, after(s, 10));
}

/** The faculty takes attendance in the register, with a note now and then. */
async function takeRegister(s: ClassSession, i: number, students: string[], faculty: Actor, ids: string[], emailOf: Map<string, string>) {
  const idOf = new Map(ids.map((id) => [emailOf.get(id), id]));
  const marks = students.flatMap((email, k): Mark[] => {
    const userId = idOf.get(email);
    if (!userId) return [];
    const h = habitOf(email, k);
    if (h.miss(i)) return [{ userId, status: "absent", note: (i + k) % 4 === 0 ? "Informed the faculty in advance" : null }];
    if (h.late(i)) return [{ userId, status: "late", note: (i + k) % 3 === 0 ? "Joined 20 minutes late" : null }];
    return [{ userId, status: "present" }];
  });
  await markAttendance(faculty, { batchId: s.batchId, date: s.date, startTime: s.startTime }, marks, at(s, 25));
}
