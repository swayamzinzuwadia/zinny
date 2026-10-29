import type { ZinnyModule } from "@/contracts/module";
import { cleanupDeliveries, runDeliveryJob, sendDirectEmail, sendDirectSms } from "./delivery";
import { activeProviders } from "./providers";
import { seed } from "./seed";

/**
 * notifications-delivery: email, SMS and WhatsApp delivery, templates and preferences.
 * Brief: .claude/agents/notifications-delivery.md
 *
 * The transports make every module's sendEmail()/sendSms() real: Resend for email and MSG91
 * for SMS when their keys are set, the console otherwise. Messages about a university are
 * branded, logged in notif_deliveries, respect unsubscribes and quiet hours, and retry.
 */
const notificationsDelivery: ZinnyModule = {
  id: "notifications-delivery",
  mailTransport: {
    get name() {
      return activeProviders().email.name;
    },
    send: (message) => sendDirectEmail(message),
  },
  smsTransport: {
    get name() {
      return activeProviders().sms.name;
    },
    send: (message) => sendDirectSms(message),
  },
  jobs: [
    // Turns new in-app notifications into emails and texts, sends what's due and retries failures.
    { id: "notifications-delivery.deliver", every: "minute", run: async (actor) => void (await runDeliveryJob(actor)) },
    { id: "notifications-delivery.cleanup", every: "day", run: async (actor) => void (await cleanupDeliveries(actor)) },
  ],
  seed,
};

export default notificationsDelivery;
