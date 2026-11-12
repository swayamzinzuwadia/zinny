/**
 * Invoice categories (pay_invoice_categories): the institute's own headings for what it
 * bills (Exam fees, Hostel, Library…), each with the GST rate and SAC code new invoices
 * in it start with.
 *
 *  - "Course fees" is built in: every order invoice belongs to it. It has no row, so it
 *    can't be renamed, archived or duplicated.
 *  - Names are unique per institute among live categories, whatever the capitals.
 *  - Archiving keeps the category on the invoices that used it; it just can't be picked
 *    for a new invoice. Restoring brings it back if the name is still free.
 *
 * Reading needs `finance.view`; every change needs `finance.manage` and is audited.
 */
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { assertCan, audit, withTenant, type Actor } from "@/server/core";
import { ConflictError, isUniqueViolation, NotFoundError, ValidationError } from "@/server/errors";
import { UUID_RE, uni } from "./internal";
import { payInvoiceCategories, payManualInvoices } from "./schema";
import { SAC_RE } from "./settings";

/** The id the built-in category goes by in filters and forms. */
export const COURSE_FEES_ID = "course-fees";
export const COURSE_FEES_NAME = "Course fees";

export const GST_RATES_BP = [0, 500, 1200, 1800, 2800] as const;
export const NAME_MAX = 60;
export const DESCRIPTION_MAX = 200;

export type CategoryRow = typeof payInvoiceCategories.$inferSelect;

export type Category = {
  /** A uuid, or "course-fees" for the built-in one. */
  id: string;
  name: string;
  description: string;
  defaultGstRateBp: number;
  /** Null = the institute's SAC code from invoice settings. */
  sacCode: string | null;
  builtIn: boolean;
  archived: boolean;
  /** Manual invoices in this category (order invoices aren't counted here). */
  invoices: number;
};

export type CategoryInput = { name: string; description?: string; defaultGstRateBp: number; sacCode?: string | null };

function clean(input: CategoryInput) {
  const name = input.name.replace(/\s+/g, " ").trim();
  if (name.length < 2) throw new ValidationError("Give the category a name of at least 2 characters, like Exam fees.");
  if (name.length > NAME_MAX) throw new ValidationError(`Keep the category name under ${NAME_MAX} characters.`);
  if (name.toLowerCase() === COURSE_FEES_NAME.toLowerCase()) {
    throw new ValidationError("Course fees is built in and already exists. Pick a different name.");
  }
  const description = (input.description ?? "").replace(/\s+/g, " ").trim();
  if (description.length > DESCRIPTION_MAX) throw new ValidationError(`Keep the description under ${DESCRIPTION_MAX} characters.`);
  if (!(GST_RATES_BP as readonly number[]).includes(input.defaultGstRateBp)) throw new ValidationError("Pick a GST rate of 0, 5, 12, 18 or 28%.");
  const sacCode = (input.sacCode ?? "").replace(/\s+/g, "") || null;
  if (sacCode && !SAC_RE.test(sacCode)) throw new ValidationError("A SAC code for services has 4 or 6 digits and starts with 99, like 999299. Leave it empty to use the institute's code.");
  return { name, description, defaultGstRateBp: input.defaultGstRateBp, sacCode };
}

async function assertNameFree(tx: Tx, name: string, exceptId?: string) {
  const [clash] = await tx
    .select({ id: payInvoiceCategories.id })
    .from(payInvoiceCategories)
    .where(and(sql`lower(${payInvoiceCategories.name}) = ${name.toLowerCase()}`, isNull(payInvoiceCategories.archivedAt), exceptId ? ne(payInvoiceCategories.id, exceptId) : undefined))
    .limit(1);
  if (clash) throw new ConflictError(`There's already a category called ${name}. Use that one, or pick a different name.`);
}

async function load(tx: Tx, id: string): Promise<CategoryRow> {
  if (id === COURSE_FEES_ID) throw new ValidationError("Course fees is built in, so it can't be changed or archived.");
  if (!UUID_RE.test(id)) throw new NotFoundError("Category");
  const [row] = await tx.select().from(payInvoiceCategories).where(eq(payInvoiceCategories.id, id)).for("update");
  if (!row) throw new NotFoundError("Category");
  return row;
}

/** The built-in category, then the institute's own by name. Archived ones only when asked for. Needs `finance.view`. */
export async function listCategories(actor: Actor, opts: { includeArchived?: boolean } = {}): Promise<Category[]> {
  assertCan(actor, "finance.view", { universityId: uni(actor) });
  return withTenant(actor, (tx) => categoriesIn(tx, opts));
}

