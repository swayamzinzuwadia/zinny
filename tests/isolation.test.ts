import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { appDb, closeDb, systemDb } from "@/db/client";
import { auditLog, courses, departments, users } from "@/db/schema";
import { loadActor } from "@/server/actor";
import { listDepartments } from "@/server/services/departments";
import { createCourse } from "@/server/services/courses";
import { enterSupportMode, exitSupportMode } from "@/server/services/support";
import { withTenant } from "@/server/tenant";
import { grant, makeDepartment, makeUniversity, makeUser, person } from "./fixtures";

/** Drizzle wraps Postgres errors; the database's own message is on `cause`. */
async function dbError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const err = e as Error & { cause?: Error };
    return err.cause?.message ?? err.message;
  }
  throw new Error("expected the database to refuse");
}

let A: Awaited<ReturnType<typeof makeUniversity>>;
let B: Awaited<ReturnType<typeof makeUniversity>>;
let deptA: { id: string };
let deptB: { id: string };

beforeAll(async () => {
  A = await makeUniversity("Alpha University");
  B = await makeUniversity("Beta University");
  deptA = await makeDepartment(A.id, "CS", "Computer Science");
  deptB = await makeDepartment(B.id, "CS", "Computer Science");
});
afterAll(closeDb);

describe("PRD page 9: each university's data is fully separate", () => {
  it("a query with no filter at all still only sees its own university", async () => {
    const adminA = await (await person("Admin A", "institute_admin", { universityId: A.id })).actor();
    const rows = await withTenant(adminA, (tx) => tx.select().from(departments));
    expect(rows.map((r) => r.id)).toEqual([deptA.id]);
  });

  it("people from another university are invisible", async () => {
    const bStudent = await makeUser("Beta Student");
    await grant(bStudent.id, "student", { universityId: B.id });
    const adminA = await (await person("Admin A2", "institute_admin", { universityId: A.id })).actor();
    const visible = await withTenant(adminA, (tx) => tx.select({ id: users.id }).from(users));
    expect(visible.map((v) => v.id)).not.toContain(bStudent.id);
  });

  it("writing a row into another university is rejected by the database", async () => {
    const adminA = await (await person("Admin A3", "institute_admin", { universityId: A.id })).actor();
    const msg = await dbError(
      withTenant(adminA, (tx) => tx.insert(courses).values({ universityId: B.id, departmentId: deptB.id, title: "Sneaky" })),
    );
    expect(msg).toMatch(/row-level security/);
  });

  it("without a university set, the app sees nothing", async () => {
    const rows = await appDb().select().from(departments);
    expect(rows).toHaveLength(0);
  });

  it("the audit log is append-only for the app", async () => {
    const adminA = await (await person("Admin A4", "institute_admin", { universityId: A.id })).actor();
    expect(await dbError(withTenant(adminA, (tx) => tx.delete(auditLog)))).toMatch(/permission denied/);
    expect(await dbError(withTenant(adminA, (tx) => tx.update(auditLog).set({ action: "x" })))).toMatch(/permission denied/);
  });

  it("services check scope before touching data", async () => {
    const adminA = await (await person("Admin A5", "institute_admin", { universityId: A.id })).actor();
    // Even if an id from another university leaks into a request, it resolves to nothing.
    const depts = await listDepartments(adminA);
    expect(depts.map((d) => d.id)).toEqual([deptA.id]);
    await expect(createCourse(adminA, { departmentId: deptB.id, title: "Cross-tenant", pricePaise: 0 })).rejects.toThrow(/Department not found/);
  });
});

describe("PRD page 9: Zinny team access only through support mode", () => {
  it("logs who, what and when", async () => {
    const staff = await makeUser("Support Sam");
    await grant(staff.id, "support_agent");

    const outside = await loadActor(staff.id, A.id);
    await expect(listDepartments(outside)).resolves.toEqual([]);

    const platform = await loadActor(staff.id, null);
    const session = await enterSupportMode(platform, A.id, "Admin asked for help with batches");
    const inside = await loadActor(staff.id, A.id);
    expect(inside.supportSessionId).toBe(session.id);

    const course = await createCourse(inside, { departmentId: deptA.id, title: "Fixed by support", pricePaise: 0 });
    const log = await systemDb()
      .select()
      .from(auditLog)
      .where(sql`${auditLog.entityId} = ${course.id}`);
    expect(log[0]).toMatchObject({ actorUserId: staff.id, supportSessionId: session.id, action: "course.create" });

    await exitSupportMode(platform, session.id);
    const after = await loadActor(staff.id, A.id);
    expect(after.supportSessionId).toBeNull();
    await expect(listDepartments(after)).resolves.toEqual([]);
  });

  it("people without a Zinny team role can't enter support mode", async () => {
    const someone = await makeUser("Not Staff");
    await expect(enterSupportMode(await loadActor(someone.id, null), A.id, "just looking")).rejects.toThrow(/access/);
  });
});
