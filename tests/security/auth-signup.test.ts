/**
 * Sign-up can't create admins (controls verified, no change needed). The server actions are
 * driven the way a forged request would: extra form fields and object keys naming a role, a
 * university, a scope or a longer trial. What the account gets comes from the server alone.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { roleAssignments, studentDepartments, universities, users } from "@/db/schema";
import { addDays, todayIn } from "@/server/lib/dates";
import { TRIAL_DAYS } from "@/modules/onboarding/lib/constants";
import { setJoinMode } from "@/modules/identity/joining";
import { grant, makeDepartment, makeUser, setupCourse, uniqueCode } from "../fixtures";
import { signupInput } from "../onboarding/helpers";

const browser = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    ip: "10.48.0.1",
    jar: {
      get: (name: string) => (values.has(name) ? { value: values.get(name)! } : undefined),
      set: (name: string, value: string) => void values.set(name, value),
      delete: (name: string) => void values.delete(name),
    },
  };
});
vi.mock("next/headers", () => ({
  cookies: async () => browser.jar,
  headers: async () => new Headers({ "x-forwarded-for": browser.ip, "user-agent": "Mozilla/5.0 Chrome/141.0" }),
}));

const { signUpAction } = await import("@/app/login/actions");
const { startTrialAction } = await import("@/app/signup/institute/actions");

afterAll(closeDb);

const rolesOf = (userId: string) =>
  systemDb().select().from(roleAssignments).where(and(eq(roleAssignments.userId, userId), isNull(roleAssignments.revokedAt)));
const freshIp = () => `10.48.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

describe("student sign-up ignores every field that would choose a role, institute or scope", () => {
  it("a forged form still makes a plain student of the institute in the address, in one of its own departments at most", async () => {
    const { uni, admin } = await setupCourse({ name: "Open Signup U" });
    await setJoinMode(admin, "instant");
    const other = await setupCourse({ name: "Somebody Else's U" });
    const otherDept = await makeDepartment(other.uni.id, uniqueCode(), "Elsewhere");
    browser.ip = freshIp();
    const email = `forged.${Date.now()}@example.test`;
    const form = new FormData();
    for (const [k, v] of Object.entries({
      name: "Forged Fields",
      email,
      password: "a long pass phrase 42",
      confirm: "a long pass phrase 42",
      uni: uni.slug,
      role: "institute_admin",
      customRoleId: "custom:5b1f6f0e-0000-4000-8000-000000000000",
      scopeType: "platform",
      universityId: other.uni.id,
      departmentId: otherDept.id,
      batchId: other.batch.id,
    }))
      form.set(k, v);
    await expect(signUpAction(null, form)).rejects.toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT/) });

    const [u] = await systemDb().select().from(users).where(eq(users.email, email));
    const roles = await rolesOf(u.id);
    expect(roles.map((r) => [r.role, r.scopeType, r.universityId, r.departmentId, r.batchId])).toEqual([["student", "university", uni.id, null, null]]);
    // The other institute's department was dropped, not attached.
    expect(await systemDb().select().from(studentDepartments).where(eq(studentDepartments.userId, u.id))).toEqual([]);
  });

  it("an email that already has an account is refused, so nobody signs up on top of an admin", async () => {
    const { uni, admin } = await setupCourse({ name: "Takeover Signup U" });
    await setJoinMode(admin, "instant");
    const [a] = await systemDb().select().from(users).where(eq(users.id, admin.userId));
    browser.ip = freshIp();
    const form = new FormData();
    for (const [k, v] of Object.entries({ name: "Not Asha", email: a.email.toUpperCase(), password: "a long pass phrase 42", confirm: "a long pass phrase 42", uni: uni.slug }))
      form.set(k, v);
    expect(await signUpAction(null, form)).toMatchObject({ code: "email_taken" });
  });
});

describe("institute self sign-up makes its creator the admin of the new institute only", () => {
  it("extra keys asking for a Zinny role, another institute, a status or a longer trial are ignored", async () => {
    const other = await setupCourse({ name: "Existing Institute" });
    browser.ip = freshIp();
    const input = {
      ...signupInput(),
      role: "super_admin",
      scopeType: "platform",
      universityId: other.uni.id,
      status: "active",
      trialDays: 3650,
      trialEndsAt: "2099-12-31",
    } as Parameters<typeof startTrialAction>[0];
    const r = await startTrialAction(input, { account: true, service: true, marketing: false });
    expect(r).toMatchObject({ ok: true, slug: input.slug });
    if (!r.ok) return;

    const [u] = await systemDb().select().from(users).where(eq(users.email, input.email));
    const [uni] = await systemDb().select().from(universities).where(eq(universities.slug, input.slug));
    expect((await rolesOf(u.id)).map((x) => [x.role, x.scopeType, x.universityId])).toEqual([["institute_admin", "university", uni.id]]);
    expect(uni.trialEndsAt).toBe(addDays(todayIn("Asia/Kolkata"), TRIAL_DAYS));
    expect(r.trialEndsAt).toBe(uni.trialEndsAt);
  });

  it("can't take an existing web address or attach to an existing account (a Super Admin's included)", async () => {
    const other = await setupCourse({ name: "Taken Address U" });
    const zara = await makeUser("Signup Super");
    await grant(zara.id, "super_admin");
    browser.ip = freshIp();
    expect(await startTrialAction(signupInput({ slug: other.uni.slug }), { account: true, service: true, marketing: false })).toMatchObject({ ok: false, step: "institute" });
    browser.ip = freshIp();
    expect(await startTrialAction(signupInput({ email: zara.email }), { account: true, service: true, marketing: false })).toMatchObject({ ok: false, step: "account" });
    expect((await rolesOf(zara.id)).map((x) => x.role)).toEqual(["super_admin"]);
  });
});
