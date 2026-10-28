/**
 * Demo data that mirrors the PRD examples: the three Data Analytics batches on
 * page 5 (12 seats left, 5 seats left, Full) and Riya's week on page 6.
 * Everything is created through the real services, as the real roles.
 *
 *   npm run db:seed        (password for every demo account: zinny123)
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { eq, like, or } from "drizzle-orm";
import { closeDb, systemDb } from "./client";
import { roleAssignments, universities, users } from "./schema";
import { loadActor, systemActorFor } from "../server/actor";
import type { Actor } from "../server/authz/engine";
import { addDays, todayIn, weekStart } from "../server/lib/dates";
import { createBatch, facultyExpiryAlerts } from "../server/services/batches";
import { createCourse, updateCourse } from "../server/services/courses";
import { createDepartment, listDepartments } from "../server/services/departments";
import { confirmPayment, holdSeat, requestSwitch } from "../server/services/enrolment";
import { createUniversity } from "../server/services/support";
import { importPeople, linkParent, listPeople } from "../server/services/users";

const PASSWORD = "zinny123";
const SLUG = "demo";

async function upsertStaff(email: string, name: string, role: "super_admin" | "support_agent") {
  const db = systemDb();
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  const u = existing ?? (await db.insert(users).values({ email, name }).returning())[0];
  const [has] = await db.select().from(roleAssignments).where(eq(roleAssignments.userId, u.id));
  if (!has) await db.insert(roleAssignments).values({ userId: u.id, role, scopeType: "platform" });
  return u;
}

async function main() {
  const db = systemDb();
  const today = todayIn("Asia/Kolkata");
  const nextMonday = addDays(weekStart(today), 7);
  const nextSaturday = addDays(nextMonday, 5);
  const runningSince = addDays(weekStart(today), -21);
  const termEnd = addDays(nextMonday, 90);

  console.log("Resetting demo university…");
  await db.delete(universities).where(eq(universities.slug, SLUG));

  const zara = await upsertStaff("zara@zinny.demo", "Zara Zinny", "super_admin");
  await upsertStaff("sid@zinny.demo", "Sid Support", "support_agent");

  const zaraActor = await loadActor(zara.id, null);
  const uni = await createUniversity(zaraActor, {
    name: "Demo University",
    slug: SLUG,
    adminName: "Asha Admin",
    adminEmail: "asha@demo.edu",
    invoicePrefix: "DEMO",
  });
  await db
    .update(universities)
    .set({ gstin: "27AABCD1234E1Z5", legalName: "Demo University Trust", address: "Mumbai, Maharashtra" })
    .where(eq(universities.id, uni.id));

  const [asha] = await db.select().from(users).where(eq(users.email, "asha@demo.edu"));
  const admin = await loadActor(asha.id, uni.id);

  console.log("Departments and people…");
  await createDepartment(admin, { code: "CS", name: "Computer Science" });
  await createDepartment(admin, { code: "MKT", name: "Marketing" });

  const vikramEnds = addDays(today, 10);
  const students = [
    "Riya Sharma", "Kabir Mehta", "Aditi Rao", "Ishaan Gupta", "Meera Nair", "Rohan Das",
    "Sneha Patil", "Arjun Singh", "Zoya Khan", "Tara Iyer", "Neil Joshi", "Diya Kapoor",
  ];
  const csv = [
    "name,email,phone,role,department,access_ends",
    "Bharat Board,bharat@demo.edu,,board_owner,,",
    "Arun Accounts,arun@demo.edu,,accounts_fees,,",
    "Hema Head,hema@demo.edu,,hod,CS,",
    "Mehul Head,mehul@demo.edu,,hod,MKT,",
    "Farah Faculty,farah@demo.edu,,permanent_faculty,CS,",
    "Vikram Visiting,vikram@demo.edu,,visiting_faculty,CS," + vikramEnds,
    "Neel Faculty,neel@demo.edu,,permanent_faculty,MKT,",
    ...students.map((s) => `${s},${s.split(" ")[0].toLowerCase()}@demo.edu,,student,,`),
  ].join("\n");
  const imported = await importPeople(admin, csv, { commit: true });
  if (imported.errors) throw new Error(JSON.stringify(imported.rows.filter((r) => !r.ok)));

  const byEmail = async (email: string) => {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    return u;
  };
  const actorFor = async (email: string): Promise<Actor> => loadActor((await byEmail(email)).id, uni.id);
  const hema = await actorFor("hema@demo.edu");
  const mehul = await actorFor("mehul@demo.edu");
  const farah = await byEmail("farah@demo.edu");
  const vikram = await byEmail("vikram@demo.edu");
  const neel = await byEmail("neel@demo.edu");
  const depts = await listDepartments(admin);
  const cs = depts.find((d) => d.code === "CS")!;
  const mkt = depts.find((d) => d.code === "MKT")!;

  console.log("Courses and batches (PRD page 5)…");
  const da = await createCourse(hema, {
    departmentId: cs.id,
    title: "Data Analytics",
    description: "Excel to SQL to dashboards: analyse real business data end to end.",
    pricePaise: 12_000_00,
  });
  const days = (d: number[], s: string, e: string) => d.map((weekday) => ({ weekday, startTime: s, endTime: e }));
  const daMorning = await createBatch(hema, {
    courseId: da.id, name: "Weekday morning", startDate: nextMonday, endDate: termEnd, seatLimit: 15,
    slots: days([1, 2, 3, 4, 5], "09:00", "11:00"), faculty: [{ userId: farah.id, role: "permanent_faculty" }],
    meetingUrl: "https://meet.google.com/demo-morning",
  });
  const daEvening = await createBatch(hema, {
    courseId: da.id, name: "Weekday evening", startDate: nextMonday, endDate: termEnd, seatLimit: 8,
    slots: days([1, 2, 3, 4, 5], "19:00", "21:00"), faculty: [{ userId: farah.id, role: "permanent_faculty" }],
  });
  const daWeekend = await createBatch(hema, {
    courseId: da.id, name: "Weekend", startDate: nextSaturday, endDate: termEnd, seatLimit: 3,
    slots: days([6, 7], "10:00", "13:00"), faculty: [{ userId: vikram.id, role: "visiting_faculty" }],
  });
  await updateCourse(hema, da.id, { status: "published" });

  const py = await createCourse(hema, {
    departmentId: cs.id,
    title: "Python Basics",
    description: "Programming from zero, with small projects every weekend.",
    pricePaise: 4_000_00,
  });
  const pyWeekend = await createBatch(hema, {
    courseId: py.id, name: "Weekend", startDate: runningSince, endDate: termEnd, seatLimit: 30,
    slots: days([6, 7], "10:00", "13:00"), faculty: [{ userId: farah.id, role: "permanent_faculty" }],
  });
  const pyEvening = await createBatch(hema, {
    courseId: py.id, name: "Weekday evening", startDate: runningSince, endDate: termEnd, seatLimit: 12,
    slots: days([1, 2, 3, 4], "17:00", "19:00"), faculty: [{ userId: farah.id, role: "permanent_faculty" }],
    meetingUrl: "https://meet.google.com/demo-python",
  });
  await updateCourse(hema, py.id, { status: "published" });

  // Running on weekdays, so the Today board always has classes on a weekday.
  const ml = await createCourse(hema, {
    departmentId: cs.id,
    title: "Machine Learning Foundations",
    description: "Regression, classification and model evaluation with Python.",
    pricePaise: 15_000_00,
  });
  const mlMorning = await createBatch(hema, {
    courseId: ml.id, name: "Morning", startDate: runningSince, endDate: termEnd, seatLimit: 10,
    slots: days([1, 2, 3, 4, 5], "10:00", "12:00"), faculty: [{ userId: farah.id, role: "permanent_faculty" }],
    meetingUrl: "https://meet.google.com/demo-ml",
  });
  await updateCourse(hema, ml.id, { status: "published" });

  const dm = await createCourse(mehul, {
    departmentId: mkt.id,
    title: "Digital Marketing",
    description: "Performance marketing, content and analytics for real brands.",
    pricePaise: 8_000_00,
  });
  const dmEvening = await createBatch(mehul, {
    courseId: dm.id, name: "Evening", startDate: runningSince, endDate: termEnd, seatLimit: 25,
    slots: days([2, 4], "19:00", "21:00"), faculty: [{ userId: neel.id, role: "permanent_faculty" }],
  });
  await createBatch(mehul, {
    courseId: dm.id, name: "Saturday intensive", startDate: nextSaturday, endDate: termEnd, seatLimit: 20,
    slots: days([6], "14:00", "18:00"), faculty: [{ userId: neel.id, role: "permanent_faculty" }],
  });
  await updateCourse(mehul, dm.id, { status: "published" });

  console.log("Enrolments, payments and GST invoices…");
  const enrol = async (first: string, batchId: string) => {
    const s = await actorFor(`${first.toLowerCase()}@demo.edu`);
    const r = await holdSeat(s, { batchId, acknowledgeClash: true });
    if (r.status === "held") await confirmPayment(uni.id, { orderId: r.orderId, gatewayPaymentId: `seed_${first}_${batchId.slice(0, 6)}` });
    return r;
  };
  // Riya's week is the PRD page 6 example.
  await enrol("Riya", daMorning.id);
  await enrol("Riya", dmEvening.id);
  await enrol("Riya", pyWeekend.id);
  const kabir = await enrol("Kabir", daMorning.id);
  await enrol("Aditi", daMorning.id); // morning: 3 of 15 → 12 seats left
  for (const s of ["Ishaan", "Meera", "Rohan"]) await enrol(s, daEvening.id); // evening: 3 of 8 → 5 left
  for (const s of ["Sneha", "Arjun", "Zoya"]) await enrol(s, daWeekend.id); // weekend: 3 of 3 → Full
  for (const s of ["Tara", "Neil", "Diya", "Ishaan"]) await enrol(s, pyWeekend.id);
  for (const s of ["Aditi", "Meera", "Tara"]) await enrol(s, dmEvening.id);
  for (const s of ["Ishaan", "Meera", "Rohan", "Sneha", "Arjun", "Zoya", "Tara", "Diya"]) await enrol(s, mlMorning.id); // 8 of 10: almost full
  for (const s of ["Kabir", "Aditi", "Rohan"]) await enrol(s, pyEvening.id);

  // A pending batch switch for Hema to approve.
  if (kabir.status !== "clash") {
    await requestSwitch(await actorFor("kabir@demo.edu"), {
      enrolmentId: kabir.enrolmentId,
      toBatchId: daEvening.id,
      reason: "Started an internship in the mornings",
      acknowledgeClash: true,
    });
  }

  const riya = (await listPeople(admin, "students")).find((p) => p.name === "Riya Sharma")!;
  await linkParent(admin, { studentUserId: riya.id, parentEmail: "pallavi@demo.edu", parentName: "Pallavi Sharma" });

  // Vikram's access ends before the weekend batch does → Hema gets an alert.
  await facultyExpiryAlerts(systemActorFor(uni.id), 14);

  const hash = await bcrypt.hash(PASSWORD, 10);
  await db
    .update(users)
    .set({ passwordHash: hash })
    .where(or(like(users.email, "%@demo.edu"), like(users.email, "%@zinny.demo")));

  console.log(`\nDone. Open http://localhost:3000/login — every demo account uses the password "${PASSWORD}".`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(closeDb);
