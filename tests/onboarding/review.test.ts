/** /platform/signups: the Zinny team reviews documents and extends trials. */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, universities } from "@/db/schema";
import { systemActorFor } from "@/server/actor";
import { addDays } from "@/server/lib/dates";
import { extendTrial, listSignups, reviewDocument, reviewDocumentLink } from "@/modules/onboarding/services/review";
import { listDocuments } from "@/modules/onboarding/services/documents";
import { freezeIfTrialOver } from "@/modules/onboarding/services/trial";
import { team } from "../zinny-team-panel/helpers";
import { trialInstitute, upload } from "./helpers";

afterAll(closeDb);

describe("who can review sign-ups", () => {
  it("allows a Zinny team member with platform.manage_universities", async () => {
    const am = await team("Signup Reviewer", "account_manager");
    const t = await trialInstitute();
    const pan = await upload(t.admin, "pan");
    const rows = await listSignups(am);
    const mine = rows.find((r) => r.universityId === t.universityId);
    expect(mine).toMatchObject({ trialEndsAt: t.trialEndsAt, status: "active" });
    expect(mine?.documents.map((d) => d.id)).toEqual([pan.id]);
    expect(await reviewDocumentLink(am, t.universityId, pan.id)).toBeTruthy();
  });

  it("denies people without it", async () => {
    const finance = await team("Signup Finance", "finance_admin");
    const t = await trialInstitute();
    const pan = await upload(t.admin, "pan");
    await expect(listSignups(finance)).rejects.toThrow();
    await expect(reviewDocument(finance, t.universityId, pan.id, "approved", "")).rejects.toThrow();
    await expect(extendTrial(finance, t.universityId, 3)).rejects.toThrow();
    // An institute's own admin can't review its own documents either.
    await expect(reviewDocument(t.admin, t.universityId, pan.id, "approved", "")).rejects.toThrow();
  });
});

describe("reviewing documents", () => {
  it("approves, and rejects with a note the institute sees; both are logged", async () => {
    const am = await team("Doc Reviewer", "account_manager");
    const t = await trialInstitute();
    const pan = await upload(t.admin, "pan");
    const gst = await upload(t.admin, "gst_certificate");
    await reviewDocument(am, t.universityId, pan.id, "approved", "");
    await expect(reviewDocument(am, t.universityId, gst.id, "rejected", "")).rejects.toThrow(/Write what is wrong/);
    await reviewDocument(am, t.universityId, gst.id, "rejected", "The certificate is cut off at the bottom.");
    const docs = await listDocuments(t.admin);
    expect(docs.find((d) => d.id === pan.id)).toMatchObject({ status: "approved", reviewedBy: am.userId });
    expect(docs.find((d) => d.id === gst.id)).toMatchObject({ status: "rejected", reviewerNote: "The certificate is cut off at the bottom." });
    const log = await systemDb().select().from(auditLog).where(and(eq(auditLog.universityId, t.universityId), eq(auditLog.actorUserId, am.userId)));
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["onboarding.document.approve", "onboarding.document.reject"]));
  });

  it("refuses a document the institute has since replaced", async () => {
    const am = await team("Doc Reviewer 2", "account_manager");
    const t = await trialInstitute();
    const old = await upload(t.admin, "pan");
    await upload(t.admin, "pan");
    await expect(reviewDocument(am, t.universityId, old.id, "approved", "")).rejects.toThrow(/replaced/);
  });
});

describe("extending a trial", () => {
  it("moves the end date, logs it, and reopens a frozen institute", async () => {
    const am = await team("Trial Extender", "account_manager");
    const t = await trialInstitute();
    await upload(t.admin, "pan");
    const end = new Date(`${t.trialEndsAt}T12:00:00+05:30`);
    await freezeIfTrialOver(systemActorFor(t.universityId), end);
    const extended = await extendTrial(am, t.universityId, 5, end);
    expect(extended).toBe(addDays(t.trialEndsAt, 5));
    const [u] = await systemDb().select().from(universities).where(eq(universities.id, t.universityId));
    expect(u).toMatchObject({ status: "active", trialEndsAt: extended });
    const log = await systemDb().select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.universityId, t.universityId));
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["university.unfreeze", "onboarding.trial.extend"]));
  });

  it("refuses 0 days or more than 60", async () => {
    const am = await team("Trial Extender 2", "account_manager");
    const t = await trialInstitute();
    await expect(extendTrial(am, t.universityId, 0)).rejects.toThrow(/1 to 60/);
    await expect(extendTrial(am, t.universityId, 61)).rejects.toThrow(/1 to 60/);
  });
});
