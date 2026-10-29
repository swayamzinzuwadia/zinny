import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { loadActor } from "@/server/actor";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { createBatch } from "@/server/services/batches";
import { createProgram } from "@/server/services/departments";
import { graduate } from "@/server/services/users";
import { holdSeat } from "@/server/services/enrolment";
import { updateCourse } from "@/server/services/courses";
import { verifyLocal } from "@/contracts/storage";
import { certCertificates } from "@/modules/certificates/schema";
import {
  certificateDownloadUrl,
  certificateSvg,
  courseCertificates,
  dashboardSummary,
  issueCandidates,
  issueCertificate,
  myCertificates,
  searchCertificates,
} from "@/modules/certificates/service";
import { slots, WEEKDAYS } from "../fixtures";
import { certWorld, useTempStorage } from "./helpers";

useTempStorage();
afterAll(closeDb);

function signedOk(url: string) {
  const u = new URL(url, "http://localhost");
  const key = decodeURIComponent(u.pathname.replace(/^\/api\/storage\//, ""));
  return verifyLocal(key, Number(u.searchParams.get("exp")), u.searchParams.get("name") ?? "", u.searchParams.get("sig") ?? "");
}

describe("learners see and download their own certificates", () => {
  it("lists only the learner's own, downloads them, and hides other people's", async () => {
    const w = await certWorld("Learner U");
    const riya = await w.enrolled("Riya Learner");
    const kabir = await w.enrolled("Kabir Learner");
    await w.complete(riya.enrolmentId);
    await w.complete(kabir.enrolmentId);
    const mine = await myCertificates(riya.actor);
    expect(mine.rows.map((r) => r.studentName)).toEqual(["Riya Learner"]);
    expect(mine.rows[0]).toMatchObject({ status: "valid", courseTitle: "Data Analytics" });
    expect(mine.rows[0].verifyPath).toBe(`/verify/${mine.rows[0].displayCode}`);

    const url = await certificateDownloadUrl(riya.actor, mine.rows[0].id);
    expect(signedOk(url)).toBe(true);
    expect(new URL(url, "http://x").searchParams.get("name")).toBe("Certificate - Data Analytics - Riya Learner.pdf");
    expect(await certificateSvg(riya.actor, mine.rows[0].id)).toContain("Riya Learner");

    const kabirs = (await myCertificates(kabir.actor)).rows[0];
    await expect(certificateDownloadUrl(riya.actor, kabirs.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(certificateSvg(riya.actor, kabirs.id)).rejects.toBeInstanceOf(NotFoundError);
    // Staff without self.view_certificates get nothing from the learner list.
    await expect(myCertificates(w.hod)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("alumni keep full access after graduating, even when the course's enrolment ended", async () => {
    const w = await certWorld("Alumni U");
    const program = await createProgram(w.admin, { departmentId: w.dept.id, name: "BSc Data Science" });
    await updateCourse(w.hod, w.course.id, { programId: program.id });
    const s = await w.enrolled("Neil Alumnus");
    await issueCertificate(w.admin, { enrolmentId: s.enrolmentId, reason: "Completed the programme module" });
    await graduate(w.admin, s.actor.userId);
    const alumnus = await loadActor(s.actor.userId, w.uni.id);
    expect(alumnus.assignments.some((a) => a.role === "alumni" && !a.endsAt)).toBe(true);
    const mine = await myCertificates(alumnus);
    expect(mine.rows).toHaveLength(1);
    expect(signedOk(await certificateDownloadUrl(alumnus, mine.rows[0].id))).toBe(true);
    // A graduate's ended enrolment can still be certified by staff.
    const candidates = await issueCandidates(w.admin, w.course.id);
    expect(candidates.find((c) => c.name === "Neil Alumnus")).toMatchObject({ enrolmentStatus: "ended", action: "none" });
  });
});

describe("staff see certificates within their reach", () => {
  it("faculty see their own batches only; HOD and board see the course", async () => {
    const w = await certWorld("Reach U");
    const fac2 = await (await import("../fixtures")).person("Faculty Two", "permanent_faculty", { universityId: w.uni.id, departmentId: w.dept.id });
    const evening = await createBatch(w.hod, {
      courseId: w.course.id,
      name: "Weekday evening",
      startDate: "2030-11-04",
      endDate: "2031-01-31",
      seatLimit: 20,
      slots: slots(WEEKDAYS, "18:00", "20:00"),
      faculty: [{ userId: fac2.user.id, role: "permanent_faculty" }],
    });
    const morning = await w.enrolled("Morning Student");
    const eveActor = await w.student("Evening Student");
    const r = await holdSeat(eveActor, { batchId: evening.id });
    if (r.status !== "enrolled") throw new Error("expected enrolment");
    await w.complete(morning.enrolmentId);
    await w.complete(r.enrolmentId);

    const names = async (a: Awaited<ReturnType<typeof loadActor>>) => (await courseCertificates(a, w.course.id)).rows.map((x) => x.studentName).sort();
    expect(await names(w.hod)).toEqual(["Evening Student", "Morning Student"]);
    expect(await names(w.board)).toEqual(["Evening Student", "Morning Student"]);
    expect(await names(w.faculty)).toEqual(["Morning Student"]);
    expect(await names(await fac2.actor())).toEqual(["Evening Student"]);
    await expect(courseCertificates(w.otherHod, w.course.id)).rejects.toBeInstanceOf(ForbiddenError);

    const eveningCert = (await myCertificates(eveActor)).rows[0];
    await expect(certificateDownloadUrl(w.faculty, eveningCert.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(signedOk(await certificateDownloadUrl(w.hod, eveningCert.id))).toBe(true);

    expect((await searchCertificates(w.faculty, { q: "student" })).rows.map((x) => x.studentName)).toEqual(["Morning Student"]);
    expect((await searchCertificates(w.admin, { q: eveningCert.displayCode })).rows.map((x) => x.id)).toEqual([eveningCert.id]);
    expect((await searchCertificates(w.otherHod, {})).rows).toEqual([]);

    const today = (await courseCertificates(w.admin, w.course.id)).today;
    expect(await dashboardSummary(w.admin, today)).toMatchObject({ thisMonth: 2, automatic: 2, manual: 0 });
    expect((await dashboardSummary(w.faculty, today)).thisMonth).toBe(1);
    expect((await dashboardSummary(w.otherHod, today)).thisMonth).toBe(0);
    const student = await w.student("Nosy Student");
    await expect(dashboardSummary(student, today)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("issue candidates say what issuing would do", async () => {
    const w = await certWorld("Candidates U");
    const a = await w.enrolled("Aarav Candidate");
    const b = await w.enrolled("Bela Candidate");
    await w.complete(a.enrolmentId);
    const list = await issueCandidates(w.hod, w.course.id);
    expect(list.map((c) => [c.name, c.enrolmentStatus, c.action])).toEqual([
      ["Aarav Candidate", "completed", "none"],
      ["Bela Candidate", "active", "issue"],
    ]);
    await expect(issueCandidates(w.faculty, w.course.id)).rejects.toBeInstanceOf(ForbiddenError);
    const [cert] = await systemDb().select().from(certCertificates).where(eq(certCertificates.enrolmentId, a.enrolmentId));
    expect(cert).toBeTruthy();
    void b;
  });
});
