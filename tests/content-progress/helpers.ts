/**
 * Fixtures for content-progress tests: a course whose batch started some days ago, with a
 * curriculum built through the module's own services, and enrolled students.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadActor } from "@/server/actor";
import type { Actor } from "@/server/authz/engine";
import { todayIn } from "@/server/lib/dates";
import { createBatch } from "@/server/services/batches";
import { createCourse, updateCourse } from "@/server/services/courses";
import { holdSeat } from "@/server/services/enrolment";
import { addDays } from "@/modules/content-progress/lib/dates";
import {
  addLesson,
  addSection,
  setLinkContent,
  setTextContent,
  setVideoLink,
  updateLesson,
  type DripInput,
} from "@/modules/content-progress/service";
import { person, setupCourse, slots, WEEKDAYS } from "../fixtures";

/** Storage goes to a temporary folder for the whole test file. Call in beforeAll/afterAll. */
export function tempStorage() {
  const dir = mkdtempSync(join(tmpdir(), "zinny-content-"));
  const before = process.env.STORAGE_DIR;
  process.env.STORAGE_DIR = dir;
  return () => {
    if (before === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = before;
    rmSync(dir, { recursive: true, force: true });
  };
}

export const today = () => todayIn("Asia/Kolkata");

type LessonSpec = { title: string; kind: "video" | "pdf" | "text" | "link" | "live"; optional?: boolean; drip?: DripInput; minutes?: number; empty?: boolean };

/**
 * A free course (published) with a batch that started `startedDaysAgo` days ago (taught by
 * Farah), and a curriculum. Text lessons get text; link lessons a URL; video lessons a
 * YouTube link; pdf lessons stay without content unless uploaded by the test.
 */
export async function setupLearning(opts: { name?: string; startedDaysAgo?: number; lessons?: LessonSpec[] } = {}) {
  const base = await setupCourse({ name: opts.name ?? "Learning U" });
  const { hod, dept } = base;
  const start = addDays(today(), -(opts.startedDaysAgo ?? 10));
  // A second course in the same department whose batch started in the past (the fixture's batch starts in 2030).
  const course = await createCourse(hod, { departmentId: dept.id, title: `Learning ${Math.random().toString(36).slice(2, 7)}`, pricePaise: 0 });
  const batch = await createBatch(hod, {
    courseId: course.id,
    name: "Running batch",
    startDate: start,
    endDate: addDays(today(), 90),
    seatLimit: 30,
    slots: slots(WEEKDAYS, "18:00", "19:00"),
    faculty: [{ userId: base.facultyUserId, role: "permanent_faculty" }],
  });
  await updateCourse(hod, course.id, { status: "published" });
  // Loaded after the batch exists, so the faculty's batch assignment is in the actor.
  const faculty = await loadActor(base.facultyUserId, base.uni.id);
  const section = await addSection(hod, course.id, "Week 1");
  const specs = opts.lessons ?? [
    { title: "Intro", kind: "text" },
    { title: "Reading", kind: "link" },
    { title: "Extra", kind: "text", optional: true },
  ];
  const lessons: { id: string; title: string }[] = [];
  for (const s of specs) {
    const l = await addLesson(hod, course.id, section.id, { title: s.title, kind: s.kind, required: !s.optional });
    if (!s.empty) {
      if (s.kind === "text") await setTextContent(hod, l.id, `<p>${s.title} text</p>`);
      if (s.kind === "link") await setLinkContent(hod, l.id, "https://example.com/reading");
      if (s.kind === "video") await setVideoLink(hod, l.id, "https://www.youtube.com/watch?v=kqtD5dpn9C8");
    }
    if (s.drip || s.minutes) await updateLesson(hod, l.id, { ...(s.drip && { drip: s.drip }), ...(s.minutes && { durationMinutes: s.minutes }) });
    lessons.push({ id: l.id, title: s.title });
  }
  /** A new student enrolled (free) in the running batch. */
  const enrolled = async (name: string): Promise<{ actor: Actor; enrolmentId: string; userId: string }> => {
    const s = await base.student(name);
    const r = await holdSeat(s, { batchId: batch.id, acknowledgeClash: true });
    if (r.status !== "enrolled") throw new Error(`expected a free enrolment, got ${r.status}`);
    return { actor: s, enrolmentId: r.enrolmentId, userId: s.userId };
  };
  return { ...base, faculty, course, batch, section, lessons, enrolled, start };
}

/** Another faculty member who teaches a batch of a different course in the same department. */
export async function otherFaculty(ctx: Awaited<ReturnType<typeof setupLearning>>) {
  const other = await person("Other Faculty", "permanent_faculty", { universityId: ctx.uni.id, departmentId: ctx.dept.id });
  const course = await createCourse(ctx.hod, { departmentId: ctx.dept.id, title: "Other course", pricePaise: 0 });
  const batch = await createBatch(ctx.hod, {
    courseId: course.id,
    name: "Other batch",
    startDate: today(),
    endDate: addDays(today(), 30),
    seatLimit: 10,
    slots: slots([6], "10:00", "11:00"),
    faculty: [{ userId: other.user.id, role: "permanent_faculty" }],
  });
  return { actor: await other.actor(), course, batch };
}
