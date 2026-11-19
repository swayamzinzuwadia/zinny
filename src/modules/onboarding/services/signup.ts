/**
 * Institute self sign-up (/signup/institute and /book-a-demo): details, the GST question
 * and the list of documents to send, checked together; then the university and its first
 * Institute Admin are made through the core API with a free trial of TRIAL_DAYS days.
 * The documents themselves are uploaded right after, as that admin (documents.ts).
 */
import { audit, loadActor, withTenant } from "@/server/core";
import { checkNewPassword, hashPassword } from "@/server/auth/passwords";
import { normalizePhone } from "@/server/auth/phone";
import { consume, throttleKey } from "@/server/auth/throttle";
import { AppError, ValidationError } from "@/server/errors";
import { createSelfServeUniversity, type SelfServeUniversity } from "@/server/services/core-api";
import { checkSlug } from "@/modules/zinny-team-panel/services/universities";
import { GSTIN_RE, INSTITUTE_TYPES, STATE_NAME, TRIAL_DAYS, documentProblem, isDocumentKind, slugFrom } from "../lib/constants";
import { onbSignups } from "../schema";

/** The wizard's steps, in order. Errors carry the step to go back to. */
export const SIGNUP_STEPS = ["institute", "account", "gst", "documents"] as const;
export type SignupStep = (typeof SIGNUP_STEPS)[number];

export type DocumentManifest = { kind: string; fileName: string; size: number; type: string };

export type InstituteSignupInput = {
  name: string;
  legalName: string;
  instituteType: string;
  city: string;
  stateCode: string;
  address: string;
  slug: string;
  contactName: string;
  email: string;
  phone: string;
  password: string;
  confirm: string;
  /** "yes" or "no". */
  gstApplies: string;
  gstin: string;
  /** The files the browser holds and will upload once the account exists. */
  documents: DocumentManifest[];
  source?: "signup" | "book-a-demo";
};

/** A problem with the form, and the step that holds the field to fix. */
export class SignupError extends ValidationError {
  constructor(
    message: string,
    public readonly step: SignupStep,
    code = "invalid",
  ) {
    super(message, code, { step });
  }
}

const fail = (step: SignupStep, message: string, code?: string): never => {
  throw new SignupError(message, step, code);
};

/** The checks every step makes, in the order the steps come. Returns the tidied values. */
export function validateSignup(input: InstituteSignupInput) {
  const name = input.name.trim();
  if (name.length < 2) fail("institute", "Enter your institute's name.");
  if (name.length > 120) fail("institute", "Keep the institute's name under 120 characters.");
  const legalName = input.legalName.trim();
  if (legalName.length < 2) fail("institute", "Enter the legal name, as it appears on your PAN card or registration.");
  if (!INSTITUTE_TYPES.some((t) => t.key === input.instituteType)) fail("institute", "Pick what kind of institute you run.");
  const city = input.city.trim();
  if (city.length < 2) fail("institute", "Enter your city.");
  if (!STATE_NAME[input.stateCode]) fail("institute", "Pick your state. It decides how GST is charged on Zinny's invoices.");
  const address = input.address.trim();
  if (address.length < 10) fail("institute", "Enter the institute's full address, with the PIN code.");
  if (address.length > 500) fail("institute", "Keep the address under 500 characters.");
  let slug = "";
  try {
    slug = checkSlug(input.slug || slugFrom(name));
  } catch (e) {
    if (e instanceof AppError) fail("institute", e.message);
    throw e;
  }

  const contactName = input.contactName.trim();
  if (contactName.length < 2) fail("account", "Enter the name of the person we should talk to.");
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("account", "Enter a valid email, like name@institute.in.");
  const phone = normalizePhone(input.phone);
  if (!phone) fail("account", "Enter a valid mobile number, like 98200 11001.");
  try {
    checkNewPassword(input.password, { email, name: contactName, confirm: input.confirm });
  } catch (e) {
    if (e instanceof AppError) fail("account", e.message);
    throw e;
  }

  if (input.gstApplies !== "yes" && input.gstApplies !== "no") fail("gst", "Answer whether GST applies when you sell a course.");
  const gstEnabled = input.gstApplies === "yes";
  const gstin = gstEnabled ? input.gstin.replace(/\s+/g, "").toUpperCase() : null;
  if (gstEnabled) {
    if (!gstin) fail("gst", "Enter your GSTIN, or answer No if GST doesn't apply to you.");
    if (!GSTIN_RE.test(gstin!)) fail("gst", "That GSTIN doesn't look right. It has 15 characters, like 27ABCDE1234F1Z5.");
    if (gstin!.slice(0, 2) !== input.stateCode) {
      fail("gst", `Your GSTIN starts with ${gstin!.slice(0, 2)}, but you picked ${STATE_NAME[input.stateCode]} (${input.stateCode}). Check the state or the GSTIN.`);
    }
  }

  if (!input.documents.some((d) => d.kind === "pan")) fail("documents", "Add your PAN card. It is the one document we need to start your trial.", "pan_required");
  for (const d of input.documents) {
    if (!isDocumentKind(d.kind)) fail("documents", "One of the documents has an unknown type. Remove it and add it again.");
    const problem = documentProblem({ name: d.fileName, size: d.size, type: d.type });
    if (problem) fail("documents", problem);
  }

  return { name, legalName, instituteType: input.instituteType, city, stateCode: input.stateCode, address, slug, contactName, email, phone: phone!, gstEnabled, gstin };
}

