/**
 * Plans (/platform/plans): what Zinny sells and at what fixed price. A licence stores a
 * plan's key and copies its price when it is made, so changing a plan here only affects
 * licences and invoices made afterwards.
 *
 * Anyone with platform.licences can read the plans; only a Super Admin changes them.
 * Pilot, Standard and Enterprise are created the first time the plans are read on an
 * empty table, so they exist without a seed.
 */
import { asc, count, eq } from "drizzle-orm";
import type { Conn } from "@/db/client";
import { assertPlatform, type Actor } from "@/server/core";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { platLicences, platPlans } from "../schema";
import { assertSuperAdmin } from "../lib/access";
import { DEFAULT_GST_BP, GST_RATES_BP, LICENSABLE_MODULES } from "../lib/constants";
import { db, isUniqueViolation, isUuid, logAction } from "./shared";

export type Plan = typeof platPlans.$inferSelect;

/** What a form needs to prefill a licence from a plan. Safe to send to the browser. */
export type PlanOption = {
  key: string;
  name: string;
  description: string;
  pricePaise: number;
  billingMonths: number;
  studentCap: number;
  staffCap: number;
  modules: string[];
  gstRateBp: number;
  archived: boolean;
};

export type PlanInput = {
  /** Only read when creating. Left empty, it is made from the name. */
  key?: string;
  name: string;
  description?: string | null;
  pricePaise: number;
  billingMonths: number;
  studentCap: number;
  staffCap: number;
  modules: string[];
  gstRateBp?: number;
  sortOrder?: number;
};

const ALL_MODULES = LICENSABLE_MODULES.map((m) => m.id);

/** The three plans every Zinny has. Prices are before GST for the whole period. */
export const DEFAULT_PLANS: (Required<Omit<PlanInput, "description">> & { description: string })[] = [
  {
    key: "pilot",
    name: "Pilot",
    description: "A term to try Zinny with one or two departments.",
    pricePaise: 45_000_00,
    billingMonths: 3,
    studentCap: 100,
    staffCap: 10,
    modules: ALL_MODULES.filter((m) => m !== "website-builder" && m !== "gamification"),
    gstRateBp: DEFAULT_GST_BP,
    sortOrder: 10,
  },
  {
    key: "standard",
    name: "Standard",
    description: "The whole institute for a year, every module included.",
    pricePaise: 7_20_000_00,
    billingMonths: 12,
    studentCap: 1000,
    staffCap: 60,
    modules: ALL_MODULES,
    gstRateBp: DEFAULT_GST_BP,
    sortOrder: 20,
  },
  {
    key: "enterprise",
    name: "Enterprise",
    description: "Universities and groups of institutes, with room for every campus.",
    pricePaise: 24_00_000_00,
    billingMonths: 12,
    studentCap: 10000,
    staffCap: 500,
    modules: ALL_MODULES,
    gstRateBp: DEFAULT_GST_BP,
    sortOrder: 30,
  },
];

const KEY_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const MAX_CAP = 1_000_000;
const MAX_PRICE = 100_00_00_000_00;
const MODULE_IDS = new Set<string>(ALL_MODULES);

/** "Campus Plus (2026)" → "campus-plus-2026". */
export function planKeyFrom(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");
}

