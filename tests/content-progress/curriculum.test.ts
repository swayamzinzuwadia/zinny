import { afterAll, describe, expect, it } from "vitest";
import { closeDb, systemDb } from "@/db/client";
import { courses } from "@/db/schema";
import { contentLessons, contentSections } from "@/modules/content-progress/schema";
import { addLesson, addSection, getCurriculum } from "@/modules/content-progress/service";
import { expectTenantIsolated } from "../helpers/isolation";
import { makeDepartment, person, setupCourse, uniqueCode } from "../fixtures";

afterAll(closeDb);

/** Moved from core by foundation-lock: the curriculum keeps working as before. */
describe("content-progress: curriculum (moved from core)", () => {
  it("HOD adds sections and lessons; anyone who can see the course reads them in order", async () => {
    const { uni, hod, course, facultyUserId } = await setupCourse({ name: "Curriculum U" });
    const s1 = await addSection(hod, course.id, "Week 1");
    const s2 = await addSection(hod, course.id, "Week 2");
    await addLesson(hod, course.id, s1.id, { title: "Spreadsheets", kind: "video" });
    await addLesson(hod, course.id, s1.id, { title: "Formulas", kind: "text" });
    await addLesson(hod, course.id, s2.id, { title: "SQL", kind: "pdf" });
    const { loadActor } = await import("@/server/actor");
    const faculty = await loadActor(facultyUserId, uni.id);
    const view = await getCurriculum(faculty, course.id);
    expect(view.map((s) => [s.title, s.lessons.map((l) => l.title)])).toEqual([
      ["Week 1", ["Spreadsheets", "Formulas"]],
      ["Week 2", ["SQL"]],
    ]);
  });

  it("only people who can update the course edit its curriculum", async () => {
    const { uni, course, hod } = await setupCourse({ name: "Curriculum Perms U" });
    const other = await makeDepartment(uni.id, "MKT", "Marketing");
    const otherHod = await (await person("Other HOD", "hod", { universityId: uni.id, departmentId: other.id })).actor();
    await expect(addSection(otherHod, course.id, "Sneaky")).rejects.toThrow(/access/);
    const s = await addSection(hod, course.id, "Week 1");
    await expect(addLesson(otherHod, course.id, s.id, { title: "Sneaky", kind: "video" })).rejects.toThrow(/access/);
  });

  it("a lesson can't be added to another course's section", async () => {
    const a = await setupCourse({ name: "Curriculum Cross U" });
    const s = await addSection(a.hod, a.course.id, "Week 1");
    const { createCourse } = await import("@/server/services/courses");
    const other = await createCourse(a.hod, { departmentId: a.dept.id, title: "Other course", pricePaise: 0 });
    await expect(addLesson(a.hod, other.id, s.id, { title: "Wrong", kind: "video" })).rejects.toThrow(/Section not found/);
  });

  it("content_sections is isolated per university", () =>
    expectTenantIsolated(contentSections, async (uni) => {
      const dept = await makeDepartment(uni.id, uniqueCode(), "Computer Science");
      const [c] = await systemDb().insert(courses).values({ universityId: uni.id, departmentId: dept.id, title: "Isolated" }).returning();
      return { universityId: uni.id, courseId: c.id, title: "Week 1" };
    }));

  it("content_lessons is isolated per university", () =>
    expectTenantIsolated(contentLessons, async (uni) => {
      const dept = await makeDepartment(uni.id, uniqueCode(), "Computer Science");
      const [c] = await systemDb().insert(courses).values({ universityId: uni.id, departmentId: dept.id, title: "Isolated" }).returning();
      const [s] = await systemDb().insert(contentSections).values({ universityId: uni.id, courseId: c.id, title: "Week 1" }).returning();
      return { universityId: uni.id, courseId: c.id, sectionId: s.id, title: "Lesson" };
    }));
});
