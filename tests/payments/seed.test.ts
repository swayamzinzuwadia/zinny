import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { invoices, orders, users } from "@/db/schema";
import { setTestModules } from "@/server/registry";
import { seedDemo } from "@/db/seed";
import contentProgress from "@/modules/content-progress";
import marketplace from "@/modules/marketplace";
import payments from "@/modules/payments";
import { payInvoiceDocuments, payRefunds, paySettings } from "@/modules/payments/schema";
import { invoiceDownload } from "@/modules/payments/invoices";
import { eventsOfType } from "../helpers/events";

afterAll(async () => {
  setTestModules([]);
  await closeDb();
});

describe("payments seed", () => {
  it("adds invoice settings and a partly refunded marketplace order to the Demo University", async () => {
    // Institute courses are free for their students, so the refund is on the marketplace seed's sale.
    // The marketplace sells recorded lessons, which content-progress seeds.
    setTestModules([contentProgress, marketplace, payments], { only: true });
    const quiet = console.log;
    console.log = () => {};
    let ctx;
    try {
      ctx = await seedDemo();
    } finally {
      console.log = quiet;
    }
    const uni = ctx.universityId;
    const db = systemDb();

    const [settings] = await db.select().from(paySettings).where(eq(paySettings.universityId, uni));
    expect(settings).toMatchObject({ sacCode: "999293" });
    expect(settings.invoiceFooter).toMatch(/accounts@demo.edu/);

    const refunds = await db.select().from(payRefunds).where(eq(payRefunds.universityId, uni));
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ amountPaise: 10_000, status: "processed" });
    const [sale] = await db.select().from(orders).where(eq(orders.id, refunds[0].orderId));
    const [neha] = await db.select().from(users).where(eq(users.email, "neha@zinny.demo"));
    expect(sale).toMatchObject({ status: "paid", userId: neha.id, totalPaise: 35_282 });
    expect((await eventsOfType("payment.refunded", uni)).map((e) => e.payload.amountPaise)).toEqual([10_000]);
    // No institute course orders at all.
    expect(await db.select().from(orders).where(and(eq(orders.universityId, uni), eq(orders.status, "refund_due")))).toEqual([]);

    // Invoices render with the demo settings (the core seed's early renders were dropped).
    const arun = await ctx.actorFor("arun@demo.edu");
    const docsBefore = await db.select().from(payInvoiceDocuments).where(eq(payInvoiceDocuments.universityId, uni));
    expect(docsBefore.every((d) => d.footer.includes("accounts@demo.edu"))).toBe(true);
    const [saleInvoice] = await db.select().from(invoices).where(eq(invoices.orderId, sale.id));
    const pdf = await invoiceDownload(arun, saleInvoice.id);
    expect(pdf.number).toMatch(/^DEMO\//);
    const [doc] = await db.select().from(payInvoiceDocuments).where(eq(payInvoiceDocuments.invoiceId, saleInvoice.id));
    expect(doc.footer).toMatch(/accounts@demo.edu/);
  });
});
