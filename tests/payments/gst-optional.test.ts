/**
 * GST is optional per institute ("Charge GST on fees", Finance → Sales → Settings).
 * Off: new orders carry no GST and their invoices are plain invoices. Anything already
 * issued never changes, and turning GST back on only affects new orders.
 */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, universities } from "@/db/schema";
import { gstFor, splitGst } from "@/server/core";
import { ForbiddenError } from "@/server/errors";
import { universityBySlug } from "@/server/context";
import { contentLessons, contentSections } from "@/modules/content-progress/schema";
import { signUpMarketplaceLearner } from "@/modules/identity/auth";
import { addToCart, cartView } from "@/modules/marketplace/cart";
import { createListing } from "@/modules/marketplace/listings";
import { liveListingsByIds } from "@/modules/marketplace/service";
import { checkoutView, payInTestMode } from "@/modules/payments/checkout";
import { invoiceDownload, invoiceEmail, invoiceHasGst, myInvoices } from "@/modules/payments/invoices";
import { invoiceAmounts } from "@/modules/payments/money";
import { orderDetail, salesOverview } from "@/modules/payments/sales";
import { getInvoiceSettings, updateGstSetting } from "@/modules/payments/settings";
import { setupCourse, uniqueCode } from "../fixtures";
import { invoiceOf, orderRow, paidCourse, startCheckout } from "./helpers";

afterAll(closeDb);

async function pdfText(bytes: Uint8Array) {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return text.replace(/\s+/g, " ");
}

const gstFlag = async (uniId: string) => (await systemDb().select({ g: universities.gstEnabled }).from(universities).where(eq(universities.id, uniId)))[0].g;

describe("the GST setting", () => {
  it("is on by default, and Accounts or an Institute Admin can turn it off and on (audited)", async () => {
    const c = await paidCourse("GST Setting U");
    expect(await gstFlag(c.uni.id)).toBe(true);
    expect((await getInvoiceSettings(c.accounts)).gstEnabled).toBe(true);

    expect(await updateGstSetting(c.accounts, false)).toEqual({ gstEnabled: false, changed: true });
    expect(await gstFlag(c.uni.id)).toBe(false);
    expect((await getInvoiceSettings(c.board)).gstEnabled).toBe(false);
    expect((await universityBySlug(c.uni.slug))?.gstEnabled).toBe(false);
    // Saving the same choice again changes and logs nothing.
    expect(await updateGstSetting(c.accounts, false)).toEqual({ gstEnabled: false, changed: false });

    expect(await updateGstSetting(c.admin, true)).toEqual({ gstEnabled: true, changed: true });
    const log = await systemDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.universityId, c.uni.id), eq(auditLog.action, "finance.gst_setting")))
      .orderBy(auditLog.at);
    expect(log.map((l) => l.data)).toEqual([{ gstEnabled: { from: true, to: false } }, { gstEnabled: { from: false, to: true } }]);
    expect(log.map((l) => l.actorUserId)).toEqual([c.accounts.userId, c.admin.userId]);
  });

  it("can't be changed without finance.manage", async () => {
    const c = await paidCourse("GST Setting Deny U");
    const student = await c.student("Setting Student");
    for (const who of [c.board, c.faculty, c.hod, student]) {
      await expect(updateGstSetting(who, false)).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(await gstFlag(c.uni.id)).toBe(true);
  });

  it("only warns about missing GST details while GST is on", async () => {
    const c = await paidCourse("GST Gaps U");
    await systemDb().update(universities).set({ gstin: null, address: null }).where(eq(universities.id, c.uni.id));
    expect((await getInvoiceSettings(c.accounts)).gaps).toEqual(["the registered address", "the GSTIN"]);
    await updateGstSetting(c.accounts, false);
    expect((await getInvoiceSettings(c.accounts)).gaps).toEqual([]);
  });

  it("another institute's setting is untouched", async () => {
    const a = await paidCourse("GST Own U");
    const b = await paidCourse("GST Other U");
    await updateGstSetting(a.accounts, false);
    expect(await gstFlag(b.uni.id)).toBe(true);
  });
});

