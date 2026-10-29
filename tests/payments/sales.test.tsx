import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { prerenderToNodeStream } from "react-dom/static.node";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog } from "@/db/schema";
import { universityLite, withTenant, type Actor } from "@/server/core";
import { payInTestMode } from "@/modules/payments/checkout";
import { refundOrder } from "@/modules/payments/refunds";
import { csvCell, financeAttention, orderDetail, parseFilters, salesCsv, salesOverview } from "@/modules/payments/sales";
import { getInvoiceSettings, updateInvoiceSettings } from "@/modules/payments/settings";
import { paidCourse, startCheckout } from "./helpers";

// The pages read the signed-in person from the session; tests hand them an actor directly.
const session = vi.hoisted(() => ({ current: null as null | { actor: unknown; university: unknown } }));
vi.mock("@/server/context", () => ({
  spaceContext: async () => {
    if (!session.current) throw new Error("no session");
    return { ...session.current, isAdminUser: true, isLearner: false, isParent: false };
  },
}));

afterAll(closeDb);

async function html(node: ReactNode) {
  const { prelude } = await prerenderToNodeStream(<>{node}</>);
  let out = "";
  for await (const chunk of prelude) out += chunk.toString();
  return out.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
}

type World = Awaited<ReturnType<typeof paidCourse>> & { orders: Record<string, string>; students: Record<string, Actor> };
let w: World;

beforeAll(async () => {
  const c = await paidCourse("Sales University");
  const students: Record<string, Actor> = {};
  const orders: Record<string, string> = {};
  for (const name of ["Riya Sharma", "Kabir Mehta", "Aditi Rao", "Ishaan Gupta"]) {
    students[name] = await c.student(name);
    orders[name] = (await startCheckout(students[name], c.batch.id)).orderId;
  }
  // Riya, Kabir and Aditi pay; Ishaan doesn't. Kabir gets ₹2,000 back, Aditi everything.
  for (const name of ["Riya Sharma", "Kabir Mehta", "Aditi Rao"]) await payInTestMode(students[name], orders[name]);
  await refundOrder(c.accounts, { orderId: orders["Kabir Mehta"], amountPaise: 200_000, reason: "Scholarship" });
  await refundOrder(c.accounts, { orderId: orders["Aditi Rao"], amountPaise: 1_180_000, reason: "Withdrew in week one" });
  w = { ...c, orders, students };
});

async function renderSales(actor: Actor, search: Record<string, string> = {}) {
  const university = await withTenant(actor, (tx) => universityLite(tx));
  session.current = { actor, university };
  const { default: SalesPage } = await import("@/app/[uni]/admin/finance/sales/page");
  return html(await SalesPage({ params: Promise.resolve({ uni: university.slug }), searchParams: Promise.resolve(search) }));
}

describe("Sales page access", () => {
  it("HOD and faculty can't open the Sales page (page and service)", async () => {
    for (const who of [w.hod, w.faculty]) {
      const page = await renderSales(who);
      expect(page).toContain("You don't have access to Sales");
      expect(page).not.toContain("Riya Sharma");
      expect(page).not.toContain("Gross collected");
      await expect(salesOverview(who, {})).rejects.toThrow(/access/);
      await expect(orderDetail(who, w.orders["Riya Sharma"])).rejects.toThrow(/access/);
      await expect(salesCsv(who, {})).rejects.toThrow(/access/);
      expect(await financeAttention(who)).toBeNull();
    }
    await expect(salesOverview(w.students["Riya Sharma"], {})).rejects.toThrow(/access/);
  });

  it("Accounts sees the orders, totals and the refund form", async () => {
    const page = await renderSales(w.accounts, { order: w.orders["Riya Sharma"] });
    expect(page).toContain("Gross collected");
    expect(page).toContain("Riya Sharma");
    expect(page).toContain("TU/");
    expect(page).toContain("Send refund");
    expect(page).toContain("Export CSV");
  });

  it("the Board views Sales without the refund form", async () => {
    const page = await renderSales(w.board, { order: w.orders["Riya Sharma"] });
    expect(page).toContain("Gross collected");
    expect(page).toContain("Riya Sharma");
    expect(page).not.toContain("Send refund");
    const d = await orderDetail(w.board, w.orders["Riya Sharma"]);
    expect(d.can).toEqual({ refund: false, refundAccess: false, manage: false });
  });
});

