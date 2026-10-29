/**
 * Typed access to everything modules register (contracts.md sections 1 to 7).
 * The module list comes from `src/generated/registry.ts`, written by `npm run gen`.
 * Everything is sorted: slots by `order` (then key), reports by label, the rest by id.
 */
import type {
  Job,
  ModuleId,
  ReportDefinition,
  SeedContext,
  SlotMap,
  SlotName,
  ZinnyModule,
} from "@/contracts/module";
import type { EventHandler } from "@/contracts/events";
import type { MailTransport } from "@/contracts/mail";
import type { PaymentGateway } from "@/contracts/payments";
import type { SmsTransport } from "@/contracts/sms";
import { generatedModules } from "@/generated/registry";
import { can, reach, type Actor, type Target } from "./authz/engine";

let testModules: ZinnyModule[] = [];
let replaceGenerated = false;

/**
 * Tests only: register extra modules (e.g. a fake module that fills every slot).
 * With `{ only: true }` they replace the generated modules entirely, so a test doesn't
 * depend on what other modules register. Call `setTestModules([])` to go back to normal.
 * Refused in production.
 */
export function setTestModules(mods: ZinnyModule[], opts: { only?: boolean } = {}) {
  if (process.env.NODE_ENV === "production") throw new Error("setTestModules is for tests only.");
  testModules = mods;
  replaceGenerated = !!opts.only;
}

/** Every registered module, sorted by id. */
export function modules(): ZinnyModule[] {
  const base = replaceGenerated ? [] : Object.values(generatedModules);
  return [...base, ...testModules].sort((a, b) => a.id.localeCompare(b.id));
}

const byOrder = (a: { order: number; key: string }, b: { order: number; key: string }) =>
  a.order - b.order || a.key.localeCompare(b.key);

/** All entries registered in one slot, sorted by order. No permission filtering. */
export function slot<N extends SlotName>(name: N): SlotMap[N][] {
  return modules()
    .flatMap((m) => (m[name] ?? []) as SlotMap[N][])
    .sort(byOrder);
}

/** Slot entries this actor may see on a page about `target` (can(actor, entry.action, target)). */
export function visibleSlots<N extends SlotName>(name: N, actor: Actor, target: Target): SlotMap[N][] {
  return slot(name).filter((s) => can(actor, s.action, target));
}

/**
 * Slot entries whose action the actor holds anywhere in the university (any scope).
 * Used by the admin dashboard, where a HOD or faculty member has no single target;
 * the card itself narrows what it shows with reach().
 */
export function slotsInReach<N extends SlotName>(name: N, actor: Actor, universityId: string): SlotMap[N][] {
  return slot(name).filter((s) => {
    const r = reach(actor, s.action, universityId);
    return r.all || r.departmentIds.size > 0 || r.batchIds.size > 0;
  });
}

export function reports(): ReportDefinition[] {
  return modules()
    .flatMap((m) => m.reports ?? [])
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Every module's jobs, optionally only those that run at one frequency. Core's own jobs live in server/jobs.ts. */
export function jobs(every?: Job["every"]): Job[] {
  const all = modules().flatMap((m) => m.jobs ?? []);
  return every ? all.filter((j) => j.every === every) : all;
}

export function eventHandlers(): EventHandler[] {
  const all = modules().flatMap((m) => m.eventHandlers ?? []);
  const seen = new Set<string>();
  for (const h of all) {
    if (seen.has(h.id)) throw new Error(`Two event handlers share the id "${h.id}". Handler ids must be unique.`);
    seen.add(h.id);
  }
  return all.sort((a, b) => a.id.localeCompare(b.id));
}

/** Module seeds in alphabetical order of module id. Core's seed runs before these. */
export function seeds(): { id: ModuleId; seed: (ctx: SeedContext) => Promise<void> }[] {
  return modules().flatMap((m) => (m.seed ? [{ id: m.id, seed: m.seed }] : []));
}

/** The registered email transport, or null (core then uses the console transport). */
export function mailTransport(): MailTransport | null {
  return modules().find((m) => m.mailTransport)?.mailTransport ?? null;
}

/** The registered SMS transport, or null (core then uses the console transport). */
export function smsTransport(): SmsTransport | null {
  return modules().find((m) => m.smsTransport)?.smsTransport ?? null;
}

/** The registered payment gateway, or null (core then uses its mock gateway). */
export function paymentGateway(): PaymentGateway | null {
  return modules().find((m) => m.paymentGateway)?.paymentGateway ?? null;
}