/** "campus-plus" → "Campus plus": what a plan is called when its row can't be read. */
export function planNameFallback(key: string) {
  const s = key.replace(/[-_]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Unknown";
}

/**
 * Inserts Pilot, Standard and Enterprise when there are no plans at all. Called from
 * every plan read, and by the seed. Safe to run at the same time twice.
 */
export async function ensureDefaultPlans(conn: Conn = db()) {
  const [{ n }] = await conn.select({ n: count() }).from(platPlans);
  if (n > 0) return;
  await conn
    .insert(platPlans)
    .values(DEFAULT_PLANS.map((p) => ({ ...p })))
    .onConflictDoNothing();
}

const ordered = [asc(platPlans.sortOrder), asc(platPlans.name)] as const;

/** Every plan, in list order. No permission check: for services that have already checked theirs. */
export async function allPlans(conn: Conn = db()): Promise<Plan[]> {
  await ensureDefaultPlans(conn);
  return conn.select().from(platPlans).orderBy(...ordered);
}

/** Plan key → name, for showing a licence's plan anywhere in the panel. */
export async function planNames(conn: Conn = db()): Promise<Record<string, string>> {
  return Object.fromEntries((await allPlans(conn)).map((p) => [p.key, p.name]));
}

export async function planByKey(conn: Conn, key: string): Promise<Plan | null> {
  await ensureDefaultPlans(conn);
  const [p] = await conn.select().from(platPlans).where(eq(platPlans.key, key));
  return p ?? null;
}

const toOption = (p: Plan): PlanOption => ({
  key: p.key,
  name: p.name,
  description: p.description,
  pricePaise: p.pricePaise,
  billingMonths: p.billingMonths,
  studentCap: p.studentCap,
  staffCap: p.staffCap,
  modules: p.modules,
  gstRateBp: p.gstRateBp,
  archived: !!p.archivedAt,
});

/**
 * The plans a licence form offers: the live ones, plus `keep` (the plan a licence is
 * already on) even when that one has since been archived.
 */
export async function planOptions(actor: Actor, opts: { keep?: string | null } = {}): Promise<PlanOption[]> {
  assertPlatform(actor, "platform.licences");
  return (await allPlans()).filter((p) => !p.archivedAt || p.key === opts.keep).map(toOption);
}

export type PlanRow = Plan & { institutes: number };

/** Every plan with how many institutes are on it. Archived ones last. */
export async function listPlans(actor: Actor): Promise<PlanRow[]> {
  assertPlatform(actor, "platform.licences");
  const [plans, used] = await Promise.all([
    allPlans(),
    db().select({ plan: platLicences.plan, n: count() }).from(platLicences).groupBy(platLicences.plan),
  ]);
  const usedBy = new Map(used.map((u) => [u.plan, u.n]));
  return plans
    .map((p) => ({ ...p, institutes: usedBy.get(p.key) ?? 0 }))
    .sort((a, b) => Number(!!a.archivedAt) - Number(!!b.archivedAt));
}

export async function getPlan(actor: Actor, planId: string): Promise<PlanRow> {
  assertPlatform(actor, "platform.licences");
  if (!isUuid(planId)) throw new NotFoundError("Plan");
  await ensureDefaultPlans();
  const [p] = await db().select().from(platPlans).where(eq(platPlans.id, planId));
  if (!p) throw new NotFoundError("Plan");
  const [{ n }] = await db().select({ n: count() }).from(platLicences).where(eq(platLicences.plan, p.key));
  return { ...p, institutes: n };
}

/** Checks and tidies a plan. Error messages say how to fix the field. */
export function validatePlan(input: PlanInput) {
  const name = input.name.trim();
  if (name.length < 2) throw new ValidationError("Give the plan a name, like Campus Plus.");
  if (name.length > 60) throw new ValidationError("Keep the plan's name under 60 characters.");
  const description = (input.description ?? "").trim();
  if (description.length > 300) throw new ValidationError("Keep the description under 300 characters.");
  if (!Number.isInteger(input.pricePaise) || input.pricePaise < 0) throw new ValidationError("Enter the price before GST in rupees, like 720000. Use 0 for a free plan.");
  if (input.pricePaise > MAX_PRICE) throw new ValidationError("That price is too large for one plan.");
  if (!Number.isInteger(input.billingMonths) || input.billingMonths < 1 || input.billingMonths > 120) {
    throw new ValidationError("The billing period is a whole number of months, from 1 to 120.");
  }
  for (const [label, v] of [
    ["Student cap", input.studentCap],
    ["Staff cap", input.staffCap],
  ] as const) {
    if (!Number.isInteger(v) || v < 1 || v > MAX_CAP) throw new ValidationError(`${label} must be a whole number between 1 and ${MAX_CAP.toLocaleString("en-IN")}.`);
  }
  const unknown = input.modules.filter((m) => !MODULE_IDS.has(m));
  if (unknown.length) throw new ValidationError(`Unknown module: ${unknown.join(", ")}.`);
  const gstRateBp = input.gstRateBp ?? DEFAULT_GST_BP;
  if (!(GST_RATES_BP as readonly number[]).includes(gstRateBp)) throw new ValidationError("Pick a GST rate.");
  const sortOrder = input.sortOrder ?? 100;
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) throw new ValidationError("The position in the list is a whole number from 0 to 9999.");
  return {
    name,
    description,
    pricePaise: input.pricePaise,
    billingMonths: input.billingMonths,
    studentCap: input.studentCap,
    staffCap: input.staffCap,
    modules: ALL_MODULES.filter((id) => input.modules.includes(id)),
    gstRateBp,
    sortOrder,
  };
}

