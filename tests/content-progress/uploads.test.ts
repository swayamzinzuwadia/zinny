import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { courses } from "@/db/schema";
import { storage } from "@/server/core";
import { finishUploadResponse, staffFileResponse, startUploadResponse, uploadPartResponse } from "@/modules/content-progress/http";
import { PART_SIZE } from "@/modules/content-progress/lib/files";
import { makePdf } from "@/modules/content-progress/lib/pdf";
import { contentLessons, contentUploads } from "@/modules/content-progress/schema";
import { getLessonForEdit, setLessonKind } from "@/modules/content-progress/service";
import { cleanAbandonedUploads, finishUpload, startUpload, uploadPart } from "@/modules/content-progress/uploads";
import { systemActorFor } from "@/server/actor";
import { expectTenantIsolated } from "../helpers/isolation";
import { makeDepartment, uniqueCode } from "../fixtures";
import { otherFaculty, setupLearning, tempStorage } from "./helpers";

let restore: () => void;
beforeAll(() => {
  restore = tempStorage();
});
afterAll(async () => {
  restore();
  await closeDb();
});

const mp4 = (size: number) => {
  const b = Buffer.alloc(size, 7);
  b.set([0, 0, 0, 0x20, ...Buffer.from("ftypisom")], 0);
  return b;
};

