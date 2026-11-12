/**
 * Demo data for payments (contracts.md section 6). Institute courses are free for their
 * students, so the only orders are marketplace sales:
 *  - invoice settings for the Demo University (SAC code and footer);
 *  - the marketplace seed's purchase, partly refunded by Arun from Accounts;
 *  - invoice categories (Exam fees, Hostel, Library, Workshop, and an archived one) and
 *    invoices Arun raised in them, one in every state: unpaid, overdue, paid, cancelled.
 */
import { and, eq } from "drizzle-orm";
import type { SeedContext } from "@/contracts/module";
import { orders, users } from "@/db/schema";
import { gateway, withTenant } from "@/server/core";
import { archiveCategory, createCategory } from "./categories";
import { cancelManualInvoice, createManualInvoice, recordManualPayment } from "./manual-invoices";
import { refundOrder } from "./refunds";
import { payInvoiceDocuments } from "./schema";
import { updateInvoiceSettings } from "./settings";

export async function seed(ctx: SeedContext) {
  const arun = await ctx.actorFor("arun@demo.edu");

  await updateInvoiceSettings(arun, {
    sacCode: "999293",
    invoiceFooter:
      "Course fees are refundable in full until the batch starts, and in part for 14 days after. For billing questions, write to accounts@demo.edu.",
  });

  // The core seed's invoices were rendered (by the payment.confirmed handler) before these
  // settings existed. Demo data only: forget those renders so they come out with the
  // settings above on first download. Real invoices are never re-rendered.
  await withTenant(ctx.systemActor, (tx) => tx.delete(payInvoiceDocuments).where(eq(payInvoiceDocuments.universityId, ctx.universityId)));

  // A partly refunded order: the marketplace seed's purchase (institute courses are free for
  // their students, so marketplace sales are the only orders).
  const [sale] = await withTenant(ctx.systemActor, (tx) =>
    tx.select().from(orders).where(and(eq(orders.universityId, ctx.universityId), eq(orders.status, "paid"))).orderBy(orders.createdAt).limit(1),
  );
  if (sale && sale.gateway === gateway().name) {
    await refundOrder(arun, {
      orderId: sale.id,
      amountPaise: Math.min(100_00, sale.totalPaise),
      reason: "Goodwill refund: two lessons were missing their notes",
    });
  } else {
    console.log("  payments: skipped the partial refund (no paid marketplace order, or it was paid through another gateway).");
  }

  await seedInvoices(ctx, arun);
}

const daysBefore = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

