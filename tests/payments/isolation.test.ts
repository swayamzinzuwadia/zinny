import { afterAll, describe, it } from "vitest";
import { randomUUID } from "node:crypto";
import { closeDb } from "@/db/client";
import { systemDb } from "@/db/client";
import { payInvoiceCategories, payInvoiceDocuments, payManualInvoiceLines, payManualInvoices, payRefunds, paySettings, payWebhookEvents } from "@/modules/payments/schema";
import { expectTenantIsolated } from "../helpers/isolation";
import { uniqueCode } from "../fixtures";
import { rawPaidOrder } from "./helpers";

const manualInvoice = (universityId: string) => ({
  universityId,
  number: `TU/26-27/${uniqueCode("").slice(0, 5)}`,
  financialYear: "26-27",
  buyerName: "Isolation Buyer",
  placeOfSupply: "27",
  sellerName: "Isolation Trust",
  sellerStateCode: "27",
  gstApplied: true,
  gstRateBp: 1800,
  subtotalPaise: 10_000,
  taxablePaise: 10_000,
  cgstPaise: 900,
  sgstPaise: 900,
  totalPaise: 11_800,
  issueDate: "2026-11-01",
});

afterAll(closeDb);

describe("payments tables are isolated per university", () => {
  it("pay_settings", () => expectTenantIsolated(paySettings, (uni) => ({ universityId: uni.id, sacCode: "999293", invoiceFooter: "Footer" })));

  it("pay_refunds", () =>
    expectTenantIsolated(payRefunds, async (uni) => ({
      universityId: uni.id,
      orderId: (await rawPaidOrder(uni.id)).order.id,
      amountPaise: 1_000,
      reason: "Isolation test",
      gateway: "mock",
    })));

  it("pay_webhook_events", () =>
    expectTenantIsolated(payWebhookEvents, (uni) => ({
      universityId: uni.id,
      eventId: `evt_${randomUUID()}`,
      bodySha256: randomUUID(),
      eventType: "payment.captured",
    })));

  it("pay_invoice_documents", () =>
    expectTenantIsolated(payInvoiceDocuments, async (uni) => {
      const { invoice } = await rawPaidOrder(uni.id);
      return { universityId: uni.id, invoiceId: invoice.id, storageKey: `${uni.id}/payments/invoices/${invoice.id}.pdf`, sacCode: "999293", sha256: "x", sizeBytes: 1 };
    }));

  it("pay_invoice_categories", () => expectTenantIsolated(payInvoiceCategories, (uni) => ({ universityId: uni.id, name: `Exam fees ${uniqueCode("")}`, defaultGstRateBp: 0 })));

  it("pay_manual_invoices", () => expectTenantIsolated(payManualInvoices, (uni) => manualInvoice(uni.id)));

  it("pay_manual_invoice_lines", () =>
    expectTenantIsolated(payManualInvoiceLines, async (uni) => {
      const [inv] = await systemDb().insert(payManualInvoices).values(manualInvoice(uni.id)).returning();
      return { universityId: uni.id, invoiceId: inv.id, position: 1, description: "Exam fee", quantity: 1, unitPricePaise: 10_000, amountPaise: 10_000 };
    }));
});
