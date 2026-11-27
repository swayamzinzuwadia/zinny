/**
 * AUTH-02: one-click demo accounts sign in without a password. With ZINNY_DEMO=1 on a
 * production build that used to include the Zinny Super Admin demo account, which can sign in
 * as anyone at every institute. A production build now never opens a Zinny team account in one
 * click, whatever ZINNY_DEMO says.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { roleAssignments, users } from "@/db/schema";
import { ForbiddenError } from "@/server/errors";
import { availableDemoAccounts, demoSignIn } from "@/modules/identity/auth";

afterEach(() => vi.unstubAllEnvs());
afterAll(closeDb);

/** The demo account by email, made if this test database doesn't have it, with `role` at the platform if it has no role yet. */
async function demoUser(email: string, name: string, platformRole?: "super_admin" | "support_agent") {
  await systemDb().insert(users).values({ email, name }).onConflictDoNothing();
  const [u] = await systemDb().select().from(users).where(eq(users.email, email));
  if (platformRole) {
    const [has] = await systemDb().select().from(roleAssignments).where(and(eq(roleAssignments.userId, u.id), eq(roleAssignments.scopeType, "platform"), isNull(roleAssignments.revokedAt)));
    if (!has) await systemDb().insert(roleAssignments).values({ userId: u.id, role: platformRole, scopeType: "platform" });
  }
  return u;
}

const production = () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("ZINNY_DEMO", "1");
};

describe("AUTH-02: demo shortcuts on a production build", () => {
  it("never sign in to the Zinny team demo accounts, even with ZINNY_DEMO=1", async () => {
    await demoUser("zara@zinny.demo", "Zara Zinny", "super_admin");
    await demoUser("sid@zinny.demo", "Sid Support", "support_agent");
    production();
    await expect(demoSignIn("zara@zinny.demo")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(demoSignIn("SID@zinny.demo")).rejects.toThrow(/password/);
    // And the sign-in page doesn't offer them.
    const offered = (await availableDemoAccounts()).map(([, email]) => email);
    expect(offered).not.toContain("zara@zinny.demo");
    expect(offered).not.toContain("sid@zinny.demo");
  });

  it("never sign in to any demo account that has been given a Zinny team role", async () => {
    const riya = await demoUser("riya@demo.edu", "Riya Sharma");
    const [extra] = await systemDb().insert(roleAssignments).values({ userId: riya.id, role: "support_agent", scopeType: "platform" }).returning();
    try {
      production();
      await expect(demoSignIn("riya@demo.edu")).rejects.toBeInstanceOf(ForbiddenError);
    } finally {
      await systemDb().update(roleAssignments).set({ revokedAt: new Date() }).where(eq(roleAssignments.id, extra.id));
    }
  });

  it("still open institute demo accounts on a demo deployment, and every account in development", async () => {
    const riya = await demoUser("riya@demo.edu", "Riya Sharma");
    production();
    expect(await demoSignIn("riya@demo.edu")).toBe(riya.id);
    vi.unstubAllEnvs();
    const zara = await demoUser("zara@zinny.demo", "Zara Zinny", "super_admin");
    expect(await demoSignIn("zara@zinny.demo")).toBe(zara.id);
  });

  it("open the Zinny team demo accounts only when a demo deployment also sets ZINNY_DEMO_TEAM=1", async () => {
    const zara = await demoUser("zara@zinny.demo", "Zara Zinny", "super_admin");
    const sid = await demoUser("sid@zinny.demo", "Sid Support", "support_agent");
    production();
    vi.stubEnv("ZINNY_DEMO_TEAM", "1");
    expect(await demoSignIn("zara@zinny.demo")).toBe(zara.id);
    expect(await demoSignIn("sid@zinny.demo")).toBe(sid.id);
    const offered = (await availableDemoAccounts()).map(([, email]) => email);
    expect(offered).toEqual(expect.arrayContaining(["zara@zinny.demo", "sid@zinny.demo"]));
  });

  it("ZINNY_DEMO_TEAM alone opens nothing, and any other value is off", async () => {
    await demoUser("zara@zinny.demo", "Zara Zinny", "super_admin");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ZINNY_DEMO", "");
    vi.stubEnv("ZINNY_DEMO_TEAM", "1");
    await expect(demoSignIn("zara@zinny.demo")).rejects.toThrow(/turned off/);
    for (const value of ["true", "yes", "0", ""]) {
      production();
      vi.stubEnv("ZINNY_DEMO_TEAM", value);
      await expect(demoSignIn("zara@zinny.demo"), value).rejects.toThrow(/password/);
      expect((await availableDemoAccounts()).map(([, email]) => email), value).not.toContain("zara@zinny.demo");
    }
  });

  it("are off on a production build without ZINNY_DEMO=1", async () => {
    await demoUser("riya@demo.edu", "Riya Sharma");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ZINNY_DEMO", "");
    await expect(demoSignIn("riya@demo.edu")).rejects.toThrow(/turned off/);
  });
});
