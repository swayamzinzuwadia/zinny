/** Permissions (allow and deny), personal preferences, test sends, retries from the log, unsubscribe, and isolation. */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { users } from "@/db/schema";
import { runDeliveryJob } from "@/modules/notifications-delivery/delivery";
import { setTestProviders } from "@/modules/notifications-delivery/providers";
import {
  notifDeliveries,
  notifDispatches,
  notifKindSettings,
  notifPreferences,
  notifSuppressions,
  notifUniversitySettings,
} from "@/modules/notifications-delivery/schema";
import {
  getInstituteSettings,
  getKindEditor,
  getPreferences,
  listDeliveries,
  resetKindSettings,
  retryDelivery,
  saveDeliverySettings,
  saveKindSettings,
  savePreferences,
  sendTestMessage,
  unsubscribeLink,
} from "@/modules/notifications-delivery/service";
import { signToken } from "@/modules/notifications-delivery/config";
import { notifications } from "@/db/schema";
import { expectTenantIsolated } from "../helpers/isolation";
import { grant, makeUser } from "../fixtures";
import { deliveriesOf, notifyUsers, permanent, quiet, recordingProviders, setupUni, zoneWithLocalHour } from "./helpers";

afterEach(() => setTestProviders(null));
afterAll(closeDb);

const base = { emailSubject: "{{title}}", emailBody: "{{body}}", smsText: "{{title}}" };

describe("notifications-delivery: institute settings need settings.manage", () => {
  it("allows an Institute Admin to read and change settings", async () => {
    const t = await setupUni();
    const s = await getInstituteSettings(t.admin);
    expect(s.kinds.map((k) => k.kind)).toEqual(expect.arrayContaining(["enrolment.confirmed", "timetable.changed", "security.otp"]));
    await saveKindSettings(t.admin, "timetable.changed", { ...base, channels: { sms: "off" } });
    expect((await getKindEditor(t.admin, "timetable.changed")).channels.sms).toBe("off");
    await saveDeliverySettings(t.admin, { replyTo: "Office@Uni.edu" });
    expect((await getInstituteSettings(t.admin)).replyTo).toBe("office@uni.edu");
  });

  it("denies HODs, faculty, students and other universities' admins", async () => {
    const t = await setupUni();
    const other = await setupUni({ name: "Other U" });
    for (const actor of [t.hod, t.riya, other.admin]) {
      await expect(getInstituteSettings(actor.universityId === t.uni.id ? actor : { ...actor, universityId: t.uni.id })).rejects.toThrow(/access/);
      await expect(saveKindSettings(actor.universityId === t.uni.id ? actor : { ...actor, universityId: t.uni.id }, "timetable.changed", base)).rejects.toThrow(/access/);
    }
    await expect(listDeliveries(t.hod)).rejects.toThrow(/access/);
    await expect(sendTestMessage(t.riya, "enrolment.confirmed", "email")).rejects.toThrow(/access/);
    await expect(saveDeliverySettings(t.hod, { replyTo: "x@y.edu" })).rejects.toThrow(/access/);
    await expect(resetKindSettings(t.riya, "timetable.changed")).rejects.toThrow(/access/);
  });

  it("validates the reply-to address and resets a kind to its defaults", async () => {
    const t = await setupUni();
    await expect(saveDeliverySettings(t.admin, { replyTo: "not an email" })).rejects.toThrow(/reply-to address/);
    await saveKindSettings(t.admin, "enrolment.confirmed", { ...base, channels: { email: "off" }, emailSubject: "Custom {{title}}", smsTemplateId: "abc123" });
    let e = await getKindEditor(t.admin, "enrolment.confirmed");
    expect(e).toMatchObject({ customized: true, smsTemplateId: "abc123" });
    expect(e.channels.email).toBe("off");
    await resetKindSettings(t.admin, "enrolment.confirmed");
    e = await getKindEditor(t.admin, "enrolment.confirmed");
    expect(e.template.emailSubject).toBe("{{title}}");
    expect(e.channels).toEqual(e.defaults.channels);
    expect(e.customized).toBe(false);
    expect(e.smsTemplateId).toBe("abc123");
  });
});

