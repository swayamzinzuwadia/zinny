/**
 * The delivery job: channels from admin defaults and preferences, quiet hours, never twice,
 * retries, and interrupted sends.
 */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { notifDeliveries } from "@/modules/notifications-delivery/schema";
import {
  CLAIM_MS,
  MAX_ATTEMPTS,
  planDeliveries,
  retryDelayMs,
  runDeliveryJob,
  sendDueDeliveries,
} from "@/modules/notifications-delivery/delivery";
import { saveKindSettings, savePreferences } from "@/modules/notifications-delivery/service";
import { deliveriesOf, later, minutes, notifyUsers, permanent, quiet, recordingProviders, retryable, setupUni, zoneWithLocalHour } from "./helpers";

afterAll(closeDb);

describe("notifications-delivery: channels from admin defaults and preferences", () => {
  it("uses the catalogue defaults: enrolment emails go out, optional SMS doesn't", async () => {
    const t = await setupUni({ timezone: zoneWithLocalHour(12) });
    await notifyUsers(t.uni.id, [t.riya.userId], { kind: "enrolment.confirmed", title: "You're enrolled in Data Analytics", body: "Starts Monday." });
    const { providers, sent } = recordingProviders();
    const r = await runDeliveryJob(t.system, { providers });
    expect(r).toMatchObject({ notifications: 1, deliveries: 1, sent: 1 });
    expect(sent.map((s) => [s.channel, s.to])).toEqual([["email", t.riya.email.toLowerCase()]]);
    const rows = await deliveriesOf(t.uni.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "sent", channel: "email", attempts: 1, source: "notification", providerMessageId: "msg-1" });
  });

  it("respects the admin's channels and each person's choices within them", async () => {
    const t = await setupUni({ timezone: zoneWithLocalHour(12) });
    // Timetable changes: email on, SMS optional, WhatsApp off.
    await saveKindSettings(t.admin, "timetable.changed", {
      channels: { email: "on", sms: "optional", whatsapp: "off" },
      emailSubject: "{{title}}",
      emailBody: "Hi {{firstName}},\n\n{{body}}",
      smsText: "{{university}}: {{title}}",
    });
    // Riya turns email off and SMS on; Kabir keeps the defaults.
    await savePreferences(t.riya, t.riya.userId, [
      { kind: "timetable.changed", channel: "email", enabled: false },
      { kind: "timetable.changed", channel: "sms", enabled: true },
    ]);
    await notifyUsers(t.uni.id, [t.riya.userId, t.kabir.userId], { kind: "timetable.changed", title: "Class on Mon is cancelled" });
    const { providers, sent } = recordingProviders();
    await runDeliveryJob(t.system, { providers });
    const got = sent.map((s) => `${s.channel}:${s.to}`).sort();
    expect(got).toEqual([`email:${t.kabir.email.toLowerCase()}`, "sms:+919812345678"].sort());
  });

  it("an admin turning a channel off overrides anyone's earlier choice", async () => {
    const t = await setupUni({ timezone: zoneWithLocalHour(12) });
    await savePreferences(t.riya, t.riya.userId, [{ kind: "enrolment.confirmed", channel: "sms", enabled: true }]);
    await saveKindSettings(t.admin, "enrolment.confirmed", {
      channels: { email: "off", sms: "off", whatsapp: "off" },
      emailSubject: "{{title}}",
      emailBody: "{{body}}",
      smsText: "{{title}}",
    });
    await notifyUsers(t.uni.id, [t.riya.userId], { kind: "enrolment.confirmed", title: "Enrolled" });
    const { providers, sent } = recordingProviders();
    const r = await runDeliveryJob(t.system, { providers });
    expect(r.notifications).toBe(1);
    expect(sent).toEqual([]);
    expect(await deliveriesOf(t.uni.id)).toEqual([]);
  });

  it("other modules' kinds get the generic email; a person without a number is recorded as skipped", async () => {
    const t = await setupUni({ timezone: zoneWithLocalHour(12) });
    await saveKindSettings(t.admin, "assignment.graded", {
      channels: { email: "on", sms: "on", whatsapp: "off" },
      emailSubject: "{{title}}",
      emailBody: "Hi {{firstName}},\n\n{{body}}",
      smsText: "{{university}}: {{title}}",
    });
    await notifyUsers(t.uni.id, [t.hod.userId], { kind: "assignment.graded", title: "SQL basics: 18/20", body: "Well structured queries." });
    const { providers, sent } = recordingProviders();
    await runDeliveryJob(t.system, { providers });
    expect(sent.map((s) => s.channel)).toEqual(["email"]);
    expect(sent[0].email!.subject).toBe("SQL basics: 18/20");
    expect(sent[0].email!.text).toContain("Hi Hod,");
    expect(sent[0].email!.text).toContain("Well structured queries.");
    const sms = (await deliveriesOf(t.uni.id)).find((d) => d.channel === "sms")!;
    expect(sms).toMatchObject({ status: "skipped", lastError: "No valid mobile number on their profile." });
  });

  it("notifications from before delivery started, or older than a day, are never sent", async () => {
    const t = await setupUni({ timezone: zoneWithLocalHour(12) });
    await notifyUsers(t.uni.id, [t.riya.userId], { kind: "enrolment.confirmed", title: "Old news" });
    const { providers, sent } = recordingProviders();
    // A day and a half later, the notification is out of the window.
    await runDeliveryJob(t.system, { providers, now: later(new Date(), 36 * 3_600_000) });
    expect(sent).toEqual([]);
  });
});

