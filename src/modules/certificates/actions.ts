"use server";

/** Server actions for certificates. Each one only reads the form and calls a service. */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { attempt, str } from "@/server/action";
import { spaceContext } from "@/server/context";
import { AppError, ValidationError } from "@/server/errors";
import {
  archiveTemplate,
  createTemplate,
  issueCertificate,
  removeSignatureImage,
  restoreTemplate,
  revokeCertificate,
  saveCourseRule,
  setDefaultTemplate,
  setSignatureImage,
  templatePreviewSvg,
  updateTemplate,
  type PreviewDraft,
} from "./service";

async function ctx(data: FormData) {
  const uni = str(data, "uni");
  const { actor } = await spaceContext(uni);
  return { uni, actor };
}

const templatesPath = (uni: string) => `/${uni}/admin/products/certificates`;
const templatePath = (uni: string, id: string) => `${templatesPath(uni)}/templates/${id}`;
const coursePath = (uni: string, courseId: string) => `/${uni}/admin/products/courses/${courseId}`;

/* ─────────────────────────── Templates ─────────────────────────── */

export async function createTemplateAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  let id = "";
  const r = await attempt(async () => {
    id = (await createTemplate(actor, { name: str(data, "name"), design: str(data, "design") })).id;
  });
  if (r?.error) return r;
  redirect(templatePath(uni, id));
}

function signatoriesFrom(data: FormData) {
  return [0, 1].map((i) => ({ name: str(data, `sig${i}_name`), title: str(data, `sig${i}_title`), imageKey: str(data, `sig${i}_imageKey`) || null }));
}

export async function updateTemplateAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const id = str(data, "templateId");
  return attempt(async () => {
    await updateTemplate(actor, id, {
      name: str(data, "name"),
      design: str(data, "design"),
      heading: str(data, "heading"),
      intro: str(data, "intro"),
      body: str(data, "body"),
      signatories: signatoriesFrom(data),
    });
    revalidatePath(templatesPath(uni));
    revalidatePath(templatePath(uni, id));
    return "Template saved. Certificates issued from now on use it; ones already issued stay as they are.";
  });
}

export async function uploadSignatureAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const id = str(data, "templateId");
  const file = data.get("signature");
  return attempt(async () => {
    const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array();
    await setSignatureImage(actor, id, Number(str(data, "index")), { bytes, size: bytes.length });
    revalidatePath(templatePath(uni, id));
    return "Signature uploaded.";
  });
}

export async function removeSignatureAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const id = str(data, "templateId");
  return attempt(async () => {
    await removeSignatureImage(actor, id, Number(str(data, "index")));
    revalidatePath(templatePath(uni, id));
    return "Signature removed.";
  });
}

export async function setDefaultTemplateAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const id = str(data, "templateId");
  return attempt(async () => {
    await setDefaultTemplate(actor, id);
    revalidatePath(templatesPath(uni));
    revalidatePath(templatePath(uni, id));
    return "This is now the default template.";
  });
}

export async function archiveTemplateAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const id = str(data, "templateId");
  return attempt(async () => {
    await archiveTemplate(actor, id);
    revalidatePath(templatesPath(uni));
    revalidatePath(templatePath(uni, id));
    return "Template archived.";
  });
}

export async function restoreTemplateAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const id = str(data, "templateId");
  return attempt(async () => {
    await restoreTemplate(actor, id);
    revalidatePath(templatesPath(uni));
    revalidatePath(templatePath(uni, id));
    return "Template restored.";
  });
}

/** Live preview: the draft drawn as SVG. Called from the editor as you type. */
export async function previewTemplateAction(uni: string, templateId: string, draft: PreviewDraft): Promise<{ svg?: string; error?: string }> {
  const { actor } = await spaceContext(uni);
  try {
    return { svg: await templatePreviewSvg(actor, templateId, draft) };
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    console.error(e);
    return { error: "The preview couldn't be drawn. Keep editing or refresh the page." };
  }
}

/* ─────────────────────────── Course rules and issuing ─────────────────────────── */

export async function saveRuleAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const courseId = str(data, "courseId");
  return attempt(async () => {
    await saveCourseRule(actor, courseId, {
      templateId: str(data, "templateId"),
      autoIssue: data.get("autoIssue") === "on",
      validityMonths: str(data, "validityMonths"),
      reminderDays: str(data, "reminderDays"),
    });
    revalidatePath(coursePath(uni, courseId));
    return "Certificate rules saved.";
  });
}

export async function issueCertificateAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const courseId = str(data, "courseId");
  return attempt(async () => {
    const enrolmentId = str(data, "enrolmentId");
    if (!enrolmentId) throw new ValidationError("Pick the student to issue a certificate to.");
    const c = await issueCertificate(actor, { enrolmentId, reason: str(data, "reason"), completedOn: str(data, "completedOn") });
    revalidatePath(coursePath(uni, courseId));
    revalidatePath(templatesPath(uni));
    return `Certificate issued to ${c.studentName}. They have been told it's ready.`;
  });
}

export async function revokeCertificateAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const id = str(data, "certificateId");
  return attempt(async () => {
    const c = await revokeCertificate(actor, id, str(data, "reason"));
    revalidatePath(`${templatesPath(uni)}/issued/${id}`);
    revalidatePath(coursePath(uni, c.courseId));
    revalidatePath(templatesPath(uni));
    return "Certificate revoked. Its verify page now shows it as revoked.";
  });
}
