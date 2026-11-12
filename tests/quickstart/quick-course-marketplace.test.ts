/** The New course page's last steps: the batch incharge and a live batch listing on the marketplace, in the same transaction. */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, systemDb } from "@/db/client";
import { batches, courses, departments, users } from "@/db/schema";
import { ROLE_GRANTS } from "@/server/authz/roles";
import type { Actor } from "@/server/authz/engine";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { createCourseQuickly, type QuickCourseInput } from "@/server/services/quick-course";
import { setupChecklist } from "@/server/services/setup";
import { mktListings } from "@/modules/marketplace/schema";
import { makeDepartment, makeUniversity, person, slots, uniqueCode } from "../fixtures";

const BATCH = { name: "Batch 1", startDate: "2031-01-06", endDate: "2031-03-30", seatLimit: 30, slots: slots([1, 3, 5], "10:00", "11:00") };
const base = (over: Partial<QuickCourseInput> = {}): QuickCourseInput => ({ title: "Spoken English", pricePaise: 0, ...over });

async function failure(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (err) => err,
  );
  expect(e).toBeInstanceOf(ValidationError);
  return { section: (e.details as { section?: string } | undefined)?.section, message: e.message as string };
}

afterAll(closeDb);

describe("selling a seat in the first batch", () => {
  let uniId: string;
  let slug: string;
  let admin: Actor;

  beforeAll(async () => {
    const u = await makeUniversity("Market Quick U");
    uniId = u.id;
    slug = u.slug;
    admin = await (await person("Market Admin", "institute_admin", { universityId: uniId })).actor();
  });

  it("lists the batch on the marketplace in the same step, and the checklist counts it", async () => {
    const before = await setupChecklist(admin, slug);
    expect(before!.items.find((i) => i.key === "marketplace")!.done).toBe(false);
    const r = await createCourseQuickly(
      admin,
      base({ newDepartmentName: "Languages", batch: BATCH, teachMyself: true, publish: true, marketplace: { pricePaise: 199_900, lateJoin: true } }),
    );
    expect(r.listingId).not.toBeNull();
    const [listing] = await systemDb().select().from(mktListings).where(eq(mktListings.id, r.listingId!));
    expect(listing).toMatchObject({ kind: "batch", batchId: r.batchId, courseId: r.courseId, pricePaise: 199_900, status: "live", lateJoin: true, title: "Spoken English" });
    const after = await setupChecklist(admin, slug);
    expect(after!.items.find((i) => i.key === "marketplace")!.done).toBe(true);
  });

  it("doesn't list anything when the option is off", async () => {
    const r = await createCourseQuickly(admin, base({ newDepartmentName: "Arts", title: "Painting", batch: BATCH, teachMyself: true }));
    expect(r.listingId).toBeNull();
    expect(await systemDb().select().from(mktListings).where(eq(mktListings.courseId, r.courseId))).toHaveLength(0);
  });

  it("needs a batch and a price of at least ₹1, named in the last section", async () => {
    expect((await failure(createCourseQuickly(admin, base({ newDepartmentName: "X1", marketplace: { pricePaise: 50_000 } })))).section).toBe("publish");
    const cheap = await failure(createCourseQuickly(admin, base({ newDepartmentName: "X2", batch: BATCH, teachMyself: true, marketplace: { pricePaise: 50 } })));
    expect(cheap.section).toBe("publish");
    expect(cheap.message).toMatch(/at least ₹1/);
  });

  it("rolls the whole course back when the marketplace refuses the listing", async () => {
    // Listing titles stop at 120 characters; a longer course title passes the course's own
    // rules, so the marketplace refuses it inside the transaction, after everything else is written.
    const title = `Rollback ${uniqueCode()} ${"long ".repeat(25)}`.trim();
    const e = await failure(createCourseQuickly(admin, base({ title, newDepartmentName: "Rollback Dept", batch: BATCH, teachMyself: true, marketplace: { pricePaise: 10_000 } })));
    expect(e.section).toBe("publish");
    expect(await systemDb().select().from(courses).where(eq(courses.title, title))).toHaveLength(0);
    expect(await systemDb().select().from(departments).where(eq(departments.name, "Rollback Dept"))).toHaveLength(0);
  });
});

describe("marketplace listing permissions", () => {
  let uniId: string;
  let deptId: string;
  let hod: Actor;

  beforeAll(async () => {
    uniId = (await makeUniversity("Market Perm U")).id;
    deptId = (await makeDepartment(uniId, uniqueCode("M"), "Management")).id;
    hod = await (await person("Hod Market", "hod", { universityId: uniId, departmentId: deptId })).actor();
  });

  it("a HOD lists a batch of their own department (allow)", async () => {
    const r = await createCourseQuickly(hod, base({ departmentId: deptId, batch: BATCH, teachMyself: true, marketplace: { pricePaise: 99_900 } }));
    expect(r.listingId).not.toBeNull();
  });

  it("someone who can create courses but not change them can't list (deny), and nothing is saved", async () => {
    // A HOD whose institute took "change courses" away from the role.
    const limited: Actor = { ...hod, assignments: hod.assignments.map((a) => ({ ...a, grants: ROLE_GRANTS.hod.filter((g) => g !== "course.update") })) };
    const title = `No list ${uniqueCode()}`;
    await expect(createCourseQuickly(limited, base({ title, departmentId: deptId, batch: BATCH, teachMyself: true, marketplace: { pricePaise: 99_900 } }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await systemDb().select().from(courses).where(eq(courses.title, title))).toHaveLength(0);
  });
});

describe("batch incharge", () => {
  let uniId: string;
  let admin: Actor;
  let deptId: string;
  let facultyId: string;

  beforeAll(async () => {
    uniId = (await makeUniversity("Incharge U")).id;
    admin = await (await person("Incharge Admin", "institute_admin", { universityId: uniId })).actor();
    deptId = (await makeDepartment(uniId, uniqueCode("I"), "Physics")).id;
    facultyId = (await person("Faculty Ira", "permanent_faculty", { universityId: uniId, departmentId: deptId })).user.id;
  });

  const inchargeOf = async (batchId: string) => (await systemDb().select().from(batches).where(eq(batches.id, batchId)))[0].inchargeUserId;

  it("defaults to the person themselves when they teach it", async () => {
    const r = await createCourseQuickly(admin, base({ departmentId: deptId, batch: BATCH, teacherIds: [facultyId], teachMyself: true }));
    expect(await inchargeOf(r.batchId!)).toBe(admin.userId);
  });

  it("defaults to the teacher otherwise", async () => {
    const r = await createCourseQuickly(admin, base({ departmentId: deptId, title: "Optics", batch: BATCH, teacherIds: [facultyId] }));
    expect(await inchargeOf(r.batchId!)).toBe(facultyId);
  });

  it("can be a teacher added on the same page", async () => {
    const email = `nina.${uniqueCode().toLowerCase()}@quick.test`;
    const r = await createCourseQuickly(
      admin,
      base({ departmentId: deptId, title: "Waves", batch: BATCH, teacherIds: [facultyId], newTeachers: [{ name: "Nina Rao", email }], incharge: `new:${email}` }),
    );
    const [nina] = await systemDb().select().from(users).where(eq(users.email, email));
    expect(await inchargeOf(r.batchId!)).toBe(nina.id);
  });

  it("must be someone who may run the batch", async () => {
    const outsider = await person("Not Staff", "student", { universityId: uniId });
    const e = await failure(createCourseQuickly(admin, base({ departmentId: deptId, title: "Heat", batch: BATCH, teacherIds: [facultyId], incharge: outsider.user.id })));
    expect(e.section).toBe("teachers");
  });
});