describe("Sales data", () => {
  it("totals: gross, GST, refunds and net over what the filters match", async () => {
    const all = await salesOverview(w.accounts, {});
    expect(all.totals).toMatchObject({
      grossPaise: 3 * 1_180_000,
      gstPaise: 3 * 180_000,
      refundsPaise: 200_000 + 1_180_000,
      netPaise: 3 * 1_180_000 - 1_380_000,
      paidOrders: 3,
      matched: 4,
    });
    const byStatus = Object.fromEntries(all.rows.map((r) => [r.studentName, r.display]));
    expect(byStatus).toEqual({ "Riya Sharma": "paid", "Kabir Mehta": "partly_refunded", "Aditi Rao": "refunded", "Ishaan Gupta": "pending" });
    expect(all.rows.find((r) => r.studentName === "Kabir Mehta")).toMatchObject({ refundedPaise: 200_000 });
    expect(all.can).toEqual({ refund: true, manage: true });
  });

  it("filters by status, course, batch, date and student", async () => {
    const names = async (f: Parameters<typeof salesOverview>[1]) => (await salesOverview(w.accounts, f)).rows.map((r) => r.studentName).sort();
    expect(await names({ status: "paid" })).toEqual(["Riya Sharma"]);
    expect(await names({ status: "partly_refunded" })).toEqual(["Kabir Mehta"]);
    expect(await names({ status: "refunded" })).toEqual(["Aditi Rao"]);
    expect(await names({ status: "pending" })).toEqual(["Ishaan Gupta"]);
    expect(await names({ q: "kabir" })).toEqual(["Kabir Mehta"]);
    expect(await names({ q: w.students["Aditi Rao"].email.toUpperCase() })).toEqual(["Aditi Rao"]);
    expect(await names({ q: "%" })).toEqual([]);
    expect(await names({ courseId: w.course.id })).toHaveLength(4);
    expect(await names({ batchId: w.batch.id })).toHaveLength(4);
    expect(await names({ courseId: "00000000-0000-0000-0000-000000000000" })).toEqual([]);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    expect(await names({ from: today, to: today })).toHaveLength(4);
    expect(await names({ from: "2001-01-01", to: "2001-12-31" })).toEqual([]);
    const totals = (await salesOverview(w.accounts, { status: "partly_refunded" })).totals;
    expect(totals).toMatchObject({ grossPaise: 1_180_000, refundsPaise: 200_000, netPaise: 980_000 });
  });

  it("reads filters from the URL safely", () => {
    expect(parseFilters({ from: "2026-10-01", to: "bad", status: "paid", course: "x", q: "  riya ", page: "3" })).toEqual({ from: "2026-10-01", status: "paid", q: "riya", page: 3 });
    expect(parseFilters({ status: "drop table", page: "-1" })).toEqual({});
  });

  it("the order detail has payment ids, invoice and refund history", async () => {
    const d = await orderDetail(w.accounts, w.orders["Kabir Mehta"]);
    expect(d.order.gatewayPaymentId).toMatch(/^mock_pay_/);
    expect(d.invoice?.number).toMatch(/^TU\//);
    expect(d.refunds).toEqual([expect.objectContaining({ amountPaise: 200_000, status: "processed", reason: "Scholarship", requestedByName: "Arun Accounts" })]);
    expect(d.refundablePaise).toBe(980_000);
    expect(d.can.refund).toBe(true);
    const done = await orderDetail(w.accounts, w.orders["Aditi Rao"]);
    expect(done.refundablePaise).toBe(0);
    expect(done.can).toMatchObject({ refund: false, refundAccess: true });
    const other = await paidCourse("Sales Other U");
    await expect(orderDetail(other.accounts, w.orders["Kabir Mehta"])).rejects.toThrow(/Order not found/);
  });

  it("exports the filtered orders as CSV (logged), safe to open in a spreadsheet", async () => {
    const { csv, rows } = await salesCsv(w.accounts, { status: "partly_refunded" });
    expect(rows).toBe(1);
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe(
      "Date,Order id,Student,Email,Course,Batch,Status,Taxable value (INR),GST (INR),Total (INR),Refunded (INR),Net (INR),GST invoice,Gateway,Gateway order id,Gateway payment id",
    );
    expect(lines[1]).toContain(",Kabir Mehta,");
    expect(lines[1]).toContain(",Partly refunded,10000.00,1800.00,11800.00,2000.00,9800.00,TU/");
    const log = await systemDb().select().from(auditLog).where(eq(auditLog.action, "sales.export"));
    expect(log.some((l) => l.actorUserId === w.accounts.userId)).toBe(true);
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+91 98")).toBe("'+91 98");
    expect(csvCell('Say "hi", ok')).toBe('"Say ""hi"", ok"');
  });

  it("the dashboard card lists refund_due orders for Accounts", async () => {
    expect((await financeAttention(w.accounts))?.dueCount).toBe(0);
  });
});

describe("invoice settings", () => {
  it("defaults to SAC 999293 with no footer, and shows the seller details core keeps", async () => {
    const c = await paidCourse("Settings Default U");
    const s = await getInvoiceSettings(c.board);
    expect(s).toMatchObject({ sacCode: "999293", invoiceFooter: "", saved: false, canEdit: false });
    expect(s.seller).toMatchObject({ legalName: "Settings Default U Trust", gstin: "27AAAAA0000A1Z5", state: "Maharashtra (27)", invoicePrefix: "TU" });
    expect(s.gaps).toEqual(["the registered address"]);
  });

  it("finance.manage edits them (Accounts, Admin); Board, HOD and faculty can't", async () => {
    const c = await paidCourse("Settings Edit U");
    await expect(updateInvoiceSettings(c.accounts, { sacCode: "9992 93", invoiceFooter: "  Fees help: fees@x.edu  " })).resolves.toMatchObject({ sacCode: "999293", invoiceFooter: "Fees help: fees@x.edu" });
    await expect(updateInvoiceSettings(c.admin, { sacCode: "9992", invoiceFooter: "" })).resolves.toMatchObject({ sacCode: "9992" });
    for (const who of [c.board, c.hod, c.faculty]) {
      await expect(updateInvoiceSettings(who, { sacCode: "999293", invoiceFooter: "" })).rejects.toThrow(/access/);
    }
    await expect(getInvoiceSettings(c.hod)).rejects.toThrow(/access/);
    await expect(updateInvoiceSettings(c.accounts, { sacCode: "123456", invoiceFooter: "" })).rejects.toThrow(/starts with 99/);
    await expect(updateInvoiceSettings(c.accounts, { sacCode: "99929", invoiceFooter: "" })).rejects.toThrow(/4 or 6 digits/);
    await expect(updateInvoiceSettings(c.accounts, { sacCode: "999293", invoiceFooter: "x".repeat(601) })).rejects.toThrow(/under 600/);
    expect((await getInvoiceSettings(c.accounts)).canEdit).toBe(true);
  });
});
