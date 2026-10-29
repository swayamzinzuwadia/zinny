import type { ZinnyModule } from "@/contracts/module";
import type { PaymentGateway } from "@/contracts/payments";
import { RefundsDueCard } from "./components/finance-card";
import { InvoicesHubSection } from "./components/invoices-hub-section";
import { razorpayFromEnv } from "./config";
import { handlers } from "./events";
import { jobs } from "./jobs";
import { seed } from "./seed";

/**
 * payments: Razorpay checkout and webhooks, refunds, GST invoice PDFs and the Sales page.
 * Brief: .claude/agents/payments.md
 */
const payments: ZinnyModule = {
  id: "payments",
  /**
   * Razorpay when RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set (read on each use, so a
   * changed environment applies without a code change); otherwise nothing, and core keeps
   * its mock gateway.
   */
  get paymentGateway(): PaymentGateway | undefined {
    return razorpayFromEnv() ?? undefined;
  },
  eventHandlers: handlers,
  jobs,
  seed,
  learnerHubSections: [{ key: "invoices", order: 700, action: "self.view_invoices", component: InvoicesHubSection }],
  dashboardCards: [{ key: "refunds-due", order: 700, action: "finance.refund", component: RefundsDueCard }],
};

export default payments;
