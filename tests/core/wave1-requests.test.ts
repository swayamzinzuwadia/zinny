/** Wave 1 integration: small core requests from the module handoffs. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { enrolments, notifications } from "@/db/schema";
import { confirmPayment } from "@/server/core";
import { buyRecordings, setupCourse } from "../fixtures";

const session = vi.hoisted(() => ({ ctx: null as null | { isAdminUser: boolean; isLearner: boolean } }));
vi.mock("@/server/context", () => ({
  spaceContext: async () => {
    if (!session.ctx) throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login?next=/x;307;" });
    return session.ctx;
  },
}));

const { default: SpaceHome } = await import("@/app/[uni]/page");

let ctx: Awaited<ReturnType<typeof setupCourse>>;
beforeAll(async () => {
  ctx = await setupCourse({ name: "Requests University", pricePaise: 300_000 });
});
afterAll(async () => {
  await closeDb();
});

describe("payment.refund_due says why", () => {
  it("a second paid checkout for the same course says the student already has a place", async () => {
    const student = await ctx.student("Neil Twice");
    // The first checkout runs out, the student buys again, and both payments land.
    const first = await buyRecordings(student, ctx.batch.id);
    await systemDb().update(enrolments).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(eq(enrolments.id, first.enrolmentId));
    const second = await buyRecordings(student, ctx.batch.id);
    expect((await confirmPayment(ctx.uni.id, { orderId: second.orderId, gatewayPaymentId: "pay_2" })).status).toBe("enrolled");
    expect((await confirmPayment(ctx.uni.id, { orderId: first.orderId, gatewayPaymentId: "pay_1" })).status).toBe("refund_due");

    const [n] = await systemDb()
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, student.userId), eq(notifications.kind, "payment.refund_due")));
    expect(n.title).toBe("You already have a place in Data Analytics");
    expect(n.body).not.toMatch(/filled up/);
  });
});

describe("sessions(user_id) index", () => {
  it("exists, for identity's sessions list", async () => {
    const rows = await systemDb().execute<{ indexdef: string }>(
      `select indexdef from pg_indexes where tablename = 'sessions' and indexname = 'sessions_user_idx'` as never,
    );
    expect([...rows][0]?.indexdef).toMatch(/\(user_id\)/);
  });
});

describe("/[uni]", () => {
  const go = async () => {
    try {
      await SpaceHome({ params: Promise.resolve({ uni: "demo" }) });
    } catch (e) {
      return String((e as { digest?: string }).digest);
    }
    return "no redirect";
  };
  it("sends staff to the admin panel and learners to the learner app", async () => {
    session.ctx = { isAdminUser: true, isLearner: true };
    expect(await go()).toContain(";/demo/admin;");
    session.ctx = { isAdminUser: false, isLearner: true };
    expect(await go()).toContain(";/demo/learn;");
  });
  it("leaves signed-out people to spaceContext's sign-in redirect", async () => {
    session.ctx = null;
    expect(await go()).toContain("/login?next=");
  });
});
