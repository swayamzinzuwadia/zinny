import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, notifications } from "@/db/schema";
import { loadActor } from "@/server/actor";
import { person } from "../fixtures";
import { drainEvents, eventsOfType } from "../helpers/events";
import {
  createAssignment,
  deleteAssignment,
  getStaffAssignment,
  gradeSubmission,
  gradingQueue,
  listBatchAssignments,
  listCourseAssignments,
  listStaffAssignments,
  myAssignment,
  myAssignments,
  submitAssignment,
  toGradeSummary,
  updateAssignment,
} from "@/modules/assignments-polls/service/assignments";
import { asgnSubmissions, asgnSubmissionVersions } from "@/modules/assignments-polls/schema";
import { T, assignmentInput, tempStorage, twoBatches, upload, type Two } from "./setup";

const store = tempStorage();
afterAll(async () => {
  store.cleanup();
  await closeDb();
});

let c: Two;
beforeAll(async () => {
  c = await twoBatches("Assignment Rules U");
});

const at = (now: Date) => ({ now });

describe("creating assignments", () => {
  it("HOD sets one for every batch; students of both batches are told", async () => {
    const a = await createAssignment(c.hod, assignmentInput(c.course.id, { title: "Course-wide task" }), at(T.before));
    expect(a.allBatches).toBe(true);
    expect(a.dueAt.toISOString()).toBe(T.due.toISOString());
    const told = await systemDb().select().from(notifications).where(and(eq(notifications.kind, "assignment.new"), eq(notifications.universityId, c.uni.id)));
    const forThis = told.filter((n) => (n.data as { assignmentId?: string }).assignmentId === a.id).map((n) => n.userId).sort();
    expect(forThis).toEqual([c.riya.userId, c.kabir.userId, c.zoya.userId].sort());
  });

  it("instructions are sanitised: scripts, handlers and javascript: links are removed", async () => {
    const a = await createAssignment(
      c.hod,
      assignmentInput(c.course.id, {
        title: "Sanitised",
        instructionsHtml: `<h1>Read</h1><p onclick="x()">Hi <script>alert(1)</script><a href="javascript:alert(1)">bad</a> <a href="https://example.com">good</a></p><img src=x onerror=alert(1)>`,
      }),
      at(T.before),
    );
    expect(a.instructionsHtml).not.toMatch(/script|onclick|onerror|javascript:|<img/);
    expect(a.instructionsHtml).toContain("<h3>Read</h3>");
    expect(a.instructionsHtml).toContain('href="https://example.com"');
    expect(a.instructionsHtml).toContain('rel="noopener noreferrer nofollow"');
  });

  it("faculty set work for their own batch, but not for another batch or the whole course", async () => {
    const mine = await createAssignment(c.farah, assignmentInput(c.course.id, { title: "Farah's batch only", batchIds: [c.batchA.id] }), at(T.before));
    expect(mine.allBatches).toBe(false);
    await expect(createAssignment(c.farah, assignmentInput(c.course.id, { batchIds: [c.batchB.id] }), at(T.before))).rejects.toThrow(/batches you teach/);
    await expect(createAssignment(c.farah, assignmentInput(c.course.id, { batchIds: "all" }), at(T.before))).rejects.toThrow(/teach all of them/);
  });

  it("a HOD of another department and the board can't create assignments", async () => {
    const { makeDepartment } = await import("../fixtures");
    const other = await makeDepartment(c.uni.id, "MKT", "Marketing");
    const otherHod = await (await person("Other Head", "hod", { universityId: c.uni.id, departmentId: other.id })).actor();
    const board = await (await person("Board Bina", "board_owner", { universityId: c.uni.id })).actor();
    await expect(createAssignment(otherHod, assignmentInput(c.course.id), at(T.before))).rejects.toThrow(/teach all of them|access/);
    await expect(createAssignment(board, assignmentInput(c.course.id, { batchIds: [c.batchA.id] }), at(T.before))).rejects.toThrow(/batches you teach/);
  });

  it("refuses a due date in the past, bad points and an empty title", async () => {
    await expect(createAssignment(c.hod, assignmentInput(c.course.id), at(T.afterDue))).rejects.toThrow(/future/);
    await expect(createAssignment(c.hod, assignmentInput(c.course.id, { points: 0 }), at(T.before))).rejects.toThrow(/Points/);
    await expect(createAssignment(c.hod, assignmentInput(c.course.id, { title: " " }), at(T.before))).rejects.toThrow(/title/);
    await expect(createAssignment(c.hod, assignmentInput(c.course.id, { dueDate: "2030-02-30" }), at(T.before))).rejects.toThrow(/date/);
    await expect(createAssignment(c.hod, assignmentInput(c.course.id, { allowLate: true, latePenaltyPct: 120 }), at(T.before))).rejects.toThrow(/penalty/);
  });
});

