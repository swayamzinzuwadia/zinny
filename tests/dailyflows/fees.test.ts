/** "Record a fee payment" and "Send reminders" for overdue invoices. */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, notifications } from "@/db/schema";
import { loadActor } from "@/server/actor";
import { todayIn } from "@/server/core";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { createManualInvoice } from "@/modules/payments/manual-invoices";
import { feeChoices, overdueFees, recordFeePayment, remindOverdueFees, REMINDER_KIND } from "@/modules/payments/fees";
import { payManualInvoices } from "@/modules/payments/schema";
import { person, setupCourse } from "../fixtures";

afterAll(closeDb);

const daysFrom = (n: number) => {
  const d = new Date(`${todayIn("Asia/Kolkata")}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function withAccounts(name: string, pricePaise = 420_000) {
  const ctx = await setupCourse({ name, pricePaise });
  const accounts = await (await person("Arun Accounts", "accounts_fees", { universityId: ctx.uni.id })).actor();
  const student = await ctx.student("Fee Student");
  return { ...ctx, accounts, student };
}

describe("recording a fee paid at the desk", () => {
  it("issues an invoice for the course, marked paid today, found by the student's email", async () => {
    const ctx = await withAccounts("Fee Record U");
    const r = await recordFeePayment(ctx.accounts, { email: `Fee Student · ${ctx.student.email}`, courseId: ctx.course.id, mode: "upi", reference: "UPI123" });
    const [inv] = await systemDb().select().from(payManualInvoices).where(eq(payManualInvoices.id, r.invoiceId));
    expect(inv).toMatchObject({ userId: ctx.student.userId, status: "paid", paymentMode: "upi", paymentReference: "UPI123", subtotalPaise: 420_000, paidOn: todayIn("Asia/Kolkata") });
    const audits = await systemDb().select().from(auditLog).where(and(eq(auditLog.entityId, inv.id)));
    expect(audits.map((a) => a.action).sort()).toEqual(["manual_invoice.create", "manual_invoice.paid"]);
  });

  it("takes an amount and a description for something other than a course", async () => {
    const ctx = await withAccounts("Fee Other U");
    const r = await recordFeePayment(ctx.accounts, { userId: ctx.student.userId, description: "Exam fee", amountPaise: 75_000, mode: "cash" });
    const [inv] = await systemDb().select().from(payManualInvoices).where(eq(payManualInvoices.id, r.invoiceId));
    expect(inv.subtotalPaise).toBe(75_000);
    await expect(recordFeePayment(ctx.accounts, { userId: ctx.student.userId, amountPaise: 75_000, mode: "cash" })).rejects.toThrow(/what the fee is for/);
    await expect(recordFeePayment(ctx.accounts, { userId: ctx.student.userId, description: "x", mode: "cash" })).rejects.toThrow(/amount/);
  });

  it("refuses someone who isn't part of the institute, and an unknown payment mode", async () => {
    const ctx = await withAccounts("Fee Refuse U");
    await expect(recordFeePayment(ctx.accounts, { email: "nobody@nowhere.example", courseId: ctx.course.id, mode: "cash" })).rejects.toBeInstanceOf(ValidationError);
    await expect(recordFeePayment(ctx.accounts, { userId: ctx.student.userId, courseId: ctx.course.id, mode: "barter" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("allows Accounts and admins, refuses HODs and faculty", async () => {
    const ctx = await withAccounts("Fee Perms U");
    const faculty = await loadActor(ctx.facultyUserId, ctx.uni.id);
    await expect(recordFeePayment(ctx.hod, { userId: ctx.student.userId, courseId: ctx.course.id, mode: "cash" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordFeePayment(faculty, { userId: ctx.student.userId, courseId: ctx.course.id, mode: "cash" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await recordFeePayment(ctx.admin, { userId: ctx.student.userId, courseId: ctx.course.id, mode: "cash" })).number).toBeTruthy();
    expect(await feeChoices(ctx.hod)).toBeNull();
    const choices = await feeChoices(ctx.accounts);
    expect(choices!.students.map((s) => s.id)).toContain(ctx.student.userId);
    expect(choices!.courses.map((c) => c.id)).toContain(ctx.course.id);
  });
});

describe("reminding overdue fees", () => {
  it("reminds each student with an overdue invoice once a day, and counts what's overdue", async () => {
    const ctx = await withAccounts("Fee Remind U");
    await createManualInvoice(ctx.accounts, { userId: ctx.student.userId, lines: [{ description: "Hostel", quantity: 1, unitPricePaise: 100_000 }], issueDate: daysFrom(-20), dueDate: daysFrom(-5) });
    await createManualInvoice(ctx.accounts, { buyerName: "Walk-in Parent", lines: [{ description: "Exam", quantity: 1, unitPricePaise: 50_000 }], issueDate: daysFrom(-20), dueDate: daysFrom(-5) });
    await createManualInvoice(ctx.accounts, { userId: ctx.student.userId, lines: [{ description: "Not due yet", quantity: 1, unitPricePaise: 10_000 }], dueDate: daysFrom(5) });
    const summary = await overdueFees(ctx.accounts);
    expect(summary).toMatchObject({ count: 2, reachable: 1 });
    expect(await remindOverdueFees(ctx.accounts)).toEqual({ sent: 1, skipped: 0 });
    expect(await remindOverdueFees(ctx.accounts)).toEqual({ sent: 0, skipped: 1 });
    const sent = await systemDb().select().from(notifications).where(and(eq(notifications.userId, ctx.student.userId), eq(notifications.kind, REMINDER_KIND)));
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toMatch(/is overdue/);
  });

  it("lets Board members see the count but only finance staff send reminders", async () => {
    const ctx = await withAccounts("Fee Remind Perms U");
    const board = await (await person("Bharat Board", "board_owner", { universityId: ctx.uni.id })).actor();
    expect((await overdueFees(board)).count).toBe(0);
    await expect(remindOverdueFees(board)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(overdueFees(ctx.hod)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await remindOverdueFees(ctx.admin)).toEqual({ sent: 0, skipped: 0 });
  });
});
