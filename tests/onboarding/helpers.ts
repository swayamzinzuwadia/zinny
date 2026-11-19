import { randomUUID } from "node:crypto";
import { loadActor } from "@/server/actor";
import type { Actor } from "@/server/authz/engine";
import { startInstituteTrial, type InstituteSignupInput } from "@/modules/onboarding/services/signup";
import { finishDocumentUpload, putDocumentPart, startDocumentUpload } from "@/modules/onboarding/services/documents";

const tag = () => randomUUID().replace(/-/g, "").slice(0, 10);

/** A filled-in sign-up form that passes every check. */
export function signupInput(over: Partial<InstituteSignupInput> = {}): InstituteSignupInput {
  const t = tag();
  return {
    name: `Trial Institute ${t}`,
    legalName: `Trial Institute ${t} LLP`,
    instituteType: "coaching",
    city: "Pune",
    stateCode: "27",
    address: "12 Paud Road, Kothrud, Pune 411038",
    slug: `onb-${t}`,
    contactName: "Anita Kulkarni",
    email: `anita.${t}@onb.test`,
    phone: "98200 11001",
    password: "Sunrise-trial-2026",
    confirm: "Sunrise-trial-2026",
    gstApplies: "no",
    gstin: "",
    documents: [{ kind: "pan", fileName: "PAN card.pdf", size: 2048, type: "application/pdf" }],
    ...over,
  };
}

/** A self-signed institute in its trial, and its admin. */
export async function trialInstitute(over: Partial<InstituteSignupInput> = {}) {
  const created = await startInstituteTrial(signupInput(over), { ip: `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  const admin = await loadActor(created.userId, created.universityId, { session: null });
  return { ...created, admin };
}

export function tinyPdf(text = "Demo") {
  return Buffer.from(`%PDF-1.4\n% ${text}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`, "latin1");
}

/** Uploads a document the way the browser does: start, one part, finish. */
export async function upload(admin: Actor, kind: string, body: Buffer = tinyPdf(kind), fileName = `${kind}.pdf`, contentType = "application/pdf") {
  const started = await startDocumentUpload(admin, { kind, fileName, size: body.byteLength, contentType });
  await putDocumentPart(admin, started.documentId, 0, body);
  return finishDocumentUpload(admin, started.documentId);
}
