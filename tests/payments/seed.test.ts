import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { invoices, orders, users } from "@/db/schema";
import { setTestModules } from "@/server/registry";
import { seedDemo } from "@/db/seed";
import contentProgress from "@/modules/content-progress";
import marketplace from "@/modules/marketplace";
import payments from "@/modules/payments";
import { listCategories } from "@/modules/payments/categories";
import { invoiceRegister } from "@/modules/payments/invoice-register";
import { payInvoiceDocuments, payManualInvoices, payRefunds, paySettings } from "@/modules/payments/schema";
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

    // Categories the institute made (one archived), and invoices raised in them in every state.
    const categories = await listCategories(arun, { includeArchived: true });
    expect(categories.map((c) => [c.name, c.archived])).toEqual([
      ["Course fees", false],
      ["Exam fees", false],
      ["Hostel", false],
      ["Library", false],
      ["Transport", true],
      ["Workshop", false],
    ]);
    const raised = await db.select().from(payManualInvoices).where(eq(payManualInvoices.universityId, uni));
    expect(raised).toHaveLength(7);
    expect(raised.map((r) => r.status).sort()).toEqual(["cancelled", "paid", "paid", "paid", "unpaid", "unpaid", "unpaid"]);
    expect(raised.filter((r) => r.igstPaise > 0).map((r) => r.buyerName)).toEqual(["Sunrise Coaching Centre"]);
    const register = await invoiceRegister(arun);
    expect(register.totals).toMatchObject({ unpaid: 3, overdue: 1, cancelled: 1 });
    expect(register.totals.count).toBe(raised.length + (await db.select().from(invoices).where(eq(invoices.universityId, uni))).length);
    // Every number is unique across order invoices and raised ones.
    expect(new Set(register.rows.map((r) => r.number)).size).toBe(register.rows.length);
    const riya = await ctx.actorFor("riya@demo.edu");
    expect((await invoiceRegister(arun, { q: riya.email })).rows.map((r) => [r.category, r.status, r.overdue])).toEqual([
      ["Exam fees", "unpaid", false],
      ["Library", "unpaid", true],
    ]);
  });
});
