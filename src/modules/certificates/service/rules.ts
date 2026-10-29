/**
 * Certificate rules per course (brief item 2): which template, whether to issue
 * automatically on completion, how many months a certificate is valid, and how many
 * days before expiry to remind the student.
 *
 * A course without a rule of its own uses the default template, issues automatically and
 * never expires. Nothing is ever issued while the course's own "Issue a certificate on
 * completion" setting (core certificateEnabled) is off.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { assertCan, audit, courseTarget, getCourseLite, withTenant, type Actor } from "@/server/core";
import { NotFoundError, ValidationError } from "@/server/errors";
import { certRules, certTemplates } from "../schema";
import { uni } from "./shared";
import { defaultTemplate, type Template } from "./templates";

export type Rule = typeof certRules.$inferSelect;

export type EffectiveRule = {
  /** False when the course has no rule of its own and uses the defaults. */
  custom: boolean;
  template: Template;
  autoIssue: boolean;
  validityMonths: number | null;
  reminderDays: number | null;
  /** The saved rule points at an archived template, so the default is used instead. */
  templateFallback: boolean;
};

/** The rule that applies to a course right now (inside a tenant transaction, no permission check). */
export async function effectiveRule(tx: Tx, actor: Actor, courseId: string): Promise<EffectiveRule> {
  const [rule] = await tx.select().from(certRules).where(eq(certRules.courseId, courseId));
  if (!rule) return { custom: false, template: await defaultTemplate(tx, actor), autoIssue: true, validityMonths: null, reminderDays: null, templateFallback: false };
  const [t] = await tx.select().from(certTemplates).where(and(eq(certTemplates.id, rule.templateId), isNull(certTemplates.archivedAt)));
  return {
    custom: true,
    template: t ?? (await defaultTemplate(tx, actor)),
    autoIssue: rule.autoIssue,
    validityMonths: rule.validityMonths,
    reminderDays: rule.reminderDays,
    templateFallback: !t,
  };
}

export async function getCourseRule(actor: Actor, courseId: string): Promise<EffectiveRule> {
  return withTenant(actor, async (tx) => {
    assertCan(actor, "cert.view", await courseTarget(tx, uni(actor), courseId));
    return effectiveRule(tx, actor, courseId);
  });
}

export type RuleInput = { templateId: string; autoIssue: boolean; validityMonths: string | number | null; reminderDays: string | number | null };

function wholeNumber(v: string | number | null | undefined, label: string, min: number, max: number): number | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v).trim());
  if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
}

/** Checks a rule's numbers. Exported for tests. */
export function cleanRule(input: RuleInput) {
  const validityMonths = wholeNumber(input.validityMonths, "Validity", 1, 600);
  const reminderDays = wholeNumber(input.reminderDays, "Reminder", 1, 365);
  if (reminderDays !== null && validityMonths === null) {
    throw new ValidationError("A reminder needs an expiry. Enter how many months certificates stay valid, or leave the reminder empty.");
  }
  if (reminderDays !== null && validityMonths !== null && reminderDays >= validityMonths * 28) {
    throw new ValidationError(`The reminder must come before the certificate expires. Use fewer than ${validityMonths * 28} days.`);
  }
  if (!input.templateId) throw new ValidationError("Pick a template.");
  return { templateId: input.templateId, autoIssue: !!input.autoIssue, validityMonths, reminderDays };
}

export async function saveCourseRule(actor: Actor, courseId: string, input: RuleInput): Promise<Rule> {
  const clean = cleanRule(input);
  return withTenant(actor, async (tx) => {
    assertCan(actor, "cert.manage", await courseTarget(tx, uni(actor), courseId));
    const course = await getCourseLite(tx, courseId);
    const [t] = await tx.select().from(certTemplates).where(eq(certTemplates.id, clean.templateId));
    if (!t) throw new NotFoundError("Template");
    if (t.archivedAt) throw new ValidationError("That template is archived. Pick another one.");
    const values = { ...clean, updatedBy: actor.userId || null, updatedAt: new Date() };
    const [rule] = await tx
      .insert(certRules)
      .values({ universityId: uni(actor), courseId, ...values })
      .onConflictDoUpdate({ target: certRules.courseId, set: values })
      .returning();
    await audit(tx, actor, "certificate.rule_save", "course", courseId, { course: course.title, template: t.name, ...clean });
    return rule;
  });
}
