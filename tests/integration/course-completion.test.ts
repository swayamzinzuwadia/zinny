/**
 * Cross-module flow (wave 1 integration): course completion.
 * A student finishes every required lesson (content-progress) → core marks the enrolment
 * completed (`enrolment.completed`) → certificates issues a stored PDF that /verify finds →
 * gamification awards XP → notifications-delivery sends the certificate email through the
 * console transport → the course and batch progress report shows the completion.
 * Real events, delivered with drainEvents().
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { enrolments, notifications } from "@/db/schema";
import { storage, systemActorFor } from "@/server/core";
import { jobs, reports } from "@/server/registry";
import { updateCourse } from "@/server/services/courses";
import { markLessonComplete } from "@/modules/content-progress/learn";
import { certCertificates } from "@/modules/certificates/schema";
import { lookupCertificate } from "@/modules/certificates/service/verify";
import { createRule } from "@/modules/gamification/rules";
import { gamXpLedger } from "@/modules/gamification/schema";
import { notifDeliveries } from "@/modules/notifications-delivery/schema";
import { drainEvents, eventsOfType } from "../helpers/events";
import { setupLearning, tempStorage, today } from "../content-progress/helpers";

let restoreStorage: () => void;
let w: Awaited<ReturnType<typeof setupLearning>>;

beforeAll(async () => {
  restoreStorage = tempStorage();
  w = await setupLearning({ name: "Completion Flow University" });
  await updateCourse(w.hod, w.course.id, { certificateEnabled: true });
  await createRule(w.admin, { name: "Lesson finished", trigger: "lesson", points: 10 });
  await createRule(w.admin, { name: "Course completed", trigger: "course-completed", points: 200 });
});

afterAll(async () => {
  restoreStorage();
  await closeDb();
});

/** Delivers this university's events until nothing new is emitted (handlers emit follow-ups). */
async function settle() {
  for (let i = 0; i < 5; i++) await drainEvents({ universityId: w.uni.id });
}

describe("course completion across modules", () => {
  it("lessons → completed enrolment → certificate → XP → email → progress report", async () => {
    const s = await w.enrolled("Riya Completes");
    const required = w.lessons.filter((l) => l.title !== "Extra");
    for (const l of required) await markLessonComplete(s.actor, l.id);
    await settle();

    // Core: the enrolment is completed, and enrolment.completed fired once.
    const [enrolment] = await systemDb().select().from(enrolments).where(eq(enrolments.id, s.enrolmentId));
    expect(enrolment.status).toBe("completed");
    const completed = (await eventsOfType("enrolment.completed", w.uni.id)).filter((e) => e.payload.enrolmentId === s.enrolmentId);
    expect(completed).toHaveLength(1);

    // Certificates: one certificate, its PDF stored, found by the public verify lookup.
    const certs = await systemDb().select().from(certCertificates).where(eq(certCertificates.enrolmentId, s.enrolmentId));
    expect(certs).toHaveLength(1);
    const pdf = await storage().get(certs[0].pdfKey);
    expect(pdf?.contentType).toBe("application/pdf");
    expect(Buffer.from(pdf!.body).subarray(0, 5).toString()).toBe("%PDF-");
    const verified = await lookupCertificate(certs[0].code.toLowerCase());
    expect(verified).toMatchObject({ status: "valid", studentName: "Riya Completes", courseTitle: w.course.title });
    expect((await eventsOfType("certificate.issued", w.uni.id)).filter((e) => e.payload.userId === s.userId)).toHaveLength(1);

    // Gamification: XP for each required lesson and for completing the course.
    const ledger = await systemDb().select().from(gamXpLedger).where(eq(gamXpLedger.userId, s.userId));
    expect(ledger.map((r) => r.eventType).sort()).toEqual(["enrolment.completed", "lesson.completed", "lesson.completed"]);
    expect(ledger.reduce((n, r) => n + r.points, 0)).toBe(220);

    // Notifications: the in-app notice, then the email through the console transport.
    const [notice] = await systemDb()
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, s.userId), eq(notifications.kind, "certificate.issued")));
    expect(notice).toBeDefined();
    const deliver = jobs().find((j) => j.id === "notifications-delivery.deliver")!;
    const quiet = console.log;
    console.log = () => {};
    try {
      await deliver.run(systemActorFor(w.uni.id));
    } finally {
      console.log = quiet;
    }
    const sent = await systemDb()
      .select()
      .from(notifDeliveries)
      .where(and(eq(notifDeliveries.notificationId, notice.id), eq(notifDeliveries.channel, "email")));
    expect(sent.map((d) => d.status)).toEqual(["sent"]);

    // Reports: the course and batch progress report counts the completion.
    const progress = reports().find((r) => r.id === "content-progress.course-batch-progress")!;
    const run = await progress.run(w.hod, { from: "2000-01-01", to: today(), courseId: w.course.id });
    const row = run.rows.find((r) => r.batch === w.batch.name);
    expect(row).toMatchObject({ students: 1, completed: 1, completionRate: 100 });
  });
});
