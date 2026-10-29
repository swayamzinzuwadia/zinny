/** Templates, branding, unsubscribe links and the helpers behind them. */
import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { verifyToken, signToken } from "@/modules/notifications-delivery/config";
import { runDeliveryJob } from "@/modules/notifications-delivery/delivery";
import { CORE_KINDS, isSecurityKind, kindDefinition } from "@/modules/notifications-delivery/kinds";
import { maskPhone, toE164 } from "@/modules/notifications-delivery/phone";
import { brandedHtml, decorateDirectEmail, escapeHtml, fill, unknownVariables } from "@/modules/notifications-delivery/render";
import { getKindEditor, saveKindSettings } from "@/modules/notifications-delivery/service";
import { isQuietHours, quietHoursEnd, zonedInstant } from "@/modules/notifications-delivery/time";
import { notifyUsers, recordingProviders, setupUni, zoneWithLocalHour } from "./helpers";

afterAll(closeDb);

describe("notifications-delivery: templates use the right university's branding", () => {
  it("each university's emails carry its own name, logo and colour, never the other's", async () => {
    const tz = zoneWithLocalHour(12);
    const a = await setupUni({ name: "Alpha Institute", timezone: tz, branding: { primaryColor: "#7A1F3D", logoUrl: "https://cdn.alpha.test/logo.png" } });
    const b = await setupUni({ name: "Beta College", timezone: tz, branding: { primaryColor: "#1F4E7A" } });
    await notifyUsers(a.uni.id, [a.riya.userId], { kind: "enrolment.confirmed", title: "You're enrolled in Data Analytics", body: "Starts Monday." });
    await notifyUsers(b.uni.id, [b.riya.userId], { kind: "enrolment.confirmed", title: "You're enrolled in Python Basics", body: "Starts Tuesday." });
    const { providers, sent } = recordingProviders();
    await runDeliveryJob(a.system, { providers });
    await runDeliveryJob(b.system, { providers });
    const [ea, eb] = [sent[0].email!, sent[1].email!];

    expect(ea.fromName).toBe("Alpha Institute");
    expect(ea.html).toContain("https://cdn.alpha.test/logo.png");
    expect(ea.html).toContain("#7A1F3D");
    expect(ea.html).toContain("Data Analytics");
    expect(ea.text).toContain("Alpha Institute");
    expect(ea.html).not.toContain("Beta College");
    expect(ea.html).not.toContain("#1F4E7A");

    expect(eb.fromName).toBe("Beta College");
    expect(eb.html).toContain("Beta College"); // no logo: the name is the header
    expect(eb.html).toContain("#1F4E7A");
    expect(eb.html).not.toContain("Alpha Institute");
    expect(eb.html).not.toContain("cdn.alpha.test");
    // Links point to the university's own space.
    expect(eb.html).toContain(`/${b.uni.slug}/learn/my`);
    expect(eb.html).not.toContain(`/${a.uni.slug}/`);
  });

  it("a university's own template text is used, with variables filled in; the other university keeps the default", async () => {
    const tz = zoneWithLocalHour(12);
    const a = await setupUni({ name: "Alpha Institute", timezone: tz });
    const b = await setupUni({ name: "Beta College", timezone: tz });
    await saveKindSettings(a.admin, "timetable.changed", {
      channels: { email: "on", sms: "on", whatsapp: "off" },
      emailSubject: "Timetable update from {{university}}: {{title}}",
      emailBody: "Dear {{name}},\n\n{{body}}\n\nOpen {{link}} for details.",
      smsText: "{{university}}: {{title}} ({{firstName}})",
    });
    for (const t of [a, b]) await notifyUsers(t.uni.id, [t.kabir.userId], { kind: "timetable.changed", title: "Class moved", body: "Now at 10 am." });
    const { providers, sent } = recordingProviders();
    await runDeliveryJob(a.system, { providers });
    await runDeliveryJob(b.system, { providers });
    const aEmail = sent.find((s) => s.channel === "email" && s.to === a.kabir.email.toLowerCase())!.email!;
    const aSms = sent.find((s) => s.channel === "sms" && s.text!.text.includes("Alpha"))!.text!;
    const bEmail = sent.find((s) => s.channel === "email" && s.to === b.kabir.email.toLowerCase())!.email!;
    expect(aEmail.subject).toBe("Timetable update from Alpha Institute: Class moved");
    expect(aEmail.text).toContain("Dear Kabir Mehta,");
    expect(aEmail.text).toMatch(new RegExp(`Open http://[^ ]+/${a.uni.slug}/learn/timetable for details`));
    expect(aSms.text).toBe("Alpha Institute: Class moved (Kabir)");
    expect(aSms.vars).toMatchObject({ firstName: "Kabir", title: "Class moved", university: "Alpha Institute" });
    expect(bEmail.subject).toBe("Class moved");
    expect(bEmail.text).toContain("Hi Kabir,");
    // Beta's default SMS for timetable changes is on.
    expect(sent.some((s) => s.channel === "sms" && s.text!.text.startsWith("Beta College: Class moved"))).toBe(true);
  });

  it("every core kind has defaults, a subject, a plain-text body and a link", async () => {
    const t = await setupUni();
    for (const def of CORE_KINDS) {
      const e = await getKindEditor(t.admin, def.kind);
      expect(e.preview.subject.length, def.kind).toBeGreaterThan(3);
      expect(e.preview.text, def.kind).toContain(t.uni.name);
      expect(e.preview.html, def.kind).toContain(escapeHtml(def.sample.body));
      expect(e.preview.sms.length, def.kind).toBeGreaterThan(5);
      expect(def.link("demo", { batchId: "00000000-0000-0000-0000-000000000000" }), def.kind).toMatch(/^\/demo\//);
    }
    // Every kind core's services send today is covered.
    for (const k of ["enrolment.confirmed", "timetable.changed", "switch.approved", "switch.rejected", "switch.requested", "payment.refund_due", "finance.refund_due", "batch.faculty_expiring"]) {
      expect(CORE_KINDS.map((c) => c.kind)).toContain(k);
    }
  });

  it("an unknown kind falls back to a generic template with the notification's title and body", () => {
    const def = kindDefinition("certificates.issued");
    expect(def.label).toBe("Certificates issued");
    expect(def.template).toEqual({ emailSubject: "{{title}}", emailBody: "Hi {{firstName}},\n\n{{body}}", smsText: "{{university}}: {{title}}" });
    expect(def.link("demo", { link: "/demo/learn/certificates/abc" })).toBe("/demo/learn/certificates/abc");
    expect(def.link("demo", { link: "https://evil.test/phish" })).toBeNull();
    expect(def.link("demo", { link: "/other/learn" })).toBeNull();
  });

  it("template text is escaped, so it can't inject markup", async () => {
    const t = await setupUni({ timezone: zoneWithLocalHour(12) });
    await notifyUsers(t.uni.id, [t.riya.userId], { kind: "enrolment.confirmed", title: "<script>alert(1)</script>", body: "<img src=x onerror=alert(1)>" });
    const { providers, sent } = recordingProviders();
    await runDeliveryJob(t.system, { providers });
    const html = sent[0].email!.html;
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });

  it("refuses templates with unknown variables, and limits length", async () => {
    const t = await setupUni();
    const base = { emailSubject: "{{title}}", emailBody: "{{body}}", smsText: "{{title}}" };
    await expect(saveKindSettings(t.admin, "enrolment.confirmed", { ...base, emailBody: "Hi {{fristName}}" })).rejects.toThrow(/\{\{fristName\}\}/);
    await expect(saveKindSettings(t.admin, "enrolment.confirmed", { ...base, smsText: "{{title" })).rejects.toThrow(/unbalanced/);
    await expect(saveKindSettings(t.admin, "enrolment.confirmed", { ...base, smsText: "x".repeat(481) })).rejects.toThrow(/too long/);
    await expect(saveKindSettings(t.admin, "enrolment.confirmed", { ...base, channels: { sms: "sometimes" } })).rejects.toThrow(/off, optional or on/);
    await expect(saveKindSettings(t.admin, "enrolment.confirmed", { ...base, smsTemplateId: "bad id!" })).rejects.toThrow(/template id/);
    await expect(saveKindSettings(t.admin, "Not A Kind!", base)).rejects.toThrow(/doesn't exist/);
    expect(unknownVariables("{{ name }} {{link}}")).toEqual([]);
    expect(fill("Hi {{ firstName }}, {{missing}}!", { firstName: "Riya" })).toBe("Hi Riya, !");
  });
});

describe("notifications-delivery: unsubscribe links", () => {
  it("every email has an unsubscribe link and one-click headers, except security messages", async () => {
    const t = await setupUni({ timezone: zoneWithLocalHour(12) });
    await notifyUsers(t.uni.id, [t.riya.userId], { kind: "enrolment.confirmed", title: "Enrolled" });
    await notifyUsers(t.uni.id, [t.riya.userId], { kind: "security.reset", title: "Reset your password", body: "Use this link: https://x.test/reset/abc" });
    const { providers, sent } = recordingProviders();
    await runDeliveryJob(t.system, { providers });
    const normal = sent.find((s) => s.email?.kind === "enrolment.confirmed")!.email!;
    const security = sent.find((s) => s.email?.kind === "security.reset")!.email!;
    const url = /href="([^"]+\/unsubscribe\?t=[^"]+)"/.exec(normal.html)?.[1];
    expect(url).toBeTruthy();
    expect(url).toContain(`/${t.uni.slug}/learn/settings/notifications/unsubscribe?t=`);
    expect(normal.text).toContain("Unsubscribe from enrolment confirmed emails:");
    expect(normal.headers).toMatchObject({ "List-Unsubscribe": `<${url!.replace(/&amp;/g, "&")}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    const claim = verifyToken(decodeURIComponent(new URL(url!.replace(/&amp;/g, "&")).searchParams.get("t")!));
    expect(claim).toEqual({ u: t.uni.id, p: t.riya.userId, k: "enrolment.confirmed" });

    expect(security.html).not.toMatch(/unsubscribe/i);
    expect(security.text).not.toMatch(/unsubscribe/i);
    expect(security.headers ?? {}).toEqual({});
    expect(security.text).toContain("can't be turned off");
  });

  it("tokens can't be forged or altered", () => {
    const token = signToken({ u: "7d1f3d2a-0000-4000-8000-000000000001", p: "7d1f3d2a-0000-4000-8000-000000000002", k: "enrolment.confirmed" });
    expect(verifyToken(token)).toMatchObject({ k: "enrolment.confirmed" });
    const [body, sig] = token.split(".");
    const other = Buffer.from(JSON.stringify({ u: "7d1f3d2a-0000-4000-8000-000000000001", p: "7d1f3d2a-0000-4000-8000-000000000003", k: "enrolment.confirmed" })).toString("base64url");
    expect(verifyToken(`${other}.${sig}`)).toBeNull();
    expect(verifyToken(`${body}.${sig.slice(0, -2)}AA`)).toBeNull();
    expect(verifyToken(body)).toBeNull();
    expect(verifyToken("")).toBeNull();
  });
});

describe("notifications-delivery: helpers", () => {
  it("normalises Indian mobile numbers to E.164 and refuses junk", () => {
    expect(toE164("98123 45678")).toBe("+919812345678");
    expect(toE164("09812345678")).toBe("+919812345678");
    expect(toE164("919812345678")).toBe("+919812345678");
    expect(toE164("+91-98123-45678")).toBe("+919812345678");
    expect(toE164("+44 7700 900123")).toBe("+447700900123");
    expect(toE164("12345")).toBeNull();
    expect(toE164("5812345678")).toBeNull();
    expect(toE164("")).toBeNull();
    expect(maskPhone("+919812345678")).toBe("+91 98•••• 5678");
  });

  it("knows quiet hours and when they end, across midnight and time zones", () => {
    const tz = "Asia/Kolkata";
    expect(isQuietHours(tz, zonedInstant("2026-11-02", 20 * 60 + 59, tz))).toBe(false);
    expect(isQuietHours(tz, zonedInstant("2026-11-02", 21 * 60, tz))).toBe(true);
    expect(isQuietHours(tz, zonedInstant("2026-11-03", 7 * 60 + 59, tz))).toBe(true);
    expect(isQuietHours(tz, zonedInstant("2026-11-03", 8 * 60, tz))).toBe(false);
    expect(quietHoursEnd(tz, zonedInstant("2026-11-02", 22 * 60, tz)).toISOString()).toBe("2026-11-03T02:30:00.000Z");
    expect(quietHoursEnd(tz, zonedInstant("2026-11-03", 3 * 60, tz)).toISOString()).toBe("2026-11-03T02:30:00.000Z");
    const noon = zonedInstant("2026-11-03", 12 * 60, tz);
    expect(quietHoursEnd(tz, noon)).toBe(noon);
    // A daylight-saving zone: 8 am New York on the day the clocks change.
    expect(quietHoursEnd("America/New_York", new Date("2026-11-01T05:00:00Z")).toISOString()).toBe("2026-11-01T13:00:00.000Z");
  });

  it("treats sign-in codes, resets and invites as security messages", () => {
    for (const k of ["security.otp", "security.reset", "identity.invite", "identity.otp", "identity.password_reset", "user.invited"]) expect(isSecurityKind(k), k).toBe(true);
    for (const k of ["enrolment.confirmed", "timetable.changed", "assignment.graded", "message", undefined]) expect(isSecurityKind(k), String(k)).toBe(false);
  });

  it("wraps another module's HTML fragment in the branded layout and keeps a full document's own design", () => {
    const ctx = {
      university: { name: "Alpha Institute", branding: { primaryColor: "#7A1F3D" } },
      absolute: (p: string) => `https://app.test${p}`,
      footer: { reason: "Because.", settingsUrl: "https://app.test/s", unsubscribeUrl: "https://app.test/u", unsubscribeLabel: "receipts" },
    };
    const frag = decorateDirectEmail({ subject: "Your receipt", html: "<p>Paid ₹4,720</p>", text: "Paid ₹4,720" }, ctx);
    expect(frag.html).toContain("<p>Paid ₹4,720</p>");
    expect(frag.html).toContain("Alpha Institute");
    expect(frag.html).toContain("Unsubscribe from receipts emails");
    expect(frag.text).toContain("Unsubscribe from receipts emails: https://app.test/u");
    const doc = decorateDirectEmail({ subject: "Hi", html: "<html><body><h1>Own design</h1></body></html>", text: "Own design" }, ctx);
    expect(doc.html).toMatch(/<h1>Own design<\/h1><div[^>]*>[\s\S]*Unsubscribe from receipts emails[\s\S]*<\/div><\/body>/);
    const layout = brandedHtml({ ...ctx, heading: "H", body: "Line one\nline two\n\nNext https://x.test/a.", cta: null });
    expect(layout).toContain('Line one<br>line two');
    expect(layout).toContain('<a href="https://x.test/a"');
  });
});
