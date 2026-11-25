/**
 * IDOR sweep (security review DATA-08): a person from institute B, even its Institute Admin,
 * can't read or change institute A's records by id — neither from B's own pages (row-level
 * security hides A's rows) nor by opening A's address with B's sign-in (they hold no role in A,
 * so every permission check fails). Within A, one student can't reach another's records.
 *
 * "Through A's address" is the actor the app builds for /<A's slug>/… : the signed-in person,
 * loaded for university A (spaceContext → loadActor(userId, A)).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { orders } from "@/db/schema";
import { loadActor } from "@/server/actor";
import type { Actor } from "@/server/core";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { invoiceDownload, myInvoices } from "@/modules/payments/invoices";
import { checkoutView, payInTestMode } from "@/modules/payments/checkout";
import { documentLink, listDocuments } from "@/modules/onboarding/services/documents";
import { reviewDocumentLink } from "@/modules/onboarding/services/review";
import { kycStatus, saveKyc } from "@/modules/onboarding/services/kyc";
import { onbStudentKyc } from "@/modules/onboarding/schema";
import { decideRequest, fileRequest, listRequests } from "@/modules/privacy/services/requests";
import { dpdpRequests } from "@/modules/privacy/schema";
import { exportMyData } from "@/modules/privacy/services/erasure";
import { runReport } from "@/modules/reports-board/service";
import { ENROLMENTS_REPORT } from "@/modules/reports-board/reports";
import { parseQuery } from "@/modules/reports-board/lib/query";
import { listPeople } from "@/server/services/users";
import { globalSearch } from "@/modules/zinny-team-panel/services/search";
import { searchUniversities } from "@/modules/zinny-team-panel/services/universities";
import { getRow } from "@/modules/zinny-team-panel/data-console";
import { setupCourse } from "../fixtures";
import { invoiceOf, paidCourse, startCheckout } from "../payments/helpers";
import { trialInstitute, upload } from "../onboarding/helpers";
import { team } from "../zinny-team-panel/helpers";

afterAll(closeDb);

let storageDir = "";
const storageBefore = process.env.STORAGE_DIR;

type World = {
  A: Awaited<ReturnType<typeof paidCourse>>;
  B: Awaited<ReturnType<typeof setupCourse>>;
  studentA: Actor;
  otherStudentA: Actor;
  studentB: Actor;
  /** B's Institute Admin, in B. */
  adminB: Actor;
  /** B's Institute Admin, opening A's address. */
  adminBinA: Actor;
  /** B's student, opening A's address. */
  studentBinA: Actor;
  orderId: string;
  invoiceId: string;
};

let w: World;

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "zinny-idor-"));
  process.env.STORAGE_DIR = storageDir;
  const A = await paidCourse("IDOR Alpha");
  const B = await setupCourse({ name: "IDOR Beta" });
  const studentA = await A.student("Alpha Learner");
  const otherStudentA = await A.student("Alpha Other");
  const studentB = await B.student("Beta Learner");
  const { orderId } = await startCheckout(studentA, A.batch.id);
  await payInTestMode(studentA, orderId);
  const invoice = await invoiceOf(orderId);
  w = {
    A,
    B,
    studentA,
    otherStudentA,
    studentB,
    adminB: B.admin,
    adminBinA: await loadActor(B.admin.userId, A.uni.id, { session: null }),
    studentBinA: await loadActor(studentB.userId, A.uni.id, { session: null }),
    orderId,
    invoiceId: invoice.id,
  };
});

afterAll(() => {
  if (storageBefore === undefined) delete process.env.STORAGE_DIR;
  else process.env.STORAGE_DIR = storageBefore;
  rmSync(storageDir, { recursive: true, force: true });
});

