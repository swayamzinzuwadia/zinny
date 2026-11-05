import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { users } from "@/db/schema";
import { setTestModules } from "@/server/registry";
import { joinPhone, normalizePhone } from "@/server/auth/phone";
import { myDepartments, setStudentDepartments } from "@/server/services/students";
import { signUpWithCode } from "@/modules/identity/auth";
import { getJoinSettings } from "@/modules/identity/joining";
import { signUpPhoneActor, signUpPhoneStatus, startPhoneChange, updateName, verifyPhoneChange } from "@/modules/identity/profile";
import { makeDepartment, makeUser, person, setupCourse } from "../fixtures";
import { codeIn, inlineDefer, resetOutbox, useIdentityOnly } from "./helpers";

beforeAll(() => useIdentityOnly());
beforeEach(() => resetOutbox());
afterAll(async () => {
  setTestModules([]);
  await closeDb();
});

let seq = 0;
const tag = () => `${Date.now().toString(36)}${++seq}`;
const freshPhone = () => `+9196${String(Date.now() % 1_000_000).padStart(6, "0")}${String(++seq % 100).padStart(2, "0")}`;

async function signUp(code: string) {
  const t = tag();
  const r = await signUpWithCode({ name: "Neha New", email: `neha-${t}@example.test`, password: "a long pass phrase 42", confirm: "a long pass phrase 42", ip: `10.9.${seq % 250}.${t.length}`, code });
  if (r.status !== "created") throw new Error("expected an account");
  return r;
}

describe("country codes", () => {
  it("joins the picked code to the number, keeping every Indian shape and a typed +", () => {
    expect(joinPhone("91", "98200 11001")).toBe("98200 11001");
    expect(normalizePhone(joinPhone("91", "098200 11001"))).toBe("+919820011001");
    expect(normalizePhone(joinPhone("971", "050 123 4567"))).toBe("+971501234567");
    expect(normalizePhone(joinPhone("44", "07911 123456"))).toBe("+447911123456");
    expect(normalizePhone(joinPhone("1", "(415) 555-0123"))).toBe("+14155550123");
    expect(joinPhone("44", "+91 98200 11001")).toBe("+91 98200 11001");
    expect(joinPhone("", "98200 11001")).toBe("98200 11001");
    expect(joinPhone("44", "")).toBe("");
  });
});

describe("confirming a mobile number at sign-up", () => {
  it("lets a student whose join request is waiting confirm their own number by code", async () => {
    const { admin, uni } = await setupCourse({ name: "Signup Phone U" });
    const { code } = await getJoinSettings(admin);
    const r = await signUp(code);
    expect(r.institute).toEqual({ id: uni.id, slug: uni.slug });

    const actor = await signUpPhoneActor(r.userId, uni.id);
    const phone = freshPhone();
    const d = inlineDefer();
    await startPhoneChange(actor, r.userId, { phone: joinPhone("91", phone.slice(3)), defer: d.defer });
    await d.flush();
    expect((await signUpPhoneStatus(actor, r.userId)).pending).toMatchObject({ attemptsLeft: 5 });
    await verifyPhoneChange(actor, r.userId, { code: codeIn(phone) });

    const [u] = await systemDb().select({ phone: users.phone }).from(users).where(eq(users.id, r.userId));
    expect(u.phone).toBe(phone);
    expect(await signUpPhoneStatus(actor, r.userId)).toEqual({ phone, pending: null });
  });

  it("refuses someone with no role and no join request at that institute", async () => {
    const { uni } = await setupCourse({ name: "Signup Phone Stranger U" });
    const stranger = await makeUser("Stranger Sam");
    await expect(signUpPhoneActor(stranger.id, uni.id)).rejects.toThrow(/once you've joined/);
  });

  it("works only for that person's own number, and for nothing else on the profile", async () => {
    const { admin, uni } = await setupCourse({ name: "Signup Phone Scope U" });
    const { code } = await getJoinSettings(admin);
    const r = await signUp(code);
    const actor = await signUpPhoneActor(r.userId, uni.id);
    const other = await person("Other Student", "student", { universityId: uni.id });
    await expect(startPhoneChange(actor, other.user.id, { phone: freshPhone(), defer: () => {} })).rejects.toThrow(/your own/);
    await expect(updateName(actor, r.userId, "Someone Else")).rejects.toThrow(/access/);
  });
});

describe("departments on the profile", () => {
  it("shows a student the departments they study in, and a HOD their own", async () => {
    const { admin, uni, dept } = await setupCourse({ name: "Profile Dept U" });
    const design = await makeDepartment(uni.id, "DES", "Design");
    const student = await person("Dept Student", "student", { universityId: uni.id });
    await setStudentDepartments(admin, student.user.id, [dept.id, design.id]);
    expect((await myDepartments(await student.actor())).map((d) => d.id).sort()).toEqual([dept.id, design.id].sort());

    const hod = await person("Design Hod", "hod", { universityId: uni.id, departmentId: design.id });
    expect(await myDepartments(await hod.actor())).toEqual([{ id: design.id, name: "Design" }]);

    const none = await person("No Dept Student", "student", { universityId: uni.id });
    await setStudentDepartments(admin, none.user.id, []);
    expect(await myDepartments(await none.actor())).toEqual([]);
  });
});
