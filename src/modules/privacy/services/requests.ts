/**
 * Data principal requests (Act s.11 to 14, Rule 14): correction, erasure, a nominee, and
 * grievances. Each gets a due date from REQUEST_SLA_DAYS. An institute's learners ask their
 * institute (handled with `privacy.manage`); marketplace learners and sign-ups ask Zinny
 * (handled by the Zinny team, who also see every institute's queue).
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { universities } from "@/db/schema";
import { withTenant, type Actor } from "@/server/core";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { dpdpRequests } from "../schema";
import { dueOnFor, type RequestKind } from "../lib/rules";
import { assertHandler, assertPlatformPrivacy, selfOf, todayOf } from "./access";
import { eraseInInstitute, eraseOnZinny, erasureMessage, peopleNames, type ErasureResult } from "./erasure";
import { zinny, zinnyAudit, zinnyTx } from "./system";

export type RequestRow = typeof dpdpRequests.$inferSelect;
export type RequestInput = { kind: RequestKind; details: string; data?: Record<string, string> };

const FILEABLE: readonly RequestKind[] = ["correction", "erasure", "nomination", "grievance"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Checks and tidies a request before it is saved. */
export function checkRequest(input: RequestInput): RequestInput {
  if (!FILEABLE.includes(input.kind)) throw new ValidationError("Choose what you'd like us to do.");
  const details = input.details.trim();
  if (details.length > 2000) throw new ValidationError("Keep the details under 2,000 characters.");
  const data: Record<string, string> = {};
  if (input.kind === "correction") {
    if (details.length < 5) throw new ValidationError("Say what is wrong and what it should say instead.");
  }
  if (input.kind === "grievance" && details.length < 10) throw new ValidationError("Tell us what went wrong, in a sentence or two.");
  if (input.kind === "nomination") {
    const name = (input.data?.nomineeName ?? "").trim();
    const contact = (input.data?.nomineeContact ?? "").trim();
    const relation = (input.data?.nomineeRelation ?? "").trim();
    if (name.length < 2) throw new ValidationError("Enter your nominee's full name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) && !/^\+?[\d\s-]{10,15}$/.test(contact)) {
      throw new ValidationError("Enter your nominee's email address or mobile number.");
    }
    Object.assign(data, { nomineeName: name, nomineeContact: contact, nomineeRelation: relation.slice(0, 60) });
  }
  return { kind: input.kind, details, data };
}

/** A person asks their institute (inside one) or Zinny (outside). One open request of each kind at a time. */
export async function fileRequest(actor: Actor, input: RequestInput): Promise<RequestRow> {
  const me = selfOf(actor);
  const req = checkRequest(input);
  const run = async (tx: Tx) => {
    const [open] = await tx
      .select({ id: dpdpRequests.id })
      .from(dpdpRequests)
      .where(
        and(
          eq(dpdpRequests.userId, me.userId),
          eq(dpdpRequests.kind, req.kind),
          inArray(dpdpRequests.status, ["open", "in_progress"]),
          me.universityId ? undefined : isNull(dpdpRequests.universityId),
        ),
      );
    if (open) throw new ConflictError("You already have a request like this open. We'll answer it by its due date.");
    const today = await todayOf(me.universityId ? tx : null);
    const [row] = await tx
      .insert(dpdpRequests)
      .values({ universityId: me.universityId, userId: me.userId, kind: req.kind, details: req.details, data: req.data ?? {}, dueOn: dueOnFor(req.kind, today) })
      .returning();
    await zinnyAudit(tx, actor, me.universityId, "privacy.request.create", "dpdp_requests", row.id, { kind: row.kind, dueOn: row.dueOn });
    return row;
  };
  return me.universityId ? withTenant(actor, run) : zinnyTx(run);
}

/** The person's own requests, newest first. */
export async function myRequests(actor: Actor): Promise<RequestRow[]> {
  const me = selfOf(actor);
  const where = (extra?: ReturnType<typeof isNull>) => and(eq(dpdpRequests.userId, me.userId), extra);
  const [here, ours] = await Promise.all([
    me.universityId ? withTenant(actor, (tx) => tx.select().from(dpdpRequests).where(where()).orderBy(desc(dpdpRequests.createdAt))) : Promise.resolve([]),
    zinny().select().from(dpdpRequests).where(where(isNull(dpdpRequests.universityId))).orderBy(desc(dpdpRequests.createdAt)),
  ]);
  return [...here, ...ours];
}

export type HandledRequest = RequestRow & { person: { name: string; email: string } | null; institute: string | null };

const openFirst = [sql`case when ${dpdpRequests.status} in ('open', 'in_progress') then 0 else 1 end`, asc(dpdpRequests.dueOn), desc(dpdpRequests.createdAt)];