describe("notifications-delivery: personal preferences (self.profile)", () => {
  it("a learner sees the kinds they receive and changes their own settings", async () => {
    const t = await setupUni();
    const prefs = await getPreferences(t.riya, t.riya.userId);
    const kinds = prefs.rows.map((r) => r.kind);
    expect(kinds).toContain("timetable.changed");
    expect(kinds).not.toContain("switch.requested"); // a HOD's kind
    expect(kinds.some((k) => k.startsWith("security."))).toBe(false);
    expect(prefs.phone).toBe("+91 98•••• 5678");
    const sms = prefs.rows.find((r) => r.kind === "enrolment.confirmed")!.channels.find((c) => c.channel === "sms")!;
    expect(sms).toMatchObject({ state: "optional", enabled: false, editable: true });

    await savePreferences(t.riya, t.riya.userId, [{ kind: "enrolment.confirmed", channel: "sms", enabled: true }]);
    const after = await getPreferences(t.riya, t.riya.userId);
    expect(after.rows.find((r) => r.kind === "enrolment.confirmed")!.channels.find((c) => c.channel === "sms")!.enabled).toBe(true);
  });

  it("staff see their own kinds in My notifications", async () => {
    const t = await setupUni();
    const kinds = (await getPreferences(t.hod, t.hod.userId)).rows.map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(["switch.requested", "batch.faculty_expiring"]));
    expect(kinds).not.toContain("timetable.changed");
  });

  it("can't read or change another person's preferences, even an admin's", async () => {
    const t = await setupUni();
    await expect(getPreferences(t.riya, t.kabir.userId)).rejects.toThrow(/access/);
    await expect(savePreferences(t.riya, t.kabir.userId, [{ kind: "enrolment.confirmed", channel: "email", enabled: false }])).rejects.toThrow(/access/);
    await expect(savePreferences(t.admin, t.riya.userId, [{ kind: "enrolment.confirmed", channel: "email", enabled: false }])).rejects.toThrow(/access/);
    // Someone from another university can't either.
    const other = await setupUni({ name: "Other U" });
    await expect(savePreferences({ ...other.riya, universityId: t.uni.id }, t.riya.userId, [{ kind: "enrolment.confirmed", channel: "email", enabled: false }])).rejects.toThrow(/access/);
    const rows = await systemDb().select().from(notifPreferences).where(eq(notifPreferences.userId, t.riya.userId));
    expect(rows).toEqual([]);
  });

  it("stays within what the admin allows, and security messages can't be turned off", async () => {
    const t = await setupUni();
    await saveKindSettings(t.admin, "timetable.changed", { ...base, channels: { email: "on", sms: "off", whatsapp: "off" } });
    await expect(savePreferences(t.riya, t.riya.userId, [{ kind: "timetable.changed", channel: "sms", enabled: true }])).rejects.toThrow(/turned off SMS/);
    await expect(savePreferences(t.riya, t.riya.userId, [{ kind: "security.otp", channel: "sms", enabled: false }])).rejects.toThrow(/always sent/);
    const row = (await getPreferences(t.riya, t.riya.userId)).rows.find((r) => r.kind === "timetable.changed")!;
    expect(row.channels.find((c) => c.channel === "sms")).toMatchObject({ editable: false, enabled: false });
  });

  it("a choice equal to the default follows later changes by the admin", async () => {
    const t = await setupUni();
    await savePreferences(t.riya, t.riya.userId, [{ kind: "enrolment.confirmed", channel: "email", enabled: false }]);
    expect(await systemDb().select().from(notifPreferences).where(eq(notifPreferences.userId, t.riya.userId))).toHaveLength(1);
    await savePreferences(t.riya, t.riya.userId, [{ kind: "enrolment.confirmed", channel: "email", enabled: true }]);
    expect(await systemDb().select().from(notifPreferences).where(eq(notifPreferences.userId, t.riya.userId))).toHaveLength(0);
  });
});

