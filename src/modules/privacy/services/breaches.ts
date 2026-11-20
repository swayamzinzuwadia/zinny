/**
 * The breach register (Act s.8(6), Rule 7). Zinny team only. Each incident tracks the two
 * 72-hour clocks from the moment Zinny became aware: the detailed report to the Data
 * Protection Board and telling every affected person, plus the first intimation to the Board.
 */
import { desc, eq, inArray } from "drizzle-orm";
import { universities } from "@/db/schema";
import type { Actor } from "@/server/core";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { dpdpBreaches } from "../schema";
import { breachDeadlines } from "../lib/rules";
import { assertPlatformPrivacy } from "./access";
import { zinny, zinnyAudit, zinnyTx } from "./system";

export type BreachRow = typeof dpdpBreaches.$inferSelect;

export type BreachInput = {
  title: string;
  description: string;
  /** "YYYY-MM-DDTHH:mm" in India time, from a datetime-local field. */
  detectedAt: string;
  occurredAt?: string;
  dataCategories: string;
  principalsAffected?: string;
  instituteIds?: string[];
  measures?: string;
};

/** "2026-11-18T14:30" in India time → a Date. */
export function istToDate(local: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const d = new Date(`${local}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function listBreaches(actor: Actor): Promise<BreachRow[]> {
  assertPlatformPrivacy(actor);
  return zinny().select().from(dpdpBreaches).orderBy(desc(dpdpBreaches.detectedAt));
}

export async function getBreach(actor: Actor, id: string): Promise<BreachRow> {
  assertPlatformPrivacy(actor);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError("Incident");
  const [row] = await zinny().select().from(dpdpBreaches).where(eq(dpdpBreaches.id, id));
  if (!row) throw new NotFoundError("Incident");
  return row;
}

export async function logBreach(actor: Actor, input: BreachInput, now = new Date()): Promise<BreachRow> {
  assertPlatformPrivacy(actor);
  const title = input.title.trim();
  if (title.length < 4) throw new ValidationError("Give the incident a short title, like “Exported student list emailed to the wrong institute”.");
  const description = input.description.trim();
  if (description.length < 10) throw new ValidationError("Describe what happened: what data, how it was exposed, and how you found out.");
  const detectedAt = istToDate(input.detectedAt);
  if (!detectedAt) throw new ValidationError("Enter when Zinny became aware of the breach. The 72-hour clock starts then.");
  if (detectedAt.getTime() > now.getTime() + 60_000) throw new ValidationError("The time Zinny became aware can't be in the future.");
  const occurredAt = input.occurredAt ? istToDate(input.occurredAt) : null;
  if (input.occurredAt && !occurredAt) throw new ValidationError("Enter when the breach happened as a date and time, or leave it empty.");
  const affected = input.principalsAffected?.trim() ? Number(input.principalsAffected) : null;
  if (affected !== null && (!Number.isInteger(affected) || affected < 0)) throw new ValidationError("Enter the number of people affected as a whole number, or leave it empty.");
  const ids = (input.instituteIds ?? []).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  return zinnyTx(async (tx) => {
    const insts = ids.length ? await tx.select({ id: universities.id, name: universities.name }).from(universities).where(inArray(universities.id, ids)) : [];
    const [row] = await tx
      .insert(dpdpBreaches)
      .values({
        title,
        description,
        detectedAt,
        occurredAt,
        dataCategories: input.dataCategories.trim(),
        principalsAffected: affected,
        affectedInstitutes: insts,
        measures: (input.measures ?? "").trim(),
        createdBy: actor.userId || null,
      })
      .returning();
    await zinnyAudit(tx, actor, null, "privacy.breach.create", "dpdp_breaches", row.id, { title, detectedAt: detectedAt.toISOString(), institutes: insts.map((i) => i.id) });
    return row;
  });
}

export type BreachStep = "board_intimated" | "board_report" | "principals_notified" | "contained" | "closed" | "reopen";

const STEP_FIELD = { board_intimated: "boardIntimatedAt", board_report: "boardReportAt", principals_notified: "principalsNotifiedAt" } as const;

/** Marks one step of an incident done, now. Closing needs the Board report and the notices first. */
export async function markBreachStep(actor: Actor, id: string, step: BreachStep, opts: { measures?: string; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const b = await getBreach(actor, id);
  const patch: Partial<typeof dpdpBreaches.$inferInsert> = {};
  if (step in STEP_FIELD) {
    const field = STEP_FIELD[step as keyof typeof STEP_FIELD];
    if (b[field]) throw new ConflictError("That step is already recorded.");
    patch[field] = now;
    if (step === "board_report" && !b.boardIntimatedAt) patch.boardIntimatedAt = now;
  } else if (step === "contained") {
    if (b.status !== "open") throw new ConflictError("Only an open incident can be marked contained.");
    patch.status = "contained";
  } else if (step === "closed") {
    if (!b.boardReportAt || !b.principalsNotifiedAt) throw new ValidationError("Record the report to the Board and the notice to affected people before closing the incident.");
    patch.status = "closed";
    patch.closedAt = now;
  } else if (step === "reopen") {
    patch.status = "open";
    patch.closedAt = null;
  }
  if (opts.measures !== undefined && opts.measures.trim()) patch.measures = opts.measures.trim();
  return zinnyTx(async (tx) => {
    const [row] = await tx.update(dpdpBreaches).set(patch).where(eq(dpdpBreaches.id, id)).returning();
    await zinnyAudit(tx, actor, null, `privacy.breach.${step}`, "dpdp_breaches", id, {});
    return row;
  });
}

/** For the register's list: which clocks are running, done, or late. */
export function breachClock(b: BreachRow, now = new Date()) {
  return breachDeadlines(b, now);
}

/** Institutes to pick from when logging an incident. */
export async function instituteChoices(actor: Actor): Promise<{ id: string; name: string }[]> {
  assertPlatformPrivacy(actor);
  return zinny().select({ id: universities.id, name: universities.name }).from(universities).orderBy(universities.name);
}