describe("invoices and orders", () => {
  it("the owner and A's finance staff can open A's invoice (control)", async () => {
    expect((await invoiceDownload(w.studentA, w.invoiceId)).number).toBeTruthy();
    expect((await invoiceDownload(w.A.accounts, w.invoiceId)).number).toBeTruthy();
  });

  it("B's admin can't open it from B, nor through A's address; another student of A can't either", async () => {
    await expect(invoiceDownload(w.adminB, w.invoiceId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(invoiceDownload(w.adminBinA, w.invoiceId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(invoiceDownload(w.studentBinA, w.invoiceId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(invoiceDownload(w.otherStudentA, w.invoiceId)).rejects.toBeInstanceOf(NotFoundError);
    expect(await myInvoices(w.otherStudentA)).toEqual([]);
  });

  it("nobody but the buyer can open the order's checkout", async () => {
    await expect(checkoutView(w.adminB, w.orderId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(checkoutView(w.adminBinA, w.orderId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(checkoutView(w.otherStudentA, w.orderId)).rejects.toBeInstanceOf(NotFoundError);
    const [o] = await systemDb().select().from(orders).where(eq(orders.id, w.orderId));
    expect(o.status).toBe("paid");
  });
});

describe("people, reports and exports", () => {
  it("B's admin sees nobody of A's, through A's address", async () => {
    expect(await listPeople(w.adminBinA, "students")).toEqual([]);
    expect(await listPeople(w.adminBinA, "administration")).toEqual([]);
    const fromB = await listPeople(w.adminB, "students");
    expect(fromB.map((p) => p.id)).not.toContain(w.studentA.userId);
  });

  it("B's admin can't run A's reports through A's address", async () => {
    const query = parseQuery({ report: ENROLMENTS_REPORT, range: "90d" });
    await expect(runReport(w.adminBinA, query)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runReport(w.A.admin, query)).resolves.toBeTruthy();
  });

  it("B's student can't export a copy of their data from A, where they hold nothing", async () => {
    await expect(exportMyData(w.studentBinA)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the Zinny team searches stay closed to institute users", async () => {
    await expect(globalSearch(w.adminB, "IDOR")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(searchUniversities(w.adminB, "IDOR")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getRow(w.adminB, "users", [w.studentA.userId])).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("KYC and institute documents (PAN)", () => {
  it("a student's KYC is theirs alone: not B's student through A's address, not another student", async () => {
    await saveKyc(w.studentA, { pan: "AAAPA1234Q", aadhaarLast4: "1234", consent: true });
    expect(await kycStatus(w.studentA)).toMatchObject({ done: true, panMasked: "XXXXX1234Q" });
    expect(await kycStatus(w.otherStudentA)).toEqual({ done: false });
    await expect(kycStatus(w.studentBinA)).rejects.toBeInstanceOf(ForbiddenError);
    const [row] = await systemDb().select().from(onbStudentKyc).where(eq(onbStudentKyc.userId, w.studentA.userId));
    expect(row.panCipher).not.toContain("AAAPA1234Q");
  });

  it("an institute's PAN card opens only for its own people who run it, and for the Zinny reviewers", async () => {
    const t = await trialInstitute();
    const pan = await upload(t.admin, "pan");
    expect(await documentLink(t.admin, pan.id)).toContain("/api/storage/");

    // B's admin: from B, and through the trial institute's address.
    await expect(documentLink(w.adminB, pan.id)).rejects.toBeInstanceOf(NotFoundError);
    const adminBinT = await loadActor(w.adminB.userId, t.universityId, { session: null });
    await expect(documentLink(adminBinT, pan.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listDocuments(adminBinT)).rejects.toBeInstanceOf(ForbiddenError);

    // Reviewers: only with platform.manage_universities, and only under the right institute.
    await expect(reviewDocumentLink(w.adminB, t.universityId, pan.id)).rejects.toBeInstanceOf(ForbiddenError);
    const support = await team("Idor Support", "support_agent");
    await expect(reviewDocumentLink(support, t.universityId, pan.id)).rejects.toBeInstanceOf(ForbiddenError);
    const am = await team("Idor AM", "account_manager");
    expect(await reviewDocumentLink(am, t.universityId, pan.id)).toContain("/api/storage/");
    await expect(reviewDocumentLink(am, w.B.uni.id, pan.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("privacy requests", () => {
  it("B's admin can't see or answer a request filed at A", async () => {
    const req = await fileRequest(w.studentA, { kind: "correction", details: "Please fix the spelling of my surname." });
    expect((await listRequests(w.adminB)).map((r) => r.id)).not.toContain(req.id);
    await expect(decideRequest(w.adminB, { requestId: req.id, status: "completed", response: "Done." })).rejects.toBeInstanceOf(NotFoundError);
    await expect(decideRequest(w.adminBinA, { requestId: req.id, status: "completed", response: "Done." })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decideRequest(w.otherStudentA, { requestId: req.id, status: "refused", response: "Not my business at all." })).rejects.toBeInstanceOf(ForbiddenError);
    const [row] = await systemDb().select().from(dpdpRequests).where(eq(dpdpRequests.id, req.id));
    expect(row.status).toBe("open");
  });
});
