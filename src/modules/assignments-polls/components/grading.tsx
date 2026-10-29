/** The grading view: a batch's queue on the left, the selected student's work and grade form on the right. */
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Avatar, Badge, Card, CardTitle, Empty, Field, Input, Textarea, buttonClass, cx } from "@/components/ui";
import { gradeAction } from "../actions";
import { ACCEPT, MAX_UPLOAD_MB } from "../lib/files";
import { formatMarks } from "../lib/grading";
import { formatWhen } from "../lib/time";
import { fileHref, staffAssignment, uploadHref } from "../links";
import type { GradingQueue, QueueRow } from "../service/assignments";
import { FileLinks } from "./bits";
import { FileUploader } from "./file-uploader";

const GROUPS: { status: QueueRow["status"]; title: string }[] = [
  { status: "to_grade", title: "To grade" },
  { status: "missing", title: "Not handed in" },
  { status: "graded", title: "Graded" },
];

function RowLine({ uni, q, r, active, tz }: { uni: string; q: GradingQueue; r: QueueRow; active: boolean; tz: string }) {
  return (
    <Link
      href={staffAssignment(uni, q.assignment.id, { batch: q.batch.id, student: r.student.id })}
      aria-current={active ? "true" : undefined}
      className={cx("flex items-center gap-3 rounded-2xl px-3 py-2.5 text-[14px]", active ? "bg-brand-soft" : "hover:bg-canvas")}
    >
      <Avatar name={r.student.name} size={30} />
      <div className="min-w-0 flex-1">
        <div className={cx("truncate", active && "font-medium")}>{r.student.name}</div>
        <div className="truncate text-[12px] text-muted">
          {r.status === "graded"
            ? `${formatMarks(r.finalMarks)} / ${q.assignment.points}`
            : r.submittedAt
              ? formatWhen(r.submittedAt, tz)
              : r.left
                ? "Left the batch"
                : "Nothing yet"}
        </div>
      </div>
      {r.late && <Badge tone="warn">Late</Badge>}
    </Link>
  );
}

