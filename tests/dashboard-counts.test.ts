/** The dashboard's numbers use the same definitions as the pages they point to. */
import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { createBatch } from "@/server/services/batches";
import { createCourse, updateCourse } from "@/server/services/courses";
import { dashboard } from "@/server/services/dashboard";
import { holdSeat } from "@/server/services/enrolment";
import { buyRecordings, setupCourse, slots, WEEKDAYS } from "./fixtures";

afterAll(closeDb);

describe("dashboard counts", () => {
  it("counts people, not enrolments, as joining this week, and courses that have an open batch", async () => {
    const c = await setupCourse({ name: "Dashboard Counts U", pricePaise: 400_000 });
    const second = await createCourse(c.hod, { departmentId: c.dept.id, title: "Python Basics", pricePaise: 0 });
    const python = await createBatch(c.hod, {
      courseId: second.id,
      name: "Evening",
      startDate: "2030-11-04",
      endDate: "2031-01-31",
      seatLimit: 10,
      slots: slots(WEEKDAYS, "18:00", "20:00"),
      faculty: [{ userId: c.facultyUserId, role: "permanent_faculty" }],
    });
    await updateCourse(c.hod, second.id, { status: "published" });

    // One student in both courses, one in just the first.
    const both = await c.student("Both Courses");
    expect((await holdSeat(both, { batchId: c.batch.id })).status).toBe("enrolled");
    expect((await holdSeat(both, { batchId: python.id })).status).toBe("enrolled");
    const one = await c.student("One Course");
    expect((await holdSeat(one, { batchId: c.batch.id })).status).toBe("enrolled");
    // A marketplace buyer puts the course's recorded batch in play, which isn't an open batch.
    await buyRecordings(await c.student("Buyer"), c.batch.id);

    const d = await dashboard(c.admin);
    expect(d.students).toBe(2);
    expect(d.thisWeek).toBe(2);
    expect(d.openBatches).toBe(2);
    expect(d.courses).toBe(2);
  });
});
