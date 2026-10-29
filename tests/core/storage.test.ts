import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertValidKey, localStorage, presignUrl, storageFromEnv, verifyLocal } from "@/contracts/storage";
import { consoleMailTransport } from "@/contracts/mail";
import { sendEmail, sendSms } from "@/server/core";

const dir = mkdtempSync(join(tmpdir(), "zinny-storage-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const UNI = "11111111-2222-3333-4444-555555555555";

describe("contracts section 7: storage", () => {
  it("keys must start with the university id and a module id", () => {
    expect(() => assertValidKey(`${UNI}/assignments-polls/a1/report.pdf`)).not.toThrow();
    expect(() => assertValidKey(`assignments-polls/a1/report.pdf`)).toThrow(/university id/);
    expect(() => assertValidKey(`${UNI}/somebody-else/a.pdf`)).toThrow(/module id/);
    expect(() => assertValidKey(`${UNI}/payments`)).toThrow(/file path/);
    expect(() => assertValidKey(`${UNI}/payments/../../etc/passwd`)).toThrow();
    expect(() => assertValidKey(`${UNI}/payments/a/<script>.pdf`)).toThrow();
  });

  it("local disk: put, get, signed URL and delete", async () => {
    const s = localStorage(dir);
    const key = `${UNI}/payments/invoices/DEMO-26-27-00001.pdf`;
    expect(await s.put({ key, body: "hello", contentType: "application/pdf" })).toEqual({ key, size: 5 });
    const got = await s.get(key);
    expect(got?.body.toString()).toBe("hello");
    expect(got?.contentType).toBe("application/pdf");

    const url = new URL(await s.signedUrl(key, 600, { downloadName: "invoice.pdf" }), "http://localhost");
    expect(url.pathname).toBe(`/api/storage/${UNI}/payments/invoices/DEMO-26-27-00001.pdf`);
    const exp = Number(url.searchParams.get("exp"));
    const sig = url.searchParams.get("sig")!;
    expect(verifyLocal(key, exp, "invoice.pdf", sig)).toBe(true);
    expect(verifyLocal(key, exp, "other.pdf", sig)).toBe(false);
    expect(verifyLocal(`${UNI}/payments/invoices/other.pdf`, exp, "invoice.pdf", sig)).toBe(false);
    expect(verifyLocal(key, exp, "invoice.pdf", sig, (exp + 1) * 1000)).toBe(false);

    await s.delete(key);
    expect(await s.get(key)).toBeNull();
  });

  it("chooses the driver from env", () => {
    expect(storageFromEnv({ STORAGE_DIR: dir } as unknown as NodeJS.ProcessEnv).name).toBe("local");
    expect(() => storageFromEnv({ STORAGE_DRIVER: "s3" } as unknown as NodeJS.ProcessEnv)).toThrow(/S3_ENDPOINT/);
    const s3 = storageFromEnv({
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
      S3_BUCKET: "zinny",
      S3_ACCESS_KEY_ID: "id",
      S3_SECRET_ACCESS_KEY: "secret",
    } as unknown as NodeJS.ProcessEnv);
    expect(s3.name).toBe("s3");
  });

  it("S3 presigned URLs match the AWS Signature V4 reference example", () => {
    // From the AWS S3 docs, "Authenticating Requests: Using Query Parameters (AWS Signature Version 4)".
    const url = presignUrl({
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/test.txt",
      region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      expiresInSeconds: 86400,
      now: new Date("2013-05-24T00:00:00Z"),
    });
    expect(url).toContain("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
  });

  it("S3 signed URLs point at the object in the bucket", async () => {
    const s3 = storageFromEnv({
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com/",
      S3_BUCKET: "zinny",
      S3_ACCESS_KEY_ID: "id",
      S3_SECRET_ACCESS_KEY: "secret",
    } as unknown as NodeJS.ProcessEnv);
    const u = new URL(await s3.signedUrl(`${UNI}/certificates/c1/My Cert.pdf`, 600));
    expect(u.origin + u.pathname).toBe(`https://acct.r2.cloudflarestorage.com/zinny/${UNI}/certificates/c1/My%20Cert.pdf`);
    expect(u.searchParams.get("X-Amz-Expires")).toBe("600");
  });
});

describe("contracts section 7: email and SMS", () => {
  it("sendEmail and sendSms use the console transports until a module registers real ones", async () => {
    expect(consoleMailTransport.name).toBe("console");
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => void logs.push(a.join(" "));
    try {
      await sendEmail({ to: "a@b.test", subject: "Hello", html: "<p>Hi</p>", text: "Hi" });
      await sendSms({ to: "+919800000001", text: "Code 123456" });
    } finally {
      console.log = orig;
    }
    expect(logs.join("\n")).toMatch(/\[mail\] to a@b.test: Hello/);
    expect(logs.join("\n")).toMatch(/\[sms\] to \+919800000001: Code 123456/);
  });
});
