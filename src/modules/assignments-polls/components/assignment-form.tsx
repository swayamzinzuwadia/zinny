"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Card, CardTitle, Field, Input, Select } from "@/components/ui";
import { FileUploader, type ExistingFile } from "./file-uploader";
import { RichTextEditor } from "./rich-text-editor";

export type AssignmentFormValues = {
  title: string;
  instructionsHtml: string;
  dueDate: string;
  dueTime: string;
  points: number;
  allowLate: boolean;
  latePenaltyPct: number;
  submissionType: "text" | "files" | "both";
  maxFiles: number;
  maxFileMb: number;
  scope: "all" | "some";
  batchIds: string[];
};

/** Create and edit form for an assignment (staff). */
export function AssignmentForm({
  action,
  uni,
  courseId,
  assignmentId,
  batches,
  canAll,
  values,
  attachments = [],
  uploadEndpoint,
  accept,
  maxUploadMb,
  submitLabel,
  timezoneNote,
  lockedPoints,
}: {
  action: FormAction;
  uni: string;
  courseId: string;
  assignmentId?: string;
  batches: { id: string; name: string; note?: string }[];
  canAll: boolean;
  values: AssignmentFormValues;
  attachments?: ExistingFile[];
  uploadEndpoint: string;
  accept: string;
  maxUploadMb: number;
  submitLabel: string;
  timezoneNote: string;
  /** Points can't change once someone is graded. */
  lockedPoints?: string;
}) {
  const [allowLate, setAllowLate] = useState(values.allowLate);
  const [type, setType] = useState(values.submissionType);
  const [scope, setScope] = useState<"all" | "some">(canAll ? values.scope : "some");

  return (
    <ActionForm action={action} resetOnSuccess={false} className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <input type="hidden" name="uni" value={uni} />
      <input type="hidden" name="courseId" value={courseId} />
      {assignmentId && <input type="hidden" name="assignmentId" value={assignmentId} />}

      <div className="space-y-5">
        <Card className="space-y-5">
          <Field label="Title">
            <Input name="title" required minLength={3} maxLength={200} defaultValue={values.title} placeholder="SQL joins worksheet" />
          </Field>
          <RichTextEditor name="instructions" label="Instructions" defaultValue={values.instructionsHtml} placeholder="What should students do, and how will it be marked?" />
          <FileUploader
            endpoint={uploadEndpoint}
            target={{ purpose: "attachment", courseId }}
            label="Attachments"
            max={10}
            maxMb={maxUploadMb}
            accept={accept}
            existing={attachments}
            removeName="removeFileIds"
            hint={`Optional: a worksheet, data set or reading. Up to 10 files, ${maxUploadMb} MB each.`}
          />
        </Card>
      </div>

      <div className="space-y-5">
        <Card className="space-y-4">
          <CardTitle>Due date and marks</CardTitle>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Due date">
              <Input type="date" name="dueDate" required defaultValue={values.dueDate} />
            </Field>
            <Field label="Time">
              <Input type="time" name="dueTime" required defaultValue={values.dueTime} />
            </Field>
          </div>
          <p className="-mt-2 text-[12px] text-muted">{timezoneNote}</p>
          <Field label="Points" hint={lockedPoints}>
            <Input type="number" name="points" min={1} max={1000} required defaultValue={values.points} readOnly={!!lockedPoints} />
          </Field>
          <label className="flex items-center gap-2 text-[14px]">
            <input type="checkbox" name="allowLate" className="accent-brand" checked={allowLate} onChange={(e) => setAllowLate(e.target.checked)} />
            Accept late work
          </label>
          {allowLate && (
            <Field label="Late penalty (%)" hint="Taken off the marks of work handed in after the due date.">
              <Input type="number" name="latePenaltyPct" min={0} max={100} defaultValue={values.latePenaltyPct} />
            </Field>
          )}
        </Card>

        <Card className="space-y-4">
          <CardTitle>How students hand in</CardTitle>
          <Field label="Students hand in">
            <Select name="submissionType" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="both">A written answer, files or both</option>
              <option value="text">A written answer only</option>
              <option value="files">Files only</option>
            </Select>
          </Field>
          {type !== "text" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Files at most">
                <Input type="number" name="maxFiles" min={1} max={10} defaultValue={values.maxFiles} />
              </Field>
              <Field label="MB per file">
                <Input type="number" name="maxFileMb" min={1} max={maxUploadMb} defaultValue={values.maxFileMb} />
              </Field>
            </div>
          )}
        </Card>

        <Card className="space-y-3">
          <CardTitle>Who it&apos;s for</CardTitle>
          {canAll && (
            <div className="space-y-2 text-[14px]">
              <label className="flex items-center gap-2">
                <input type="radio" name="scope" value="all" className="accent-brand" checked={scope === "all"} onChange={() => setScope("all")} />
                Every batch of the course, including new ones
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="scope" value="some" className="accent-brand" checked={scope === "some"} onChange={() => setScope("some")} />
                Only some batches
              </label>
            </div>
          )}
          {!canAll && <input type="hidden" name="scope" value="some" />}
          {scope === "some" && (
            <div className="space-y-1.5 rounded-xl bg-canvas p-3">
              {batches.length === 0 && <p className="text-[13px] text-muted">You don&apos;t teach a batch of this course.</p>}
              {batches.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-[14px]">
                  <input type="checkbox" name="batchId" value={b.id} defaultChecked={values.batchIds.includes(b.id) || batches.length === 1} className="accent-brand" />
                  {b.name}
                  {b.note && <span className="text-[12px] text-faint">{b.note}</span>}
                </label>
              ))}
            </div>
          )}
          <p className="text-[12px] text-muted">Students in these batches are told as soon as you save.</p>
        </Card>

        <SubmitButton pendingText="Saving…">{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}
