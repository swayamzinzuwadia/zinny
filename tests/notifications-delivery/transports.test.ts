/**
 * The transports every module's sendEmail()/sendSms() go through, and the Resend and MSG91
 * clients (against a fake fetch: no network).
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { users } from "@/db/schema";
import notificationsDelivery from "@/modules/notifications-delivery";
import { sendDirectEmail, sendDirectSms } from "@/modules/notifications-delivery/delivery";
import {
  activeProviders,
  fromHeader,
  msg91SmsProvider,
  msg91WhatsappProvider,
  ProviderError,
  providerStatus,
  resendProvider,
  setTestProviders,
} from "@/modules/notifications-delivery/providers";
import { saveKindSettings, savePreferences } from "@/modules/notifications-delivery/service";
import { mailTransport, smsTransport } from "@/server/registry";
import { sendEmail, sendSms } from "@/server/core";
import { deliveriesOf, quiet, recordingProviders, retryable, setupUni, zoneWithLocalHour } from "./helpers";

const ENV_KEYS = ["RESEND_API_KEY", "MAIL_FROM", "MSG91_AUTH_KEY", "MSG91_SMS_TEMPLATES", "MSG91_SENDER_ID", "MSG91_WHATSAPP_NUMBER", "APP_URL"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  setTestProviders(null);
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
afterAll(closeDb);

describe("notifications-delivery: registered transports", () => {
  it("registers the mail and SMS transports that core's sendEmail and sendSms use", () => {
    expect(mailTransport()).toBe(notificationsDelivery.mailTransport);
    expect(smsTransport()).toBe(notificationsDelivery.smsTransport);
    expect(mailTransport()!.name).toBe("console");
    process.env.RESEND_API_KEY = "re_test";
    process.env.MSG91_AUTH_KEY = "msg_test";
    expect(mailTransport()!.name).toBe("resend");
    expect(smsTransport()!.name).toBe("msg91");
    expect(notificationsDelivery.jobs?.map((j) => [j.id, j.every])).toEqual([
      ["notifications-delivery.deliver", "minute"],
      ["notifications-delivery.cleanup", "day"],
    ]);
  });

  it("without keys, core's sendEmail and sendSms still print to the console", async () => {
    const logs: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => void logs.push(a.join(" "));
    try {
      await sendEmail({ to: "a@b.test", subject: "Hello", html: "<p>Hi</p>", text: "Hi" });
      await sendSms({ to: "+919800000001", text: "Code 123456" });
    } finally {
      console.log = log;
    }
    expect(logs.join("\n")).toMatch(/\[mail\] to a@b.test: Hello/);
    expect(logs.join("\n")).toMatch(/\[sms\] to \+919800000001: Code 123456/);
    expect(activeProviders().email.name).toBe("console");
  });
});

describe("notifications-delivery: direct sends from other modules", () => {
  it("brands and logs an email about a university, with an unsubscribe link for its kind", async () => {
    const t = await setupUni({ name: "Alpha Institute" });
    const { providers, sent } = recordingProviders();
    setTestProviders(providers);
    await sendEmail({ to: t.riya.email, subject: "Your receipt", html: "<p>Paid ₹4,720</p>", text: "Paid ₹4,720", kind: "payments.receipt", universityId: t.uni.id });
    expect(sent).toHaveLength(1);
    const m = sent[0].email!;
    expect(m).toMatchObject({ to: t.riya.email.toLowerCase(), subject: "Your receipt", kind: "payments.receipt", fromName: "Alpha Institute" });
    expect(m.html).toContain("<p>Paid ₹4,720</p>");
    expect(m.html).toContain("Alpha Institute");
    expect(m.html).toContain("Unsubscribe from payments receipt emails");
    expect(m.headers?.["List-Unsubscribe"]).toMatch(/unsubscribe\?t=/);
    const [row] = await deliveriesOf(t.uni.id);
    expect(row).toMatchObject({ source: "direct", status: "sent", userId: t.riya.userId, kind: "payments.receipt", security: false });
    expect(row.payload.html).toContain("Paid ₹4,720");
  });

  it("sends security emails with no unsubscribe link and never stores their content", async () => {
    const t = await setupUni();
    const { providers, sent } = recordingProviders();
    setTestProviders(providers);
    await savePreferences(t.riya, t.riya.userId, [{ kind: "enrolment.confirmed", channel: "email", enabled: false }]);
    await sendEmail({
      to: t.riya.email,
      subject: "Reset your password",
      html: '<p><a href="https://app.test/reset/SECRET-TOKEN">Set a new password</a></p>',
      text: "https://app.test/reset/SECRET-TOKEN",
      kind: "security.reset",
      universityId: t.uni.id,
    });
    expect(sent[0].email!.html).toContain("SECRET-TOKEN");
    expect(sent[0].email!.html).not.toMatch(/unsubscribe/i);
    const [row] = await deliveriesOf(t.uni.id);
    expect(row).toMatchObject({ status: "sent", security: true });
    expect(JSON.stringify(row.payload)).not.toContain("SECRET-TOKEN");
    expect(row.payload).toMatchObject({ redacted: true });
  });

  it("a failed security message throws so the sender can tell the person; it is never retried", async () => {
    const t = await setupUni();
    setTestProviders(recordingProviders({ fail: () => retryable() }).providers);
    await expect(quiet(() => sendSms({ to: "9812345678", text: "Your code is 482913", kind: "security.otp", universityId: t.uni.id }))).rejects.toThrow(/couldn't be sent/);
    const [row] = await deliveriesOf(t.uni.id);
    expect(row).toMatchObject({ status: "failed", security: true, attempts: 1 });
    expect(JSON.stringify(row.payload)).not.toContain("482913");
  });

  it("an ordinary direct message that fails doesn't throw: the job retries it", async () => {
    const t = await setupUni();
    let fail = true;
    const { providers, sent } = recordingProviders({ fail: () => (fail ? retryable() : null) });
    setTestProviders(providers);
    await quiet(() => sendEmail({ to: t.kabir.email, subject: "Grades are out", html: "<p>Hi</p>", text: "Hi", kind: "assignment.graded", universityId: t.uni.id }));
    const [row] = await deliveriesOf(t.uni.id);
    expect(row).toMatchObject({ status: "queued", attempts: 1 });
    fail = false;
    const { runDeliveryJob } = await import("@/modules/notifications-delivery/delivery");
    await runDeliveryJob(t.system, { providers, now: new Date(Date.now() + 120_000) });
    expect(sent).toHaveLength(1);
    expect((await deliveriesOf(t.uni.id))[0]).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("respects a person's unsubscribe and the admin's settings for direct messages of a configured kind", async () => {
    const t = await setupUni();
    const { providers, sent } = recordingProviders();
    await savePreferences(t.riya, t.riya.userId, [{ kind: "enrolment.confirmed", channel: "email", enabled: false }]);
    await saveKindSettings(t.admin, "assignment.graded", { channels: { email: "off" }, emailSubject: "{{title}}", emailBody: "{{body}}", smsText: "{{title}}" });
    await sendDirectEmail({ to: t.riya.email, subject: "Enrolled", html: "<p>x</p>", text: "x", kind: "enrolment.confirmed", universityId: t.uni.id }, { providers });
    await sendDirectEmail({ to: t.kabir.email, subject: "Graded", html: "<p>x</p>", text: "x", kind: "assignment.graded", universityId: t.uni.id }, { providers });
    // A kind nobody configured goes out: the module chose to send it.
    await sendDirectEmail({ to: t.kabir.email, subject: "Badge", html: "<p>x</p>", text: "x", kind: "gamification.badge", universityId: t.uni.id }, { providers });
    expect(sent.map((s) => s.email!.subject)).toEqual(["Badge"]);
    const skipped = (await deliveriesOf(t.uni.id)).filter((d) => d.status === "skipped").map((d) => d.lastError).sort();
    expect(skipped).toEqual(["They unsubscribed from these emails.", "Turned off in the institute's notification settings."]);
  });

  it("holds a non-security SMS for the morning and sends security codes at night", async () => {
    const t = await setupUni({ timezone: zoneWithLocalHour(1) });
    const { providers, sent } = recordingProviders();
    await sendDirectSms({ to: "+91 98123 45678", text: "Class moved to 10 am", kind: "timetable.changed", universityId: t.uni.id }, { providers });
    await sendDirectSms({ to: "+91 98123 45678", text: "Your code is 482913", kind: "security.otp", universityId: t.uni.id }, { providers });
    expect(sent.map((s) => s.text!.kind)).toEqual(["security.otp"]);
    expect(sent[0].text!.vars).toMatchObject({ code: "482913" });
    const rows = await deliveriesOf(t.uni.id);
    const held = rows.find((r) => r.kind === "timetable.changed")!;
    expect(held).toMatchObject({ status: "queued", userId: t.riya.userId });
    expect(held.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 6 * 3_600_000);
  });

  it("refuses bad addresses clearly and sends Zinny team messages (no university) without branding", async () => {
    const t = await setupUni();
    const { providers, sent } = recordingProviders();
    await expect(sendDirectEmail({ to: [], subject: "x", html: "x", text: "x", universityId: t.uni.id }, { providers })).rejects.toThrow(/no recipient/);
    await sendDirectEmail({ to: ["not-an-email", t.kabir.email], subject: "x", html: "x", text: "x", universityId: t.uni.id }, { providers });
    expect((await deliveriesOf(t.uni.id)).map((d) => d.status).sort()).toEqual(["failed", "sent"]);
    await expect(sendDirectSms({ to: "123", text: "Code 1", kind: "security.otp", universityId: t.uni.id }, { providers })).rejects.toThrow(/isn't a valid mobile number/);
    await sendDirectEmail({ to: "zara@zinny.test", subject: "Welcome to the team", html: "<p>Hi</p>", text: "Hi", kind: "identity.invite" }, { providers });
    expect(sent.at(-1)!.email).toMatchObject({ to: "zara@zinny.test", subject: "Welcome to the team", html: "<p>Hi</p>" });
  });

  it("matches a text to its person by mobile number, in any format", async () => {
    const t = await setupUni({ timezone: zoneWithLocalHour(12) });
    await systemDb().update(users).set({ phone: "098765 43210" }).where(eq(users.id, t.hod.userId));
    const { providers } = recordingProviders();
    await sendDirectSms({ to: "9812345678", text: "Keep your streak going", kind: "gamification.streak", universityId: t.uni.id }, { providers });
    const [row] = await deliveriesOf(t.uni.id);
    expect(row.userId).toBe(t.riya.userId);
  });
});

describe("notifications-delivery: provider clients", () => {
  type Call = { url: string; init: RequestInit & { headers: Record<string, string> } };
  function fakeFetch(responses: { status: number; body: unknown }[]) {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: Call["init"]) => {
        calls.push({ url, init });
        const r = responses[Math.min(calls.length - 1, responses.length - 1)];
        return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status });
      }),
    );
    return calls;
  }

  it("Resend: posts the email with the idempotency key, sender name, reply-to and unsubscribe headers", async () => {
    process.env.RESEND_API_KEY = "re_123";
    process.env.MAIL_FROM = "Zinny <notifications@mail.zinny.in>";
    const calls = fakeFetch([{ status: 200, body: { id: "em_1" } }]);
    const r = await resendProvider()!.send({
      to: "riya@demo.edu",
      subject: "Hi",
      html: "<p>Hi</p>",
      text: "Hi",
      replyTo: "office@demo.edu",
      headers: { "List-Unsubscribe": "<https://x.test/u>" },
      kind: "enrolment.confirmed",
      fromName: "Demo University",
      idempotencyKey: "zinny-notif-abc-0",
    });
    expect(r).toEqual({ id: "em_1" });
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].init.headers).toMatchObject({ Authorization: "Bearer re_123", "Idempotency-Key": "zinny-notif-abc-0" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      from: '"Demo University via Zinny" <notifications@mail.zinny.in>',
      to: ["riya@demo.edu"],
      subject: "Hi",
      html: "<p>Hi</p>",
      text: "Hi",
      reply_to: "office@demo.edu",
      headers: { "List-Unsubscribe": "<https://x.test/u>" },
      tags: [{ name: "kind", value: "enrolment_confirmed" }],
    });
  });

  it("Resend: rate limits and server errors can be retried; validation errors can't", async () => {
    process.env.RESEND_API_KEY = "re_123";
    const send = () => resendProvider()!.send({ to: "a@b.test", subject: "s", html: "h", text: "t", kind: "k", idempotencyKey: "k" });
    fakeFetch([{ status: 429, body: { name: "rate_limit_exceeded", message: "Too many requests" } }]);
    await expect(send()).rejects.toMatchObject({ retryable: true, status: 429 });
    fakeFetch([{ status: 500, body: "oops" }]);
    await expect(send()).rejects.toMatchObject({ retryable: true });
    fakeFetch([{ status: 422, body: { name: "validation_error", message: "Invalid `to` field." } }]);
    await expect(send()).rejects.toMatchObject({ retryable: false, message: expect.stringContaining("Invalid `to` field.") });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    await expect(send()).rejects.toMatchObject({ retryable: true, message: expect.stringContaining("Couldn't reach the provider") });
  });

  it("MSG91 SMS: uses the kind's DLT template through the Flow API, with the variables", async () => {
    process.env.MSG91_AUTH_KEY = "auth_1";
    process.env.MSG91_SENDER_ID = "ZINNYE";
    process.env.MSG91_SMS_TEMPLATES = JSON.stringify({ "security.otp": "tpl_otp" });
    const calls = fakeFetch([{ status: 200, body: { type: "success", message: "req_1" } }]);
    const sms = msg91SmsProvider()!;
    expect(await sms.send({ to: "+919812345678", text: "Your code is 482913", kind: "security.otp", vars: { code: "482913", text: "Your code is 482913" } })).toEqual({ id: "req_1" });
    expect(calls[0].url).toBe("https://control.msg91.com/api/v5/flow");
    expect(calls[0].init.headers).toMatchObject({ authkey: "auth_1" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      template_id: "tpl_otp",
      short_url: "0",
      sender: "ZINNYE",
      recipients: [{ mobiles: "919812345678", code: "482913", text: "Your code is 482913" }],
    });
    // A university's own template id for the kind wins.
    await sms.send({ to: "+919812345678", text: "x", kind: "security.otp", vars: {}, templateId: "tpl_uni" });
    expect(JSON.parse(String(calls[1].init.body)).template_id).toBe("tpl_uni");
  });

  it("MSG91 SMS: refuses to send without a DLT template, and reads errors in a 200 answer", async () => {
    process.env.MSG91_AUTH_KEY = "auth_1";
    const sms = msg91SmsProvider()!;
    await expect(sms.send({ to: "+919812345678", text: "x", kind: "timetable.changed", vars: {} })).rejects.toMatchObject({ retryable: false, message: expect.stringContaining("DLT") });
    fakeFetch([{ status: 200, body: { type: "error", message: "Invalid template id" } }]);
    await expect(sms.send({ to: "+919812345678", text: "x", kind: "k", vars: {}, templateId: "t" })).rejects.toMatchObject({ retryable: false });
    fakeFetch([{ status: 200, body: { type: "error", message: "Request throttled" } }]);
    await expect(sms.send({ to: "+919812345678", text: "x", kind: "k", vars: {}, templateId: "t" })).rejects.toMatchObject({ retryable: true });
  });

  it("MSG91 WhatsApp: sends the approved template with the four values, through the same interface", async () => {
    process.env.MSG91_AUTH_KEY = "auth_1";
    process.env.MSG91_WHATSAPP_NUMBER = "+91 98000 00000";
    const calls = fakeFetch([{ status: 200, body: { status: "success", hasError: false, data: "wa_1" } }]);
    const wa = msg91WhatsappProvider()!;
    await wa.send({
      to: "+919812345678",
      text: "x",
      kind: "timetable.changed",
      whatsappTemplate: "timetable_update",
      vars: { firstName: "Riya", title: "Class moved", university: "Demo University", link: "https://x.test/t" },
    });
    expect(calls[0].url).toBe("https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.integrated_number).toBe("919800000000");
    expect(body.payload.template.name).toBe("timetable_update");
    expect(body.payload.template.to_and_components[0]).toEqual({
      to: ["919812345678"],
      components: {
        body_1: { type: "text", value: "Riya" },
        body_2: { type: "text", value: "Class moved" },
        body_3: { type: "text", value: "Demo University" },
        body_4: { type: "text", value: "https://x.test/t" },
      },
    });
    await expect(wa.send({ to: "+919812345678", text: "x", kind: "k", vars: {} })).rejects.toBeInstanceOf(ProviderError);
  });

  it("shows which providers are live without revealing keys", () => {
    expect(providerStatus().email).toMatchObject({ provider: "Console", live: false });
    process.env.RESEND_API_KEY = "re_secret_value";
    process.env.MSG91_AUTH_KEY = "msg_secret_value";
    const s = providerStatus();
    expect(s.email.live && s.sms.live).toBe(true);
    expect(s.whatsapp).toMatchObject({ live: false, provider: "Not set up" });
    expect(JSON.stringify(s)).not.toMatch(/secret_value/);
    expect(fromHeader("Zinny <n@mail.zinny.in>", 'Bad "Name" <x>')).toBe('"Bad Name x via Zinny" <n@mail.zinny.in>');
    expect(fromHeader("n@mail.zinny.in", null)).toBe("n@mail.zinny.in");
  });
});
