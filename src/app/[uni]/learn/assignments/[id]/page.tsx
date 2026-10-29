import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardTitle, Field, Notice, Textarea, cx } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { submitAction } from "@/modules/assignments-polls/actions";
import { FileLinks, Instructions, Score, StatusBadge } from "@/modules/assignments-polls/components/bits";
import { FileUploader } from "@/modules/assignments-polls/components/file-uploader";
import { isDueSoon } from "@/modules/assignments-polls/components/learner-bits";
import { ACCEPT, MAX_TEXT_CHARS } from "@/modules/assignments-polls/lib/files";
import { formatMarks } from "@/modules/assignments-polls/lib/grading";
import { dueLabel, formatWhen, relative } from "@/modules/assignments-polls/lib/time";
import { fileHref, learnBase, uploadHref } from "@/modules/assignments-polls/links";
import { orNotFound } from "@/modules/assignments-polls/pages";
import { myAssignment } from "@/modules/assignments-polls/service/assignments";

export const metadata = { title: "Assignment" };

const HANDS_IN: Record<string, string> = { text: "A written answer", files: "Files", both: "A written answer, files or both" };

export default async function LearnerAssignmentPage({ params }: { params: Promise<{ uni: string; id: string }> }) {
  const { uni, id } = await params;
  const { actor } = await spaceContext(uni);
  const a = await orNotFound(myAssignment(actor, id));
  const tz = a.timezone;
  const now = new Date();
  const soon = isDueSoon(a, tz, now);
  const latest = a.versions[0];
  const pastDue = now > a.dueAt;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href={learnBase(uni)} className="text-sm text-muted">
        Assignments
      </Link>
      <div className="mb-5 mt-2">
        <div className="text-[13px] text-muted">
          <Link href={`/${uni}/learn/my/${a.enrolmentId}?tab=assignments`} className="hover:text-brand">
            {a.courseTitle}
          </Link>
        </div>
        <h1 className="mt-0.5 text-[24px] font-semibold leading-tight tracking-tight sm:text-[26px]">{a.title}</h1>
        <div className="mt-2">
          <StatusBadge status={a.status} late={a.late} dueSoon={soon} />
        </div>
      </div>

      <Card className={cx("mb-5 p-5", soon && "border-gold")}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[14px] sm:grid-cols-4">
          <div className="col-span-2">
            <dt className="text-muted">Due</dt>
            <dd className={cx("font-medium", soon && "text-gold-strong")}>
              {dueLabel(a.dueAt, tz, now)}
              {!pastDue && <span className="block text-[12px] font-normal text-muted">{relative(a.dueAt, now)}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Points</dt>
            <dd className="font-medium">{a.points}</dd>
          </div>
          <div>
            <dt className="text-muted">Late work</dt>
            <dd className="font-medium">{a.allowLate ? (a.latePenaltyPct ? `${a.latePenaltyPct}% off` : "Accepted") : "Not accepted"}</dd>
          </div>
        </dl>
        <p className="mt-3 border-t border-line pt-3 text-[13px] text-muted">
          Hand in: {HANDS_IN[a.submissionType]}
          {a.submissionType !== "text" && `, up to ${a.maxFiles} file${a.maxFiles === 1 ? "" : "s"} of ${a.maxFileMb} MB each`}.
        </p>
      </Card>

      {a.status === "graded" && (
        <Card className="mb-5 border-brand/30 bg-brand-soft/40">
          <CardTitle hint={a.gradedAt ? `Graded ${formatWhen(a.gradedAt, tz, now)}` : undefined}>Your grade</CardTitle>
          <Score marks={a.finalMarks} points={a.points} percent={a.scorePercent} className="text-[22px]" />
          {a.penaltyPct ? (
            <p className="mt-1 text-[13px] text-muted">
              {formatMarks(a.marks)} before the {a.penaltyPct}% late penalty.
            </p>
          ) : null}
          {a.feedback && (
            <div className="mt-4">
              <div className="mb-1 text-[13px] font-medium">Feedback</div>
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{a.feedback}</p>
            </div>
          )}
          {a.returned.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 text-[13px] font-medium">Returned to you</div>
              <FileLinks uni={uni} area="learn" files={a.returned} />
            </div>
          )}
        </Card>
      )}

      <Card className="mb-5">
        <CardTitle>Instructions</CardTitle>
        <Instructions html={a.instructionsHtml} />
        {a.attachments.length > 0 && (
          <div className="mt-4 border-t border-line pt-4">
            <div className="mb-2 text-[13px] font-medium">Files from your teacher</div>
            <FileLinks uni={uni} area="learn" files={a.attachments} />
          </div>
        )}
      </Card>

      {latest && (
        <Card className="mb-5">
          <CardTitle hint={a.versionCount > 1 ? `Version ${latest.version}` : undefined}>Your work</CardTitle>
          <p className="mb-3 text-[13px] text-muted">
            Handed in {formatWhen(latest.submittedAt, tz, now)}
            {latest.late && <span className="text-warn">, after the due date</span>}
          </p>
          {latest.textAnswer && <div className="mb-3 whitespace-pre-wrap rounded-2xl bg-canvas p-4 text-[14px] leading-relaxed">{latest.textAnswer}</div>}
          <FileLinks uni={uni} area="learn" files={latest.files} />
          {a.versions.length > 1 && (
            <details className="mt-4 rounded-2xl border border-line p-3">
              <summary className="cursor-pointer text-[13px] font-medium text-brand">Earlier versions ({a.versions.length - 1})</summary>
              <ol className="mt-3 space-y-4">
                {a.versions.slice(1).map((v) => (
                  <li key={v.id} className="space-y-2">
                    <div className="text-[13px] text-muted">
                      Version {v.version}, {formatWhen(v.submittedAt, tz, now)}
                    </div>
                    {v.textAnswer && <div className="whitespace-pre-wrap rounded-xl bg-canvas p-3 text-[13px]">{v.textAnswer}</div>}
                    <FileLinks uni={uni} area="learn" files={v.files} />
                  </li>
                ))}
              </ol>
            </details>
          )}
        </Card>
      )}

      {a.canSubmit ? (
        <Card>
          <CardTitle>{latest ? "Hand in again" : "Hand in your work"}</CardTitle>
          {pastDue && (
            <div className="mb-4">
              <Notice tone="warn">
                The due date has passed. Your work will be marked late{a.latePenaltyPct ? ` and lose ${a.latePenaltyPct}% of its marks` : ""}, and you can&apos;t change it afterwards.
              </Notice>
            </div>
          )}
          {latest && !pastDue && <p className="mb-4 text-[13px] text-muted">Your teacher sees the newest version. Earlier versions are kept.</p>}
          <ActionForm action={submitAction} resetOnSuccess={false} className="space-y-4">
            <input type="hidden" name="uni" value={uni} />
            <input type="hidden" name="assignmentId" value={a.id} />
            {a.submissionType !== "files" && (
              <Field label="Your answer" hint={a.submissionType === "both" ? "Optional when you upload files." : undefined}>
                <Textarea name="text" rows={8} maxLength={MAX_TEXT_CHARS} defaultValue={latest?.textAnswer ?? ""} placeholder="Write your answer here." className="text-[14px]" />
              </Field>
            )}
            {a.submissionType !== "text" && (
              <FileUploader
                key={a.versionCount}
                endpoint={uploadHref(uni, "learn")}
                target={{ purpose: "submission", assignmentId: a.id }}
                label="Files"
                max={a.maxFiles}
                maxMb={a.maxFileMb}
                accept={ACCEPT}
                existing={(latest?.files ?? []).map((f) => ({ ...f, href: fileHref(uni, f.id, "learn") }))}
                keepName="keepFileIds"
              />
            )}
            <SubmitButton pendingText="Handing in…">{pastDue ? "Hand in late" : latest ? "Hand in again" : "Hand in"}</SubmitButton>
          </ActionForm>
        </Card>
      ) : (
        a.closedReason && a.status !== "graded" && <Notice tone={a.status === "missed" ? "danger" : "neutral"}>{a.closedReason}</Notice>
      )}
    </div>
  );
}