describe("notifications-delivery: quiet hours", () => {
  it("holds SMS and WhatsApp between 9 pm and 8 am, sends email now, then sends texts at 8 am", async () => {
    const tz = zoneWithLocalHour(23);
    const t = await setupUni({ timezone: tz });
    await saveKindSettings(t.admin, "timetable.changed", {
      channels: { email: "on", sms: "on", whatsapp: "optional" },
      emailSubject: "{{title}}",
      emailBody: "{{body}}",
      smsText: "{{university}}: {{title}}",
    });
    await savePreferences(t.kabir, t.kabir.userId, [{ kind: "timetable.changed", channel: "whatsapp", enabled: true }]);
    await notifyUsers(t.uni.id, [t.kabir.userId], { kind: "timetable.changed", title: "Class moved to 10 am" });
    const { providers, sent } = recordingProviders();
    const now = new Date();
    await runDeliveryJob(t.system, { providers, now });
    expect(sent.map((s) => s.channel)).toEqual(["email"]);

    const held = (await deliveriesOf(t.uni.id)).filter((d) => d.channel !== "email");
    expect(held.map((d) => d.status).sort()).toEqual(["queued", "queued"]);
    // 8 am local is 9 hours after 11 pm, give or take the minutes past the hour.
    const wait = held[0].nextAttemptAt!.getTime() - now.getTime();
    expect(wait).toBeGreaterThan(8 * 3_600_000);
    expect(wait).toBeLessThanOrEqual(9 * 3_600_000);
    expect(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(held[0].nextAttemptAt!)).toBe("08:00");

    // Still night an hour later: nothing.
    await runDeliveryJob(t.system, { providers, now: later(now, minutes(60)) });
    expect(sent).toHaveLength(1);
    // Morning: both texts go.
    await runDeliveryJob(t.system, { providers, now: held[0].nextAttemptAt! });
    expect(sent.map((s) => s.channel).sort()).toEqual(["email", "sms", "whatsapp"]);
  });

  it("lets security messages through at night", async () => {
    const t = await setupUni({ timezone: zoneWithLocalHour(2) });
    await notifyUsers(t.uni.id, [t.riya.userId], { kind: "security.otp", title: "Your sign-in code", body: "Your code is 482913." });
    const { providers, sent } = recordingProviders();
    await runDeliveryJob(t.system, { providers });
    expect(sent.map((s) => s.channel).sort()).toEqual(["email", "sms"]);
    const email = sent.find((s) => s.channel === "email")!.email!;
    expect(email.html).not.toMatch(/unsubscribe/i);
    expect(email.headers ?? {}).not.toHaveProperty("List-Unsubscribe");
  });

  it("a text that comes due during quiet hours (a retry) waits for the morning too", async () => {
    const t = await setupUni({ timezone: zoneWithLocalHour(20) });
    await savePreferences(t.kabir, t.kabir.userId, [{ kind: "enrolment.confirmed", channel: "sms", enabled: true }]);
    await notifyUsers(t.uni.id, [t.kabir.userId], { kind: "enrolment.confirmed", title: "Enrolled" });
    let fail = true;
    const { providers, sent } = recordingProviders({ fail: (s) => (s.channel === "sms" && fail ? retryable() : null) });
    const now = new Date();
    await runDeliveryJob(t.system, { providers, now });
    const [sms] = (await deliveriesOf(t.uni.id)).filter((d) => d.channel === "sms");
    expect(sms).toMatchObject({ status: "queued", attempts: 1 });
    fail = false;
    // Two hours later it's after 9 pm: the retry is held until 8 am.
    const night = later(now, minutes(120));
    const r = await runDeliveryJob(t.system, { providers, now: night });
    expect(r.deferred).toBe(1);
    expect(sent.filter((s) => s.channel === "sms")).toHaveLength(0);
    const [held] = (await deliveriesOf(t.uni.id)).filter((d) => d.channel === "sms");
    expect(held.nextAttemptAt!.getTime()).toBeGreaterThan(later(night, minutes(9 * 60)).getTime());
  });
});

