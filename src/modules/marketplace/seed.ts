/** Demo data: a course on a deal with a code, a lecture, a combo, and a marketplace learner who bought the lecture. */
import { eq } from "drizzle-orm";
import type { SeedContext } from "@/contracts/module";
import { systemDb } from "@/db/client";
import { users } from "@/db/schema";
import { hashPassword } from "@/server/auth/passwords";
import { confirmPayment } from "@/server/core";
import { comboSources, createCode, createCombo, createListing, listableSources } from "./listings";
import { mktLearners } from "./schema";
import { startPurchase } from "./service";

export async function seed(ctx: SeedContext) {
  const hema = await ctx.actorFor("hema@demo.edu");
  const sources = await listableSources(hema);
  const whole = sources.find((s) => s.canSellWhole);
  const lecture = sources.flatMap((s) => s.lectures).at(-1);
  if (!whole || !lecture) return;

  const course = await createListing(hema, {
    kind: "course",
    sourceId: whole.id,
    title: `${whole.title}: the full recordings`,
    description: "Every recorded lesson of this course, yours to watch at your own pace. The recordings come from our live batches, so you hear real questions from real students.",
    pricePaise: 349_900,
    compareAtPaise: 499_900,
  });
  await createCode(hema, { code: "WELCOME10", kind: "percent", value: 10, listingId: course.id });
  const forCombo = (await comboSources(hema)).slice(0, 2);
  if (forCombo.length === 2) {
    await createCombo(hema, {
      courseIds: forCombo.map((c) => c.id),
      title: `${forCombo[0].title} + ${forCombo[1].title}`,
      description: "Both courses' recordings together, for less than buying them one by one.",
      pricePaise: 449_900,
      compareAtPaise: 699_900,
    });
  }
  const single = await createListing(hema, {
    kind: "lecture",
    sourceId: lecture.id,
    title: lecture.title,
    description: "One lecture from our recorded catalogue, for when you want this topic and nothing else.",
    pricePaise: 29_900,
  });

  const email = "neha@zinny.demo";
  const db = systemDb();
  const [created] = await db
    .insert(users)
    .values({ email, name: "Neha Kulkarni", passwordHash: await hashPassword("zinny123") })
    .onConflictDoNothing()
    .returning({ id: users.id });
  const [neha] = created ? [created] : await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  await db.insert(mktLearners).values({ userId: neha.id }).onConflictDoNothing();

  const { orderId } = await startPurchase(neha.id, single.id);
  await confirmPayment(ctx.universityId, { orderId, gatewayPaymentId: `mock_pay_seed_${orderId.slice(0, 8)}` });
}
