/** Student KYC: the PAN encrypted and masked, only the last 4 Aadhaar digits, consent. */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { closeDb, systemDb } from "@/db/client";
import { auditLog } from "@/db/schema";
import { loadActor } from "@/server/actor";
import { decryptSecret, encryptSecret, kycKey, maskPan } from "@/modules/onboarding/lib/crypto";
import { checkAadhaarLast4, kycStatus, saveKyc } from "@/modules/onboarding/services/kyc";
import { KYC_NOTICE_VERSION } from "@/modules/onboarding/lib/constants";
import { onbStudentKyc } from "@/modules/onboarding/schema";
import { grant, makeUniversity, makeUser } from "../fixtures";

afterAll(closeDb);

async function student() {
  const uni = await makeUniversity("KYC Uni");
  const u = await makeUser("Kyc Student");
  await grant(u.id, "student", { universityId: uni.id });
  return loadActor(u.id, uni.id, { session: null });
}

describe("PAN encryption", () => {
  it("round-trips, with a fresh IV each time", () => {
    const a = encryptSecret("ABCDE1234F");
    const b = encryptSecret("ABCDE1234F");
    expect(a).not.toBe(b);
    expect(a).not.toContain("ABCDE1234F");
    expect(decryptSecret(a)).toBe("ABCDE1234F");
    expect(decryptSecret(b)).toBe("ABCDE1234F");
  });

  it("can't be read with another key, or after tampering", () => {
    const stored = encryptSecret("ABCDE1234F");
    expect(() => decryptSecret(stored, randomBytes(32))).toThrow();
    const parts = stored.split(".");
    parts[3] = Buffer.from("XXXXX9999X").toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("reads KYC_ENCRYPTION_KEY as hex or base64, and needs one in production", () => {
    const key = randomBytes(32);
    expect(kycKey({ KYC_ENCRYPTION_KEY: key.toString("hex") } as unknown as NodeJS.ProcessEnv).equals(key)).toBe(true);
    expect(kycKey({ KYC_ENCRYPTION_KEY: key.toString("base64") } as unknown as NodeJS.ProcessEnv).equals(key)).toBe(true);
    expect(() => kycKey({ KYC_ENCRYPTION_KEY: "short" } as unknown as NodeJS.ProcessEnv)).toThrow(/32 bytes/);
    expect(() => kycKey({ NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toThrow(/not set/);
    expect(kycKey({ NODE_ENV: "development" } as unknown as NodeJS.ProcessEnv)).toHaveLength(32);
  });

  it("masks the PAN to its last 5 characters", () => {
    expect(maskPan("abcde1234f")).toBe("XXXXX1234F");
  });
});

describe("Aadhaar", () => {
  it("takes only the last 4 digits", () => {
    expect(checkAadhaarLast4("1234")).toBe("1234");
    expect(checkAadhaarLast4("")).toBeNull();
  });
  it("refuses a full Aadhaar number", () => {
    expect(() => checkAadhaarLast4("1234 5678 9012")).toThrow(/only the last 4 digits/);
    expect(() => checkAadhaarLast4("123456789012")).toThrow(expect.objectContaining({ code: "aadhaar_full" }));
    expect(() => checkAadhaarLast4("12a4")).toThrow();
  });
});

describe("saving KYC", () => {
  it("stores the PAN encrypted, shows it masked, and records consent", async () => {
    const s = await student();
    const now = new Date("2026-11-19T06:00:00Z");
    expect(await saveKyc(s, { pan: "bxrps4821k", aadhaarLast4: "4821", consent: true }, now)).toBe("XXXXX4821K");
    const [row] = await systemDb().select().from(onbStudentKyc).where(eq(onbStudentKyc.userId, s.userId));
    expect(row.panCipher).not.toContain("BXRPS4821K");
    expect(decryptSecret(row.panCipher)).toBe("BXRPS4821K");
    expect(row).toMatchObject({ panMasked: "XXXXX4821K", aadhaarLast4: "4821", consentNoticeVersion: KYC_NOTICE_VERSION, consentAt: now });
    expect(await kycStatus(s)).toMatchObject({ done: true, panMasked: "XXXXX4821K" });
    const log = await systemDb().select().from(auditLog).where(eq(auditLog.entityId, row.id));
    expect(JSON.stringify(log)).not.toContain("BXRPS4821K");
  });

  it("refuses a bad PAN, a full Aadhaar or no consent, and stores nothing", async () => {
    const s = await student();
    await expect(saveKyc(s, { pan: "12345", aadhaarLast4: "", consent: true })).rejects.toThrow(/PAN doesn't look right/);
    await expect(saveKyc(s, { pan: "ABCDE1234F", aadhaarLast4: "123456789012", consent: true })).rejects.toThrow(/last 4 digits/);
    await expect(saveKyc(s, { pan: "ABCDE1234F", aadhaarLast4: "", consent: false })).rejects.toThrow(/Tick the box/);
    expect(await kycStatus(s)).toEqual({ done: false });
  });

  it("updates in place", async () => {
    const s = await student();
    await saveKyc(s, { pan: "ABCDE1234F", aadhaarLast4: "", consent: true });
    await saveKyc(s, { pan: "PQRST6789Z", aadhaarLast4: "1111", consent: true });
    const rows = await systemDb().select().from(onbStudentKyc).where(eq(onbStudentKyc.userId, s.userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].panMasked).toBe("XXXXX6789Z");
  });
});