describe("notifications-delivery: never twice", () => {
  it("two job runs that overlap send every notification on every channel exactly once", async () => {
    const t = await setupUni({ timezone: zoneWithLocalHour(12) });
    await saveKindSettings(t.admin, "timetable.changed", {
      channels: { email: "on", sms: "on", whatsapp: "off" },
      emailSubject: "{{title}}",
      emailBody: "{{body}}",
      smsText: "{{title}}",
    });
    for (let i = 0; i < 12; i++) {
      await notifyUsers(t.uni.id, [t.riya.userId, t.kabir.userId], { kind: "timetable.changed", title: `Change ${i}` });
    }
    const { providers, sent } = recordingProviders({ delayMs: 5 });
    await Promise.all([
      runDeliveryJob(t.system, { providers, concurrency: 3 }),
      runDeliveryJob(t.system, { providers, concurrency: 3 }),
      runDeliveryJob(t.system, { providers, concurrency: 3 }),
    ]);
    // Anything one run planned after another had started sending goes out on the next run.
    await runDeliveryJob(t.system, { providers });
    const keys = sent.map((s) => `${s.channel}|${s.to}|${s.email?.subject ?? s.text?.text}`);
    expect(keys).toHaveLength(48); // 12 changes × 2 people × 2 channels
    expect(new Set(keys).size).toBe(48);
    const rows = await deliveriesOf(t.uni.id);
    expect(rows).toHaveLength(48);
    expect(rows.every((r) => r.status === "sent" && r.attempts === 1)).toBe(true);
  });

  it("planning the same notifications twice adds nothing", async () => {
    const t = await setupUni({ timezone: zoneWithLocalHour(12) });
    await notifyUsers(t.uni.id, [t.riya.userId], { kind: "enrolment.confirmed", title: "Enrolled" });
    const [a, b] = await Promise.all([planDeliveries(t.system), planDeliveries(t.system)]);
    expect(a.notifications + b.notifications).toBe(1);
    expect(await planDeliveries(t.system)).toEqual({ notifications: 0, deliveries: 0, skipped: 0 });
    expect(await deliveriesOf(t.uni.id)).toHaveLength(1);
  });

  it("the database refuses a second delivery of a notification on the same channel", async () => {
    const t = await setupUni({ timezone: zoneWithLocalHour(12) });
    await notifyUsers(t.uni.id, [t.riya.userId], { kind: "enrolment.confirmed", title: "Enrolled" });
    await planDeliveries(t.system);
    const [row] = await deliveriesOf(t.uni.id);
    const { id: _id, ...copy } = row;
    void _id;
    await expect(systemDb().insert(notifDeliveries).values(copy)).rejects.toThrow();
  });

  it("an interrupted send is never repeated unless the provider drops repeats itself", async () => {
    const t = await setupUni({ timezone: zoneWithLocalHour(12) });
    await notifyUsers(t.uni.id, [t.riya.userId, t.kabir.userId], { kind: "enrolment.confirmed", title: "Enrolled" });
    await planDeliveries(t.system);
    const rows = await deliveriesOf(t.uni.id);
    const past = new Date(Date.now() - 1000);
    // Two sends that a crashed run left "sending": one through the console, one through Resend.
    await systemDb().update(notifDeliveries).set({ status: "sending", attempts: 1, lockedUntil: past, provider: "console" }).where(eq(notifDeliveries.id, rows[0].id));
    await systemDb().update(notifDeliveries).set({ status: "sending", attempts: 1, lockedUntil: past, provider: "resend" }).where(eq(notifDeliveries.id, rows[1].id));
    const { providers, sent } = recordingProviders();
    const r = await sendDueDeliveries(t.system, { providers });
    expect(r.recovered).toBe(2);
    const after = new Map((await deliveriesOf(t.uni.id)).map((d) => [d.id, d]));
    expect(after.get(rows[0].id)).toMatchObject({ status: "failed", interrupted: true });
    expect(after.get(rows[1].id)).toMatchObject({ status: "sent", interrupted: true, attempts: 2 });
    // Resend gets the same idempotency key as the interrupted attempt, so it can't deliver twice.
    expect(sent).toHaveLength(1);
    expect(sent[0].email!.idempotencyKey).toBe(`zinny-notif-${rows[1].id}-0`);
  });

  it("a claim still within its time is left alone by other runs", async () => {
    const t = await setupUni({ timezone: zoneWithLocalHour(12) });
    await notifyUsers(t.uni.id, [t.riya.userId], { kind: "enrolment.confirmed", title: "Enrolled" });
    await planDeliveries(t.system);
    const [row] = await deliveriesOf(t.uni.id);
    await systemDb()
      .update(notifDeliveries)
      .set({ status: "sending", attempts: 1, lockedUntil: new Date(Date.now() + CLAIM_MS), provider: "resend" })
      .where(eq(notifDeliveries.id, row.id));
    const { providers, sent } = recordingProviders();
    expect(await sendDueDeliveries(t.system, { providers })).toMatchObject({ sent: 0, recovered: 0 });
    expect(sent).toEqual([]);
  });
});

