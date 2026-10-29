import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { verifyLocal } from "@/contracts/storage";
import { person } from "../fixtures";
import { createAssignment, gradeSubmission, myAssignment, submitAssignment } from "@/modules/assignments-polls/service/assignments";
import { cleanStagedFiles, fileLink, finishUpload, PART_BYTES, putPart, startUpload } from "@/modules/assignments-polls/service/files";
import { safeFileName, storageKeyFor } from "@/modules/assignments-polls/lib/files";
import { asgnFiles } from "@/modules/assignments-polls/schema";
import { storage } from "@/server/core";
import { T, assignmentInput, tempStorage, twoBatches, upload, type Two } from "./setup";

const store = tempStorage();
afterAll(async () => {
  store.cleanup();
  await closeDb();
});

let c: Two;
let assignmentId: string;
let riyaFile: string;
let zoyaFile: string;
let attachment: string;

beforeAll(async () => {
  c = await twoBatches("Files U");
  attachment = await upload(c.hod, { purpose: "attachment", courseId: c.course.id, fileName: "brief.pdf" });
  const a = await createAssignment(c.hod, assignmentInput(c.course.id, { title: "With files", attachmentIds: [attachment] }), { now: T.before });
  assignmentId = a.id;
  riyaFile = await upload(c.riya, { purpose: "submission", assignmentId, fileName: "riya answer.pdf", body: "riya's work" });
  await submitAssignment(c.riya, { assignmentId, fileIds: [riyaFile] }, { now: T.before });
  zoyaFile = await upload(c.zoya, { purpose: "submission", assignmentId, fileName: "zoya.pdf", body: "zoya's work" });
  await submitAssignment(c.zoya, { assignmentId, fileIds: [zoyaFile] }, { now: T.before });
});

