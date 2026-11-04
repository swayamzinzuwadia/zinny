/**
 * "Book a demo" on the website: checked, recorded in the activity log, and emailed to every
 * active Super Admin and nobody else. Bots that fill the hidden field get nothing; one network
 * can't send more than a few an hour.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, roleAssignments } from "@/db/schema";
import type { MailMessage } from "@/contracts/mail";
import type { ZinnyModule } from "@/contracts/module";
import { setTestModules } from "@/server/registry";
import { cleanDemoRequest, DEMO_REQUEST_ACTION, DEMO_REQUEST_LIMITS, requestDemo, superAdminEmails } from "@/modules/zinny-team-panel/services/demo-requests";
import { grant, makeUser } from "../fixtures";

const mail: MailMessage[] = [];
const capture: ZinnyModule = { id: "notifications-delivery", mailTransport: { name: "test-mail", send: async (m) => (mail.push(m), {}) } };

const good = { name: "Priya Shah", institute: "Sunrise Classes", role: "Director", phone: "98200 12345", email: "Priya@Sunrise.in", city: "Pune", message: "About 300 students." };
const ip = () => `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const clearLog = () => systemDb().delete(auditLog).where(eq(auditLog.action, DEMO_REQUEST_ACTION));

let superAdmin: string, secondSuperAdmin: string, revoked: string, ended: string, support: string;

beforeAll(async () => {
  setTestModules([capture], { only: true });
  const a = await makeUser("Demo Super One");
  const b = await makeUser("Demo Super Two");
  const c = await makeUser("Demo Super Revoked");
  const d = await makeUser("Demo Super Ended");
  const e = await makeUser("Demo Support");
  await grant(a.id, "super_admin");
  await grant(b.id, "super_admin");
  await grant(c.id, "super_admin");
  await systemDb()
    .update(roleAssignments)
    .set({ revokedAt: new Date() })
    .where(and(eq(roleAssignments.userId, c.id), eq(roleAssignments.role, "super_admin")));
  await grant(d.id, "super_admin", {}, new Date(Date.now() - 86_400_000));
  await grant(e.id, "support_agent");
  [superAdmin, secondSuperAdmin, revoked, ended, support] = [a.email, b.email, c.email, d.email, e.email];
});

beforeEach(async () => {
  mail.length = 0;
  await clearLog();
});

afterAll(async () => {
  await clearLog();
  setTestModules([]);
  await closeDb();
});

describe("checking a request", () => {
  it("tidies what was typed", () => {
    expect(cleanDemoRequest({ ...good, name: "  Priya   Shah ", city: "" })).toMatchObject({ name: "Priya Shah", email: "priya@sunrise.in", city: "" });
  });

  it("says what to fix", () => {
    expect(() => cleanDemoRequest({ ...good, name: "" })).toThrow(/your name/);
    expect(() => cleanDemoRequest({ ...good, institute: " " })).toThrow(/institute's name/);
    expect(() => cleanDemoRequest({ ...good, email: "priya@" })).toThrow(/email address/);
    expect(() => cleanDemoRequest({ ...good, phone: "12345" })).toThrow(/at least 10 digits/);
    expect(() => cleanDemoRequest({ ...good, phone: "call me" })).toThrow(/phone number/);
    expect(() => cleanDemoRequest({ ...good, message: "x".repeat(2001) })).toThrow(/2,000 characters/);
  });
});

describe("who gets it", () => {
  it("is every active Super Admin, and not a revoked or ended one, or another team role", async () => {
    const to = await superAdminEmails();
    expect(to).toEqual(expect.arrayContaining([superAdmin, secondSuperAdmin]));
    expect(to).not.toContain(revoked);
    expect(to).not.toContain(ended);
    expect(to).not.toContain(support);
  });
});

describe("sending a request", () => {
  it("emails the Super Admins with a reply-to of the sender, and records it in the activity log", async () => {
    const res = await requestDemo(good, { ip: ip() });
    expect(res.status).toBe("sent");
    expect(mail).toHaveLength(1);
    const m = mail[0];
    expect(m.to).toEqual(expect.arrayContaining([superAdmin, secondSuperAdmin]));
    expect(m.replyTo).toBe("priya@sunrise.in");
    expect(m.subject).toBe("Demo request from Sunrise Classes");
    expect(m.text).toContain("Phone: 98200 12345");
    expect(m.text).toContain("About 300 students.");
    const [row] = await systemDb().select().from(auditLog).where(eq(auditLog.action, DEMO_REQUEST_ACTION));
    expect(row).toMatchObject({ universityId: null, actorUserId: null, entity: "demo_request" });
    expect(row.data).toMatchObject({ name: "Priya Shah", institute: "Sunrise Classes", email: "priya@sunrise.in" });
  });

  it("escapes what was typed in the HTML email", async () => {
    await requestDemo({ ...good, institute: "<b>Sunrise</b> & Co" }, { ip: ip() });
    expect(mail[0].html).toContain("&lt;b&gt;Sunrise&lt;/b&gt; &amp; Co");
    expect(mail[0].html).not.toContain("<b>Sunrise</b>");
  });

  it("does nothing for a bot that fills in the hidden field", async () => {
    expect(await requestDemo({ ...good, website: "https://spam.example" }, { ip: ip() })).toEqual({ status: "ignored", recipients: 0 });
    expect(mail).toHaveLength(0);
    const [{ n }] = await systemDb().select({ n: sql<number>`count(*)::int` }).from(auditLog).where(eq(auditLog.action, DEMO_REQUEST_ACTION));
    expect(n).toBe(0);
  });

  it("refuses more than a few an hour from one network, and doesn't send a bad request at all", async () => {
    const from = ip();
    for (let i = 0; i < DEMO_REQUEST_LIMITS.perSender; i++) await requestDemo(good, { ip: from });
    await expect(requestDemo(good, { ip: from })).rejects.toThrow(/several requests from your network/);
    await expect(requestDemo({ ...good, email: "nope" }, { ip: ip() })).rejects.toThrow(/email address/);
    expect(mail).toHaveLength(DEMO_REQUEST_LIMITS.perSender);
    // Someone else, on another network, still gets through.
    expect((await requestDemo(good, { ip: ip() })).status).toBe("sent");
  });
});