describe("lesson file uploads", () => {
  it("uploads a video in parts, joins them and points the lesson at the file", async () => {
    const ctx = await setupLearning({ name: "Upload U", lessons: [{ title: "Watch", kind: "video", empty: true }] });
    const body = mp4(PART_SIZE + 1234);
    const u = await startUpload(ctx.faculty, { lessonId: ctx.lessons[0].id, fileName: "Week 1 / intro?.mp4", size: body.length, durationSeconds: 95.4 });
    expect(u).toMatchObject({ partSize: PART_SIZE, partCount: 2 });
    await uploadPart(ctx.faculty, u.uploadId, 1, body.subarray(PART_SIZE));
    await expect(finishUpload(ctx.faculty, u.uploadId)).rejects.toThrow(/haven't arrived/);
    await uploadPart(ctx.faculty, u.uploadId, 0, body.subarray(0, PART_SIZE));
    await uploadPart(ctx.faculty, u.uploadId, 0, body.subarray(0, PART_SIZE)); // a retry is fine
    const done = await finishUpload(ctx.faculty, u.uploadId);
    expect(done.fileName).toBe("intro-.mp4");
    const { lesson } = await getLessonForEdit(ctx.faculty, ctx.lessons[0].id);
    expect(lesson.ready).toBe(true);
    expect(lesson.content).toMatchObject({ source: "upload", key: done.key, contentType: "video/mp4", size: body.length, durationSeconds: 95 });
    const stored = await storage().get(done.key);
    expect(stored?.size).toBe(body.length);
    expect(Buffer.compare(stored!.body, body)).toBe(0);
    // The parts and the upload record are gone.
    expect(await storage().get(`${ctx.uni.id}/content-progress/uploads/${u.uploadId}/part-0`)).toBeNull();
    expect(await systemDb().select().from(contentUploads).where(eq(contentUploads.id, u.uploadId))).toEqual([]);
  });

  it("replacing a file deletes the old one; changing the lesson type deletes it too", async () => {
    const ctx = await setupLearning({ name: "Replace U", lessons: [{ title: "Notes", kind: "pdf" }] });
    const send = async (title: string) => {
      const body = makePdf(title, [{ text: title }]);
      const u = await startUpload(ctx.hod, { lessonId: ctx.lessons[0].id, fileName: `${title}.pdf`, size: body.length });
      await uploadPart(ctx.hod, u.uploadId, 0, body);
      return (await finishUpload(ctx.hod, u.uploadId)).key;
    };
    const first = await send("First");
    const second = await send("Second");
    expect(await storage().get(first)).toBeNull();
    expect(await storage().get(second)).not.toBeNull();
    await setLessonKind(ctx.hod, ctx.lessons[0].id, "text");
    expect(await storage().get(second)).toBeNull();
  });

  it("checks the real file type, the size and each part's length", async () => {
    const ctx = await setupLearning({ name: "Upload Checks U", lessons: [{ title: "Notes", kind: "pdf" }, { title: "Read", kind: "text" }] });
    const fake = Buffer.from("<html><script>alert(1)</script></html>");
    const u = await startUpload(ctx.hod, { lessonId: ctx.lessons[0].id, fileName: "notes.pdf", size: fake.length });
    await expect(uploadPart(ctx.hod, u.uploadId, 0, fake)).rejects.toThrow(/isn't a PDF/);
    await expect(startUpload(ctx.hod, { lessonId: ctx.lessons[0].id, fileName: "big.pdf", size: 51 * 1024 * 1024 })).rejects.toThrow(/up to 50 MB/);
    await expect(startUpload(ctx.hod, { lessonId: ctx.lessons[0].id, fileName: "empty.pdf", size: 0 })).rejects.toThrow(/empty/);
    await expect(startUpload(ctx.hod, { lessonId: ctx.lessons[1].id, fileName: "a.pdf", size: 10 })).rejects.toThrow(/Only video and PDF lessons/);
    const pdf = makePdf("Notes", [{ text: "x" }]);
    const v = await startUpload(ctx.hod, { lessonId: ctx.lessons[0].id, fileName: "notes.pdf", size: pdf.length });
    await expect(uploadPart(ctx.hod, v.uploadId, 0, pdf.subarray(0, 10))).rejects.toThrow(/incomplete/);
    await expect(uploadPart(ctx.hod, v.uploadId, 1, pdf)).rejects.toThrow(/outside the file/);
  });

  it("only people who edit the course upload, and only to their own upload", async () => {
    const ctx = await setupLearning({ name: "Upload Perms U", lessons: [{ title: "Notes", kind: "pdf" }] });
    const other = await otherFaculty(ctx);
    const s = await ctx.enrolled("Student Up");
    for (const who of [other.actor, s.actor]) {
      await expect(startUpload(who, { lessonId: ctx.lessons[0].id, fileName: "x.pdf", size: 100 })).rejects.toThrow(/access/);
    }
    const pdf = makePdf("Notes", [{ text: "x" }]);
    const u = await startUpload(ctx.hod, { lessonId: ctx.lessons[0].id, fileName: "notes.pdf", size: pdf.length });
    await expect(uploadPart(ctx.faculty, u.uploadId, 0, pdf)).rejects.toThrow(/started by someone else/);
    await expect(uploadPart(other.actor, u.uploadId, 0, pdf)).rejects.toThrow(/access/);
  });

  it("works through the route handlers, which refuse other sites", async () => {
    const ctx = await setupLearning({ name: "Upload Routes U", lessons: [{ title: "Notes", kind: "pdf" }] });
    const base = `http://localhost/${ctx.uni.slug}/admin/products/content/uploads`;
    const pdf = makePdf("Notes", [{ text: "x" }]);
    const headers = { host: "localhost", origin: "http://localhost" };
    const cross = await startUploadResponse(ctx.hod, new Request(base, { method: "POST", headers: { host: "localhost", origin: "https://evil.example" }, body: "{}" }));
    expect(cross.status).toBe(403);
    const start = await startUploadResponse(ctx.hod, new Request(base, { method: "POST", headers, body: JSON.stringify({ lessonId: ctx.lessons[0].id, fileName: "n.pdf", size: pdf.length }) }));
    expect(start.status).toBe(200);
    const { uploadId } = (await start.json()) as { uploadId: string };
    const part = await uploadPartResponse(ctx.hod, uploadId, new Request(`${base}/${uploadId}?part=0`, { method: "PUT", headers, body: new Uint8Array(pdf) }));
    expect(part.status).toBe(200);
    const fin = await finishUploadResponse(ctx.hod, uploadId, new Request(`${base}/${uploadId}`, { method: "POST", headers }));
    expect(fin.status).toBe(200);
    // Staff preview: anyone who can see the course; nobody else.
    const preview = await staffFileResponse(ctx.faculty, ctx.lessons[0].id, new Request(`${base}/x`));
    expect(preview.status).toBe(302);
    const s = await ctx.enrolled("Student Preview");
    expect((await staffFileResponse(s.actor, ctx.lessons[0].id, new Request(`${base}/x`))).status).toBe(403);
  });

  it("abandoned uploads are cleaned up after a day", async () => {
    const ctx = await setupLearning({ name: "Cleanup U", lessons: [{ title: "Notes", kind: "pdf" }] });
    const pdf = makePdf("Notes", [{ text: "x" }]);
    const u = await startUpload(ctx.hod, { lessonId: ctx.lessons[0].id, fileName: "n.pdf", size: pdf.length });
    await uploadPart(ctx.hod, u.uploadId, 0, pdf);
    expect(await cleanAbandonedUploads(systemActorFor(ctx.uni.id))).toBe(0);
    expect(await cleanAbandonedUploads(systemActorFor(ctx.uni.id), new Date(Date.now() + 25 * 3600 * 1000))).toBe(1);
    expect(await storage().get(`${ctx.uni.id}/content-progress/uploads/${u.uploadId}/part-0`)).toBeNull();
  });

  it("content_uploads is isolated per university", () =>
    expectTenantIsolated(contentUploads, async (uni) => {
      const dept = await makeDepartment(uni.id, uniqueCode(), "Computer Science");
      const [c] = await systemDb().insert(courses).values({ universityId: uni.id, departmentId: dept.id, title: "Isolated" }).returning();
      const { contentSections } = await import("@/modules/content-progress/schema");
      const [s] = await systemDb().insert(contentSections).values({ universityId: uni.id, courseId: c.id, title: "Week 1" }).returning();
      const [l] = await systemDb().insert(contentLessons).values({ universityId: uni.id, courseId: c.id, sectionId: s.id, title: "Lesson", kind: "pdf" }).returning();
      return { universityId: uni.id, lessonId: l.id, kind: "pdf" as const, fileName: "a.pdf", contentType: "application/pdf", size: 10, partSize: 10, partCount: 1 };
    }));
});
