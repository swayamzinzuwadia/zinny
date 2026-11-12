/**
 * Demo data: a course on a deal with a code, a lecture, a combo, live batches (starting soon,
 * running, nearly full and full), and a marketplace learner who bought the lecture and a seat.
 * When the second demo institute exists (the Zinny team panel's seed creates it, so from the
 * second seed run on), it gets two live batches of its own so the directory has more than one seller.
 */
import { and, eq } from "drizzle-orm";
import type { SeedContext } from "@/contracts/module";
import { systemDb } from "@/db/client";
import { courses, departments, roleAssignments, universities, users } from "@/db/schema";
import { hashPassword } from "@/server/auth/passwords";
import { confirmPayment, loadActor } from "@/server/core";
import { addDays } from "@/server/lib/dates";
import { createBatch } from "@/server/services/batches";
import { createCourse, updateCourse } from "@/server/services/courses";
import { createDepartment } from "@/server/services/departments";
import { addPerson } from "@/server/services/users";
import { comboSources, createBatchListing, createCode, createCombo, createListing, listableSources } from "./listings";
import { mktLearners, mktListings } from "./schema";
import { startPurchase } from "./service";

export async function seed(ctx: SeedContext) {
  const hema = await ctx.actorFor("hema@demo.edu");
  const sources = await listableSources(hema);
  const whole = sources.find((s) => s.canSellWhole);
  const lecture = sources.flatMap((s) => s.lectures).at(-1);

  const email = "neha@zinny.demo";
  const db = systemDb();
  const [created] = await db
    .insert(users)
    .values({ email, name: "Neha Kulkarni", passwordHash: await hashPassword("zinny123") })
    .onConflictDoNothing()
    .returning({ id: users.id });
  const [neha] = created ? [created] : await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  await db.insert(mktLearners).values({ userId: neha.id }).onConflictDoNothing();

  if (whole && lecture) {
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
    // The first paid order of the demo: the payments seed refunds part of it.
    const { orderId } = await startPurchase(neha.id, single.id);
    await confirmPayment(ctx.universityId, { orderId, gatewayPaymentId: `mock_pay_seed_${orderId.slice(0, 8)}` });
  }

  await seedLiveBatches(ctx, neha.id);
  await seedSecondInstitute(ctx.today).catch((e) => console.log(`  marketplace: skipped the second institute's listings (${e instanceof Error ? e.message : e}).`));
}

/** Seats in the Demo University's own batches: two starting soon, one running, one nearly full and one full. */
async function seedLiveBatches(ctx: SeedContext, buyerId: string) {
  const hema = await ctx.actorFor("hema@demo.edu");
  const mehul = await ctx.actorFor("mehul@demo.edu");
  const live = [
    {
      // Starts next Monday with seats to spare.
      by: hema,
      batch: "Data Analytics / Weekday evening",
      description: "Two hours every weekday evening, taught live. Bring a laptop: you work on real sales and survey data from the first week, and finish with a dashboard of your own.",
      pricePaise: 899_900,
      compareAtPaise: 1_199_900,
      lateJoin: false,
    },
    {
      // Starts next Saturday.
      by: mehul,
      batch: "Digital Marketing / Saturday intensive",
      description: "Four hours every Saturday for working people. Each session ends with a campaign you could run on Monday.",
      pricePaise: 649_900,
      compareAtPaise: null,
      lateJoin: false,
    },
    {
      // Running now, and still taking learners.
      by: hema,
      batch: "Python Basics / Weekday evening",
      description: "Programming from zero in small evening classes. The batch has started; the first weeks are recorded, so late joiners catch up before their first class.",
      pricePaise: 349_900,
      compareAtPaise: null,
      lateJoin: true,
    },
    {
      // Nearly full: 8 of its 10 seats are taken.
      by: hema,
      batch: "Machine Learning Foundations / Morning",
      description: "Regression, classification and model evaluation, taught live every weekday morning with problem sets marked by the faculty.",
      pricePaise: 1_249_900,
      compareAtPaise: null,
      lateJoin: true,
    },
    {
      // Full: shown, but it can't be bought.
      by: hema,
      batch: "Data Analytics / Weekend",
      description: "The weekend batch of Data Analytics, for people who work through the week.",
      pricePaise: 899_900,
      compareAtPaise: null,
      lateJoin: false,
    },
  ];
  const listed = new Map<string, string>();
  for (const { by, batch, ...fields } of live) {
    const batchId = ctx.ids.batches[batch];
    if (!batchId) continue;
    listed.set(batch, (await createBatchListing(by, { batchId, ...fields })).id);
  }

  // Neha takes a seat in the running batch, so her library and her learner app there have classes to join.
  const running = listed.get("Python Basics / Weekday evening");
  if (running) {
    const { orderId } = await startPurchase(buyerId, running);
    await confirmPayment(ctx.universityId, { orderId, gatewayPaymentId: `mock_pay_seed_${orderId.slice(0, 8)}` });
  }
}

