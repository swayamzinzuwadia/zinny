/** The admin dashboard's "Get set up" checklist and the course page's "What's next". */
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, systemDb } from "@/db/client";
import { courses } from "@/db/schema";
import { createCourseQuickly } from "@/server/services/quick-course";
import { courseNextSteps, setupChecklist } from "@/server/services/setup";
import { makeUniversity, person, slots, uniqueCode } from "../fixtures";

afterAll(closeDb);

const BATCH = { name: "Batch 1", startDate: "2031-01-06", endDate: "2031-03-30", seatLimit: 30, slots: slots([2, 4], "18:00", "19:30") };
const doneKeys = (c: Awaited<ReturnType<typeof setupChecklist>>) => c!.items.filter((i) => i.done).map((i) => i.key);

describe("setup checklist", () => {
  it("starts at nothing done for a new institute, with the first course as the next step", async () => {
    const uni = await makeUniversity("Fresh Institute");
    const admin = await (await person("Fresh Admin", "institute_admin", { universityId: uni.id })).actor();
    const c = await setupChecklist(admin, uni.slug);
    expect(c!.items.map((i) => i.key)).toEqual(["course", "batch", "teacher", "publish", "students", "website", "marketplace"]);
    expect(c).toMatchObject({ done: 0, total: 7, next: "course" });
    expect(c!.items[0].href).toBe(`/${uni.slug}/admin/products/courses/new`);
  });

  it("ticks off course, batch, teacher and publish from real data, then students", async () => {
    const uni = await makeUniversity("Growing Institute");
    const admin = await (await person("Grow Admin", "institute_admin", { universityId: uni.id })).actor();

    // A draft course with no batch: only the course is done, and "add a batch" points at it.
    const draft = await createCourseQuickly(admin, { title: "Tally basics", pricePaise: 0, newDepartmentName: "Commerce" });
    let c = await setupChecklist(admin, uni.slug);
    expect(doneKeys(c)).toEqual(["course"]);
    expect(c!.next).toBe("batch");
    expect(c!.items.find((i) => i.key === "batch")!.href).toBe(`/${uni.slug}/admin/products/courses/${draft.courseId}?tab=batches`);

    await createCourseQuickly(admin, { title: "GST filing", pricePaise: 0, departmentId: draft.departmentId, batch: BATCH, teachMyself: true, publish: true });
    c = await setupChecklist(admin, uni.slug);
    expect(doneKeys(c)).toEqual(["course", "batch", "teacher", "publish"]);
    expect(c).toMatchObject({ done: 4, total: 7, next: "students" });

    await person("Stu Sahil", "student", { universityId: uni.id });
    c = await setupChecklist(admin, uni.slug);
    expect(doneKeys(c)).toContain("students");
    expect(c!.next).toBe("website");
  });

  it("an archived course doesn't count as a first course", async () => {
    const uni = await makeUniversity("Archive Institute");
    const admin = await (await person("Arch Admin", "institute_admin", { universityId: uni.id })).actor();
    const r = await createCourseQuickly(admin, { title: "Old course", pricePaise: 0, newDepartmentName: "General" });
    await systemDb().update(courses).set({ status: "archived" }).where(eq(courses.id, r.courseId));
    expect(doneKeys(await setupChecklist(admin, uni.slug))).toEqual([]);
  });

  it("is only for people who run the institute (deny HOD, faculty, student)", async () => {
    const uni = await makeUniversity("Who Sees It");
    const admin = await (await person("Who Admin", "institute_admin", { universityId: uni.id })).actor();
    const r = await createCourseQuickly(admin, { title: "Any course", pricePaise: 0, newDepartmentName: "General" });
    const hod = await (await person("Who Hod", "hod", { universityId: uni.id, departmentId: r.departmentId })).actor();
    const fac = await (await person("Who Fac", "permanent_faculty", { universityId: uni.id, departmentId: r.departmentId })).actor();
    const stu = await (await person("Who Stu", "student", { universityId: uni.id })).actor();
    expect(await setupChecklist(admin, uni.slug)).not.toBeNull();
    expect(await setupChecklist(hod, uni.slug)).toBeNull();
    expect(await setupChecklist(fac, uni.slug)).toBeNull();
    expect(await setupChecklist(stu, uni.slug)).toBeNull();
  });

  it("only sees its own institute's data", async () => {
    const busy = await makeUniversity("Busy Institute");
    const busyAdmin = await (await person("Busy Admin", "institute_admin", { universityId: busy.id })).actor();
    await createCourseQuickly(busyAdmin, { title: "Busy course", pricePaise: 0, newDepartmentName: "General", batch: BATCH, teachMyself: true, publish: true });
    const quiet = await makeUniversity("Quiet Institute");
    const quietAdmin = await (await person("Quiet Admin", "institute_admin", { universityId: quiet.id })).actor();
    expect((await setupChecklist(quietAdmin, quiet.slug))!.done).toBe(0);
  });
});

describe("what's next after creating a course", () => {
  it("lists the steps not done yet, and hides the ones already done", async () => {
    const uni = await makeUniversity("Next Steps U");
    const admin = await (await person("Next Admin", "institute_admin", { universityId: uni.id })).actor();
    const r = await createCourseQuickly(admin, { title: "Next course", pricePaise: 0, newDepartmentName: "General", batch: BATCH, teachMyself: true, publish: true });
    const steps = await courseNextSteps(admin, uni.slug, r.courseId, { canInvite: true });
    expect(steps.map((s) => s.key)).toEqual(["lessons", "students", "share", "marketplace"]);
    expect(steps[0].href).toBe(`/${uni.slug}/admin/products/courses/${r.courseId}?tab=curriculum`);

    await person(`Stu ${uniqueCode()}`, "student", { universityId: uni.id });
    const later = await courseNextSteps(admin, uni.slug, r.courseId, { canInvite: true });
    expect(later.map((s) => s.key)).toEqual(["lessons", "share", "marketplace"]);
    expect((await courseNextSteps(admin, uni.slug, r.courseId, { canInvite: false })).map((s) => s.key)).toEqual(["lessons", "marketplace"]);
  });

  it("needs permission to change the course (deny faculty)", async () => {
    const uni = await makeUniversity("Next Deny U");
    const admin = await (await person("Nd Admin", "institute_admin", { universityId: uni.id })).actor();
    const r = await createCourseQuickly(admin, { title: "Locked course", pricePaise: 0, newDepartmentName: "General" });
    const fac = await (await person("Nd Fac", "permanent_faculty", { universityId: uni.id, departmentId: r.departmentId })).actor();
    await expect(courseNextSteps(fac, uni.slug, r.courseId, { canInvite: false })).rejects.toThrow();
  });
});
