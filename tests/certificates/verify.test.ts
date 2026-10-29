import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { formatCode } from "@/modules/certificates/lib";
import { verifyLimits } from "@/modules/certificates/rate-limit";
import { certCertificates } from "@/modules/certificates/schema";
import { lookupCertificate, revokeCertificate, verifyForVisitor } from "@/modules/certificates/service";
import { certWorld, useTempStorage } from "./helpers";

useTempStorage();
afterAll(closeDb);
beforeEach(() => {
  verifyLimits.lookups.reset();
  verifyLimits.misses.reset();
});

async function issuedIn(name: string, student: string) {
  const w = await certWorld(name);
  const { enrolmentId } = await w.enrolled(student);
  await w.complete(enrolmentId);
  const [c] = await systemDb().select().from(certCertificates).where(eq(certCertificates.enrolmentId, enrolmentId));
  return { w, c };
}

const headers = (ip: string) => new Headers({ "x-forwarded-for": `${ip}, 10.0.0.1` });

describe("public verify page", () => {
  it("shows only student name, course, institute, issue date and status", async () => {
    const { c } = await issuedIn("Verify Fields University", "Riya Verify");
    const r = await lookupCertificate(c.code);
    expect(r).toEqual({
      code: formatCode(c.code),
      studentName: "Riya Verify",
      courseTitle: "Data Analytics",
      institute: "Verify Fields University",
      issuedOn: c.issuedOn,
      status: "valid",
    });
    // Nothing else leaves the service: no ids, email, reasons, dates or file keys.
    expect(Object.keys(r!).sort()).toEqual(["code", "courseTitle", "institute", "issuedOn", "status", "studentName"]);
  });

  it("works across universities by exact code only", async () => {
    const a = await issuedIn("Verify A", "Alpha Student");
    const b = await issuedIn("Verify B", "Beta Student");
    expect((await lookupCertificate(a.c.code))?.institute).toBe("Verify A");
    expect((await lookupCertificate(b.c.code))?.institute).toBe("Verify B");
    // Formatting a person may type: lower case, hyphens, spaces; O and I/L read as 0 and 1.
    expect((await lookupCertificate(formatCode(a.c.code).toLowerCase()))?.studentName).toBe("Alpha Student");
    expect((await lookupCertificate(` ${a.c.code.slice(0, 6)} ${a.c.code.slice(6)} `))?.studentName).toBe("Alpha Student");
    // Never a partial, prefix or altered code.
    expect(await lookupCertificate(a.c.code.slice(0, 11))).toBeNull();
    expect(await lookupCertificate(`${a.c.code}0`)).toBeNull();
    const last = a.c.code.at(-1)!;
    expect(await lookupCertificate(a.c.code.slice(0, 11) + (last === "Z" ? "Y" : "Z"))).toBeNull();
    expect(await lookupCertificate("%")).toBeNull();
    expect(await lookupCertificate("' or 1=1 --")).toBeNull();
    expect(await lookupCertificate("")).toBeNull();
  });

  it("shows a revoked certificate as revoked", async () => {
    const { w, c } = await issuedIn("Verify Revoked U", "Kabir Revoked");
    await revokeCertificate(w.admin, c.id, "Exam malpractice found");
    const r = await lookupCertificate(c.code);
    expect(r?.status).toBe("revoked");
    expect(JSON.stringify(r)).not.toContain("malpractice");
  });

  it("shows an expired certificate as expired, even before the daily job marks it", async () => {
    const { c } = await issuedIn("Verify Expired U", "Meera Expired");
    await systemDb().update(certCertificates).set({ issuedOn: "2020-01-01", completedOn: "2020-01-01", validUntil: "2021-12-31" }).where(eq(certCertificates.id, c.id));
    expect((await lookupCertificate(c.code))?.status).toBe("expired");
    // The last valid day still counts as valid.
    const { c: d } = await issuedIn("Verify Last Day U", "Aditi Lastday");
    await systemDb().update(certCertificates).set({ validUntil: d.issuedOn }).where(eq(certCertificates.id, d.id));
    expect((await lookupCertificate(d.code))?.status).toBe("valid");
  });

  it("is rate-limited per visitor, with a tighter limit on codes that don't exist", async () => {
    const { c } = await issuedIn("Verify Limits U", "Tara Limits");
    for (let i = 0; i < 10; i++) expect((await verifyForVisitor("ZZZZZZZZZZZZ", headers("203.0.113.9"))).kind).toBe("not_found");
    const blocked = await verifyForVisitor(c.code, headers("203.0.113.9"));
    expect(blocked.kind).toBe("limited");
    // Someone else is unaffected.
    const other = await verifyForVisitor(c.code, headers("198.51.100.4"));
    expect(other.kind).toBe("found");
    for (let i = 0; i < 29; i++) expect((await verifyForVisitor(c.code, headers("198.51.100.4"))).kind).toBe("found");
    const over = await verifyForVisitor(c.code, headers("198.51.100.4"));
    expect(over).toMatchObject({ kind: "limited" });
    expect((over as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
  });
});