/** Two upcoming batches at Riverside College of Commerce, once, if that institute is there. */
async function seedSecondInstitute(today: string) {
  const db = systemDb();
  const [riverside] = await db.select().from(universities).where(and(eq(universities.slug, "riverside"), eq(universities.status, "active")));
  if (!riverside) return;
  const [already] = await db.select({ id: mktListings.id }).from(mktListings).where(eq(mktListings.universityId, riverside.id)).limit(1);
  if (already) return;
  const [admin] = await db
    .select({ userId: roleAssignments.userId })
    .from(roleAssignments)
    .where(and(eq(roleAssignments.universityId, riverside.id), eq(roleAssignments.role, "institute_admin")))
    .limit(1);
  if (!admin) return;

  const sys = await loadActor(admin.userId, riverside.id);
  const [existing] = await db.select().from(departments).where(and(eq(departments.universityId, riverside.id), eq(departments.code, "COM")));
  const dept = existing ?? (await createDepartment(sys, { code: "COM", name: "Commerce" }));
  const title = "GST and Tally for Small Businesses";
  const [had] = await db.select().from(courses).where(and(eq(courses.universityId, riverside.id), eq(courses.title, title)));
  const course =
    had ??
    (await createCourse(sys, {
      departmentId: dept.id,
      title,
      description: "Set up books in Tally, raise GST invoices, file returns and close a month, using the accounts of a real trading firm.",
      pricePaise: 6_000_00,
    }));
  // Batches need someone on the department's teaching staff.
  const teacher = await addPerson(sys, { email: "kavita@riverside.edu", name: "Kavita Menon", role: "permanent_faculty", departmentId: dept.id });
  const evening = await createBatch(sys, {
    courseId: course.id,
    name: "Evening batch",
    startDate: addDays(today, 12),
    endDate: addDays(today, 82),
    seatLimit: 25,
    slots: [1, 3, 5].map((weekday) => ({ weekday, startTime: "18:30", endTime: "20:00" })),
    faculty: [{ userId: teacher, role: "permanent_faculty" }],
    meetingUrl: "https://meet.google.com/demo-riverside",
  });
  const sunday = await createBatch(sys, {
    courseId: course.id,
    name: "Sunday batch",
    startDate: addDays(today, 40),
    endDate: addDays(today, 124),
    seatLimit: 18,
    slots: [{ weekday: 7, startTime: "10:00", endTime: "13:00" }],
    faculty: [{ userId: teacher, role: "permanent_faculty" }],
  });
  await updateCourse(sys, course.id, { status: "published" });
  await createBatchListing(sys, {
    batchId: evening.id,
    description: "Three evenings a week, taught live. For shop owners, accountants in training and anyone who keeps a small firm's books.",
    pricePaise: 499_900,
    compareAtPaise: 649_900,
  });
  await createBatchListing(sys, {
    batchId: sunday.id,
    description: "The same course on Sunday mornings, for people who work six days a week.",
    pricePaise: 499_900,
  });
}