describe("notifications-delivery: test sends and the delivery log", () => {
  it("sends the saved template to the admin, marked as a test, ignoring quiet hours", async () => {
    const t = await setupUni({ timezone: zoneWithLocalHour(23) });
    await systemDb().update(users).set({ phone: "9800000001" }).where(eq(users.id, t.admin.userId));
    const { providers, sent } = recordingProviders();
    setTestProviders(providers);
    await saveKindSettings(t.admin, "timetable.changed", { ...base, emailSubject: "Update: {{title}}" });
    const r = await sendTestMessage(t.admin, "timetable.changed", "email");
    expect(r).toMatchObject({ status: "sent", to: t.admin.email.toLowerCase() });
    expect(sent[0].email!.subject).toMatch(/^\[Test\] Update: /);
    const sms = await sendTestMessage(t.admin, "timetable.changed", "sms");
    expect(sms).toMatchObject({ status: "sent", to: "+91 98•••• 0001" });
    expect(sent[1].text!.to).toBe("+919800000001");
    const log = await listDeliveries(t.admin);
    expect(log.rows.map((x) => x.source)).toEqual(["test", "test"]);
  });

  it("explains a test that can't be sent", async () => {
    const t = await setupUni();
    setTestProviders(recordingProviders({ fail: () => permanent("No WhatsApp template for \"timetable.changed\".") }).providers);
    await expect(sendTestMessage(t.admin, "timetable.changed", "sms")).rejects.toThrow(/no mobile number/);
    await systemDb().update(users).set({ phone: "9800000001" }).where(eq(users.id, t.admin.userId));
    const r = await quiet(() => sendTestMessage(t.admin, "timetable.changed", "whatsapp"));
    expect(r).toMatchObject({ status: "failed", error: 'No WhatsApp template for "timetable.changed".' });
  });

  it("an admin can send a failed delivery again; it isn't offered for security messages", async () => {
    const t = await setupUni({ timezone: zoneWithLocalHour(12) });
    await notifyUsers(t.uni.id, [t.riya.userId], { kind: "enrolment.confirmed", title: "Enrolled" });
    let fail = true;
    const { providers, sent } = recordingProviders({ fail: () => (fail ? permanent() : null) });
    await quiet(() => runDeliveryJob(t.system, { providers }));
    const [failed] = (await listDeliveries(t.admin, { status: "failed" })).rows;
    expect(failed).toMatchObject({ status: "failed", retryable: true, personName: "Riya Sharma" });
    await expect(retryDelivery(t.hod, failed.id)).rejects.toThrow(/access/);
    await retryDelivery(t.admin, failed.id);
    fail = false;
    await runDeliveryJob(t.system, { providers });
    expect(sent).toHaveLength(1);
    expect((await deliveriesOf(t.uni.id))[0]).toMatchObject({ status: "sent" });
    await expect(retryDelivery(t.admin, failed.id)).rejects.toThrow(/Only failed messages/);
  });
});

describe("notifications-delivery: unsubscribe links work without signing in, for one kind only", () => {
  it("unsubscribes from one kind, shows the state, and can be undone", async () => {
    const t = await setupUni({ timezone: zoneWithLocalHour(12) });
    const token = signToken({ u: t.uni.id, p: t.riya.userId, k: "enrolment.confirmed" });
    const view = await unsubscribeLink(token, t.uni.slug, "view");
    expect(view).toMatchObject({ kind: "enrolment.confirmed", label: "Enrolment confirmed", subscribed: true });
    expect(view!.recipient).toMatch(/^ri•+@test\.zinny$/);
    expect((await unsubscribeLink(token, t.uni.slug, "unsubscribe"))!.subscribed).toBe(false);

    await notifyUsers(t.uni.id, [t.riya.userId], { kind: "enrolment.confirmed", title: "Enrolled" });
    await notifyUsers(t.uni.id, [t.riya.userId], { kind: "timetable.changed", title: "Moved" });
    const { providers, sent } = recordingProviders();
    await runDeliveryJob(t.system, { providers });
    expect(sent.filter((s) => s.channel === "email").map((s) => s.email!.kind)).toEqual(["timetable.changed"]);
    // Her settings page shows it off; turning it back on works from the link too.
    expect((await getPreferences(t.riya, t.riya.userId)).rows.find((r) => r.kind === "enrolment.confirmed")!.channels[0].enabled).toBe(false);
    expect((await unsubscribeLink(token, t.uni.slug, "resubscribe"))!.subscribed).toBe(true);
  });

  it("refuses a link for another university's address, a wrong slug, or a security kind", async () => {
    const t = await setupUni();
    const other = await setupUni({ name: "Other U" });
    expect(await unsubscribeLink(signToken({ u: t.uni.id, p: t.riya.userId, k: "enrolment.confirmed" }), other.uni.slug, "unsubscribe")).toBeNull();
    // A person who isn't in the university named by the token.
    expect(await unsubscribeLink(signToken({ u: other.uni.id, p: t.riya.userId, k: "enrolment.confirmed" }), other.uni.slug, "unsubscribe")).toBeNull();
    expect(await unsubscribeLink(signToken({ u: t.uni.id, p: t.riya.userId, k: "security.otp" }), t.uni.slug, "unsubscribe")).toBeNull();
    expect(await unsubscribeLink("garbage", t.uni.slug, "view")).toBeNull();
    expect(await systemDb().select().from(notifSuppressions).where(eq(notifSuppressions.universityId, other.uni.id))).toEqual([]);
  });

  it("the unsubscribe route shows a page on GET (changing nothing) and applies on POST, including one-click", async () => {
    const { GET, POST } = await import("@/app/[uni]/learn/settings/notifications/unsubscribe/route");
    const t = await setupUni();
    const token = signToken({ u: t.uni.id, p: t.kabir.userId, k: "timetable.changed" });
    const url = `http://app.test/${t.uni.slug}/learn/settings/notifications/unsubscribe?t=${encodeURIComponent(token)}`;
    const params = Promise.resolve({ uni: t.uni.slug });
    const get = await GET(new Request(url), { params });
    expect(get.status).toBe(200);
    const page = await get.text();
    expect(page).toContain("Stop timetable changed emails?");
    expect(page).toContain(t.uni.name);
    expect(await systemDb().select().from(notifSuppressions).where(eq(notifSuppressions.universityId, t.uni.id))).toEqual([]);

    const oneClick = await POST(new Request(url, { method: "POST", body: new URLSearchParams({ "List-Unsubscribe": "One-Click" }) }), { params });
    expect(oneClick.status).toBe(200);
    expect(await oneClick.text()).toBe("Unsubscribed.");
    expect(await systemDb().select().from(notifSuppressions).where(eq(notifSuppressions.universityId, t.uni.id))).toHaveLength(1);

    const undo = await POST(new Request(url, { method: "POST", body: new URLSearchParams({ t: token, action: "resubscribe" }) }), { params });
    expect(await undo.text()).toContain("emails are back on");
    const bad = await GET(new Request(url.replace(/t=[^&]+/, "t=nope")), { params });
    expect(bad.status).toBe(404);
  });
});

