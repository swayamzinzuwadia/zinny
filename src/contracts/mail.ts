/**
 * Email contract (contracts.md section 7). Everyone calls `sendEmail` from
 * `@/server/core`; notifications-delivery registers the real transport through
 * `mailTransport`. Until then this console transport prints each message.
 */
export type MailMessage = {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  /** Optional: what kind of message this is ("identity.invite", "security.reset", …). */
  kind?: string;
  /** Optional: the university the message is about, for branding and preferences. */
  universityId?: string | null;
  replyTo?: string;
};

export interface MailTransport {
  name: string;
  send(message: MailMessage): Promise<{ id?: string }>;
}

export const consoleMailTransport: MailTransport = {
  name: "console",
  async send(m) {
    const to = Array.isArray(m.to) ? m.to.join(", ") : m.to;
    console.log(`[mail] to ${to}${m.kind ? ` (${m.kind})` : ""}: ${m.subject}\n${m.text}\n`);
    return {};
  },
};