describe("orders while GST is off", () => {
  it("a new order has no GST: the total is the price", async () => {
    const c = await paidCourse("GST Off Order U");
    await updateGstSetting(c.accounts, false);
    const s = await c.student("Off Student");
    const { order, orderId, totalPaise } = await startCheckout(s, c.batch.id);
    expect(order).toMatchObject({ basePaise: 1_000_000, gstPaise: 0, totalPaise: 1_000_000 });
    expect(totalPaise).toBe(1_000_000);

    const view = await checkoutView(s, orderId);
    expect(view.gst).toBe(false);
    expect(view.split).toEqual({ cgstPaise: 0, sgstPaise: 0, halfRatePercent: 0 });
  });

  it("the invoice is a plain invoice: no GSTIN, SAC code or tax rows, on the record and in the PDF", async () => {
    const c = await paidCourse("GST Off Invoice U");
    await systemDb().update(universities).set({ address: "12 MG Road, Pune 411001" }).where(eq(universities.id, c.uni.id));
    await updateGstSetting(c.accounts, false);
    const s = await c.student("Plain Student");
    const { orderId } = await startCheckout(s, c.batch.id);
    await payInTestMode(s, orderId);

    const inv = await invoiceOf(orderId);
    expect(inv).toMatchObject({ sellerGstin: null, basePaise: 1_000_000, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 1_000_000 });
    expect(inv.number).toMatch(/^TU\/\d\d-\d\d\/\d{5}$/);
    expect(invoiceHasGst(inv)).toBe(false);

    const text = await pdfText((await invoiceDownload(s, inv.id)).bytes);
    expect(text).toContain("Invoice");
    expect(text).not.toContain("Tax invoice");
    expect(text).not.toMatch(/GSTIN|SAC|CGST|SGST|IGST|Taxable value|Place of supply|Reverse charge|999293/);
    expect(text).toContain("Amount (₹)");
    expect(text).toContain("Total (₹) 10,000.00");
    expect(text).toContain("Indian Rupees Ten Thousand Only");
    expect(text).toContain("GST Off Invoice U Trust");
    expect(text).toContain("12 MG Road, Pune 411001");
    expect(text).toContain("Data Analytics");

    // What the learner and the admin see carries no GST either.
    const [mine] = await myInvoices(s);
    expect(mine).toMatchObject({ gstPaise: 0, gst: false, totalPaise: 1_000_000 });
    const sales = await salesOverview(c.accounts, {});
    expect(sales.totals).toMatchObject({ grossPaise: 1_000_000, gstPaise: 0 });
    expect((await orderDetail(c.accounts, orderId)).order.gstPaise).toBe(0);
    expect(invoiceEmail({ universityName: "U", slug: "u", number: inv.number, course: "C", totalPaise: 1, name: "N", gst: false }).subject).toBe(`Your invoice ${inv.number} from U`);
  });

  it("turning GST back on affects new orders only; the earlier invoice never changes", async () => {
    const c = await paidCourse("GST Back On U");
    await updateGstSetting(c.accounts, false);
    const first = await c.student("Before Student");
    const a = await startCheckout(first, c.batch.id);
    await payInTestMode(first, a.orderId);
    const plain = await invoiceOf(a.orderId);
    const plainPdf = (await invoiceDownload(first, plain.id)).bytes;

    await updateGstSetting(c.accounts, true);
    const second = await c.student("After Student");
    const b = await startCheckout(second, c.batch.id);
    expect(b.order).toMatchObject({ basePaise: 1_000_000, gstPaise: 180_000, totalPaise: 1_180_000 });
    await payInTestMode(second, b.orderId);
    const taxed = await invoiceOf(b.orderId);
    expect(taxed).toMatchObject({ sellerGstin: "27AAAAA0000A1Z5", cgstPaise: 90_000, sgstPaise: 90_000, totalPaise: 1_180_000 });
    const taxedText = await pdfText((await invoiceDownload(second, taxed.id)).bytes);
    expect(taxedText).toContain("Tax invoice");
    expect(taxedText).toContain("GSTIN: 27AAAAA0000A1Z5");
    expect(taxedText).toContain("CGST @ 9% 900.00");

    // The order and invoice from while GST was off are exactly as they were.
    expect(await orderRow(a.orderId)).toMatchObject({ gstPaise: 0, totalPaise: 1_000_000 });
    expect(await invoiceOf(a.orderId)).toEqual(plain);
    const again = (await invoiceDownload(c.accounts, plain.id)).bytes;
    expect(Buffer.from(again).equals(Buffer.from(plainPdf))).toBe(true);
    // Numbers keep running in one series across the change.
    expect(Number(taxed.number.slice(-5))).toBe(Number(plain.number.slice(-5)) + 1);
  });

  it("an order placed while GST was on keeps its GST and gets a tax invoice, even if GST is off when it's paid", async () => {
    const c = await paidCourse("GST Pending U");
    const s = await c.student("Pending Student");
    const { orderId, order } = await startCheckout(s, c.batch.id);
    expect(order.gstPaise).toBe(180_000);
    await updateGstSetting(c.accounts, false);
    await payInTestMode(s, orderId);
    const inv = await invoiceOf(orderId);
    expect(inv).toMatchObject({ sellerGstin: "27AAAAA0000A1Z5", cgstPaise: 90_000, sgstPaise: 90_000, totalPaise: 1_180_000 });
    expect(await pdfText((await invoiceDownload(s, inv.id)).bytes)).toContain("Tax invoice");
    // Turning GST off never rewrites an invoice that's already issued.
    const before = await paidCourse("GST Issued U");
    const s2 = await before.student("Issued Student");
    const o2 = await startCheckout(s2, before.batch.id);
    await payInTestMode(s2, o2.orderId);
    const issued = await invoiceOf(o2.orderId);
    const pdf = (await invoiceDownload(s2, issued.id)).bytes;
    await updateGstSetting(before.accounts, false);
    expect(await invoiceOf(o2.orderId)).toEqual(issued);
    expect(Buffer.from((await invoiceDownload(s2, issued.id)).bytes).equals(Buffer.from(pdf))).toBe(true);
  });
});