describe("who sees what", () => {
  it("a student never sees or submits to another batch's assignment", async () => {
    const forB = await createAssignment(c.hod, assignmentInput(c.course.id, { title: "Evening batch only", batchIds: [c.batchB.id] }), at(T.before));
    const riyaList = await myAssignments(c.riya, at(T.before));
    expect(riyaList.map((a) => a.id)).not.toContain(forB.id);
    await expect(myAssignment(c.riya, forB.id, at(T.before))).rejects.toThrow(/not found/);
    await expect(submitAssignment(c.riya, { assignmentId: forB.id, text: "sneaky" }, at(T.before))).rejects.toThrow(/not found/);
    const zoyaList = await myAssignments(c.zoya, at(T.before));
    expect(zoyaList.map((a) => a.id)).toContain(forB.id);
  });

  it("a student from another course or university sees nothing", async () => {
    const a = await createAssignment(c.hod, assignmentInput(c.course.id, { title: "Private" }), at(T.before));
    const outsider = await c.student("Outside Olga");
    expect(await myAssignments(outsider, at(T.before))).toEqual([]);
    await expect(submitAssignment(outsider, { assignmentId: a.id, text: "hi" }, at(T.before))).rejects.toThrow(/not found/);
    const other = await twoBatches("Other Assignments U");
    await expect(myAssignment(other.riya, a.id, at(T.before))).rejects.toThrow(/not found/);
    await expect(gradeSubmission(other.hod, { assignmentId: a.id, studentId: c.riya.userId, marks: 5 })).rejects.toThrow(/not found/);
  });

  it("staff lists are scoped: faculty see their batches, HOD the department, board read only", async () => {
    const onlyB = await createAssignment(c.omar, assignmentInput(c.course.id, { title: "Omar's own", batchIds: [c.batchB.id] }), at(T.before));
    const farahIds = (await listCourseAssignments(c.farah, c.course.id)).map((a) => a.id);
    expect(farahIds).not.toContain(onlyB.id);
    expect((await listCourseAssignments(c.hod, c.course.id)).map((a) => a.id)).toContain(onlyB.id);
    expect((await listStaffAssignments(c.omar)).map((a) => a.id)).toContain(onlyB.id);
    expect((await listStaffAssignments(c.farah)).map((a) => a.id)).not.toContain(onlyB.id);
    await expect(getStaffAssignment(c.farah, onlyB.id)).rejects.toThrow(/not found/);
    const board = await (await person("Board Bob", "board_owner", { universityId: c.uni.id })).actor();
    const view = await getStaffAssignment(board, onlyB.id);
    expect(view.canManage).toBe(false);
    expect(view.batches.every((b) => b.canView && !b.canGrade)).toBe(true);
    const batchList = await listBatchAssignments(c.omar, c.batchB.id);
    expect(batchList.find((a) => a.id === onlyB.id)?.students).toBe(1);
    await expect(listBatchAssignments(c.farah, c.batchB.id)).rejects.toThrow(/access/);
  });
});