/** Same as listCategories, inside an open tenant transaction (the caller has checked `finance.view`). */
export async function categoriesIn(tx: Tx, opts: { includeArchived?: boolean } = {}): Promise<Category[]> {
  const rows = await tx
    .select({
      c: payInvoiceCategories,
      // Spelled out: without a join Drizzle leaves column names bare, and "id" would mean the invoice's.
      invoices: sql<number>`(select count(*)::int from pay_manual_invoices m where m.category_id = "pay_invoice_categories"."id")`,
    })
    .from(payInvoiceCategories)
    .where(opts.includeArchived ? undefined : isNull(payInvoiceCategories.archivedAt))
    .orderBy(asc(sql`lower(${payInvoiceCategories.name})`));
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(payManualInvoices).where(isNull(payManualInvoices.categoryId));
  return [
    { id: COURSE_FEES_ID, name: COURSE_FEES_NAME, description: "Built in. Every course and marketplace order is invoiced here.", defaultGstRateBp: 1800, sacCode: null, builtIn: true, archived: false, invoices: n },
    ...rows.map(({ c, invoices }) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      defaultGstRateBp: c.defaultGstRateBp,
      sacCode: c.sacCode,
      builtIn: false,
      archived: c.archivedAt !== null,
      invoices,
    })),
  ];
}

/** Needs `finance.manage`. */
export async function createCategory(actor: Actor, input: CategoryInput): Promise<CategoryRow> {
  assertCan(actor, "finance.manage", { universityId: uni(actor) });
  const v = clean(input);
  return withTenant(actor, async (tx) => {
    await assertNameFree(tx, v.name);
    const [row] = await tx
      .insert(payInvoiceCategories)
      .values({ universityId: uni(actor), ...v, createdBy: actor.userId || null })
      .returning();
    await audit(tx, actor, "invoice_category.create", "pay_invoice_category", row.id, v);
    return row;
  }).catch((e) => {
    if (isUniqueViolation(e)) throw new ConflictError(`There's already a category called ${v.name}. Use that one, or pick a different name.`);
    throw e;
  });
}

/** Renames a category or changes its description, default GST rate or SAC code. Needs `finance.manage`. Invoices already issued keep their own rate and code. */
export async function updateCategory(actor: Actor, id: string, input: CategoryInput): Promise<CategoryRow> {
  assertCan(actor, "finance.manage", { universityId: uni(actor) });
  const v = clean(input);
  return withTenant(actor, async (tx) => {
    const before = await load(tx, id);
    if (before.archivedAt) throw new ValidationError("This category is archived. Restore it before changing it.");
    await assertNameFree(tx, v.name, id);
    const [row] = await tx
      .update(payInvoiceCategories)
      .set({ ...v, updatedAt: new Date() })
      .where(eq(payInvoiceCategories.id, id))
      .returning();
    await audit(tx, actor, "invoice_category.update", "pay_invoice_category", id, {
      before: { name: before.name, description: before.description, defaultGstRateBp: before.defaultGstRateBp, sacCode: before.sacCode },
      after: v,
    });
    return row;
  }).catch((e) => {
    if (isUniqueViolation(e)) throw new ConflictError(`There's already a category called ${v.name}. Use that one, or pick a different name.`);
    throw e;
  });
}

/** Archived categories stay on their invoices but can't be picked for new ones. Needs `finance.manage`. */
export async function archiveCategory(actor: Actor, id: string): Promise<CategoryRow> {
  assertCan(actor, "finance.manage", { universityId: uni(actor) });
  return withTenant(actor, async (tx) => {
    const before = await load(tx, id);
    if (before.archivedAt) return before;
    const [row] = await tx.update(payInvoiceCategories).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(payInvoiceCategories.id, id)).returning();
    await audit(tx, actor, "invoice_category.archive", "pay_invoice_category", id, { name: before.name });
    return row;
  });
}

/** Needs `finance.manage`. Refused when a live category took the name meanwhile. */
export async function restoreCategory(actor: Actor, id: string): Promise<CategoryRow> {
  assertCan(actor, "finance.manage", { universityId: uni(actor) });
  return withTenant(actor, async (tx) => {
    const before = await load(tx, id);
    if (!before.archivedAt) return before;
    const [clash] = await tx
      .select({ id: payInvoiceCategories.id })
      .from(payInvoiceCategories)
      .where(and(sql`lower(${payInvoiceCategories.name}) = ${before.name.toLowerCase()}`, isNull(payInvoiceCategories.archivedAt)))
      .limit(1);
    if (clash) throw new ConflictError(`Another category is called ${before.name} now. Rename that one first, then restore this.`);
    const [row] = await tx.update(payInvoiceCategories).set({ archivedAt: null, updatedAt: new Date() }).where(eq(payInvoiceCategories.id, id)).returning();
    await audit(tx, actor, "invoice_category.restore", "pay_invoice_category", id, { name: before.name });
    return row;
  });
}
