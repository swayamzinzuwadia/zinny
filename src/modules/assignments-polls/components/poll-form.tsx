"use client";

import { useEffect, useRef, useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Field, Input, Select } from "@/components/ui";

/** Add-a-poll form: a question, 2 to 10 options, who it's for and when it's open. */
export function PollForm({
  action,
  uni,
  courseId,
  batches,
  canAll,
  defaults,
  timezoneNote,
}: {
  action: FormAction;
  uni: string;
  courseId: string;
  batches: { id: string; name: string }[];
  canAll: boolean;
  defaults: { opensDate: string; opensTime: string; closesDate: string; closesTime: string };
  timezoneNote: string;
}) {
  const [count, setCount] = useState(2);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const form = root.current?.closest("form");
    const reset = () => setCount(2);
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, []);

  return (
    <ActionForm action={action} className="space-y-4">
      <div ref={root} className="space-y-4">
        <input type="hidden" name="uni" value={uni} />
        <input type="hidden" name="courseId" value={courseId} />
        <Field label="Question">
          <Input name="question" required minLength={3} maxLength={300} placeholder="Which day suits the extra class?" />
        </Field>
        <div className="space-y-2">
          <span className="block text-[13px] font-medium">Options</span>
          {Array.from({ length: count }, (_, i) => (
            <Input key={i} name="option" required={i < 2} maxLength={120} placeholder={`Option ${i + 1}`} aria-label={`Option ${i + 1}`} />
          ))}
          {count < 10 && (
            <button type="button" className="text-[13px] font-medium text-brand hover:underline" onClick={() => setCount((n) => n + 1)}>
              Add an option
            </button>
          )}
        </div>
        <Field label="Who votes">
          <Select name="batchId" defaultValue={canAll ? "all" : batches[0]?.id}>
            {canAll && <option value="all">Every batch of the course</option>}
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} only
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Opens">
            <Input type="date" name="opensDate" required defaultValue={defaults.opensDate} />
          </Field>
          <Field label="At">
            <Input type="time" name="opensTime" required defaultValue={defaults.opensTime} />
          </Field>
          <Field label="Closes">
            <Input type="date" name="closesDate" required defaultValue={defaults.closesDate} />
          </Field>
          <Field label="At">
            <Input type="time" name="closesTime" required defaultValue={defaults.closesTime} />
          </Field>
        </div>
        <p className="-mt-2 text-[12px] text-muted">{timezoneNote}</p>
        <label className="flex items-start gap-2 text-[14px]">
          <input type="checkbox" name="anonymous" className="mt-1 accent-brand" />
          <span>
            Anonymous
            <span className="block text-[12px] text-muted">Nobody, staff included, can see who chose what.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-[14px]">
          <input type="checkbox" name="resultsToStudents" defaultChecked className="mt-1 accent-brand" />
          <span>
            Show results to students after it closes
            <span className="block text-[12px] text-muted">Totals only, never names.</span>
          </span>
        </label>
        <SubmitButton variant="secondary">Add poll</SubmitButton>
      </div>
    </ActionForm>
  );
}