const logged = (p: Pick<Plan, "name" | "pricePaise" | "billingMonths" | "studentCap" | "staffCap" | "modules" | "gstRateBp" | "sortOrder" | "description">) => ({
  name: p.name,
  description: p.description,
  pricePaise: p.pricePaise,
  billingMonths: p.billingMonths,
  studentCap: p.studentCap,
  staffCap: p.staffCap,
  modules: p.modules,
  gstRateBp: p.gstRateBp,
  sortOrder: p.sortOrder,
});

function assertManagePlans(actor: Actor) {
  assertPlatform(actor, "platform.licences");
  assertSuperAdmin(actor);
}

export async function createPlan(actor: Actor, input: PlanInput): Promise<Plan> {
  assertManagePlans(actor);
  const clean = validatePlan(input);
  const key = (input.key?.trim().toLowerCase() || planKeyFrom(clean.name)).trim();
  if (!KEY_RE.test(key)) throw new ValidationError("The plan's key can use a to z, 0 to 9 and hyphens, up to 32 characters, like campus-plus.");
  await ensureDefaultPlans();
  try {
    return await db().transaction(async (tx) => {
      const [row] = await tx
        .insert(platPlans)
        .values({ key, ...clean, updatedBy: actor.userId || null })
        .returning();
      await logAction(tx, actor, {}, "plat.plan.create", "plat_plan", row.id, { key, ...logged(row) });
      return row;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError(`Another plan already uses the key "${key}". Pick a different key.`);
    throw e;
  }
}

/** Changes a plan. Its key stays. Licences and invoices that already exist keep their price. */
export async function updatePlan(actor: Actor, planId: string, input: PlanInput): Promise<Plan> {
  assertManagePlans(actor);
  if (!isUuid(planId)) throw new NotFoundError("Plan");
  const clean = validatePlan(input);
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(platPlans).where(eq(platPlans.id, planId)).for("update");
    if (!before) throw new NotFoundError("Plan");
    const [row] = await tx
      .update(platPlans)
      .set({ ...clean, updatedAt: new Date(), updatedBy: actor.userId || null })
      .where(eq(platPlans.id, planId))
      .returning();
    await logAction(tx, actor, {}, "plat.plan.update", "plat_plan", row.id, { key: row.key, ...logged(row), before: logged(before) });
    return row;
  });
}

/** Archived: no new licence can pick it; licences already on it keep it. */
export async function archivePlan(actor: Actor, planId: string): Promise<Plan> {
  return setArchived(actor, planId, true);
}

export async function restorePlan(actor: Actor, planId: string): Promise<Plan> {
  return setArchived(actor, planId, false);
}

async function setArchived(actor: Actor, planId: string, archived: boolean) {
  assertManagePlans(actor);
  if (!isUuid(planId)) throw new NotFoundError("Plan");
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(platPlans).where(eq(platPlans.id, planId)).for("update");
    if (!before) throw new NotFoundError("Plan");
    if (!!before.archivedAt === archived) throw new ConflictError(archived ? `${before.name} is already archived.` : `${before.name} isn't archived.`);
    const [row] = await tx
      .update(platPlans)
      .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date(), updatedBy: actor.userId || null })
      .where(eq(platPlans.id, planId))
      .returning();
    await logAction(tx, actor, {}, archived ? "plat.plan.archive" : "plat.plan.restore", "plat_plan", row.id, { key: row.key, name: row.name });
    return row;
  });
}

/**
 * Deletes a plan that no licence uses, such as one made by mistake. A plan with licences
 * on it is archived instead, so their key keeps pointing at it. The last plan can't go:
 * the defaults would come straight back.
 */
export async function deletePlan(actor: Actor, planId: string): Promise<Plan> {
  assertManagePlans(actor);
  if (!isUuid(planId)) throw new NotFoundError("Plan");
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(platPlans).where(eq(platPlans.id, planId)).for("update");
    if (!before) throw new NotFoundError("Plan");
    const [{ n }] = await tx.select({ n: count() }).from(platLicences).where(eq(platLicences.plan, before.key));
    if (n > 0) {
      throw new ConflictError(
        `${before.name} can't be deleted: ${n === 1 ? "1 institute has a licence" : `${n.toLocaleString("en-IN")} institutes have licences`} on it. Archive it instead, so it can't be chosen for new licences.`,
      );
    }
    const [{ total }] = await tx.select({ total: count() }).from(platPlans);
    if (total <= 1) throw new ConflictError(`${before.name} is the only plan. Create another plan before deleting this one.`);
    await tx.delete(platPlans).where(eq(platPlans.id, planId));
    await logAction(tx, actor, {}, "plat.plan.delete", "plat_plan", before.id, { key: before.key, ...logged(before) });
    return before;
  });
}
