import type { ZinnyModule } from "@/contracts/module";
import { activeProviders } from "./providers";

/**
 * notifications-delivery: email, SMS and WhatsApp delivery, templates and preferences.
 * Brief: .claude/agents/notifications-delivery.md
 *
 * The transports make every module's sendEmail()/sendSms() real: Resend for email and MSG91
 * for SMS when their keys are set, the console otherwise. Messages about a university are
 * branded, logged in notif_deliveries, respect unsubscribes and quiet hours, and retry.
 *
 * The delivery code is loaded on first use. It imports the core API, which imports the
 * registry, which imports this file: loading it eagerly would make that a cycle in which the
 * registry could see this module before it is defined.
 */
const delivery = () => import("./delivery");

const notificationsDelivery: ZinnyModule = {
  id: "notifications-delivery",
  mailTransport: {
    get name() {
      return activeProviders().email.name;
    },
    send: async (message) => (await delivery()).sendDirectEmail(message),
  },
  smsTransport: {
    get name() {
      return activeProviders().sms.name;
    },
    send: async (message) => (await delivery()).sendDirectSms(message),
  },
  jobs: [
    {
      // Turns new in-app notifications into emails and texts, sends what's due and retries failures.
      id: "notifications-delivery.deliver",
      every: "minute",
      run: async (actor) => void (await (await delivery()).runDeliveryJob(actor)),
    },
    {
      // Drops bookkeeping past the planning window and delivery records older than 180 days.
      id: "notifications-delivery.cleanup",
      every: "day",
      run: async (actor) => void (await (await delivery()).cleanupDeliveries(actor)),
    },
  ],
  seed: async (ctx) => (await import("./seed")).seed(ctx),
};

export default notificationsDelivery;