export function GradingView({ uni, q, selected, tz }: { uni: string; q: GradingQueue; selected: string | undefined; tz: string }) {
  const current = q.rows.find((r) => r.student.id === selected) ?? q.rows.find((r) => r.status === "to_grade") ?? q.rows[0];
  if (!current) return <Empty title="No students in this batch">Students who join the batch show up here.</Empty>;
  const waiting = q.rows.filter((r) => r.status === "to_grade" && r.student.id !== current.student.id);
  const next = waiting.find((r) => (r.submittedAt?.getTime() ?? 0) >= (current.submittedAt?.getTime() ?? 0)) ?? waiting[0];
  const latest = current.versions[0];
  const a = q.assignment;

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      <Card className="h-fit p-3">
        {GROUPS.map((g) => {
          const rows = q.rows.filter((r) => r.status === g.status);
          if (rows.length === 0) return null;
          return (
            <div key={g.status} className="mb-2 last:mb-0">
              <div className="flex items-baseline justify-between px-3 pb-1 pt-2 text-[12px] text-muted">
                <span>{g.title}</span>
                <span className="tabular">{rows.length}</span>
              </div>
              <ul>
                {rows.map((r) => (
                  <li key={r.student.id}>
                    <RowLine uni={uni} q={q} r={r} active={r.student.id === current.student.id} tz={tz} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </Card>

      <div className="min-w-0 space-y-5">
        <Card>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <Avatar name={current.student.name} size={40} />
              <div>
                <div className="text-[17px] font-medium">{current.student.name}</div>
                <div className="text-[13px] text-muted">{current.student.email}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {current.status === "to_grade" && <Badge tone="gold">To grade</Badge>}
              {current.status === "missing" && <Badge tone={new Date() > a.dueAt ? "danger" : "neutral"}>{new Date() > a.dueAt ? "Not handed in" : "Not handed in yet"}</Badge>}
              {current.status === "graded" && <Badge tone="brand">Graded</Badge>}
              {current.late && <Badge tone="warn">Late</Badge>}
            </div>
          </div>

          {latest ? (
            <div className="space-y-4">
              <div className="text-[13px] text-muted">
                Version {latest.version}, handed in {formatWhen(latest.submittedAt, tz)}
                {latest.late && <span className="text-warn">, after the due date</span>}
              </div>
              {latest.textAnswer && (
                <div className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded-2xl bg-canvas p-4 font-mono text-[13px] leading-relaxed">{latest.textAnswer}</div>
              )}
              <FileLinks uni={uni} area="admin" files={latest.files} />
              {current.versions.length > 1 && (
                <details className="rounded-2xl border border-line p-3">
                  <summary className="cursor-pointer text-[13px] font-medium text-brand">Earlier versions ({current.versions.length - 1})</summary>
                  <ol className="mt-3 space-y-4">
                    {current.versions.slice(1).map((v) => (
                      <li key={v.id} className="space-y-2">
                        <div className="text-[13px] text-muted">
                          Version {v.version}, {formatWhen(v.submittedAt, tz)}
                          {v.late && ", late"}
                        </div>
                        {v.textAnswer && <div className="whitespace-pre-wrap rounded-xl bg-canvas p-3 font-mono text-[12px]">{v.textAnswer}</div>}
                        <FileLinks uni={uni} area="admin" files={v.files} />
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </div>
          ) : (
            <p className="rounded-2xl bg-canvas px-4 py-5 text-[14px] text-muted">
              {current.student.name.split(" ")[0]} hasn&apos;t handed anything in online. You can still record a grade, for example for work handed in on paper.
            </p>
          )}
        </Card>

        {q.canGrade ? (
          <Card>
            <CardTitle hint={current.gradedAt ? `Last saved ${formatWhen(current.gradedAt, tz)}` : undefined}>{current.status === "graded" ? "Change the grade" : "Grade"}</CardTitle>
            <ActionForm action={gradeAction} resetOnSuccess={false} className="space-y-4" key={current.student.id}>
              <input type="hidden" name="uni" value={uni} />
              <input type="hidden" name="assignmentId" value={a.id} />
              <input type="hidden" name="batchId" value={q.batch.id} />
              <input type="hidden" name="studentId" value={current.student.id} />
              <div className="flex items-end gap-3">
                <div className="w-32">
                  <Field label="Marks">
                    <Input name="marks" inputMode="decimal" required defaultValue={current.marks !== null ? formatMarks(current.marks) : ""} placeholder="0" aria-describedby={current.late && a.latePenaltyPct > 0 ? "marks-hint" : undefined} />
                  </Field>
                </div>
                <div className="pb-2.5 text-[14px] text-muted">out of {a.points}</div>
              </div>
              {current.late && a.latePenaltyPct > 0 && (
                <p id="marks-hint" className="-mt-2 text-[13px] text-warn">
                  Handed in late, so {a.latePenaltyPct}% comes off the marks you give.
                  {current.marks !== null && ` ${formatMarks(current.marks)} became ${formatMarks(current.finalMarks)}.`}
                </p>
              )}
              <Field label="Feedback">
                <Textarea name="feedback" rows={5} maxLength={5000} defaultValue={current.feedback ?? ""} placeholder="What went well, and what to work on next." />
              </Field>
              <FileUploader
                key={current.gradedAt?.getTime() ?? 0}
                endpoint={uploadHref(uni, "admin")}
                target={{ purpose: "returned", assignmentId: a.id, batchId: q.batch.id }}
                label="Return a file"
                max={5}
                maxMb={MAX_UPLOAD_MB}
                accept={ACCEPT}
                existing={current.returned.map((f) => ({ ...f, href: fileHref(uni, f.id, "admin") }))}
                removeName="removeFileIds"
                hint="Optional: the marked-up work or a model answer. Only this student sees it."
              />
              <div className="flex flex-wrap gap-2 pt-1">
                <SubmitButton>Save grade</SubmitButton>
                {next && (
                  <button type="submit" name="next" value={next.student.id} className={buttonClass("secondary")}>
                    Save and grade {next.student.name.split(" ")[0]}
                  </button>
                )}
              </div>
            </ActionForm>
          </Card>
        ) : (
          current.status === "graded" && (
            <Card>
              <CardTitle>Grade</CardTitle>
              <p className="text-[15px]">
                <span className="font-semibold">{formatMarks(current.finalMarks)}</span> / {a.points}
                {current.penaltyPct ? <span className="text-muted"> after a {current.penaltyPct}% late penalty</span> : null}
              </p>
              {current.feedback && <p className="mt-2 whitespace-pre-wrap text-[14px] text-muted">{current.feedback}</p>}
            </Card>
          )
        )}
      </div>
    </div>
  );
}
