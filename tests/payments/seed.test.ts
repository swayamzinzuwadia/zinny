import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { invoices, notifications, orders } from "@/db/schema";
import { setTestModules } from "@/server/registry";
import { seedDemo } from "@/db/seed";
import payments from "@/modules/payments";
import { payInvoiceDocuments, payRefunds, paySettings } from "@/modules/payments/schema";
import { invoiceDownload } from "@/modules/payments/invoices";
import { eventsOfType } from "../helpers/events";

afterAll(async () => {
  setTestModules([]);
  await closeDb();
});

describe("payments seed", () => {
  it("adds invoice settings, a partly refunded order and a refund_due order to the Demo University", async () => {
    setTestModules([payments], { only: true });
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
    expect(refunds[0]).toMatchObject({ amountPaise: 100_000, status: "processed" });
    const [riyaOrder] = await db.select().from(orders).where(eq(orders.id, refunds[0].orderId));
    expect(riyaOrder).toMatchObject({ status: "paid", userId: ctx.ids.users["riya@demo.edu"], totalPaise: 472_000 });
    expect((await eventsOfType("payment.refunded", uni)).map((e) => e.payload.amountPaise)).toEqual([100_000]);

    const due = await db.select().from(orders).where(and(eq(orders.universityId, uni), eq(orders.status, "refund_due")));
    expect(due).toHaveLength(1);
    expect(due[0].userId).toBe(ctx.ids.users["neil@demo.edu"]);
    const accountsTold = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, ctx.ids.users["arun@demo.edu"]), eq(notifications.kind, "finance.refund_due")));
    expect(accountsTold).toHaveLength(1);

    // Invoices render with the demo settings (the core seed's early renders were dropped).
    const arun = await ctx.actorFor("arun@demo.edu");
    const docsBefore = await db.select().from(payInvoiceDocuments).where(eq(payInvoiceDocuments.universityId, uni));
    expect(docsBefore.every((d) => d.footer.includes("accounts@demo.edu"))).toBe(true);
    const [riyaInvoice] = await db.select().from(invoices).where(eq(invoices.orderId, riyaOrder.id));
    const pdf = await invoiceDownload(arun, riyaInvoice.id);
    expect(pdf.number).toMatch(/^DEMO\//);
    const [doc] = await db.select().from(payInvoiceDocuments).where(eq(payInvoiceDocuments.invoiceId, riyaInvoice.id));
    expect(doc.footer).toMatch(/accounts@demo.edu/);
  });
});