describe("notifications-delivery: every table is isolated per university", () => {
  it("notif_university_settings", () => expectTenantIsolated(notifUniversitySettings, (uni) => ({ universityId: uni.id, replyTo: "a@b.edu" })));

  it("notif_kind_settings", () =>
    expectTenantIsolated(notifKindSettings, (uni) => ({ universityId: uni.id, kind: `test.${crypto.randomUUID().slice(0, 8)}`, email: "on" as const, sms: "off" as const, whatsapp: "off" as const })));

  it("notif_preferences", async () => {
    const u = await makeUser("Pref Person");
    return expectTenantIsolated(notifPreferences, (uni) => ({ universityId: uni.id, userId: u.id, kind: `test.${crypto.randomUUID().slice(0, 8)}`, channel: "email" as const, enabled: false }));
  });

  it("notif_suppressions", () =>
    expectTenantIsolated(notifSuppressions, (uni) => ({ universityId: uni.id, address: `${crypto.randomUUID().slice(0, 8)}@x.test`, kind: "enrolment.confirmed" })));

  it("notif_dispatches", async () => {
    const u = await makeUser("Dispatch Person");
    return expectTenantIsolated(notifDispatches, async (uni) => {
      const [n] = await systemDb().insert(notifications).values({ universityId: uni.id, userId: u.id, kind: "x", title: "x" }).returning();
      return { notificationId: n.id, universityId: uni.id };
    });
  });

  it("notif_deliveries", () =>
    expectTenantIsolated(notifDeliveries, (uni) => ({ universityId: uni.id, source: "direct" as const, kind: "message", channel: "email" as const, recipient: "a@b.test", status: "sent" as const })));

  it("notif_university_settings rows are invisible to other universities", async () => {
    const a = await setupUni();
    const b = await setupUni({ name: "Other U" });
    const { withTenant } = await import("@/server/core");
    const seen = await withTenant(b.system, (tx) => tx.select().from(notifUniversitySettings));
    expect(seen.map((r) => r.universityId)).toEqual([b.uni.id]);
    expect(seen.some((r) => r.universityId === a.uni.id)).toBe(false);
  });

  it("the delivery job of one university never touches another's notifications", async () => {
    const tz = zoneWithLocalHour(12);
    const a = await setupUni({ timezone: tz });
    const b = await setupUni({ name: "Other U", timezone: tz });
    await notifyUsers(b.uni.id, [b.riya.userId], { kind: "enrolment.confirmed", title: "Enrolled at B" });
    const { providers, sent } = recordingProviders();
    await runDeliveryJob(a.system, { providers });
    expect(sent).toEqual([]);
    expect(await deliveriesOf(b.uni.id)).toEqual([]);
    await runDeliveryJob(b.system, { providers });
    expect(sent).toHaveLength(1);
  });

  it("a person who belongs to two universities gets each university's messages with its own settings", async () => {
    const tz = zoneWithLocalHour(12);
    const a = await setupUni({ name: "Alpha", timezone: tz });
    const b = await setupUni({ name: "Beta", timezone: tz });
    await grant(a.riya.userId, "student", { universityId: b.uni.id });
    await saveKindSettings(b.admin, "enrolment.confirmed", { ...base, channels: { email: "off" } });
    await notifyUsers(a.uni.id, [a.riya.userId], { kind: "enrolment.confirmed", title: "Enrolled at Alpha" });
    await notifyUsers(b.uni.id, [a.riya.userId], { kind: "enrolment.confirmed", title: "Enrolled at Beta" });
    const { providers, sent } = recordingProviders();
    await runDeliveryJob(a.system, { providers });
    await runDeliveryJob(b.system, { providers });
    expect(sent.map((s) => s.email?.subject)).toEqual(["Enrolled at Alpha"]);
  });
});