describe("the marketplace while the seller has GST off", () => {
  it("shows and charges the listing price with no GST", async () => {
    const s = await setupCourse({ name: "GST Off Market College" });
    const [section] = await systemDb().insert(contentSections).values({ universityId: s.uni.id, courseId: s.course.id, title: "Week 1" }).returning();
    await systemDb()
      .insert(contentLessons)
      .values({ universityId: s.uni.id, courseId: s.course.id, sectionId: section.id, title: "Intro", kind: "video", content: { source: "youtube", videoId: "abc123", url: "https://youtu.be/abc123" }, ready: true, durationMinutes: 10 });
    const listing = await createListing(s.hod, { kind: "course", sourceId: s.course.id, title: "Whole course", description: "", pricePaise: 100_000 });
    const r = await signUpMarketplaceLearner({
      name: "Gst Learner",
      email: `gst.${uniqueCode("").toLowerCase()}@market.test`,
      password: "a quiet green field",
      confirm: "a quiet green field",
      ip: `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    });
    if (r.status !== "created") throw new Error("Sign-up was limited.");

    expect((await liveListingsByIds([listing.id]))[0].totalPaise).toBe(118_000);
    await addToCart(r.userId, listing.id);
    expect(await cartView(r.userId)).toMatchObject({ subtotalPaise: 100_000, gstPaise: 18_000, totalPaise: 118_000 });

    await updateGstSetting(s.admin, false);
    expect((await liveListingsByIds([listing.id]))[0].totalPaise).toBe(100_000);
    expect(await cartView(r.userId)).toMatchObject({ subtotalPaise: 100_000, gstPaise: 0, totalPaise: 100_000 });

    await updateGstSetting(s.admin, true);
    expect(await cartView(r.userId)).toMatchObject({ gstPaise: 18_000, totalPaise: 118_000 });
  });
});

describe("invoiceAmounts", () => {
  it("follows core's GST rules: rounding, the CGST and SGST halves, and IGST across states", () => {
    for (const [paise, rateBp] of [
      [1_000_000, 1800],
      [333_333, 1800],
      [99_999, 500],
      [1, 2800],
      [750_55, 1200],
      [500_00, 0],
    ]) {
      for (const intraState of [true, false]) {
        const a = invoiceAmounts({ lines: [{ quantity: 1, unitPricePaise: paise }], discountPaise: 0, gstRateBp: rateBp, intraState });
        const gst = gstFor(paise, rateBp);
        expect(a).toMatchObject({ subtotalPaise: paise, taxablePaise: paise, gstPaise: gst, ...splitGst(gst, intraState), totalPaise: paise + gst });
      }
    }
  });

  it("takes the discount off before GST", () => {
    const a = invoiceAmounts({ lines: [{ quantity: 3, unitPricePaise: 650_000 }, { quantity: 1, unitPricePaise: 50_000 }], discountPaise: 150_000, gstRateBp: 1200, intraState: true });
    expect(a).toEqual({ subtotalPaise: 2_000_000, discountPaise: 150_000, taxablePaise: 1_850_000, gstPaise: 222_000, cgstPaise: 111_000, sgstPaise: 111_000, igstPaise: 0, totalPaise: 2_072_000 });
  });
});
