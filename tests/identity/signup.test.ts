import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, roleAssignments, universities, users } from "@/db/schema";
import { setTestModules } from "@/server/registry";
import { addPerson } from "@/server/services/users";
import { verifyPassword } from "@/server/auth/passwords";
import { loginUniversity, signInWithPassword, signUpStudent } from "@/modules/identity/auth";
import { setSelfSignup } from "@/modules/identity/settings";
import { setupCourse, uniqueCode } from "../fixtures";
import { useIdentityOnly } from "./helpers";

const PW = "a quiet green field";
const email = (name: string) => `${name}.${uniqueCode("").toLowerCase()}@signup.test`;
const ip = () => `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const form = (slug: string, over: Partial<Parameters<typeof signUpStudent>[0]> = {}) => ({
  slug,
  name: "Isha Kapoor",
  email: email("isha"),
  password: PW,
  confirm: PW,
  ip: ip(),
  ...over,
});

beforeAll(() => useIdentityOnly());
afterAll(async () => {
  setTestModules([]);
  await closeDb();
});

describe("student sign-up", () => {
  it("creates a student at that institute who can sign in, and logs it", async () => {
    const { uni } = await setupCourse({ name: "Sunrise Institute" });
    const input = form(uni.slug);
    const r = await signUpStudent(input);
    if (r.status !== "created") throw new Error("expected an account");
    expect(r.landing).toBe(`/${uni.slug}/learn`);

    const [u] = await systemDb().select().from(users).where(eq(users.id, r.userId));
    expect(u.email).toBe(input.email);
    expect(await verifyPassword(PW, u.passwordHash!)).toBe(true);

    const roles = await systemDb().select().from(roleAssignments).where(eq(roleAssignments.userId, r.userId));
    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject({ role: "student", scopeType: "university", universityId: uni.id });

    const log = await systemDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.universityId, uni.id), eq(auditLog.action, "user.self_signup")));
    expect(log).toHaveLength(1);

    expect((await signInWithPassword({ email: input.email, password: PW, ip: ip() })).ok).toBe(true);
  });

  it("never touches an existing person, even one with a pending invitation and no password", async () => {
    const { uni, admin, dept } = await setupCourse({ name: "Hilltop College" });
    const taken = email("nisha");
    const userId = await addPerson(admin, { name: "Nisha Rao", email: taken, role: "permanent_faculty", departmentId: dept.id });

    await expect(signUpStudent(form(uni.slug, { email: taken.toUpperCase() }))).rejects.toMatchObject({ code: "email_taken" });

    const [u] = await systemDb().select().from(users).where(eq(users.id, userId));
    expect(u.passwordHash).toBeNull();
    expect(u.name).toBe("Nisha Rao");
    const roles = await systemDb().select().from(roleAssignments).where(eq(roleAssignments.userId, userId));
    expect(roles.map((r) => r.role)).toEqual(["permanent_faculty"]);
  });

  it("refuses when the institute turns sign-up off, and opens again when it turns it on", async () => {
    const { uni, admin } = await setupCourse({ name: "Fixed List College" });
    expect((await loginUniversity(uni.slug))?.signupOpen).toBe(true);

    await setSelfSignup(admin, false);
    expect((await loginUniversity(uni.slug))?.signupOpen).toBe(false);
    await expect(signUpStudent(form(uni.slug))).rejects.toMatchObject({ code: "signup_closed" });

    await setSelfSignup(admin, true);
    expect((await signUpStudent(form(uni.slug))).status).toBe("created");
  });

  it("refuses at a suspended institute and an unknown one", async () => {
    const { uni } = await setupCourse({ name: "Paused Academy" });
    expect((await loginUniversity(uni.slug))?.signupOpen).toBe(true);
    await systemDb().update(universities).set({ status: "suspended" }).where(eq(universities.id, uni.id));
    expect((await loginUniversity(uni.slug))?.signupOpen).toBe(false);
    await expect(signUpStudent(form(uni.slug))).rejects.toMatchObject({ code: "signup_closed" });
    await expect(signUpStudent(form("no-such-institute"))).rejects.toMatchObject({ code: "unknown_institute" });
  });

  it("checks the name, email and password before creating anything", async () => {
    const { uni } = await setupCourse({ name: "Careful Academy" });
    const bad = email("bad");
    await expect(signUpStudent(form(uni.slug, { name: " ", email: bad }))).rejects.toThrow("full name");
    await expect(signUpStudent(form(uni.slug, { email: "not-an-email" }))).rejects.toThrow("valid email");
    await expect(signUpStudent(form(uni.slug, { email: bad, confirm: "something else entirely" }))).rejects.toBeTruthy();
    expect(await systemDb().select().from(users).where(eq(users.email, bad))).toHaveLength(0);
  });

  it("caps new accounts from one network", async () => {
    const { uni } = await setupCourse({ name: "Busy Campus" });
    const shared = `10.9.${Math.floor(Math.random() * 250)}.1`;
    const now = new Date();
    for (let i = 0; i < 30; i++) {
      expect((await signUpStudent(form(uni.slug, { ip: shared, now }))).status).toBe("created");
    }
    expect((await signUpStudent(form(uni.slug, { ip: shared, now }))).status).toBe("network_limited");
  }, 120_000);
});