export type StartedTrial = SelfServeUniversity;

/** Up to 5 new institutes an hour from one network. */
const SIGNUP_RULE = { limit: 5, windowMs: 60 * 60 * 1000 };

/**
 * Checks the whole form, then makes the university, its Institute Admin and the trial in one
 * go. The caller signs the new admin in. Throws SignupError (with the step) for a field to fix.
 */
export async function startInstituteTrial(input: InstituteSignupInput, ctx: { ip: string | null }): Promise<StartedTrial> {
  const v = validateSignup(input);
  const limit = await consume(throttleKey("onb_signup", ctx.ip ?? "unknown"), SIGNUP_RULE);
  if (!limit.ok) throw new ValidationError("Too many institutes were signed up from your network in the last hour. Please try again later.", "network_limited");

  let created: SelfServeUniversity;
  try {
    created = await createSelfServeUniversity({
      name: v.name,
      slug: v.slug,
      legalName: v.legalName,
      address: `${v.address}${v.address.toLowerCase().includes(v.city.toLowerCase()) ? "" : `, ${v.city}`}`,
      stateCode: v.stateCode,
      gstEnabled: v.gstEnabled,
      gstin: v.gstin,
      admin: { name: v.contactName, email: v.email, passwordHash: await hashPassword(input.password) },
      trialDays: TRIAL_DAYS,
    });
  } catch (e) {
    if (e instanceof AppError && e.code === "slug_taken") fail("institute", e.message, e.code);
    if (e instanceof AppError && e.code === "email_taken") fail("account", e.message, e.code);
    throw e;
  }

  const admin = await loadActor(created.userId, created.universityId, { session: null });
  await withTenant(admin, async (tx) => {
    const [row] = await tx
      .insert(onbSignups)
      .values({
        universityId: created.universityId,
        instituteType: v.instituteType,
        contactName: v.contactName,
        contactEmail: v.email,
        contactPhone: v.phone,
        city: v.city,
        source: input.source ?? "signup",
        createdBy: created.userId,
      })
      .returning();
    await audit(tx, admin, "onboarding.signup", "onb_signup", row.id, {
      instituteType: v.instituteType,
      city: v.city,
      gstEnabled: v.gstEnabled,
      trialEndsAt: created.trialEndsAt,
      documents: input.documents.map((d) => d.kind),
      source: row.source,
    });
  });
  return created;
}