describe("submitting", () => {
  it("students hand in text and files, resubmit before the due date, and every version is kept", async () => {
    const a = await createAssignment(c.hod, assignmentInput(c.course.id, { title: "Versions" }), at(T.before));
    const f1 = await upload(c.riya, { purpose: "submission", assignmentId: a.id, fileName: "draft.pdf" });
    const r1 = await submitAssignment(c.riya, { assignmentId: a.id, text: "First try", fileIds: [f1] }, at(T.before));
    expect(r1.version.version).toBe(1);
    expect(r1.submission.late).toBe(false);
    const f2 = await upload(c.riya, { purpose: "submission", assignmentId: a.id, fileName: "final.docx" });
    const r2 = await submitAssignment(c.riya, { assignmentId: a.id, text: "Second try", fileIds: [f2], keepFileIds: [] }, at(new Date(T.before.getTime() + 3_600_000)));
    expect(r2.version.version).toBe(2);
    const detail = await myAssignment(c.riya, a.id, at(T.before));
    expect(detail.status).toBe("submitted");
    expect(detail.versions.map((v) => [v.version, v.textAnswer, v.files.map((f) => f.fileName)])).toEqual([
      [2, "Second try", ["final.docx"]],
      [1, "First try", ["draft.pdf"]],
    ]);
    // Keeping a file from the latest version carries it into the next one.
    const keepId = detail.versions[0].files[0].id;
    const r3 = await submitAssignment(c.riya, { assignmentId: a.id, text: "Third", keepFileIds: [keepId] }, at(T.before));
    const after = await myAssignment(c.riya, a.id, at(T.before));
    expect(after.versions[0].files.map((f) => f.fileName)).toEqual(["final.docx"]);
    expect(r3.version.version).toBe(3);
    const events = (await eventsOfType("assignment.submitted", c.uni.id)).filter((e) => (e.payload as { assignmentId: string }).assignmentId === a.id);
    expect(events).toHaveLength(3);
    expect(events[0].payload).toEqual({ submissionId: r1.submission.id, assignmentId: a.id, userId: c.riya.userId, batchId: c.batchA.id, late: false });
  });

  it("submitting after the due date is refused when late work isn't allowed", async () => {
    const a = await createAssignment(c.hod, assignmentInput(c.course.id, { title: "Strict deadline", allowLate: false }), at(T.before));
    await expect(submitAssignment(c.kabir, { assignmentId: a.id, text: "Too late" }, at(T.afterDue))).rejects.toThrow(/doesn't take late work/);
    const view = await myAssignment(c.kabir, a.id, at(T.afterDue));
    expect(view.status).toBe("missed");
    expect(view.canSubmit).toBe(false);
  });

  it("late work is accepted when allowed, marked late, and loses the penalty when graded", async () => {
    const a = await createAssignment(c.hod, assignmentInput(c.course.id, { title: "Late allowed", allowLate: true, latePenaltyPct: 20 }), at(T.before));
    expect((await myAssignment(c.kabir, a.id, at(T.afterDue))).status).toBe("overdue");
    const r = await submitAssignment(c.kabir, { assignmentId: a.id, text: "Sorry, late" }, at(T.afterDue));
    expect(r.submission.late).toBe(true);
    // Work handed in late can't then be changed.
    await expect(submitAssignment(c.kabir, { assignmentId: a.id, text: "Again" }, at(T.afterDue))).rejects.toThrow(/can't be changed/);
    const graded = await gradeSubmission(c.farah, { assignmentId: a.id, studentId: c.kabir.userId, marks: "8" });
    expect(graded.marks).toBe(8);
    expect(graded.penaltyPct).toBe(20);
    expect(graded.finalMarks).toBe(6.4);
    expect(graded.scorePercent).toBe(64);
    const late = (await eventsOfType("assignment.submitted", c.uni.id)).find((e) => (e.payload as { submissionId: string }).submissionId === r.submission.id);
    expect((late?.payload as { late: boolean }).late).toBe(true);
  });

  it("checks the submission type and file count", async () => {
    const text = await createAssignment(c.hod, assignmentInput(c.course.id, { title: "Text only", submissionType: "text" }), at(T.before));
    await expect(submitAssignment(c.riya, { assignmentId: text.id, text: "" }, at(T.before))).rejects.toThrow(/Write your answer/);
    await expect(upload(c.riya, { purpose: "submission", assignmentId: text.id })).rejects.toThrow(/written answer only/);
    const files = await createAssignment(c.hod, assignmentInput(c.course.id, { title: "One file", submissionType: "files", maxFiles: 1, maxFileMb: 1 }), at(T.before));
    await expect(submitAssignment(c.riya, { assignmentId: files.id, text: "words" }, at(T.before))).rejects.toThrow(/Upload at least one file/);
    const x = await upload(c.riya, { purpose: "submission", assignmentId: files.id, fileName: "a.pdf" });
    const y = await upload(c.riya, { purpose: "submission", assignmentId: files.id, fileName: "b.pdf" });
    await expect(submitAssignment(c.riya, { assignmentId: files.id, fileIds: [x, y] }, at(T.before))).rejects.toThrow(/at most 1 file/);
    await expect(upload(c.riya, { purpose: "submission", assignmentId: files.id, fileName: "big.pdf", body: Buffer.alloc(1024 * 1024 + 1, 1) })).rejects.toThrow(/larger than 1 MB/);
    await expect(upload(c.riya, { purpose: "submission", assignmentId: files.id, fileName: "virus.exe" })).rejects.toThrow(/isn't a file type/);
    // Someone else's upload can't be claimed.
    const kabirFile = await upload(c.kabir, { purpose: "submission", assignmentId: files.id, fileName: "k.pdf" });
    await expect(submitAssignment(c.riya, { assignmentId: files.id, fileIds: [kabirFile] }, at(T.before))).rejects.toThrow(/didn't finish uploading/);
    await submitAssignment(c.riya, { assignmentId: files.id, fileIds: [x] }, at(T.before));
  });

  it("only students may submit (a faculty member is refused)", async () => {
    const a = await createAssignment(c.hod, assignmentInput(c.course.id, { title: "Students only" }), at(T.before));
    await expect(submitAssignment(c.farah, { assignmentId: a.id, text: "hi" }, at(T.before))).rejects.toThrow(/access/);
  });

  it("moving the due date re-marks ungraded work as late or on time", async () => {
    const a = await createAssignment(c.hod, assignmentInput(c.course.id, { title: "Moved", allowLate: true, latePenaltyPct: 10 }), at(T.before));
    await submitAssignment(c.riya, { assignmentId: a.id, text: "done" }, at(T.afterDue));
    expect((await myAssignment(c.riya, a.id, at(T.afterDue))).late).toBe(true);
    await updateAssignment(c.hod, a.id, { ...assignmentInput(c.course.id, { title: "Moved", allowLate: true, latePenaltyPct: 10, dueDate: "2030-11-16" }) });
    const after = await myAssignment(c.riya, a.id, at(T.afterDue));
    expect(after.late).toBe(false);
    expect(after.versions[0].late).toBe(false);
  });
});

describe("grading", () => {
  it("the queue lists every student of the batch, unsubmitted ones too", async () => {
    const a = await createAssignment(c.hod, assignmentInput(c.course.id, { title: "Queue" }), at(T.before));
    await submitAssignment(c.riya, { assignmentId: a.id, text: "mine" }, at(T.before));
    const q = await gradingQueue(c.farah, a.id, c.batchA.id);
    expect(q.canGrade).toBe(true);
    expect(q.rows.map((r) => [r.student.id, r.status])).toEqual([
      [c.riya.userId, "to_grade"],
      [c.kabir.userId, "missing"],
    ]);
    expect(q.counts).toMatchObject({ students: 2, toGrade: 1, missing: 1, graded: 0 });
    await expect(gradingQueue(c.farah, a.id, c.batchB.id)).rejects.toThrow(/not found/);
  });

  it("faculty of another batch can't grade, and the HOD and admin can", async () => {
    const a = await createAssignment(c.hod, assignmentInput(c.course.id, { title: "Who grades" }), at(T.before));
    await submitAssignment(c.zoya, { assignmentId: a.id, text: "evening work" }, at(T.before));
    await expect(gradeSubmission(c.farah, { assignmentId: a.id, studentId: c.zoya.userId, marks: 9 })).rejects.toThrow(/batches you teach/);
    const byOmar = await gradeSubmission(c.omar, { assignmentId: a.id, studentId: c.zoya.userId, marks: 9, feedback: "Good" });
    expect(byOmar.finalMarks).toBe(9);
    const byHod = await gradeSubmission(c.hod, { assignmentId: a.id, studentId: c.zoya.userId, marks: 9.5 });
    expect(byHod.finalMarks).toBe(9.5);
    const byAdmin = await gradeSubmission(c.admin, { assignmentId: a.id, studentId: c.zoya.userId, marks: "7,5" });
    expect(byAdmin.finalMarks).toBe(7.5);
    const board = await (await person("Board Bala", "board_owner", { universityId: c.uni.id })).actor();
    await expect(gradeSubmission(board, { assignmentId: a.id, studentId: c.zoya.userId, marks: 1 })).rejects.toThrow(/batches you teach/);
  });

  it("refuses marks above the points or malformed, and grades missing work as a zero", async () => {
    const a = await createAssignment(c.hod, assignmentInput(c.course.id, { title: "Marks" }), at(T.before));
    await expect(gradeSubmission(c.farah, { assignmentId: a.id, studentId: c.kabir.userId, marks: 11 })).rejects.toThrow(/more than 10/);
    await expect(gradeSubmission(c.farah, { assignmentId: a.id, studentId: c.kabir.userId, marks: "abc" })).rejects.toThrow(/number/);
    const zero = await gradeSubmission(c.farah, { assignmentId: a.id, studentId: c.kabir.userId, marks: 0, feedback: "Nothing handed in." });
    expect(zero.finalMarks).toBe(0);
    expect(zero.submittedAt).toBeNull();
    expect((await myAssignment(c.kabir, a.id, at(T.afterDue))).status).toBe("graded");
  });

  it("grading emits assignment.graded with the score, tells the student, and audits", async () => {
    const a = await createAssignment(c.hod, assignmentInput(c.course.id, { title: "Graded event", points: 20 }), at(T.before));
    const r = await submitAssignment(c.riya, { assignmentId: a.id, text: "answer" }, at(T.before));
    await gradeSubmission(c.farah, { assignmentId: a.id, studentId: c.riya.userId, marks: 15, feedback: "Nice joins." });
    const ev = (await eventsOfType("assignment.graded", c.uni.id)).filter((e) => (e.payload as { submissionId: string }).submissionId === r.submission.id);
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toEqual({ submissionId: r.submission.id, assignmentId: a.id, userId: c.riya.userId, batchId: c.batchA.id, scorePercent: 75 });
    // Saving the same grade again doesn't emit a second event.
    await gradeSubmission(c.farah, { assignmentId: a.id, studentId: c.riya.userId, marks: 15, feedback: "Nice joins!" });
    expect((await eventsOfType("assignment.graded", c.uni.id)).filter((e) => (e.payload as { submissionId: string }).submissionId === r.submission.id)).toHaveLength(1);
    await gradeSubmission(c.farah, { assignmentId: a.id, studentId: c.riya.userId, marks: 16 });
    expect((await eventsOfType("assignment.graded", c.uni.id)).filter((e) => (e.payload as { submissionId: string }).submissionId === r.submission.id)).toHaveLength(2);
    const told = await systemDb().select().from(notifications).where(and(eq(notifications.userId, c.riya.userId), eq(notifications.kind, "assignment.graded")));
    expect(told.some((n) => n.title.includes("Graded event"))).toBe(true);
    const log = await systemDb().select().from(auditLog).where(and(eq(auditLog.entityId, r.submission.id), eq(auditLog.action, "assignment.grade")));
    expect(log).toHaveLength(1);
    // A graded student can't hand in again.
    await expect(submitAssignment(c.riya, { assignmentId: a.id, text: "more" }, at(T.before))).rejects.toThrow(/graded/);
    const mine = await myAssignment(c.riya, a.id, at(T.before));
    expect(mine).toMatchObject({ status: "graded", finalMarks: 16, scorePercent: 80, feedback: null });
  });

  it("returned files reach the student; points can't change after grading", async () => {
    const a = await createAssignment(c.hod, assignmentInput(c.course.id, { title: "Returned file" }), at(T.before));
    await submitAssignment(c.riya, { assignmentId: a.id, text: "work" }, at(T.before));
    const back = await upload(c.farah, { purpose: "returned", assignmentId: a.id, batchId: c.batchA.id, fileName: "marked-up.pdf" });
    await gradeSubmission(c.farah, { assignmentId: a.id, studentId: c.riya.userId, marks: 7, feedback: "See the notes.", returnedFileIds: [back] });
    const mine = await myAssignment(c.riya, a.id, at(T.before));
    expect(mine.returned.map((f) => f.fileName)).toEqual(["marked-up.pdf"]);
    expect(mine.feedback).toBe("See the notes.");
    await expect(upload(c.farah, { purpose: "returned", assignmentId: a.id, batchId: c.batchB.id })).rejects.toThrow(/batches you grade/);
    await expect(updateAssignment(c.hod, a.id, { ...assignmentInput(c.course.id, { title: "Returned file", points: 20 }) })).rejects.toThrow(/Points can't change/);
  });

  it("the to-grade summary counts waiting work per batch for the people who grade it", async () => {
    const fresh = await twoBatches("To Grade U");
    const a = await createAssignment(fresh.hod, assignmentInput(fresh.course.id, { title: "Waiting" }), at(T.before));
    await submitAssignment(fresh.riya, { assignmentId: a.id, text: "1" }, at(T.before));
    await submitAssignment(fresh.kabir, { assignmentId: a.id, text: "2" }, at(T.before));
    await submitAssignment(fresh.zoya, { assignmentId: a.id, text: "3" }, at(T.before));
    expect((await toGradeSummary(fresh.farah)).map((x) => [x.batchId, x.count])).toEqual([[fresh.batchA.id, 2]]);
    expect((await toGradeSummary(fresh.hod)).reduce((n, x) => n + x.count, 0)).toBe(3);
    expect(await toGradeSummary(fresh.riya)).toEqual([]);
  });
});

describe("editing and deleting", () => {
  it("only staff who manage every covered batch edit or delete; dropping a batch with work is refused", async () => {
    const a = await createAssignment(c.hod, assignmentInput(c.course.id, { title: "Editable" }), at(T.before));
    await expect(updateAssignment(c.farah, a.id, assignmentInput(c.course.id, { title: "Hijack", batchIds: [c.batchA.id] }))).rejects.toThrow(/teach every batch/);
    await submitAssignment(c.zoya, { assignmentId: a.id, text: "evening" }, at(T.before));
    await expect(updateAssignment(c.hod, a.id, assignmentInput(c.course.id, { title: "Editable", batchIds: [c.batchA.id] }))).rejects.toThrow(/Keep that batch/);
    const renamed = await updateAssignment(c.hod, a.id, assignmentInput(c.course.id, { title: "Edited title" }));
    expect(renamed.title).toBe("Edited title");
    await expect(deleteAssignment(c.farah, a.id)).rejects.toThrow(/teach every batch/);
    await deleteAssignment(c.hod, a.id);
    await expect(getStaffAssignment(c.hod, a.id)).rejects.toThrow(/not found/);
    expect(await systemDb().select().from(asgnSubmissions).where(eq(asgnSubmissions.assignmentId, a.id))).toEqual([]);
  });

  it("faculty edit and delete assignments for their own batch", async () => {
    const a = await createAssignment(c.farah, assignmentInput(c.course.id, { title: "Mine to edit", batchIds: [c.batchA.id] }), at(T.before));
    const edited = await updateAssignment(c.farah, a.id, assignmentInput(c.course.id, { title: "Mine, edited", batchIds: [c.batchA.id] }));
    expect(edited.title).toBe("Mine, edited");
    await expect(updateAssignment(c.omar, a.id, assignmentInput(c.course.id, { title: "Nope", batchIds: [c.batchB.id] }))).rejects.toThrow(/not found/);
    await deleteAssignment(c.farah, a.id);
  });
});

describe("batch switches", () => {
  it("ungraded work follows the student to the new batch, so its faculty grade it", async () => {
    const fresh = await twoBatches("Switch U");
    const a = await createAssignment(fresh.hod, assignmentInput(fresh.course.id, { title: "Follows" }), at(T.before));
    await submitAssignment(fresh.kabir, { assignmentId: a.id, text: "morning work" }, at(T.before));
    const { requestSwitch, decideSwitch, myLearning } = await import("@/server/services/enrolment");
    const kabirEnrolment = (await myLearning(fresh.kabir)).find((l) => l.status === "active")!.enrolmentId;
    const req = await requestSwitch(fresh.kabir, { enrolmentId: kabirEnrolment, toBatchId: fresh.batchB.id, acknowledgeClash: true });
    if (req.status !== "requested") throw new Error(`unexpected ${req.status}`);
    await decideSwitch(fresh.hod, req.requestId, { approve: true });
    await drainEvents();
    const [s] = await systemDb().select().from(asgnSubmissions).where(eq(asgnSubmissions.assignmentId, a.id));
    expect(s.batchId).toBe(fresh.batchB.id);
    const omar = await loadActor(fresh.omar.userId, fresh.uni.id);
    expect((await gradeSubmission(omar, { assignmentId: a.id, studentId: fresh.kabir.userId, marks: 5 })).finalMarks).toBe(5);
    expect(await systemDb().select().from(asgnSubmissionVersions).where(eq(asgnSubmissionVersions.submissionId, s.id))).toHaveLength(1);
  });
});
