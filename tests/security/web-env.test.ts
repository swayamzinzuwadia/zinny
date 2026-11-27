/**
 * Production secrets: the app refuses to serve in production until the secrets it would
 * otherwise replace with public development constants are set.
 */
import { describe, expect, it } from "vitest";
import { isProductionServer, productionSecretProblems } from "@/server/security/env";

const GOOD = {
  NODE_ENV: "production",
  AUTH_SECRET: "a".repeat(48),
  CRON_SECRET: "b".repeat(40),
  KYC_ENCRYPTION_KEY: "0123456789abcdef".repeat(4),
};
const names = (env: Record<string, string | undefined>) => productionSecretProblems(env).map((p) => p.name);

describe("productionSecretProblems", () => {
  it("is happy with every secret set", () => {
    expect(productionSecretProblems(GOOD)).toEqual([]);
    // A base64 key of 32 bytes works too, as the KYC module reads it.
    expect(names({ ...GOOD, KYC_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") })).toEqual([]);
  });

  it("needs AUTH_SECRET and CRON_SECRET, at least 32 characters each", () => {
    expect(names({ ...GOOD, AUTH_SECRET: undefined })).toEqual(["AUTH_SECRET"]);
    expect(names({ ...GOOD, AUTH_SECRET: "   " })).toEqual(["AUTH_SECRET"]);
    expect(names({ ...GOOD, CRON_SECRET: "short" })).toEqual(["CRON_SECRET"]);
  });

  it("needs a 32-byte KYC_ENCRYPTION_KEY, except on a demo deployment", () => {
    expect(names({ ...GOOD, KYC_ENCRYPTION_KEY: undefined })).toEqual(["KYC_ENCRYPTION_KEY"]);
    expect(names({ ...GOOD, KYC_ENCRYPTION_KEY: "abc" })).toEqual(["KYC_ENCRYPTION_KEY"]);
    expect(names({ ...GOOD, KYC_ENCRYPTION_KEY: "zz".repeat(32) })).toEqual(["KYC_ENCRYPTION_KEY"]);
    expect(names({ ...GOOD, KYC_ENCRYPTION_KEY: undefined, ZINNY_DEMO: "1" })).toEqual([]);
  });

  it("needs RAZORPAY_WEBHOOK_SECRET once live Razorpay keys are set", () => {
    expect(names({ ...GOOD, RAZORPAY_KEY_ID: "rzp_live_x" })).toEqual(["RAZORPAY_WEBHOOK_SECRET"]);
    expect(names({ ...GOOD, RAZORPAY_KEY_ID: "rzp_live_x", RAZORPAY_WEBHOOK_SECRET: "whsec" })).toEqual([]);
  });

  it("never echoes a secret's value", () => {
    const problems = productionSecretProblems({ ...GOOD, CRON_SECRET: "hunter2-hunter2" });
    expect(JSON.stringify(problems)).not.toContain("hunter2");
  });

  it("applies only to a production server", () => {
    expect(isProductionServer({ NODE_ENV: "production" })).toBe(true);
    expect(isProductionServer({ NODE_ENV: "development" })).toBe(false);
    expect(isProductionServer({ NODE_ENV: "test" })).toBe(false);
  });
});