/** The institute's queue: every request except downloads, open ones first by due date. */
export async function listRequests(actor: Actor): Promise<HandledRequest[]> {
  assertHandler(actor);
  return withTenant(actor, async (tx) => {
    const rows = await tx.select().from(dpdpRequests).where(sql`${dpdpRequests.kind} <> 'access'`).orderBy(...openFirst).limit(200);
    const names = await peopleNames(tx, [...new Set(rows.map((r) => r.userId))]);
    return rows.map((r) => ({ ...r, person: names.get(r.userId) ?? null, institute: null }));
  });
}

export type Decision = { requestId: string; status: "in_progress" | "completed" | "refused"; response: string };

function checkDecision(d: Decision) {
  if (!UUID.test(d.requestId)) throw new NotFoundError("Request");
  const response = d.response.trim();
  if (d.status === "refused" && response.length < 10) throw new ValidationError("Say why the request is refused, so the person can complain to the Data Protection Board if they disagree.");
  if (response.length > 2000) throw new ValidationError("Keep the reply under 2,000 characters.");
  return response;
}

async function decide(tx: Tx, actor: Actor, universityId: string | null, d: Decision, erase: (userId: string) => Promise<ErasureResult>) {
  const response = checkDecision(d);
  const [row] = await tx
    .select()
    .from(dpdpRequests)
    .where(and(eq(dpdpRequests.id, d.requestId), universityId ? undefined : isNull(dpdpRequests.universityId)))
    .for("update");
  if (!row) throw new NotFoundError("Request");
  if (row.status === "completed" || row.status === "refused") throw new ConflictError("This request is already closed.");
  let reply = response;
  let erased: ErasureResult | null = null;
  if (d.status === "completed" && row.kind === "erasure") {
    erased = await erase(row.userId);
    reply = [response, erasureMessage(erased)].filter(Boolean).join(" ");
  }
  if (d.status === "completed" && !reply) throw new ValidationError("Write a short reply saying what you did.");
  const closed = d.status !== "in_progress";
  const [done] = await tx
    .update(dpdpRequests)
    .set({ status: d.status, response: reply || row.response, handledBy: actor.userId || null, closedAt: closed ? new Date() : null })
    .where(eq(dpdpRequests.id, row.id))
    .returning();
  await zinnyAudit(tx, actor, universityId, `privacy.request.${d.status}`, "dpdp_requests", row.id, { kind: row.kind, ...(erased ?? {}) });
  return { request: done, erased };
}

/** The institute answers one of its requests. Completing an erasure erases the person here. */
export async function decideRequest(actor: Actor, d: Decision) {
  const universityId = assertHandler(actor);
  return withTenant(actor, (tx) => decide(tx, actor, universityId, d, (userId) => eraseInInstitute(tx, actor, userId)));
}

/* ─────────────────────────── Zinny team ─────────────────────────── */

/** Every request on Zinny: Zinny's own (which the team answers) and each institute's (to see SLAs slipping). */
export async function platformRequests(actor: Actor): Promise<HandledRequest[]> {
  assertPlatformPrivacy(actor);
  const rows = await zinny()
    .select({ r: dpdpRequests, institute: universities.name })
    .from(dpdpRequests)
    .leftJoin(universities, eq(universities.id, dpdpRequests.universityId))
    .where(sql`${dpdpRequests.kind} <> 'access'`)
    .orderBy(...openFirst)
    .limit(300);
  const names = await zinnyTx((tx) => peopleNames(tx, [...new Set(rows.map((x) => x.r.userId))]));
  return rows.map((x) => ({ ...x.r, person: names.get(x.r.userId) ?? null, institute: x.institute }));
}

/** The Zinny team answers one of Zinny's own requests (university null). */
export async function decidePlatformRequest(actor: Actor, d: Decision) {
  assertPlatformPrivacy(actor);
  return zinnyTx((tx) => decide(tx, actor, null, d, (userId) => eraseOnZinny(tx, actor, userId)));
}

/** Open requests for the institute dashboard's "Needs you" row. */
export async function openRequestCount(actor: Actor): Promise<{ open: number; overdue: number }> {
  assertHandler(actor);
  return withTenant(actor, async (tx) => {
    const today = await todayOf(tx);
    const [r] = await tx
      .select({
        open: sql<number>`count(*)`.mapWith(Number),
        overdue: sql<number>`count(*) filter (where ${dpdpRequests.dueOn} < ${today})`.mapWith(Number),
      })
      .from(dpdpRequests)
      .where(inArray(dpdpRequests.status, ["open", "in_progress"]));
    return r ?? { open: 0, overdue: 0 };
  });
}
