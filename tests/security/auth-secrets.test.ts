/**
 * AUTH-06: the key for the HMAC over 6-digit phone codes fell back to a constant written in the
 * source code when AUTH_SECRET and CRON_SECRET were missing, on production builds too. With a
 * copy of the database, every stored code could then be worked out offline in moments.
 */
import { describe, expect, it } from "vitest";
import { authSecret } from "@/server/auth/tokens";

const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;

describe("AUTH-06: the phone-code key", () => {
  it("is never the public development constant on a production build", () => {
    expect(() => authSecret(env({ NODE_ENV: "production" }))).toThrow(/AUTH_SECRET/);
    expect(() => authSecret(env({ NODE_ENV: "production", AUTH_SECRET: "" }))).toThrow(/AUTH_SECRET/);
  });

  it("uses AUTH_SECRET, then CRON_SECRET, and the constant only outside production", () => {
    expect(authSecret(env({ NODE_ENV: "production", AUTH_SECRET: "a-long-random-secret", CRON_SECRET: "cron" }))).toBe("a-long-random-secret");
    expect(authSecret(env({ NODE_ENV: "production", CRON_SECRET: "cron-secret" }))).toBe("cron-secret");
    expect(authSecret(env({ NODE_ENV: "development" }))).toBe("zinny-dev-auth-secret");
  });
});
