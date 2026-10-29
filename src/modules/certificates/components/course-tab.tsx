import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Empty, Field, Input, Notice, Select, Stat, Table, Td, Textarea } from "@/components/ui";
import type { CourseTabProps } from "@/contracts/module";
import { can } from "@/server/core";
import { issueCertificateAction, saveRuleAction } from "../actions";
import { shortDate } from "../lib";
import { DESIGNS } from "../render/designs";
import { courseCertificates, getCourseRule, issueCandidates, listTemplates } from "../service";
import { StatusBadge } from "./status-badge";

/** Admin course page → Certificates tab (adminCourseTabs.certificates): rules, issued certificates, issuing by hand. */
export async function CertificatesCourseTab({ uni, actor, course, target }: CourseTabProps) {
  const canManage = can(actor, "cert.manage", target);
  const canIssue = can(actor, "cert.issue", target);
  const [rule, data, templates, candidates] = await Promise.all([
    getCourseRule(actor, course.id),
    courseCertificates(actor, course.id),
    canManage ? listTemplates(actor) : Promise.resolve([]),
    canIssue && course.certificateEnabled ? issueCandidates(actor, course.id) : Promise.resolve([]),
  ]);
  const base = `/${uni}/admin/products/certificates`;
  const issuable = candidates.filter((c) => c.action !== "none");

  return (
    <div className="space-y-6">
      {!course.certificateEnabled && (
        <Notice tone="warn">
          Certificates are off for this course, so none are issued.{" "}
          {can(actor, "course.update", target) ? (
            <>
              Turn on &ldquo;Issue a certificate on completion&rdquo; in{" "}
              <Link href={`/${uni}/admin/products/courses/${course.id}?tab=settings`} className="font-medium underline underline-offset-2">
                Settings
              </Link>{" "}
              to start.
            </>
          ) : (
            "A course editor can turn them on in Settings."
          )}
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Valid" value={data.counts.valid} />
        <Stat
          label="Expiring in 30 days"
          value={data.counts.expiringSoon}
          hint={rule.reminderDays ? `Students are reminded ${rule.reminderDays} days before` : rule.validityMonths ? "No reminder set" : "Certificates don't expire"}
        />
        <Stat label="Expired" value={data.counts.expired} hint="Not renewed yet" />
        <Stat label="Revoked" value={data.counts.revoked} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[17px] font-medium">Issued certificates</h2>
            <span className="text-[13px] text-muted">{data.rows.length === 1 ? "1 certificate" : `${data.rows.length} certificates`}</span>
          </div>
          {data.rows.length === 0 ? (
            <Empty title="No certificates issued yet">
              {course.certificateEnabled && rule.autoIssue
                ? "Each student gets one automatically when they complete the course."
                : "Issue one by hand when a student has finished."}
            </Empty>
          ) : (
            <Table head={["Student", "Batch", "Issued", "Valid until", "Status", ""]}>
              {data.rows.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <Link href={`${base}/issued/${c.id}`} className="whitespace-nowrap font-medium hover:text-brand">
                      {c.studentName}
                    </Link>
                    <div className="tabular whitespace-nowrap font-mono text-[12px] text-muted">{c.displayCode}</div>
                  </Td>
                  <Td className="whitespace-nowrap text-muted">{c.batchName}</Td>
                  <Td className="tabular whitespace-nowrap">
                    {shortDate(c.issuedOn)}
                    {c.source === "manual" && <div className="text-[12px] text-muted">By hand</div>}
                  </Td>
                  <Td className="tabular whitespace-nowrap">{c.validUntil ? shortDate(c.validUntil) : <span className="text-muted">No expiry</span>}</Td>
                  <Td>
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge status={c.status} />
                      {c.replacedById && <span className="text-[12px] text-muted">Renewed</span>}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap text-right">
                    <a href={`${base}/issued/${c.id}/download`} className="text-[13px] font-medium text-brand hover:underline">
                      Download
                    </a>
                    <Link href={`${base}/issued/${c.id}`} className="ml-4 text-[13px] text-muted hover:text-ink">
                      Details
                    </Link>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardTitle hint={rule.custom ? undefined : "Using the defaults"}>Certificate rules</CardTitle>
            {rule.templateFallback && (
              <div className="mb-4">
                <Notice tone="warn">The template picked for this course was archived, so the default template is used. Pick another one.</Notice>
              </div>
            )}
            {canManage ? (
              <ActionForm action={saveRuleAction} className="space-y-4" resetOnSuccess={false}>
                <input type="hidden" name="uni" value={uni} />
                <input type="hidden" name="courseId" value={course.id} />
                <Field label="Template">
                  <Select name="templateId" defaultValue={rule.template.id}>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.name.toLowerCase() === DESIGNS[t.design].label.toLowerCase() ? "" : ` (${DESIGNS[t.design].label} design)`}
                        {t.isDefault ? ", the default" : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
                <label className="flex items-start gap-2 text-[14px]">
                  <input type="checkbox" name="autoIssue" defaultChecked={rule.autoIssue} className="mt-1 accent-brand" />
                  <span>
                    Issue automatically when a student completes the course
                    <span className="block text-[12px] text-muted">Turn off to review each student and issue by hand.</span>
                  </span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Valid for (months)" hint="Empty: never expires.">
                    <Input name="validityMonths" type="number" min={1} max={600} inputMode="numeric" placeholder="Never" defaultValue={rule.validityMonths ?? ""} />
                  </Field>
                  <Field label="Remind (days before)" hint="Empty: no reminder.">
                    <Input name="reminderDays" type="number" min={1} max={365} inputMode="numeric" placeholder="None" defaultValue={rule.reminderDays ?? ""} />
                  </Field>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <SubmitButton>Save rules</SubmitButton>
                  <Link href={`${base}/templates/${rule.template.id}`} className="text-[13px] text-brand hover:underline">
                    Open the template
                  </Link>
                </div>
              </ActionForm>
            ) : (
              <dl className="space-y-2 text-[14px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Template</dt>
                  <dd className="text-right font-medium">{rule.template.name}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Issued</dt>
                  <dd className="text-right">{rule.autoIssue ? "Automatically on completion" : "By hand"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Valid for</dt>
                  <dd className="text-right">{rule.validityMonths ? `${rule.validityMonths} months` : "No expiry"}</dd>
                </div>
                {rule.reminderDays && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Reminder</dt>
                    <dd className="text-right">{rule.reminderDays} days before expiry</dd>
                  </div>
                )}
              </dl>
            )}
          </Card>

          {canIssue && course.certificateEnabled && (
            <Card>
              <CardTitle>Issue by hand</CardTitle>
              {candidates.length === 0 ? (
                <p className="text-[14px] text-muted">No students are enrolled in this course yet.</p>
              ) : issuable.length === 0 ? (
                <p className="text-[14px] text-muted">Every student here already has a valid certificate.</p>
              ) : (
                <ActionForm action={issueCertificateAction} className="space-y-4">
                  <input type="hidden" name="uni" value={uni} />
                  <input type="hidden" name="courseId" value={course.id} />
                  <Field label="Student">
                    <Select name="enrolmentId" required defaultValue="">
                      <option value="" disabled>
                        Pick a student
                      </option>
                      {candidates.map((c) => (
                        <option key={c.enrolmentId} value={c.enrolmentId} disabled={c.action === "none"}>
                          {c.name}
                          {c.batchName ? `, ${c.batchName}` : ""}
                          {c.action === "renew" ? " (renew)" : c.action === "reissue" ? " (issue again)" : ""}
                          {c.note ? ` (${c.note.toLowerCase()})` : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Completed on">
                    <Input type="date" name="completedOn" defaultValue={data.today} max={data.today} required />
                  </Field>
                  <Field label="Reason" hint="Kept on record with the certificate.">
                    <Textarea name="reason" required minLength={5} maxLength={500} placeholder="Final project reviewed and approved" />
                  </Field>
                  <SubmitButton pendingText="Issuing…">Issue certificate</SubmitButton>
                </ActionForm>
              )}
              {candidates.some((c) => c.action === "renew" || c.action === "reissue") && (
                <p className="mt-3 text-[12px] text-muted">Renewing or issuing again creates a new certificate with a new code. The old one stays on record.</p>
              )}
            </Card>
          )}
          {!canIssue && (
            <p className="px-1 text-[13px] text-muted">
              <Badge>View only</Badge> An Institute Admin or the department&apos;s HOD issues and revokes certificates.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
