import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, courses } from "@/db/schema";
import { loadActor } from "@/server/actor";
import { contentLessons, contentSections } from "@/modules/content-progress/schema";
import {
  addLesson,
  addSection,
  clearLessonContent,
  deleteLesson,
  deleteSection,
  getCurriculum,
  getLessonForEdit,
  moveLesson,
  moveSection,
  renameSection,
  setLessonKind,
  setLinkContent,
  setTextContent,
  setVideoLink,
  updateLesson,
} from "@/modules/content-progress/service";
import { expectTenantIsolated } from "../helpers/isolation";
import { makeDepartment, person, setupCourse, uniqueCode } from "../fixtures";
import { otherFaculty, setupLearning, tempStorage } from "./helpers";

let restore: () => void;
beforeAll(() => {
  restore = tempStorage();
});
afterAll(async () => {
  restore();
  await closeDb();
});

describe("curriculum: sections and lessons", () => {
  it("HOD adds sections and lessons; anyone who can see the course reads them in order", async () => {
    const { uni, hod, course, facultyUserId } = await setupCourse({ name: "Curriculum U" });
    const s1 = await addSection(hod, course.id, "Week 1");
    const s2 = await addSection(hod, course.id, "Week 2");
    await addLesson(hod, course.id, s1.id, { title: "Spreadsheets", kind: "video" });
    await addLesson(hod, course.id, s1.id, { title: "Formulas", kind: "text" });
    await addLesson(hod, course.id, s2.id, { title: "SQL", kind: "pdf" });
    const faculty = await loadActor(facultyUserId, uni.id);
    const view = await getCurriculum(faculty, course.id);
    expect(view.map((s) => [s.title, s.lessons.map((l) => l.title)])).toEqual([
      ["Week 1", ["Spreadsheets", "Formulas"]],
      ["Week 2", ["SQL"]],
    ]);
  });

  it("renames, reorders and deletes sections", async () => {
    const { hod, course } = await setupCourse({ name: "Sections U" });
    const a = await addSection(hod, course.id, "Week A");
    const b = await addSection(hod, course.id, "Week B");
    const c = await addSection(hod, course.id, "Week C");
    await renameSection(hod, a.id, "  Week   One ");
    expect(await moveSection(hod, c.id, "up")).toBe(true);
    expect(await moveSection(hod, a.id, "up")).toBe(false);
    expect((await getCurriculum(hod, course.id)).map((s) => s.title)).toEqual(["Week One", "Week C", "Week B"]);
    await addLesson(hod, course.id, b.id, { title: "Inside B", kind: "text" });
    await deleteSection(hod, b.id);
    const left = await getCurriculum(hod, course.id);
    expect(left.map((s) => s.title)).toEqual(["Week One", "Week C"]);
    const orphans = await systemDb().select().from(contentLessons).where(eq(contentLessons.sectionId, b.id));
    expect(orphans).toEqual([]);
  });

  it("reorders, moves between sections, edits and deletes lessons", async () => {
    const { hod, course } = await setupCourse({ name: "Lessons U" });
    const s1 = await addSection(hod, course.id, "Week 1");
    const s2 = await addSection(hod, course.id, "Week 2");
    const l1 = await addLesson(hod, course.id, s1.id, { title: "First", kind: "text" });
    const l2 = await addLesson(hod, course.id, s1.id, { title: "Second", kind: "text" });
    await moveLesson(hod, l2.id, "up");
    expect((await getCurriculum(hod, course.id))[0].lessons.map((l) => l.title)).toEqual(["Second", "First"]);
    const updated = await updateLesson(hod, l1.id, {
      title: "First, renamed",
      sectionId: s2.id,
      required: false,
      durationMinutes: 45,
      drip: { mode: "after_start", days: 14 },
    });
    expect(updated).toMatchObject({ title: "First, renamed", sectionId: s2.id, required: false, durationMinutes: 45, dripMode: "after_start", dripDays: 14, dripDate: null });
    await updateLesson(hod, l1.id, { drip: { mode: "on_date", date: "2027-01-15" } });
    expect((await getLessonForEdit(hod, l1.id)).lesson).toMatchObject({ dripMode: "on_date", dripDays: null, dripDate: "2027-01-15" });
    await updateLesson(hod, l1.id, { drip: { mode: "none" } });
    await deleteLesson(hod, l2.id);
    const view = await getCurriculum(hod, course.id);
    expect(view.map((s) => s.lessons.map((l) => l.title))).toEqual([[], ["First, renamed"]]);
  });

  it("refuses bad input with a message that says how to fix it", async () => {
    const { hod, course } = await setupCourse({ name: "Validation U" });
    const s = await addSection(hod, course.id, "Week 1");
    await expect(addSection(hod, course.id, " ")).rejects.toThrow(/title, like Week 1/);
    await expect(addLesson(hod, course.id, s.id, { title: "Quiz", kind: "scorm" })).rejects.toThrow(/Pick a lesson type/);
    const l = await addLesson(hod, course.id, s.id, { title: "Intro", kind: "text" });
    await expect(updateLesson(hod, l.id, { durationMinutes: -5 })).rejects.toThrow(/whole number of minutes/);
    await expect(updateLesson(hod, l.id, { drip: { mode: "after_start", days: 1.5 } })).rejects.toThrow(/how many days/);
    await expect(updateLesson(hod, l.id, { drip: { mode: "on_date", date: "2026-02-30" } })).rejects.toThrow(/Pick the date/);
    await expect(setTextContent(hod, l.id, "<p>  </p><script>x</script>")).rejects.toThrow(/Write the lesson text/);
    await expect(setVideoLink(hod, l.id, "https://www.youtube.com/watch?v=kqtD5dpn9C8")).rejects.toThrow(/This is a text lesson/);
    await expect(getCurriculum(hod, "not-a-uuid")).rejects.toThrow(/Course not found/);
  });

  it("a lesson can't be added to another course's section", async () => {
    const a = await setupCourse({ name: "Curriculum Cross U" });
    const s = await addSection(a.hod, a.course.id, "Week 1");
    const { createCourse } = await import("@/server/services/courses");
    const other = await createCourse(a.hod, { departmentId: a.dept.id, title: "Other course", pricePaise: 0 });
    await expect(addLesson(a.hod, other.id, s.id, { title: "Wrong", kind: "video" })).rejects.toThrow(/Section not found/);
    const l = await addLesson(a.hod, a.course.id, s.id, { title: "Mine", kind: "text" });
    const otherSection = await addSection(a.hod, other.id, "Other week");
    await expect(updateLesson(a.hod, l.id, { sectionId: otherSection.id })).rejects.toThrow(/Section not found/);
  });

  it("every change is in the audit log", async () => {
    const { hod, course } = await setupCourse({ name: "Audit U" });
    const s = await addSection(hod, course.id, "Week 1");
    const l = await addLesson(hod, course.id, s.id, { title: "Intro", kind: "text" });
    await setTextContent(hod, l.id, "<p>Hello</p>");
    await deleteLesson(hod, l.id);
    const log = await systemDb().select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.actorUserId, hod.userId));
    expect(log.map((r) => r.action)).toEqual(expect.arrayContaining(["content.section_add", "content.lesson_add", "content.lesson_text", "content.lesson_delete"]));
  });
});

