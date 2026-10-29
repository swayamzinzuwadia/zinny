import sharp from "sharp";
import { loadActor } from "@/server/actor";
import { person, setupCourse } from "../fixtures";

/**
 * A university with a published course and one open batch, plus everyone the website module
 * cares about: an Institute Admin (website.manage), a HOD, a faculty member teaching the batch,
 * a second faculty member, a Board member and a student.
 */
export async function siteFixture(name = "Website University") {
  const base = await setupCourse({ name });
  const faculty = await loadActor(base.facultyUserId, base.uni.id);
  const other = await person("Faculty Omar", "permanent_faculty", { universityId: base.uni.id, departmentId: base.dept.id });
  const board = await (await person("Board Bina", "board_owner", { universityId: base.uni.id })).actor();
  const student = await base.student("Student Sam");
  return { ...base, faculty, otherFaculty: await other.actor(), otherFacultyUserId: other.user.id, board, studentActor: student };
}

/** A small real PNG (for upload tests). */
export async function png(width = 64, height = 48, color = "#17365d") {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}

let ipCounter = 1;
/** A fresh fake IP per call, so rate limits don't carry over between tests. */
export const freshIp = () => `10.${Math.floor(ipCounter / 250) % 250}.${ipCounter++ % 250}.7`;
