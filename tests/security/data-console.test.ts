/**
 * The data console (/platform/data) as a high-risk area (security review DATA-05, DATA-06):
 *   - KYC data (the encrypted PAN, Aadhaar digits) is masked like password and token hashes:
 *     never shown, searched, filtered, sorted, written or logged;
 *   - the audit trail and the event log can be read but not changed, so a Super Admin can't
 *     erase the record of what they did;
 *   - only a Super Admin with a current assignment gets in; names in the request are never SQL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, domainEvents, users } from "@/db/schema";
import { loadActor } from "@/server/actor";
import type { Actor } from "@/server/core";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { deleteRows, describeTable, getRow, insertRow, isSecretColumn, listRows, listTables, updateRow } from "@/modules/zinny-team-panel/data-console";
import { saveKyc } from "@/modules/onboarding/services/kyc";
import { onbStudentKyc } from "@/modules/onboarding/schema";
import { grant, makeUniversity, makeUser, person } from "../fixtures";
import { team } from "../zinny-team-panel/helpers";

afterAll(closeDb);

let sa: Actor;
let uni: { id: string };
let kycId: string;
let studentId: string;

beforeAll(async () => {
  sa = await team("Sec Console Super", "super_admin");
  uni = await makeUniversity("Sec Console Institute");
  const s = await person("Kyc Student", "student", { universityId: uni.id });
  studentId = s.user.id;
  await saveKyc(await s.actor(), { pan: "BXRPS4821K", aadhaarLast4: "4821", consent: true });
  const [row] = await systemDb().select().from(onbStudentKyc).where(eq(onbStudentKyc.userId, studentId));
  kycId = row.id;
});

describe("KYC data is masked like credentials", () => {
  it("treats the encrypted PAN and Aadhaar digits as secret columns", () => {
    expect(["pan_cipher", "aadhaar_last4", "code_hash", "nonce_hash", "otp_code", "api_key"].every(isSecretColumn)).toBe(true);
    // The masked PAN is what everyone may see, and ordinary columns stay visible.
    expect(["pan_masked", "name", "notes", "photo", "consent_notice_version"].some(isSecretColumn)).toBe(false);
  });

  it("never shows them in a list or on the row page", async () => {
    const page = await listRows(sa, "onb_student_kyc", { universityId: uni.id });
    const row = page.rows.find((r) => r.values.id === kycId)!;
    expect(row.values.pan_masked).toBe("XXXXX4821K");
    expect(row.values.pan_cipher).toBe("••••••");
    expect(row.values.aadhaar_last4).toBe("••••••");
    const one = await getRow(sa, "onb_student_kyc", [kycId]);
    expect(one.row.values.pan_cipher).toBe("••••••");
    expect(one.row.values.aadhaar_last4).toBe("••••••");
    expect(JSON.stringify(one)).not.toContain("BXRPS4821K");
    expect(JSON.stringify(one)).not.toMatch(/v1\.[A-Za-z0-9_-]+\./);
  });

  it("can't be used to search, filter or sort, so the values can't be guessed one query at a time", async () => {
    const [stored] = await systemDb().select().from(onbStudentKyc).where(eq(onbStudentKyc.id, kycId));
    const search = await listRows(sa, "onb_student_kyc", { q: stored.panCipher.slice(3, 20) });
    expect(search.rows.map((r) => r.values.id)).not.toContain(kycId);
    const digits = await listRows(sa, "onb_student_kyc", { q: "4821" });
    // "4821" is in the masked PAN, which may be searched; the Aadhaar column is not what matched.
    expect(digits.rows.every((r) => r.values.aadhaar_last4 === "••••••")).toBe(true);
    await expect(listRows(sa, "onb_student_kyc", { filter: "aadhaar_last4", value: "4821" })).rejects.toBeInstanceOf(ValidationError);
    await expect(listRows(sa, "onb_student_kyc", { filter: "pan_cipher", value: stored.panCipher })).rejects.toBeInstanceOf(ValidationError);
    await expect(listRows(sa, "onb_student_kyc", { sort: "pan_cipher" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("can't be written, and the activity log never holds them", async () => {
    await expect(updateRow(sa, "onb_student_kyc", [kycId], { pan_cipher: "v1.a.b.c" })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateRow(sa, "onb_student_kyc", [kycId], { aadhaar_last4: "0000" })).rejects.toBeInstanceOf(ValidationError);
    await updateRow(sa, "onb_student_kyc", [kycId], { consent_notice_version: "2026-11-v1-checked" });
    const [entry] = await systemDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "plat.data.update"), eq(auditLog.entity, "onb_student_kyc"), eq(auditLog.entityId, kycId)))
      .orderBy(desc(auditLog.at));
    const text = JSON.stringify(entry.data);
    expect(text).toContain("2026-11-v1-checked");
    expect(text).not.toContain("4821\"");
    expect(text).not.toMatch(/v1\.[A-Za-z0-9_-]+\./);
    expect((entry.data as { after: Record<string, string> }).after.pan_cipher).toBe("••••••");
  });
});

describe("the audit trail can't be rewritten from the console", () => {
  it("marks audit_log and domain_events read only", async () => {
    expect((await describeTable(sa, "audit_log")).readOnly).toBe(true);
    expect((await describeTable(sa, "domain_events")).readOnly).toBe(true);
    expect((await describeTable(sa, "departments")).readOnly).toBe(false);
  });

  it("refuses to add, change or delete audit entries, including the console's own", async () => {
    // Make an entry the console itself logs, then try to make it disappear.
    await updateRow(sa, "onb_student_kyc", [kycId], { consent_notice_version: "2026-11-v1-again" });
    const [entry] = await systemDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "plat.data.update"), eq(auditLog.entityId, kycId)))
      .orderBy(desc(auditLog.at));
    await expect(updateRow(sa, "audit_log", [entry.id], { action: "nothing.happened" })).rejects.toThrow(/can be read here but not changed/);
    await expect(deleteRows(sa, "audit_log", [[entry.id]], "delete")).rejects.toThrow(/can be read here but not changed/);
    await expect(insertRow(sa, "audit_log", { action: "plat.forged", entity: "users" })).rejects.toThrow(/can be read here but not changed/);
    const [still] = await systemDb().select().from(auditLog).where(eq(auditLog.id, entry.id));
    expect(still.action).toBe("plat.data.update");
  });

  it("refuses to change the event log", async () => {
    const [ev] = await systemDb().select().from(domainEvents).limit(1);
    if (ev) {
      await expect(deleteRows(sa, "domain_events", [[ev.id]], "delete")).rejects.toBeInstanceOf(ValidationError);
      await expect(updateRow(sa, "domain_events", [ev.id], { type: "forged" })).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(insertRow(sa, "domain_events", { type: "forged" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("still lets the Super Admin read them", async () => {
    const page = await listRows(sa, "audit_log", { filter: "entity", value: "onb_student_kyc" });
    expect(page.rows.length).toBeGreaterThan(0);
  });
});

describe("only a current Super Admin gets in, and request names are never SQL", () => {
  it("refuses a Super Admin whose assignment has ended", async () => {
    const u = await makeUser("Former Super");
    await grant(u.id, "super_admin", {}, new Date(Date.now() - 60_000));
    const former = await loadActor(u.id, null, { session: null });
    await expect(listTables(former)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getRow(former, "users", [studentId])).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses the Super Admin's institute roles: an institute admin at many institutes is still not a Super Admin", async () => {
    const admin = await person("Busy Admin", "institute_admin", { universityId: uni.id });
    await expect(listRows(await admin.actor(), "users")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("treats table and column names as catalogue lookups, so SQL in them goes nowhere", async () => {
    await expect(listRows(sa, "users; drop table users; --")).rejects.toBeInstanceOf(NotFoundError);
    await expect(listRows(sa, "users", { sort: "name; drop table users" })).rejects.toBeInstanceOf(ValidationError);
    await expect(listRows(sa, "users", { filter: "1=1) or (true" , value: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(listRows(sa, "users", { q: "' or 1=1 --", dir: "asc; drop table users" as "asc" })).resolves.toBeTruthy();
    await expect(getRow(sa, "users", ["' or '1'='1"])).rejects.toBeInstanceOf(NotFoundError);
    const [{ n }] = (await systemDb().select({ n: users.id }).from(users).limit(1)) as { n: string }[];
    expect(n).toBeTruthy();
  });
});