const opens = async (actorP: Parameters<typeof fileLink>[0], id: string) => {
  const { url } = await fileLink(actorP, id);
  const u = new URL(url, "http://localhost");
  const key = decodeURIComponent(u.pathname.replace(/^\/api\/storage\//, ""));
  expect(verifyLocal(key, Number(u.searchParams.get("exp")), u.searchParams.get("name") ?? "", u.searchParams.get("sig") ?? "")).toBe(true);
  const expiresIn = Number(u.searchParams.get("exp")) - Date.now() / 1000;
  expect(expiresIn).toBeLessThanOrEqual(120);
  return (await storage().get(key))!.body.toString();
};

describe("file access", () => {
  it("storage keys always start with the university id and the module", async () => {
    const rows = await systemDb().select().from(asgnFiles).where(eq(asgnFiles.universityId, c.uni.id));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) expect(r.storageKey.startsWith(`${c.uni.id}/assignments-polls/files/${r.id}/`)).toBe(true);
    expect(storageKeyFor(c.uni.id, "f1", "../../etc/passwd")).toBe(`${c.uni.id}/assignments-polls/files/f1/passwd`);
    expect(safeFileName("Résumé <final>.PDF")).toBe("Resume-final.pdf");
    // The database refuses a key under another university.
    await expect(
      systemDb().insert(asgnFiles).values({ universityId: c.uni.id, purpose: "attachment", storageKey: `00000000-0000-0000-0000-000000000000/assignments-polls/files/x/a.pdf`, fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 1 }),
    ).rejects.toThrow();
  });

  it("the submitting student opens their own file through a short-lived signed link", async () => {
    expect(await opens(c.riya, riyaFile)).toBe("riya's work");
  });

  it("another student can't open it", async () => {
    await expect(fileLink(c.kabir, riyaFile)).rejects.toThrow(/not found/);
    await expect(fileLink(c.zoya, riyaFile)).rejects.toThrow(/not found/);
  });

  it("that batch's faculty, the HOD and admins can open it", async () => {
    expect(await opens(c.farah, riyaFile)).toBe("riya's work");
    expect(await opens(c.hod, riyaFile)).toBe("riya's work");
    expect(await opens(c.admin, riyaFile)).toBe("riya's work");
  });

  it("faculty of another batch can't open it, nor can the board or another university", async () => {
    await expect(fileLink(c.omar, riyaFile)).rejects.toThrow(/not found/);
    await expect(fileLink(c.farah, zoyaFile)).rejects.toThrow(/not found/);
    const board = await (await person("Board Bea", "board_owner", { universityId: c.uni.id })).actor();
    await expect(fileLink(board, riyaFile)).rejects.toThrow(/not found/);
    const other = await twoBatches("Files Other U");
    await expect(fileLink(other.admin, riyaFile)).rejects.toThrow(/not found/);
  });

  it("attachments open for students the assignment is for and staff who can see it", async () => {
    expect(await opens(c.riya, attachment)).toContain("%PDF");
    expect(await opens(c.zoya, attachment)).toContain("%PDF");
    expect(await opens(c.omar, attachment)).toContain("%PDF");
    const outsider = await c.student("No Seat");
    await expect(fileLink(outsider, attachment)).rejects.toThrow(/not found/);
  });

  it("a returned file opens for the student and their grader only", async () => {
    const back = await upload(c.farah, { purpose: "returned", assignmentId, batchId: c.batchA.id, fileName: "notes.pdf", body: "marked up" });
    await gradeSubmission(c.farah, { assignmentId, studentId: c.riya.userId, marks: 9, returnedFileIds: [back] });
    const mine = await myAssignment(c.riya, assignmentId);
    expect(await opens(c.riya, mine.returned[0].id)).toBe("marked up");
    await expect(fileLink(c.kabir, back)).rejects.toThrow(/not found/);
    await expect(fileLink(c.omar, back)).rejects.toThrow(/not found/);
  });

  it("a staged upload opens only for its uploader", async () => {
    const staged = await upload(c.kabir, { purpose: "submission", assignmentId, fileName: "draft.txt", body: "draft" });
    expect(await opens(c.kabir, staged)).toBe("draft");
    await expect(fileLink(c.farah, staged)).rejects.toThrow(/not found/);
  });

  it("only students in the assignment upload work; only staff who manage the course upload attachments", async () => {
    const outsider = await c.student("Uploader Out");
    await expect(upload(outsider, { purpose: "submission", assignmentId })).rejects.toThrow(/not found/);
    await expect(upload(c.riya, { purpose: "attachment", courseId: c.course.id })).rejects.toThrow(/can't add assignments/);
    const board = await (await person("Board Bix", "board_owner", { universityId: c.uni.id })).actor();
    await expect(upload(board, { purpose: "attachment", courseId: c.course.id })).rejects.toThrow(/can't add assignments/);
    expect(await upload(c.farah, { purpose: "attachment", courseId: c.course.id })).toBeTruthy();
  });

  it("large files arrive in parts and are joined; a short part is refused", async () => {
    const body = Buffer.alloc(PART_BYTES + 1234, 7);
    const started = await startUpload(c.kabir, { purpose: "submission", assignmentId, fileName: "big.zip", size: body.length });
    expect(started.parts).toBe(2);
    await expect(putPart(c.kabir, started.fileId, 0, body.subarray(0, 10))).rejects.toThrow(/went missing/);
    await expect(putPart(c.riya, started.fileId, 0, body.subarray(0, PART_BYTES))).rejects.toThrow(/not found/);
    await putPart(c.kabir, started.fileId, 0, body.subarray(0, PART_BYTES));
    await expect(finishUpload(c.kabir, started.fileId)).rejects.toThrow(/went missing/);
    await putPart(c.kabir, started.fileId, 1, body.subarray(PART_BYTES));
    const done = await finishUpload(c.kabir, started.fileId);
    expect(done.sizeBytes).toBe(body.length);
    const [row] = await systemDb().select().from(asgnFiles).where(eq(asgnFiles.id, started.fileId));
    expect((await storage().get(row.storageKey))!.size).toBe(body.length);
  });

  it("the daily job removes uploads nobody saved, and keeps saved files", async () => {
    const staged = await upload(c.kabir, { purpose: "submission", assignmentId, fileName: "forgotten.pdf" });
    const [row] = await systemDb().select().from(asgnFiles).where(eq(asgnFiles.id, staged));
    const { systemActorFor } = await import("@/server/core");
    const removed = await cleanStagedFiles(systemActorFor(c.uni.id), new Date(Date.now() + 25 * 3_600_000));
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await storage().get(row.storageKey)).toBeNull();
    expect(await opens(c.riya, riyaFile)).toBe("riya's work");
  });
});