/** Categories the institute made for itself, and invoices raised in them over the last few weeks. */
async function seedInvoices(ctx: SeedContext, arun: Awaited<ReturnType<SeedContext["actorFor"]>>) {
  const exam = await createCategory(arun, { name: "Exam fees", description: "Semester and re-sit examination fees.", defaultGstRateBp: 0, sacCode: "999294" });
  const hostel = await createCategory(arun, { name: "Hostel", description: "Room rent and mess charges.", defaultGstRateBp: 1200, sacCode: "996322" });
  const library = await createCategory(arun, { name: "Library", description: "Membership, late returns and lost books.", defaultGstRateBp: 0 });
  const workshop = await createCategory(arun, { name: "Workshop", description: "Short workshops and guest sessions, for students and outside groups.", defaultGstRateBp: 1800 });
  const transport = await createCategory(arun, { name: "Transport", description: "Bus pass. The service ended last year.", defaultGstRateBp: 500 });
  await archiveCategory(arun, transport.id);

  const idOf = async (email: string) => {
    const [u] = await withTenant(ctx.systemActor, (tx) => tx.select({ id: users.id }).from(users).where(eq(users.email, email)));
    return u?.id ?? null;
  };
  const [riya, kabir, aditi, meera] = await Promise.all(["riya@demo.edu", "kabir@demo.edu", "aditi@demo.edu", "meera@demo.edu"].map(idOf));
  if (!riya || !kabir || !aditi || !meera) {
    console.log("  payments: skipped the demo invoices (the demo students aren't there).");
    return;
  }
  const t = ctx.today;
  const due = (n: number) => {
    const d = new Date(`${t}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  // Overdue: a library fine Riya hasn't settled.
  await createManualInvoice(arun, {
    categoryId: library.id,
    userId: riya,
    lines: [
      { description: "Late return: Database System Concepts (14 days)", quantity: 14, unitPricePaise: 10_00 },
      { description: "Annual library membership", quantity: 1, unitPricePaise: 500_00 },
    ],
    issueDate: daysBefore(t, 24),
    dueDate: daysBefore(t, 10),
    notes: "Pay at the library desk or the accounts office, 10 am to 4 pm on working days.",
  });

  // Paid by bank transfer: Kabir's hostel fee, with a concession.
  const hostelInv = await createManualInvoice(arun, {
    categoryId: hostel.id,
    userId: kabir,
    buyerAddress: "Room 214, Boys' Hostel B",
    lines: [
      { description: "Hostel room rent, twin sharing (per month)", quantity: 3, unitPricePaise: 6_500_00 },
      { description: "Mess charges (per month)", quantity: 3, unitPricePaise: 3_200_00 },
    ],
    discountPaise: 1_500_00,
    discountNote: "Merit concession",
    issueDate: daysBefore(t, 20),
    dueDate: daysBefore(t, 6),
  });
  await recordManualPayment(arun, hostelInv.id, { paidOn: daysBefore(t, 12), mode: "bank_transfer", reference: "HDFCN52026110998431" });

  // Paid by UPI: a workshop for an outside group in another state (IGST).
  const workshopInv = await createManualInvoice(arun, {
    categoryId: workshop.id,
    buyerName: "Sunrise Coaching Centre",
    buyerEmail: "accounts@sunrisecoaching.example",
    buyerPhone: "080 4123 9876",
    buyerAddress: "42 Residency Road, Bengaluru 560025",
    buyerGstin: "29AAECS1234F1Z3",
    placeOfSupply: "29",
    lines: [
      { description: "Two-day workshop: Spreadsheets for teachers", quantity: 18, unitPricePaise: 1_200_00 },
      { description: "Printed workbook", quantity: 18, unitPricePaise: 150_00 },
    ],
    discountPaise: 2_000_00,
    discountNote: "Group booking",
    issueDate: daysBefore(t, 15),
    dueDate: daysBefore(t, 1),
    notes: "Venue: Seminar Hall 2. Certificates are handed out on the second day.",
  });
  await recordManualPayment(arun, workshopInv.id, { paidOn: daysBefore(t, 9), mode: "upi", reference: "431276598812" });

  // Paid in cash: Aditi's re-sit fee.
  const resit = await createManualInvoice(arun, {
    categoryId: exam.id,
    userId: aditi,
    lines: [{ description: "Re-sit examination fee: Statistics II", quantity: 1, unitPricePaise: 750_00 }],
    issueDate: daysBefore(t, 8),
    dueDate: daysBefore(t, 1),
  });
  await recordManualPayment(arun, resit.id, { paidOn: daysBefore(t, 7), mode: "cash" });

  // Cancelled: raised twice by mistake.
  const twice = await createManualInvoice(arun, {
    categoryId: exam.id,
    userId: aditi,
    lines: [{ description: "Re-sit examination fee: Statistics II", quantity: 1, unitPricePaise: 750_00 }],
    issueDate: daysBefore(t, 8),
    dueDate: daysBefore(t, 1),
  });
  await cancelManualInvoice(arun, twice.id, "Raised twice by mistake");

  // Unpaid, not yet due: semester exam fees.
  await createManualInvoice(arun, {
    categoryId: exam.id,
    userId: riya,
    lines: [
      { description: "Semester 2 examination fee", quantity: 1, unitPricePaise: 2_400_00 },
      { description: "Practical examination fee", quantity: 2, unitPricePaise: 350_00 },
    ],
    issueDate: daysBefore(t, 3),
    dueDate: due(11),
    notes: "Pay at the accounts office, or by UPI to demo.university@upi with your roll number in the note.",
  });
  await createManualInvoice(arun, {
    categoryId: hostel.id,
    userId: meera,
    buyerAddress: "Room 108, Girls' Hostel A",
    lines: [{ description: "Hostel room rent, single (per month)", quantity: 1, unitPricePaise: 9_000_00 }],
    issueDate: daysBefore(t, 1),
    dueDate: due(6),
  });
}
