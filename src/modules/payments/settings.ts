/**
 * Invoice settings per university (pay_settings): the SAC code printed on every invoice
 * and the invoice footer. The seller's legal name, address, GSTIN, state and invoice
 * prefix belong to core (the Zinny team sets them); they're shown here read only.
 */
import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { assertCan, audit, can, withTenant, type Actor } from "@/server/core";
import { ValidationError } from "@/server/errors";
import { DEFAULT_SAC } from "./config";
import { uni, universityRow } from "./internal";
import { stateLabel } from "./money";
import { paySettings } from "./schema";

export type InvoiceSettings = { sacCode: string; invoiceFooter: string; saved: boolean };

export const SAC_RE = /^99\d{2}(\d{2})?$/;
export const FOOTER_MAX = 600;

/** The settings row, or the defaults when the university hasn't saved any. */
export async function settingsFor(tx: Tx, universityId: string): Promise<InvoiceSettings> {
  const [s] = await tx.select().from(paySettings).where(eq(paySettings.universityId, universityId));
  return s ? { sacCode: s.sacCode, invoiceFooter: s.invoiceFooter, saved: true } : { sacCode: DEFAULT_SAC, invoiceFooter: "", saved: false };
}

export type SettingsView = InvoiceSettings & {
  canEdit: boolean;
  seller: { name: string; legalName: string | null; address: string | null; gstin: string | null; state: string; invoicePrefix: string };
  /** What's missing for a valid GST invoice, in plain words. */
  gaps: string[];
};

/** Needs `finance.view`; editing needs `finance.manage`. */
export async function getInvoiceSettings(actor: Actor): Promise<SettingsView> {
  assertCan(actor, "finance.view", { universityId: uni(actor) });
  return withTenant(actor, async (tx) => {
    const s = await settingsFor(tx, uni(actor));
    const u = await universityRow(tx);
    const gaps = [
      !u.legalName && "the legal name",
      !u.address && "the registered address",
      !u.gstin && "the GSTIN",
    ].filter(Boolean) as string[];
    return {
      ...s,
      canEdit: can(actor, "finance.manage", { universityId: uni(actor) }),
      seller: { name: u.name, legalName: u.legalName, address: u.address, gstin: u.gstin, state: stateLabel(u.stateCode), invoicePrefix: u.invoicePrefix },
      gaps,
    };
  });
}

/** Saves the SAC code and footer. Needs `finance.manage`. Applies to invoices rendered from now on. */
export async function updateInvoiceSettings(actor: Actor, input: { sacCode: string; invoiceFooter: string }) {
  assertCan(actor, "finance.manage", { universityId: uni(actor) });
  const sacCode = input.sacCode.replace(/\s+/g, "");
  if (!SAC_RE.test(sacCode)) throw new ValidationError("A SAC code for services has 4 or 6 digits and starts with 99, like 999293.");
  const invoiceFooter = input.invoiceFooter.replace(/\r\n/g, "\n").trim();
  if (invoiceFooter.length > FOOTER_MAX) throw new ValidationError(`Keep the footer under ${FOOTER_MAX} characters so it fits on the invoice.`);
  return withTenant(actor, async (tx) => {
    const before = await settingsFor(tx, uni(actor));
    const [row] = await tx
      .insert(paySettings)
      .values({ universityId: uni(actor), sacCode, invoiceFooter, updatedBy: actor.userId || null })
      .onConflictDoUpdate({ target: paySettings.universityId, set: { sacCode, invoiceFooter, updatedBy: actor.userId || null, updatedAt: new Date() } })
      .returning();
    await audit(tx, actor, "payment.settings_update", "pay_settings", uni(actor), {
      sacCode: { from: before.sacCode, to: sacCode },
      footerChanged: before.invoiceFooter !== invoiceFooter,
    });
    return { sacCode: row.sacCode, invoiceFooter: row.invoiceFooter, saved: true };
  });
}
