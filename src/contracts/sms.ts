/**
 * SMS contract (contracts.md section 7). Everyone calls `sendSms` from
 * `@/server/core`; notifications-delivery registers the real transport through
 * `smsTransport`. Until then this console transport prints each message.
 */
export type SmsMessage = {
  /** E.164, e.g. "+919800000001". */
  to: string;
  text: string;
  /** Optional: what kind of message this is ("security.otp", …). DLT template ids are chosen per kind. */
  kind?: string;
  universityId?: string | null;
};

export interface SmsTransport {
  name: string;
  send(message: SmsMessage): Promise<{ id?: string }>;
}

export const consoleSmsTransport: SmsTransport = {
  name: "console",
  async send(m) {
    console.log(`[sms] to ${m.to}${m.kind ? ` (${m.kind})` : ""}: ${m.text}`);
    return {};
  },
};
