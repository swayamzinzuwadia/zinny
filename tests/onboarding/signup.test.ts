/** Institute self sign-up: the checks, GST, the trial dates, documents. */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, roleAssignments, universities } from "@/db/schema";
import { addDays, todayIn } from "@/server/lib/dates";
import { SignupError, validateSignup, startInstituteTrial } from "@/modules/onboarding/services/signup";
import { listDocuments, removeDocument, startDocumentUpload } from "@/modules/onboarding/services/documents";
import { onbDocuments, onbSignups } from "@/modules/onboarding/schema";
import { signupInput, trialInstitute, upload } from "./helpers";

afterAll(closeDb);

function stepOf(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    if (e instanceof SignupError) return { step: e.step, code: e.code, message: e.message };
    throw e;
  }
  return null;
}

describe("the sign-up form", () => {
  it("passes a complete form", () => {
    expect(stepOf(() => validateSignup(signupInput()))).toBeNull();
  });

  it("requires the PAN card", () => {
    const err = stepOf(() => validateSignup(signupInput({ documents: [{ kind: "moa", fileName: "MOA.pdf", size: 1000, type: "application/pdf" }] })));
    expect(err).toMatchObject({ step: "documents", code: "pan_required" });
  });

  it("takes the other documents as optional", () => {
    expect(stepOf(() => validateSignup(signupInput()))).toBeNull();
  });

  it("refuses files that aren't PDF, JPG or PNG, or are over 10 MB", () => {
    const pan = { kind: "pan", fileName: "PAN.pdf", size: 1000, type: "application/pdf" };
    expect(stepOf(() => validateSignup(signupInput({ documents: [pan, { kind: "moa", fileName: "MOA.docx", size: 1000, type: "application/msword" }] })))?.step).toBe("documents");
    expect(stepOf(() => validateSignup(signupInput({ documents: [{ ...pan, size: 11 * 1024 * 1024 }] })))?.message).toMatch(/up to 10 MB/);
  });

  it("asks for a GSTIN when GST applies, and checks it matches the state", () => {
    expect(stepOf(() => validateSignup(signupInput({ gstApplies: "yes", gstin: "" })))?.step).toBe("gst");
    expect(stepOf(() => validateSignup(signupInput({ gstApplies: "yes", gstin: "29AAPFS1234K1Z3" })))?.message).toMatch(/starts with 29/);
    expect(stepOf(() => validateSignup(signupInput({ gstApplies: "", gstin: "" })))?.step).toBe("gst");
    expect(stepOf(() => validateSignup(signupInput({ gstApplies: "yes", gstin: "27AAPFS1234K1Z3" })))).toBeNull();
  });

  it("sends each problem back to the step that has the field", () => {
    expect(stepOf(() => validateSignup(signupInput({ name: "" })))?.step).toBe("institute");
    expect(stepOf(() => validateSignup(signupInput({ stateCode: "99" })))?.step).toBe("institute");
    expect(stepOf(() => validateSignup(signupInput({ email: "not-an-email" })))?.step).toBe("account");
    expect(stepOf(() => validateSignup(signupInput({ confirm: "something else" })))?.step).toBe("account");
  });
});

describe("starting a trial", () => {
  it("makes the institute, its admin and a 3-day trial from today in the institute's time zone", async () => {
    const t = await trialInstitute();
    const [u] = await systemDb().select().from(universities).where(eq(universities.id, t.universityId));
    expect(u.trialEndsAt).toBe(addDays(todayIn(u.timezone), 3));
    expect(t.trialEndsAt).toBe(u.trialEndsAt);
    expect(u.status).toBe("active");
    const roles = await systemDb().select().from(roleAssignments).where(and(eq(roleAssignments.userId, t.userId), eq(roleAssignments.universityId, t.universityId)));
    expect(roles.map((r) => r.role)).toEqual(["institute_admin"]);
    const [s] = await systemDb().select().from(onbSignups).where(eq(onbSignups.universityId, t.universityId));
    expect(s).toMatchObject({ instituteType: "coaching", city: "Pune", contactPhone: "+919820011001" });
    const logged = await systemDb().select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.universityId, t.universityId));
    expect(logged.map((l) => l.action)).toEqual(expect.arrayContaining(["university.self_signup", "onboarding.signup"]));
  });

  it("saves the GST answer and GSTIN on the university", async () => {
    const yes = await trialInstitute({ gstApplies: "yes", gstin: "27aapfs1234k1z3" });
    const no = await trialInstitute({ gstApplies: "no", gstin: "27AAPFS1234K1Z3" });
    const [a] = await systemDb().select().from(universities).where(eq(universities.id, yes.universityId));
    const [b] = await systemDb().select().from(universities).where(eq(universities.id, no.universityId));
    expect(a).toMatchObject({ gstEnabled: true, gstin: "27AAPFS1234K1Z3", stateCode: "27" });
    expect(b).toMatchObject({ gstEnabled: false, gstin: null });
  });

  it("refuses a web address or an email that is taken, on the right step", async () => {
    const t = await trialInstitute();
    const again = signupInput({ slug: t.slug });
    await expect(startInstituteTrial(again, { ip: "10.9.9.1" })).rejects.toMatchObject({ step: "institute", code: "slug_taken" });
    const [u] = await systemDb().select().from(universities).where(eq(universities.id, t.universityId));
    const email = (await systemDb().select().from(onbSignups).where(eq(onbSignups.universityId, u.id)))[0].contactEmail;
    await expect(startInstituteTrial(signupInput({ email }), { ip: "10.9.9.2" })).rejects.toMatchObject({ step: "account", code: "email_taken" });
  });
});

describe("documents", () => {
  it("are stored pending review; a new upload replaces the old one, which is kept", async () => {
    const t = await trialInstitute();
    const first = await upload(t.admin, "pan");
    expect(first.status).toBe("pending");
    const second = await upload(t.admin, "pan");
    const docs = await listDocuments(t.admin);
    expect(docs.map((d) => d.id)).toEqual([second.id]);
    const all = await systemDb().select().from(onbDocuments).where(eq(onbDocuments.universityId, t.universityId));
    expect(all).toHaveLength(2);
    expect(all.find((d) => d.id === first.id)?.supersededAt).not.toBeNull();
  });

  it("can remove an optional document but not the PAN card", async () => {
    const t = await trialInstitute();
    const pan = await upload(t.admin, "pan");
    const moa = await upload(t.admin, "moa");
    await expect(removeDocument(t.admin, pan.id)).rejects.toThrow(/can't be removed/);
    await removeDocument(t.admin, moa.id);
    expect((await listDocuments(t.admin)).map((d) => d.kind)).toEqual(["pan"]);
  });

  it("refuses a file whose bytes aren't really a PDF, JPG or PNG", async () => {
    const t = await trialInstitute();
    await expect(upload(t.admin, "pan", Buffer.from("MZ not a pdf at all"))).rejects.toThrow(/isn't really a PDF/);
  });

  it("refuses a wrong type or an oversize file before anything is sent", async () => {
    const t = await trialInstitute();
    await expect(startDocumentUpload(t.admin, { kind: "pan", fileName: "pan.exe", size: 100, contentType: "application/octet-stream" })).rejects.toThrow(/isn't a PDF/);
    await expect(startDocumentUpload(t.admin, { kind: "pan", fileName: "pan.pdf", size: 10 * 1024 * 1024 + 1, contentType: "application/pdf" })).rejects.toThrow(/up to 10 MB/);
  });
});
