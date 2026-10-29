import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, users } from "@/db/schema";
import { setTestModules } from "@/server/registry";
import { addPerson, importPeople, linkParent } from "@/server/services/users";
import { grantPlatformRole } from "@/server/core";
import { loadActor } from "@/server/actor";
import { sha256 } from "@/server/auth/tokens";
import { verifyPassword } from "@/server/auth/passwords";
import { acceptInvite, inspectInvite } from "@/modules/identity/auth";
import { listInvites, resendInvite, revokeInvite } from "@/modules/identity/invites";
import { idnInvites, idnTokens } from "@/modules/identity/schema";
import { drainEvents, eventsOfType } from "../helpers/events";
import { grant, makeDepartment, makeUser, person, setupCourse, uniqueCode } from "../fixtures";
import { linkIn, mailTo, resetOutbox, useIdentityOnly } from "./helpers";

const DAY = 86_400_000;
const PW = "a quiet green field";

beforeAll(() => useIdentityOnly());
beforeEach(() => resetOutbox());
afterAll(async () => {
  setTestModules([]);
  await closeDb();
});

const email = (name: string) => `${name}.${uniqueCode("").toLowerCase()}@invite.test`;

describe("user.invited sends a single-use invitation", () => {
  it("emails a link that shows the institute name, and stores only the token's hash", async () => {
    const { uni, admin, dept } = await setupCourse({ name: "Sunrise Institute" });
    const to = email("nisha");
    const userId = await addPerson(admin, { name: "Nisha Rao", email: to, role: "permanent_faculty", departmentId: dept.id });
    await drainEvents();

    const [m] = mailTo(to);
    expect(m.subject).toBe("Join Sunrise Institute on Zinny");
    expect(m.kind).toBe("identity.invite");
    expect(m.universityId).toBe(uni.id);
    expect(m.text).toContain("Sunrise Institute has invited you to Zinny as Permanent Faculty");
    const token = linkIn(to, "invite");

    const [row] = await systemDb().select().from(idnInvites).where(eq(idnInvites.userId, userId));
    expect(row.tokenHash).toBe(sha256(token));
    expect(row.tokenHash).not.toContain(token.split(".")[1]);
    expect(JSON.stringify(row)).not.toContain(token.split(".")[1]);
    expect(row.expiresAt.getTime() - row.sentAt.getTime()).toBe(7 * DAY);

    const view = await inspectInvite(token);
    expect(view).toMatchObject({ state: "valid", institute: "Sunrise Institute", name: "Nisha Rao", email: to, roleLabel: "Permanent Faculty" });
  });

  it("is idempotent: delivering the same event twice sends one email", async () => {
    const { admin } = await setupCourse({ name: "Twice U" });
    const to = email("twice");
    const userId = await addPerson(admin, { name: "Twice Person", email: to, role: "board_owner" });
    await drainEvents();
    const [event] = (await eventsOfType("user.invited", admin.universityId!)).filter((e) => e.payload.userId === userId);
    // Deliver again by hand, as a retried delivery would.
    const { handleUserInvited } = await import("@/modules/identity/invites");
    const { withTenant, systemActorFor } = await import("@/server/core");
    const actor = systemActorFor(admin.universityId!);
    await withTenant(actor, (tx) => handleUserInvited(tx, actor, event as never));
    expect(mailTo(to)).toHaveLength(1);
    expect(await systemDb().select().from(idnInvites).where(eq(idnInvites.userId, userId))).toHaveLength(1);
  });

  it("invites people from CSV import and parent links too", async () => {
    const { admin, student } = await setupCourse({ name: "Import Invite U" });
    const s = email("csv");
    await importPeople(admin, `name,email,role\nCsv Student,${s},student`, { commit: true });
    const kid = await student("Kid Kumar");
    const p = email("parent");
    await linkParent(admin, { studentUserId: kid.userId, parentEmail: p, parentName: "Parent Kumar" });
    await drainEvents();
    expect(mailTo(s)[0].text).toContain("as Student");
    expect(mailTo(p)[0].text).toContain("as Parent / Guardian");
  });

  it("accepting sets the password, signs the person in, and the link can't be used again", async () => {
    const { admin, dept } = await setupCourse({ name: "Accept U" });
    const to = email("accept");
    const userId = await addPerson(admin, { name: "Accept Me", email: to, role: "permanent_faculty", departmentId: dept.id });
    await drainEvents();
    const token = linkIn(to, "invite");

    const r = await acceptInvite({ token, password: PW, confirm: PW });
    expect(r.userId).toBe(userId);
    expect(r.landing).toMatch(/\/admin$/);
    const [u] = await systemDb().select().from(users).where(eq(users.id, userId));
    expect(await verifyPassword(PW, u.passwordHash!)).toBe(true);

    expect(await inspectInvite(token)).toMatchObject({ state: "accepted", email: to });
    await expect(acceptInvite({ token, password: "another long password", confirm: "another long password" })).rejects.toThrow(/already used/);
    const [audit] = await systemDb().select().from(auditLog).where(eq(auditLog.action, "invite.accept"));
    expect(audit).toBeTruthy();
  });

  it("students land in the learner app", async () => {
    const { admin } = await setupCourse({ name: "Learner Land U" });
    const to = email("learner");
    await addPerson(admin, { name: "Learner Lee", email: to, role: "student" });
    await drainEvents();
    const r = await acceptInvite({ token: linkIn(to, "invite"), password: PW, confirm: PW });
    expect(r.landing).toMatch(/\/learn$/);
  });

  it("checks the new password before using up the link", async () => {
    const { admin } = await setupCourse({ name: "Weak U" });
    const to = email("weak");
    await addPerson(admin, { name: "Weak Pass", email: to, role: "student" });
    await drainEvents();
    const token = linkIn(to, "invite");
    await expect(acceptInvite({ token, password: "short", confirm: "short" })).rejects.toThrow(/at least 8/);
    await expect(acceptInvite({ token, password: "password123", confirm: "password123" })).rejects.toThrow(/too common/);
    await expect(acceptInvite({ token, password: PW, confirm: `${PW}!` })).rejects.toThrow(/don't match/);
    expect((await inspectInvite(token)).state).toBe("valid");
  });

  it("expires after 7 days", async () => {
    const { admin } = await setupCourse({ name: "Expiry U" });
    const to = email("late");
    await addPerson(admin, { name: "Late Larry", email: to, role: "student" });
    await drainEvents();
    const token = linkIn(to, "invite");
    const almost = new Date(Date.now() + 7 * DAY - 60_000);
    const after = new Date(Date.now() + 7 * DAY + 60_000);
    expect((await inspectInvite(token, almost)).state).toBe("valid");
    expect((await inspectInvite(token, after)).state).toBe("expired");
    await expect(acceptInvite({ token, password: PW, confirm: PW, now: after })).rejects.toThrow(/expired/);
  });

  it("rejects made-up and tampered tokens", async () => {
    const { admin } = await setupCourse({ name: "Tamper U" });
    const to = email("tamper");
    await addPerson(admin, { name: "Tamper Tim", email: to, role: "student" });
    await drainEvents();
    const token = linkIn(to, "invite");
    const [uniPart, secret] = token.split(".");
    const flipped = secret.slice(0, -1) + (secret.endsWith("A") ? "B" : "A");
    expect((await inspectInvite(`${uniPart}.${flipped}`)).state).toBe("invalid");
    expect((await inspectInvite("nonsense")).state).toBe("invalid");
    expect((await inspectInvite(`${uniPart}.${"x".repeat(43)}`)).state).toBe("invalid");
    await expect(acceptInvite({ token: `${uniPart}.${flipped}`, password: PW, confirm: PW })).rejects.toThrow(/isn't valid/);
  });

  it("an invitation for university A can't be used to reach university B", async () => {
    const a = await setupCourse({ name: "Alpha Academy" });
    const b = await setupCourse({ name: "Beta Academy" });
    const to = email("cross");
    await addPerson(a.admin, { name: "Cross Over", email: to, role: "institute_admin" });
    await drainEvents();
    const token = linkIn(to, "invite");
    const secret = token.split(".")[1];
    const { compactUuid } = await import("@/server/auth/tokens");
    const forged = `${compactUuid(b.uni.id)}.${secret}`;

    // Pointing the token at B finds nothing: B's tables don't hold it, and the hash covers the university part.
    expect((await inspectInvite(forged)).state).toBe("invalid");
    await expect(acceptInvite({ token: forged, password: PW, confirm: PW })).rejects.toThrow(/isn't valid/);

    // Accepting the real link lands in A, and the person has no access to B.
    const r = await acceptInvite({ token, password: PW, confirm: PW });
    expect(r.landing).toBe(`/${a.uni.slug}/admin`);
    const inB = await loadActor(r.userId, b.uni.id);
    expect(inB.assignments.filter((x) => x.universityId === b.uni.id)).toEqual([]);
  });

  it("can't be used once the person's role is removed", async () => {
    const { admin } = await setupCourse({ name: "Removed U" });
    const to = email("removed");
    const userId = await addPerson(admin, { name: "Removed Rani", email: to, role: "accounts_fees" });
    await drainEvents();
    const token = linkIn(to, "invite");
    const { revokeRole } = await import("@/server/services/users");
    const { roleAssignments } = await import("@/db/schema");
    const [ra] = await systemDb().select().from(roleAssignments).where(eq(roleAssignments.userId, userId));
    await revokeRole(admin, ra.id);
    expect((await inspectInvite(token)).state).toBe("no_access");
    await expect(acceptInvite({ token, password: PW, confirm: PW })).rejects.toThrow(/no longer have a role/);
  });

  it("isn't sent to someone who already has a password", async () => {
    const { admin } = await setupCourse({ name: "Has PW U" });
    const u = await makeUser("Already Here");
    await systemDb().update(users).set({ passwordHash: "x" }).where(eq(users.id, u.id));
    await addPerson(admin, { name: u.name, email: u.email, role: "board_owner" });
    await drainEvents();
    expect(mailTo(u.email)).toHaveLength(0);
  });

  it("Zinny team members get a team invitation that leads to the team panel", async () => {
    const sa = await makeUser("Super Sam");
    await grant(sa.id, "super_admin");
    const to = email("qa");
    const a = await grantPlatformRole(await loadActor(sa.id, null), { email: to, name: "Quinn QA", role: "content_qa" });
    await drainEvents({ universityId: null });
    expect(mailTo(to)[0].subject).toBe("Join the Zinny team");
    const token = linkIn(to, "invite");
    expect(token.startsWith("team.")).toBe(true);
    const [row] = await systemDb().select().from(idnTokens).where(eq(idnTokens.userId, a.userId));
    expect(row.tokenHash).toBe(sha256(token));
    expect(await inspectInvite(token)).toMatchObject({ state: "valid", institute: "the Zinny team", roleLabel: "Content QA" });
    expect((await acceptInvite({ token, password: PW, confirm: PW })).landing).toBe("/platform");
    await expect(acceptInvite({ token, password: PW, confirm: PW })).rejects.toThrow(/already used/);
  });
});

describe("invitations page: resend and revoke", () => {
  it("resending sends a new link and the old one stops working", async () => {
    const { admin } = await setupCourse({ name: "Resend U" });
    const to = email("resend");
    const userId = await addPerson(admin, { name: "Resend Ravi", email: to, role: "student" });
    await drainEvents();
    const first = linkIn(to, "invite");
    const r = await resendInvite(admin, userId, { now: new Date(Date.now() + 2 * 60_000) });
    expect(r.email).toBe(to);
    const second = linkIn(to, "invite");
    expect(second).not.toBe(first);
    expect((await inspectInvite(first)).state).toBe("replaced");
    expect((await inspectInvite(second)).state).toBe("valid");
    await expect(acceptInvite({ token: first, password: PW, confirm: PW })).rejects.toThrow(/newer invitation/);
  });

  it("won't resend twice within a minute (a double click sends one email)", async () => {
    const { admin } = await setupCourse({ name: "Double U" });
    const to = email("double");
    const userId = await addPerson(admin, { name: "Double Click", email: to, role: "student" });
    await drainEvents();
    await expect(resendInvite(admin, userId)).rejects.toThrow(/a moment ago/);
    expect(mailTo(to)).toHaveLength(1);
  });

  it("resending revives an expired invitation", async () => {
    const { admin } = await setupCourse({ name: "Revive U" });
    const to = email("revive");
    const userId = await addPerson(admin, { name: "Revive Rhea", email: to, role: "student" });
    await drainEvents();
    const eightDays = new Date(Date.now() + 8 * DAY);
    expect((await listInvites(admin, { now: eightDays })).open.find((r) => r.userId === userId)?.status).toBe("expired");
    await resendInvite(admin, userId, { now: eightDays });
    const token = linkIn(to, "invite");
    expect((await inspectInvite(token, eightDays)).state).toBe("valid");
  });

  it("revoking stops the link at once and keeps the role; the person can be invited again", async () => {
    const { admin } = await setupCourse({ name: "Revoke U" });
    const to = email("revoke");
    const userId = await addPerson(admin, { name: "Wrong Address", email: to, role: "student" });
    await drainEvents();
    const token = linkIn(to, "invite");
    const [row] = (await listInvites(admin)).open.filter((r) => r.userId === userId);
    expect(row.status).toBe("pending");
    await revokeInvite(admin, row.inviteId!);
    expect((await inspectInvite(token)).state).toBe("revoked");
    await expect(acceptInvite({ token, password: PW, confirm: PW })).rejects.toThrow(/cancelled/);
    await expect(revokeInvite(admin, row.inviteId!)).rejects.toThrow(/already revoked/);
    const after = (await listInvites(admin)).open.find((r) => r.userId === userId)!;
    expect(after).toMatchObject({ status: "not_sent", inviteId: null });
    await resendInvite(admin, userId);
    expect((await inspectInvite(linkIn(to, "invite"))).state).toBe("valid");
    const actions = (await systemDb().select().from(auditLog).where(eq(auditLog.entityId, row.inviteId!))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["invite.send", "invite.revoke"]));
  });

  it("lists who joined, and people without a password who were never invited", async () => {
    const { admin, uni } = await setupCourse({ name: "List U" });
    const joined = email("joined");
    await addPerson(admin, { name: "Joined Jai", email: joined, role: "student" });
    await drainEvents();
    await acceptInvite({ token: linkIn(joined, "invite"), password: PW, confirm: PW });
    const quiet = await makeUser("Quiet Quinn");
    await grant(quiet.id, "student", { universityId: uni.id });
    const { open, accepted } = await listInvites(admin);
    expect(accepted.map((a) => a.name)).toContain("Joined Jai");
    expect(open.find((r) => r.userId === quiet.id)).toMatchObject({ status: "not_sent", sends: 0 });
    expect(open.find((r) => r.name === "Joined Jai")).toBeUndefined();
  });
});

describe("invitations page: permissions (user.manage_roles)", () => {
  it("Institute Admin is allowed; Board, Accounts, faculty and students are denied", async () => {
    const { uni, admin, dept, facultyUserId, student } = await setupCourse({ name: "Perm U" });
    const to = email("perm");
    const userId = await addPerson(admin, { name: "Perm Person", email: to, role: "student" });
    await drainEvents();
    expect((await listInvites(admin)).open.some((r) => r.userId === userId)).toBe(true);

    const board = await (await person("Board B", "board_owner", { universityId: uni.id })).actor();
    const accounts = await (await person("Accounts A", "accounts_fees", { universityId: uni.id })).actor();
    const faculty = await loadActor(facultyUserId, uni.id);
    const kid = await student("Student S");
    for (const who of [board, accounts, faculty, kid]) {
      await expect(listInvites(who)).rejects.toThrow(/access/);
      await expect(resendInvite(who, userId)).rejects.toThrow(/access/);
    }
    const [row] = (await listInvites(admin)).open.filter((r) => r.userId === userId);
    await expect(revokeInvite(board, row.inviteId!)).rejects.toThrow(/access/);
    void dept;
  });

  it("a HOD manages faculty invitations in their own department only", async () => {
    const { uni, admin, hod, dept } = await setupCourse({ name: "HOD Scope U" });
    const other = await makeDepartment(uni.id, uniqueCode("M"), "Marketing");
    const mine = await addPerson(admin, { name: "My Faculty", email: email("myfac"), role: "permanent_faculty", departmentId: dept.id });
    const theirs = await addPerson(admin, { name: "Their Faculty", email: email("theirfac"), role: "permanent_faculty", departmentId: other.id });
    const studentId = await addPerson(admin, { name: "Some Student", email: email("stu"), role: "student" });
    await drainEvents();

    const names = (await listInvites(hod)).open.map((r) => r.name);
    expect(names).toContain("My Faculty");
    expect(names).not.toContain("Their Faculty");
    expect(names).not.toContain("Some Student");

    await resendInvite(hod, mine, { now: new Date(Date.now() + 2 * 60_000) });
    await expect(resendInvite(hod, theirs, { now: new Date(Date.now() + 2 * 60_000) })).rejects.toThrow(/access/);
    await expect(resendInvite(hod, studentId, { now: new Date(Date.now() + 2 * 60_000) })).rejects.toThrow(/access/);
    const theirRow = (await listInvites(admin)).open.find((r) => r.userId === theirs)!;
    await expect(revokeInvite(hod, theirRow.inviteId!)).rejects.toThrow(/access/);
  });

  it("an admin of university B can't see or touch university A's invitations", async () => {
    const a = await setupCourse({ name: "Iso A" });
    const b = await setupCourse({ name: "Iso B" });
    const userId = await addPerson(a.admin, { name: "Only In A", email: email("onlya"), role: "student" });
    await drainEvents();
    const row = (await listInvites(a.admin)).open.find((r) => r.userId === userId)!;
    expect((await listInvites(b.admin)).open.find((r) => r.userId === userId)).toBeUndefined();
    await expect(revokeInvite(b.admin, row.inviteId!)).rejects.toThrow(/not found/);
    await expect(resendInvite(b.admin, userId)).rejects.toThrow(/not found/);
  });
});