describe("curriculum: lesson content", () => {
  it("text is sanitised before it is stored, and a lesson is ready only with content", async () => {
    const { hod, course } = await setupCourse({ name: "Text U" });
    const s = await addSection(hod, course.id, "Week 1");
    const l = await addLesson(hod, course.id, s.id, { title: "Notes", kind: "text" });
    expect(l.ready).toBe(false);
    const saved = await setTextContent(hod, l.id, '<p onclick="x()">Hi<script>alert(1)</script></p><img src=x onerror=alert(1)>');
    expect(saved.content).toEqual({ html: "<p>Hi</p>" });
    expect(saved.ready).toBe(true);
    const cleared = await clearLessonContent(hod, l.id);
    expect(cleared).toMatchObject({ ready: false, content: {} });
  });

  it("video lessons take a YouTube or Vimeo link; link lessons take http(s) only; live lessons are ready at once", async () => {
    const { hod, course } = await setupCourse({ name: "Kinds U" });
    const s = await addSection(hod, course.id, "Week 1");
    const v = await addLesson(hod, course.id, s.id, { title: "Video", kind: "video" });
    await expect(setVideoLink(hod, v.id, "https://example.com/video.mp4")).rejects.toThrow(/YouTube or Vimeo/);
    expect((await setVideoLink(hod, v.id, "https://vimeo.com/76979871")).content).toMatchObject({ source: "vimeo", videoId: "76979871" });
    const link = await addLesson(hod, course.id, s.id, { title: "Link", kind: "link" });
    await expect(setLinkContent(hod, link.id, "javascript:alert(1)")).rejects.toThrow(/https/);
    expect((await setLinkContent(hod, link.id, "https://sqlbolt.com")).ready).toBe(true);
    const live = await addLesson(hod, course.id, s.id, { title: "Live", kind: "live" });
    expect(live.ready).toBe(true);
  });

  it("changing a lesson's type removes its content", async () => {
    const { hod, course } = await setupCourse({ name: "Retype U" });
    const s = await addSection(hod, course.id, "Week 1");
    const l = await addLesson(hod, course.id, s.id, { title: "Notes", kind: "text" });
    await setTextContent(hod, l.id, "<p>Hi</p>");
    const changed = await setLessonKind(hod, l.id, "link");
    expect(changed).toMatchObject({ kind: "link", content: {}, ready: false });
  });
});

