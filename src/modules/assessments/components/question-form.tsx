"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Field, Input, Select, Textarea, buttonClass, cx } from "@/components/ui";

type Type = "single" | "multiple" | "true_false" | "numeric" | "short";

export type QuestionFormValues = {
  type: Type;
  prompt: string;
  options: { text: string; correct: boolean }[];
  isTrue: boolean | null;
  value: number | null;
  tolerance: number | null;
  guide: string;
  marks: number;
  negativeMarks: number;
  difficulty: "easy" | "medium" | "hard";
  tags: string[];
  explanation: string;
};

const EMPTY: QuestionFormValues = {
  type: "single",
  prompt: "",
  options: [
    { text: "", correct: false },
    { text: "", correct: false },
    { text: "", correct: false },
    { text: "", correct: false },
  ],
  isTrue: null,
  value: null,
  tolerance: 0,
  guide: "",
  marks: 1,
  negativeMarks: 0,
  difficulty: "medium",
  tags: [],
  explanation: "",
};

const TYPES: { value: Type; label: string; hint: string }[] = [
  { value: "single", label: "Single choice", hint: "One right option" },
  { value: "multiple", label: "Multiple choice", hint: "One or more right options, all or nothing" },
  { value: "true_false", label: "True or false", hint: "A statement to judge" },
  { value: "numeric", label: "Numeric", hint: "A number, with a tolerance" },
  { value: "short", label: "Short answer", hint: "Graded by hand" },
];

/** Add or edit a question. The pool is chosen by the page (a hidden field or a select passed in `poolField`). */
export function QuestionForm({
  action,
  hidden,
  poolField,
  initial,
  submitLabel,
}: {
  action: FormAction;
  hidden: Record<string, string>;
  poolField?: React.ReactNode;
  initial?: QuestionFormValues;
  submitLabel: string;
}) {
  const start = initial ?? EMPTY;
  const [type, setType] = useState<Type>(start.type);
  const [rows, setRows] = useState(start.options.length >= 2 ? start.options : EMPTY.options);
  const choice = type === "single" || type === "multiple";

  return (
    <ActionForm action={action} className="space-y-5" resetOnSuccess={!initial}>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {poolField}
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium">Type</legend>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {TYPES.map((t) => (
            <label
              key={t.value}
              className={cx(
                "cursor-pointer rounded-2xl border px-3 py-2.5 text-[13px] transition-colors",
                type === t.value ? "border-brand bg-brand-soft text-brand-strong" : "border-line bg-surface hover:border-brand/40",
              )}
            >
              <input type="radio" name="type" value={t.value} checked={type === t.value} onChange={() => setType(t.value)} className="sr-only" />
              <span className="block font-medium">{t.label}</span>
              <span className="block text-[12px] text-muted">{t.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="Question">
        <Textarea name="prompt" defaultValue={start.prompt} required rows={3} placeholder="Which SQL clause filters groups after aggregation?" className="text-[14px]" />
      </Field>

      {choice && (
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium">
            Options <span className="font-normal text-muted">{type === "single" ? "(pick the right one)" : "(tick every right one)"}</span>
          </legend>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <label className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line bg-surface" title="Correct answer">
                  <input
                    type={type === "single" ? "radio" : "checkbox"}
                    name="correct"
                    value={i}
                    defaultChecked={r.correct}
                    className="accent-brand"
                    aria-label={`Option ${String.fromCharCode(65 + i)} is correct`}
                  />
                </label>
                <span className="w-5 text-center text-[13px] text-muted">{String.fromCharCode(65 + i)}</span>
                <Input name="option" defaultValue={r.text} placeholder={`Option ${String.fromCharCode(65 + i)}`} className="min-w-0 flex-1" />
              </div>
            ))}
          </div>
          {rows.length < 8 && (
            <button type="button" onClick={() => setRows([...rows, { text: "", correct: false }])} className={cx(buttonClass("ghost", "sm"), "mt-2")}>
              Add an option
            </button>
          )}
        </fieldset>
      )}

      {type === "true_false" && (
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium">The statement is</legend>
          <div className="flex gap-2">
            {[
              ["true", "True"],
              ["false", "False"],
            ].map(([v, l]) => (
              <label key={v} className="flex cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[14px]">
                <input type="radio" name="isTrue" value={v} defaultChecked={start.isTrue === (v === "true")} className="accent-brand" required />
                {l}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {type === "numeric" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Correct answer">
            <Input name="value" type="number" step="any" defaultValue={start.value ?? ""} required />
          </Field>
          <Field label="Tolerance" hint="Answers within this much either way count as right.">
            <Input name="tolerance" type="number" step="any" min={0} defaultValue={start.tolerance ?? 0} />
          </Field>
        </div>
      )}

      {type === "short" && (
        <Field label="Model answer or marking guide" hint="Only graders see this, and students after results are shown.">
          <Textarea name="guide" defaultValue={start.guide} rows={3} placeholder="Mentions that a LEFT JOIN keeps unmatched rows from the left table." />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Marks">
          <Input name="marks" type="number" step="0.25" min={0.25} defaultValue={start.marks} required />
        </Field>
        <Field label="Negative marks" hint="Lost for a wrong answer.">
          <Input name="negativeMarks" type="number" step="0.25" min={0} defaultValue={start.negativeMarks} disabled={type === "short"} />
        </Field>
        <Field label="Difficulty">
          <Select name="difficulty" defaultValue={start.difficulty}>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </Select>
        </Field>
        <Field label="Tags" hint="Separate with commas.">
          <Input name="tags" defaultValue={start.tags.join(", ")} placeholder="SQL, Joins" />
        </Field>
      </div>

      <Field label="Explanation" hint="Shown to students with the answer, when answers are shown.">
        <Textarea name="explanation" defaultValue={start.explanation} rows={2} />
      </Field>

      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
