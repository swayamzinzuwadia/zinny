/**
 * sendEmail / sendSms / storage (contracts.md section 7). Everyone calls these from
 * `@/server/core`; they use the transports a module registers (notifications-delivery)
 * and print to the console until then.
 */
import { consoleMailTransport, type MailMessage } from "@/contracts/mail";
import { consoleSmsTransport, type SmsMessage } from "@/contracts/sms";
import { storageFromEnv, type Storage } from "@/contracts/storage";
import { mailTransport, smsTransport } from "./registry";

export async function sendEmail(message: MailMessage) {
  return (mailTransport() ?? consoleMailTransport).send(message);
}

export async function sendSms(message: SmsMessage) {
  return (smsTransport() ?? consoleSmsTransport).send(message);
}

let cached: { key: string; storage: Storage } | null = null;

/** The configured storage (local disk by default, S3-compatible with STORAGE_DRIVER=s3). */
export function storage(): Storage {
  const key = [process.env.STORAGE_DRIVER, process.env.STORAGE_DIR, process.env.S3_ENDPOINT, process.env.S3_BUCKET, process.cwd()].join("|");
  if (!cached || cached.key !== key) cached = { key, storage: storageFromEnv() };
  return cached.storage;
}
