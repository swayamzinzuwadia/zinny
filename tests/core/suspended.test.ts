/** Wave 1 integration (zinny-team-panel request): a suspended university is closed to its own people. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { supportSessions, universities } from "@/db/schema";
import { grant, makeUser, setupCourse } from "../fixtures";

const session = vi.hoisted(() => ({ userId: null as string | null, impersonatorUserId: null as string | null }));
vi.mock("@/server/auth/session", () => ({
  currentUserId: async () => session.userId,
  currentSession: async () => (session.userId ? { sessionId: "s", userId: session.userId, impersonatorUserId: session.impersonatorUserId } : null),
}));

const { spaceContext } = await import("@/server/context");

let ctx: Awaited<ReturnType<typeof setupCourse>>;
beforeAll(async () => {
  ctx = await setupCourse({ name: "Paused University" });
});
afterAll(closeDb);

const outcome = async (slug: string) => {
  try {
    await spaceContext(slug);
    return "in";
  } catch (e) {
    return String((e as { digest?: string }).digest ?? e);
  }
};
const setStatus = (status: string) => systemDb().update(universities).set({ status }).where(eq(universities.id, ctx.uni.id));

describe("suspended universities", () => {
  it("lets members in while active", async () => {
    session.userId = ctx.admin.userId;
    expect(await outcome(ctx.uni.slug)).toBe("in");
  });

  it("sends members to the paused page while suspended", async () => {
    await setStatus("suspended");
    session.userId = ctx.admin.userId;
    expect(await outcome(ctx.uni.slug)).toContain(`/suspended?uni=${ctx.uni.slug}`);
  });

  it("still lets the Zinny team in through support mode", async () => {
    await setStatus("suspended");
    const agent = await makeUser("Support Sam");
    await grant(agent.id, "support_agent", {});
    await systemDb()
      .insert(supportSessions)
      .values({ staffUserId: agent.id, universityId: ctx.uni.id, reason: "Suspension review", expiresAt: new Date(Date.now() + 3_600_000) });
    session.userId = agent.id;
    const r = await outcome(ctx.uni.slug);
    await setStatus("active");
    expect(r).toBe("in");
  });

  it("doesn't block a Super Admin signed in as one of its people", async () => {
    await setStatus("suspended");
    const zara = await makeUser("Zara Super");
    await grant(zara.id, "super_admin", {});
    // The session is the Institute Admin's, with the Super Admin behind it.
    session.userId = ctx.admin.userId;
    session.impersonatorUserId = zara.id;
    const inside = await outcome(ctx.uni.slug);
    // The same person on their own session is still kept out.
    session.impersonatorUserId = null;
    const alone = await outcome(ctx.uni.slug);
    await setStatus("active");
    expect(inside).toBe("in");
    expect(alone).toContain(`/suspended?uni=${ctx.uni.slug}`);
  });
});
