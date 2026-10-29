/**
 * Demo data for the Demo University: delivery settings, a few customised kinds, learners'
 * own preferences, and a realistic delivery log (sent, waiting for the morning, retrying,
 * failed and skipped), all written through the services or the delivery engine.
 */
import type { SeedContext } from "@/contracts/module";
import { audit, universityLite, withTenant } from "@/server/core";
import { runDeliveryJob } from "./delivery";
import { consoleEmailProvider, consoleSmsProvider, consoleWhatsappProvider, ProviderError, type Providers } from "./providers";
import { notifDeliveries } from "./schema";
import { saveDeliverySettings, saveKindSettings, savePreferences } from "./service";
import { localClock, QUIET_END_MINUTES, safeTimezone, zonedInstant } from "./time";

const quietly = <T,>(fn: () => Promise<T>) => async () => {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
};

export async function seed(ctx: SeedContext) {
  const admin = await ctx.actorFor("asha@demo.edu");

  await saveDeliverySettings(admin, { replyTo: "office@demo.edu" });

  // Timetable changes go out by SMS too, with a DLT template registered for them.
  await saveKindSettings(admin, "timetable.changed", {
    channels: { email: "on", sms: "on", whatsapp: "optional" },
    emailSubject: "Timetable update: {{title}}",
    emailBody:
      "Hi {{firstName}},\n\n{{body}}\n\nYour timetable in Zinny already shows the change. If the new timing clashes with something, reply to this email and the office will help.",
    smsText: "{{university}}: {{title}}. Timetable: {{link}}",
    smsTemplateId: "6650a1b2c3d4e5f6a7b8c9d0",
    whatsappTemplate: "timetable_update",
  });
  await saveKindSettings(admin, "enrolment.confirmed", {
    channels: { email: "on", sms: "optional", whatsapp: "optional" },
    emailSubject: "Welcome to {{university}}: {{title}}",
    emailBody:
      "Hi {{firstName}},\n\n{{body}}\n\nBefore your first class, open Zinny on your phone so your timetable is always with you. See you in class.",
    smsText: "{{university}}: {{title}}. Details: {{link}}",
    smsTemplateId: "6650a1b2c3d4e5f6a7b8c9d1",
  });
  // Refund alerts are urgent for the accounts team: staff may add SMS for them.
  await saveKindSettings(admin, "finance.refund_due", {
    channels: { email: "on", sms: "optional", whatsapp: "off" },
    emailSubject: "Action needed: {{title}}",
    emailBody: "Hi {{firstName}},\n\n{{body}}\n\nRefund it from Sales within two working days.",
    smsText: "{{university}}: {{title}}. {{link}}",
  });
  await saveKindSettings(admin, "security.otp", { smsTemplateId: "6650a1b2c3d4e5f6a7b8c9d2" });

  // Learners' own choices: Riya wants WhatsApp for timetable changes and no SMS; Kabir wants SMS for his enrolments.
  const riya = await ctx.actorFor("riya@demo.edu");
  await savePreferences(riya, riya.userId, [
    { kind: "timetable.changed", channel: "whatsapp", enabled: true },
    { kind: "timetable.changed", channel: "sms", enabled: false },
  ]);
  const kabir = await ctx.actorFor("kabir@demo.edu");
  await savePreferences(kabir, kabir.userId, [{ kind: "enrolment.confirmed", channel: "sms", enabled: true }]);
  const hema = await ctx.actorFor("hema@demo.edu");
  await savePreferences(hema, hema.userId, [{ kind: "batch.faculty_expiring", channel: "sms", enabled: false }]);

  // Deliver the core seed's notifications (enrolments, the switch request, the faculty alert)
  // through the console, so the log shows what a real day looks like. One address bounces,
  // to show what a failure looks like.
  const providers: Providers = {
    email: {
      name: "console",
      async send(m) {
        if (m.to === "zoya@demo.edu") throw new ProviderError("The recipient's mailbox doesn't exist (the email bounced).", false, 422);
        return consoleEmailProvider.send(m);
      },
    },
    sms: consoleSmsProvider,
    whatsapp: consoleWhatsappProvider,
  };
  // Older notifications than the first-run window are left out on purpose; the seed's are all fresh.
  await quietly(() => runDeliveryJob(ctx.systemActor, { providers, budgetMs: 60_000 }))();

  // A text that waits for the morning, as quiet hours hold texts sent between 9 pm and 8 am.
  const tz = safeTimezone((await withTenant(ctx.systemActor, (tx) => universityLite(tx))).timezone);
  const tomorrow = new Date(Date.now() + 86_400_000);
  const morning = zonedInstant(localClock(tz, tomorrow).date, QUIET_END_MINUTES, tz);
  await withTenant(ctx.systemActor, async (tx) => {
    const [row] = await tx
      .insert(notifDeliveries)
      .values({
        universityId: ctx.universityId,
        source: "direct",
        kind: "timetable.changed",
        channel: "sms",
        userId: ctx.ids.users["aditi@demo.edu"] ?? null,
        recipient: "+919812300003",
        status: "queued",
        nextAttemptAt: morning,
        payload: { text: "Demo University: Data Analytics: extra class on Sat. Timetable: http://localhost:3110/demo/learn/timetable", vars: {} },
      })
      .returning({ id: notifDeliveries.id });
    await audit(tx, ctx.systemActor, "notifications.direct_send", "notif_delivery", row.id, { kind: "timetable.changed", channel: "sms", status: "queued", seed: true });
  });
}
