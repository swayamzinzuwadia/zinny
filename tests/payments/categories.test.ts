/** Invoice categories: made by the institute, unique by name, archived instead of deleted. "Course fees" is built in. */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { archiveCategory, COURSE_FEES_ID, createCategory, listCategories, restoreCategory, updateCategory } from "@/modules/payments/categories";
import { createManualInvoice } from "@/modules/payments/manual-invoices";
import { paidCourse } from "./helpers";

afterAll(closeDb);

const exam = { name: "Exam fees", description: "Semester exams", defaultGstRateBp: 0, sacCode: "999294" };

describe("invoice categories", () => {
  it("always has the built-in Course fees, then the institute's own by name", async () => {
    const c = await paidCourse("Category List U");
    expect(await listCategories(c.accounts)).toEqual([expect.objectContaining({ id: COURSE_FEES_ID, name: "Course fees", builtIn: true, archived: false })]);
    await createCategory(c.accounts, { name: "workshop", defaultGstRateBp: 1800 });
    const made = await createCategory(c.accounts, exam);
    expect(made).toMatchObject({ name: "Exam fees", description: "Semester exams", defaultGstRateBp: 0, sacCode: "999294", archivedAt: null, createdBy: c.accounts.userId });
    const list = await listCategories(c.board);
    expect(list.map((x) => x.name)).toEqual(["Course fees", "Exam fees", "workshop"]);
    expect(list[1]).toMatchObject({ id: made.id, builtIn: false, defaultGstRateBp: 0, sacCode: "999294", invoices: 0 });
    expect(list[2].sacCode).toBeNull();
  });

  it("refuses a name already in use (whatever the capitals), the built-in name, and bad values, saying how to fix them", async () => {
    const c = await paidCourse("Category Rules U");
    await createCategory(c.accounts, exam);
    await expect(createCategory(c.accounts, { ...exam, name: "  EXAM   fees " })).rejects.toThrow(/already a category called EXAM fees/);
    await expect(createCategory(c.accounts, { ...exam, name: "exam fees" })).rejects.toBeInstanceOf(ConflictError);
    await expect(createCategory(c.accounts, { ...exam, name: "course FEES" })).rejects.toThrow(/Course fees is built in/);
    await expect(createCategory(c.accounts, { ...exam, name: "X" })).rejects.toThrow(/at least 2 characters/);
    await expect(createCategory(c.accounts, { ...exam, name: "Hostel", defaultGstRateBp: 1700 })).rejects.toThrow(/0, 5, 12, 18 or 28%/);
    await expect(createCategory(c.accounts, { ...exam, name: "Hostel", sacCode: "1234" })).rejects.toThrow(/starts with 99/);
    await expect(createCategory(c.accounts, { ...exam, name: "H".repeat(61) })).rejects.toBeInstanceOf(ValidationError);
    // The same name is free in another institute.
    const other = await paidCourse("Category Rules Other U");
    await expect(createCategory(other.accounts, exam)).resolves.toMatchObject({ name: "Exam fees" });
  });

  it("renames and changes defaults, with before and after in the audit log", async () => {
    const c = await paidCourse("Category Update U");
    const made = await createCategory(c.accounts, exam);
    await createCategory(c.accounts, { name: "Hostel", defaultGstRateBp: 1200 });
    const saved = await updateCategory(c.admin, made.id, { name: "Examination fees", description: "", defaultGstRateBp: 500, sacCode: "" });
    expect(saved).toMatchObject({ name: "Examination fees", description: "", defaultGstRateBp: 500, sacCode: null });
    // Changing only the capitals of its own name is fine; taking another's name isn't.
    await expect(updateCategory(c.admin, made.id, { name: "EXAMINATION FEES", defaultGstRateBp: 500 })).resolves.toMatchObject({ name: "EXAMINATION FEES" });
    await expect(updateCategory(c.admin, made.id, { name: "hostel", defaultGstRateBp: 500 })).rejects.toBeInstanceOf(ConflictError);
    await expect(updateCategory(c.admin, COURSE_FEES_ID, { name: "Tuition", defaultGstRateBp: 500 })).rejects.toThrow(/built in/);
    await expect(updateCategory(c.admin, "not-an-id", { name: "Tuition", defaultGstRateBp: 500 })).rejects.toBeInstanceOf(NotFoundError);

    const [log] = await systemDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, made.id), eq(auditLog.action, "invoice_category.update")))
      .orderBy(auditLog.at)
      .limit(1);
    expect(log.data).toMatchObject({ before: { name: "Exam fees", defaultGstRateBp: 0, sacCode: "999294" }, after: { name: "Examination fees", defaultGstRateBp: 500, sacCode: null } });
  });

  it("archives and restores: archived categories stay on old invoices but can't be picked for new ones", async () => {
    const c = await paidCourse("Category Archive U");
    const made = await createCategory(c.accounts, exam);
    const old = await createManualInvoice(c.accounts, { categoryId: made.id, buyerName: "Walk-in Candidate", lines: [{ description: "Exam fee", quantity: 1, unitPricePaise: 50_000 }] });

    await archiveCategory(c.accounts, made.id);
    expect((await listCategories(c.accounts)).map((x) => x.name)).toEqual(["Course fees"]);
    const all = await listCategories(c.accounts, { includeArchived: true });
    expect(all.find((x) => x.id === made.id)).toMatchObject({ archived: true, invoices: 1 });
    expect(old.categoryId).toBe(made.id);

    await expect(createManualInvoice(c.accounts, { categoryId: made.id, buyerName: "Someone New", lines: [{ description: "Exam fee", quantity: 1, unitPricePaise: 50_000 }] })).rejects.toThrow(
      /Exam fees is archived, so it can't be used for a new invoice/,
    );
    await expect(updateCategory(c.accounts, made.id, exam)).rejects.toThrow(/Restore it before changing it/);
    await expect(archiveCategory(c.accounts, COURSE_FEES_ID)).rejects.toThrow(/built in/);

    // The name is free again while it's archived; restoring is refused until it's free once more.
    const second = await createCategory(c.accounts, exam);
    await expect(restoreCategory(c.accounts, made.id)).rejects.toThrow(/Another category is called Exam fees now/);
    await updateCategory(c.accounts, second.id, { ...exam, name: "Exam fees 2027" });
    await expect(restoreCategory(c.accounts, made.id)).resolves.toMatchObject({ archivedAt: null });
    await expect(createManualInvoice(c.accounts, { categoryId: made.id, buyerName: "Someone New", lines: [{ description: "Exam fee", quantity: 1, unitPricePaise: 50_000 }] })).resolves.toMatchObject({
      categoryId: made.id,
    });
  });

  it("permissions: finance.view reads, only finance.manage changes", async () => {
    const c = await paidCourse("Category Perms U");
    const student = await c.student("Category Student");
    const made = await createCategory(c.accounts, exam);
    // Allowed: Accounts & Fees and the Institute Admin change; Board / Owner reads.
    await expect(listCategories(c.board)).resolves.toHaveLength(2);
    await expect(createCategory(c.admin, { name: "Library", defaultGstRateBp: 0 })).resolves.toMatchObject({ name: "Library" });
    // Denied.
    for (const who of [c.faculty, student]) await expect(listCategories(who)).rejects.toBeInstanceOf(ForbiddenError);
    for (const who of [c.board, c.faculty, student]) {
      await expect(createCategory(who, { name: "Sports", defaultGstRateBp: 0 })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(updateCategory(who, made.id, { ...exam, name: "Renamed" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(archiveCategory(who, made.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(restoreCategory(who, made.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
    // Another institute's Accounts can't touch it: it isn't there for them.
    const other = await paidCourse("Category Perms Other U");
    await expect(archiveCategory(other.accounts, made.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listCategories(c.accounts)).map((x) => x.name)).toEqual(["Course fees", "Exam fees", "Library"]);
  });
});