describe("curriculum: who edits (content.manage)", () => {
  it("admins, the course's HOD and faculty who teach one of its batches can edit", async () => {
    const ctx = await setupLearning({ name: "Editors U" });
    const s1 = await addSection(ctx.admin, ctx.course.id, "By the admin");
    const s2 = await addSection(ctx.hod, ctx.course.id, "By the HOD");
    const s3 = await addSection(ctx.faculty, ctx.course.id, "By the faculty");
    const l = await addLesson(ctx.faculty, ctx.course.id, s3.id, { title: "Faculty lesson", kind: "text" });
    await setTextContent(ctx.faculty, l.id, "<p>Written by the faculty</p>");
    expect([s1, s2, s3].every((s) => s.courseId === ctx.course.id)).toBe(true);
  });

  it("faculty can't edit a course they don't teach", async () => {
    const ctx = await setupLearning({ name: "Not My Course U" });
    const other = await otherFaculty(ctx);
    await expect(addSection(other.actor, ctx.course.id, "Sneaky")).rejects.toThrow(/access/);
    await expect(addLesson(other.actor, ctx.course.id, ctx.section.id, { title: "Sneaky", kind: "text" })).rejects.toThrow(/access/);
    await expect(renameSection(other.actor, ctx.section.id, "Renamed")).rejects.toThrow(/access/);
    await expect(updateLesson(other.actor, ctx.lessons[0].id, { title: "Renamed" })).rejects.toThrow(/access/);
    await expect(setTextContent(other.actor, ctx.lessons[0].id, "<p>Changed</p>")).rejects.toThrow(/access/);
    await expect(moveLesson(other.actor, ctx.lessons[0].id, "down")).rejects.toThrow(/access/);
    await expect(deleteLesson(other.actor, ctx.lessons[0].id)).rejects.toThrow(/access/);
    await expect(deleteSection(other.actor, ctx.section.id)).rejects.toThrow(/access/);
    // …but can edit the course they do teach.
    await expect(addSection(other.actor, other.course.id, "Week 1")).resolves.toMatchObject({ title: "Week 1" });
  });

  it("a HOD of another department, the Board and students can't edit", async () => {
    const ctx = await setupLearning({ name: "Outsiders U" });
    const mkt = await makeDepartment(ctx.uni.id, "MKT", "Marketing");
    const otherHod = await (await person("Other HOD", "hod", { universityId: ctx.uni.id, departmentId: mkt.id })).actor();
    const board = await (await person("Board Bina", "board_owner", { universityId: ctx.uni.id })).actor();
    const s = await ctx.enrolled("Student Sam");
    for (const who of [otherHod, board, s.actor]) {
      await expect(addSection(who, ctx.course.id, "Sneaky")).rejects.toThrow(/access/);
      await expect(deleteLesson(who, ctx.lessons[0].id)).rejects.toThrow(/access/);
    }
    // The Board can still read the curriculum.
    await expect(getCurriculum(board, ctx.course.id)).resolves.toHaveLength(1);
  });

  it("another university's staff can't see or touch the curriculum", async () => {
    const a = await setupLearning({ name: "Tenant A U" });
    const b = await setupCourse({ name: "Tenant B U" });
    await expect(getCurriculum(b.admin, a.course.id)).rejects.toThrow(/not found/);
    await expect(updateLesson(b.admin, a.lessons[0].id, { title: "Hacked" })).rejects.toThrow(/not found/);
  });

  it("the Curriculum tab shows edit controls only to content.manage holders", async () => {
    const { prerenderToNodeStream } = await import("react-dom/static.node");
    const { createElement } = await import("react");
    const { SlotOutlet } = await import("@/components/slots");
    const { visibleSlots } = await import("@/server/registry");
    const { universityLite, withTenant } = await import("@/server/core");
    const ctx = await setupLearning({ name: "Curriculum Tab U" });
    const board = await (await person("Board Bina", "board_owner", { universityId: ctx.uni.id })).actor();
    const target = { universityId: ctx.uni.id, departmentIds: [ctx.dept.id], batchIds: [ctx.batch.id] };
    const university = await withTenant(ctx.admin, (tx) => universityLite(tx));
    const course = { id: ctx.course.id, title: ctx.course.title, departmentId: ctx.dept.id, programId: null, status: "published" as const, certificateEnabled: true, pricePaise: 0 };
    const render = async (actor: typeof board) => {
      const tab = visibleSlots("adminCourseTabs", actor, target).find((t) => t.key === "curriculum")!;
      expect(tab).toMatchObject({ label: "Curriculum", order: 100 });
      const { prelude } = await prerenderToNodeStream(
        createElement(SlotOutlet<Parameters<typeof tab.component>[0]>, {
          slot: "adminCourseTabs",
          entry: tab,
          props: { uni: ctx.uni.slug, actor, university, course, target, searchParams: {} },
        }),
      );
      let html = "";
      for await (const chunk of prelude) html += chunk.toString();
      return html;
    };
    const asFaculty = await render(ctx.faculty);
    expect(asFaculty).toContain("Week 1");
    expect(asFaculty).toContain("Add a section");
    expect(asFaculty).toContain("Progress by batch");
    const asBoard = await render(board);
    expect(asBoard).toContain("Week 1");
    expect(asBoard).not.toContain("Add a section");
    expect(asBoard).not.toContain("Add lesson");
  });
});

describe("curriculum tables are isolated per university", () => {
  it("content_sections", () =>
    expectTenantIsolated(contentSections, async (uni) => {
      const dept = await makeDepartment(uni.id, uniqueCode(), "Computer Science");
      const [c] = await systemDb().insert(courses).values({ universityId: uni.id, departmentId: dept.id, title: "Isolated" }).returning();
      return { universityId: uni.id, courseId: c.id, title: "Week 1" };
    }));

  it("content_lessons", () =>
    expectTenantIsolated(contentLessons, async (uni) => {
      const dept = await makeDepartment(uni.id, uniqueCode(), "Computer Science");
      const [c] = await systemDb().insert(courses).values({ universityId: uni.id, departmentId: dept.id, title: "Isolated" }).returning();
      const [s] = await systemDb().insert(contentSections).values({ universityId: uni.id, courseId: c.id, title: "Week 1" }).returning();
      return { universityId: uni.id, courseId: c.id, sectionId: s.id, title: "Lesson" };
    }));
});
