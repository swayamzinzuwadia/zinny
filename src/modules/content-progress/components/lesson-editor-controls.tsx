"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass } from "@/components/ui";
import { deleteLessonAction } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("danger", "sm")}>
      {pending ? "Deleting…" : "Delete lesson"}
    </button>
  );
}

/** Deletes the lesson after a confirmation, then returns to the Curriculum tab. */
export function DeleteLessonButton({ uni, lessonId, courseId, title }: { uni: string; lessonId: string; courseId: string; title: string }) {
  const [state, action] = useActionState(deleteLessonAction, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Delete ${title}? Students lose their progress on it. This can't be undone.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="uni" value={uni} />
      <input type="hidden" name="lessonId" value={lessonId} />
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="from" value="editor" />
      <Submit />
      {state?.error && <p className="mt-2 text-[13px] text-danger">{state.error}</p>}
    </form>
  );
}
