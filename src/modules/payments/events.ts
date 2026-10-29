/**
 * Event handlers (contracts.md section 2). Idempotent: rendering stores the PDF once, and
 * the email is claimed with a row update, so a redelivery never sends it twice.
 */
import { defineHandler, type EventHandler } from "@/contracts/events";
import { renderAndEmailInvoice } from "./invoices";

export const handlers: EventHandler[] = [
  defineHandler({
    id: "payments.invoice-ready",
    on: ["payment.confirmed"],
    async handle({ tx, actor, event }) {
      if (!event.universityId) return;
      await renderAndEmailInvoice(tx, actor, event.payload.orderId);
    },
  }),
];
