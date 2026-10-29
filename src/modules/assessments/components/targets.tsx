"use client";

import { useState } from "react";
import { Field, Input, Select } from "@/components/ui";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";

export type CourseChoice = { courseId: string; title: string; wholeCourse: boolean; batches: { id: string; name: string; status: string }[] };

/** "Whole course" or "Specific batches", with the batches the person may pick. */
export function TargetsPicker({
  wholeCourse,
  batches,
  allBatches,
  selected,
  disabled,
}: {
  wholeCourse: boolean;
  batches: { id: string; name: string; status: string }[];
  allBatches: boolean;
  selected: readonly string[];
  disabled?: boolean;
}) {
  const [scope, setScope] = useState<"course" | "batches">(wholeCourse && allBatches ? "course" : "batches");
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-1.5 text-[13px] font-medium">For</legend>
      <div className="space-y-2 text-[14px]">
        {wholeCourse && (
          <label className="flex items-start gap-2">
            <input type="radio" name="scope" value="course" checked={scope === "course"} onChange={() => setScope("course")} className="mt-1 accent-brand" />
            <span>
              Every batch of the course
              <span className="block text-[12px] text-muted">Batches added later get it too.</span>
            </span>
          </label>
        )}
        <label className="flex items-start gap-2">
          <input type="radio" name="scope" value="batches" checked={scope === "batches"} onChange={() => setScope("batches")} className="mt-1 accent-brand" />
          <span>Specific batches</span>
        </label>
        {scope === "batches" && (
          <div className="ml-6 space-y-1.5">
            {batches.length === 0 && <p className="text-[13px] text-muted">This course has no batches you teach.</p>}
            {batches.map((b) => (
              <label key={b.id} className="flex items-center gap-2 text-[14px]">
                <input type="checkbox" name="batchId" value={b.id} defaultChecked={selected.includes(b.id) || batches.length === 1} className="accent-brand" />
                {b.name}
                {b.status !== "open" && <span className="text-[12px] text-faint">{b.status}</span>}
              </label>
            ))}
          </div>
        )}
      </div>
    </fieldset>
  );
}

export function NewTestForm({ uni, choices, action, defaultCourseId, defaultKind }: { uni: string; choices: CourseChoice[]; action: FormAction; defaultCourseId?: string; defaultKind?: string }) {
  const [courseId, setCourseId] = useState(choices.some((c) => c.courseId === defaultCourseId) ? defaultCourseId! : choices[0]?.courseId);
  const course = choices.find((c) => c.courseId === courseId);
  return (
    <ActionForm action={action} className="space-y-4" resetOnSuccess={false}>
      <input type="hidden" name="uni" value={uni} />
      <Field label="Type">
        <Select name="kind" defaultValue={defaultKind ?? "quiz"}>
          <option value="quiz">Quiz</option>
          <option value="mock_test">Mock test</option>
          <option value="series">Test series</option>
        </Select>
      </Field>
      <Field label="Title">
        <Input name="title" placeholder="SQL joins practice" required minLength={3} maxLength={160} />
      </Field>
      <Field label="Course">
        <Select name="courseId" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          {choices.map((c) => (
            <option key={c.courseId} value={c.courseId}>
              {c.title}
            </option>
          ))}
        </Select>
      </Field>
      {course && <TargetsPicker key={course.courseId} wholeCourse={course.wholeCourse} batches={course.batches} allBatches selected={[]} />}
      <SubmitButton pendingText="Creating…">Create test</SubmitButton>
    </ActionForm>
  );
}