describe("notifications-delivery: retries", () => {
  it("retries with growing waits, then marks the delivery failed after the last attempt", async () => {
    const t = await setupUni({ timezone: zoneWithLocalHour(12) });
    await notifyUsers(t.uni.id, [t.riya.userId], { kind: "enrolment.confirmed", title: "Enrolled" });
    const { providers, attempts } = recordingProviders({ fail: () => retryable() });
    let now = new Date();
    await quiet(() => runDeliveryJob(t.system, { providers, now }));
    const waits: number[] = [];
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      const [row] = await deliveriesOf(t.uni.id);
      expect(row).toMatchObject({ status: "queued", attempts: i, lastError: "Provider is down (HTTP 503)" });
      waits.push(row.nextAttemptAt!.getTime() - now.getTime());
      // Not yet due: nothing happens.
      await quiet(() => runDeliveryJob(t.system, { providers, now: later(now, waits[i - 1] - 1000) }));
      expect(attempts).toHaveLength(i);
      now = row.nextAttemptAt!;
      await quiet(() => runDeliveryJob(t.system, { providers, now }));
    }
    expect(waits).toEqual([1, 2, 3, 4].map(retryDelayMs));
    expect(waits).toEqual([minutes(1), minutes(5), minutes(30), minutes(120)]);
    const [row] = await deliveriesOf(t.uni.id);
    expect(row).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS, nextAttemptAt: null });
    // And then it stops.
    await quiet(() => runDeliveryJob(t.system, { providers, now: later(now, 86_400_000) }));
    expect(attempts).toHaveLength(MAX_ATTEMPTS);
  });

  it("a refusal that can't succeed later (a bad address) fails at once", async () => {
    const t = await setupUni({ timezone: zoneWithLocalHour(12) });
    await notifyUsers(t.uni.id, [t.riya.userId], { kind: "enrolment.confirmed", title: "Enrolled" });
    const { providers, attempts } = recordingProviders({ fail: () => permanent() });
    await quiet(() => runDeliveryJob(t.system, { providers }));
    const [row] = await deliveriesOf(t.uni.id);
    expect(row).toMatchObject({ status: "failed", attempts: 1, lastError: "Invalid recipient (HTTP 422)" });
    expect(attempts).toHaveLength(1);
  });

  it("a retry after a known failure gets a fresh idempotency key; the first try's key is never reused", async () => {
    const t = await setupUni({ timezone: zoneWithLocalHour(12) });
    await notifyUsers(t.uni.id, [t.riya.userId], { kind: "enrolment.confirmed", title: "Enrolled" });
    let n = 0;
    const { providers, attempts } = recordingProviders({ fail: () => (n++ === 0 ? retryable() : null) });
    const now = new Date();
    await quiet(() => runDeliveryJob(t.system, { providers, now }));
    await runDeliveryJob(t.system, { providers, now: later(now, minutes(2)) });
    const [row] = await deliveriesOf(t.uni.id);
    expect(row).toMatchObject({ status: "sent", attempts: 2, failures: 1 });
    expect(attempts.map((a) => a.email!.idempotencyKey)).toEqual([`zinny-notif-${row.id}-0`, `zinny-notif-${row.id}-1`]);
  });

  it("one person's failure doesn't hold up anyone else", async () => {
    const t = await setupUni({ timezone: zoneWithLocalHour(12) });
    await notifyUsers(t.uni.id, [t.riya.userId, t.kabir.userId], { kind: "enrolment.confirmed", title: "Enrolled" });
    const { providers, sent } = recordingProviders({ fail: (s) => (s.to === t.riya.email.toLowerCase() ? permanent() : null) });
    await quiet(() => runDeliveryJob(t.system, { providers }));
    expect(sent.map((s) => s.to)).toEqual([t.kabir.email.toLowerCase()]);
    const rows = await systemDb()
      .select()
      .from(notifDeliveries)
      .where(and(eq(notifDeliveries.universityId, t.uni.id), eq(notifDeliveries.status, "failed")));
    expect(rows).toHaveLength(1);
  });
});
