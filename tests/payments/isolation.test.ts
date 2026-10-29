import { afterAll, describe, it } from "vitest";
import { randomUUID } from "node:crypto";
import { closeDb } from "@/db/client";
import { payInvoiceDocuments, payRefunds, paySettings, payWebhookEvents } from "@/modules/payments/schema";
import { expectTenantIsolated } from "../helpers/isolation";
import { rawPaidOrder } from "./helpers";

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
});
