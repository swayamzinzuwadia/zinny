"use client";

/** Small interactive controls for the Curriculum tab: move up/down, delete, rename a section. */
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { cx } from "@/components/ui";
import { deleteLessonAction, deleteSectionAction, moveLessonAction, moveSectionAction, renameSectionAction } from "../actions";

const iconBtn =
  "inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-brand-soft hover:text-brand-strong disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent";

function Pending({
  children,
  label,
  disabled,
  className,
  name,
  value,
}: {
  children: React.ReactNode;
  label: string;
  disabled?: boolean;
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      aria-label={label}
      title={label}
      disabled={disabled || pending}
      className={cx(iconBtn, className, pending && "animate-pulse")}
    >
      {children}
    </button>
  );
}

function ErrorTip({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <span role="alert" className="absolute right-0 top-9 z-10 w-64 rounded-xl bg-danger-soft px-3 py-2 text-[12.5px] text-danger shadow-sm">
      {error}
    </span>
  );
}

export function MoveButtons({
  kind,
  uni,
  id,
  courseId,
  first,
  last,
  label,
}: {
  kind: "section" | "lesson";
  uni: string;
  id: string;
  courseId: string;
  first: boolean;
  last: boolean;
  label: string;
}) {
  const [state, action] = useActionState(kind === "section" ? moveSectionAction : moveLessonAction, null);
  const idName = kind === "section" ? "sectionId" : "lessonId";
  return (
    <form action={action} className="relative flex">
      <input type="hidden" name="uni" value={uni} />
      <input type="hidden" name={idName} value={id} />
      <input type="hidden" name="courseId" value={courseId} />
      <Pending label={`Move ${label} up`} disabled={first} name="direction" value="up">
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m5.5 12 4.5-4.5 4.5 4.5" />
        </svg>
      </Pending>
      <Pending label={`Move ${label} down`} disabled={last} name="direction" value="down">
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m5.5 8 4.5 4.5L14.5 8" />
        </svg>
      </Pending>
      <ErrorTip error={state?.error} />
    </form>
  );
}

export function DeleteButton({ kind, uni, id, courseId, label, confirm }: { kind: "section" | "lesson"; uni: string; id: string; courseId: string; label: string; confirm: string }) {
  const [state, action] = useActionState(kind === "section" ? deleteSectionAction : deleteLessonAction, null);
  return (
    <form
      action={action}
      className="relative"
      onSubmit={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
    >
      <input type="hidden" name="uni" value={uni} />
      <input type="hidden" name={kind === "section" ? "sectionId" : "lessonId"} value={id} />
      <input type="hidden" name="courseId" value={courseId} />
      <Pending label={`Delete ${label}`} className="hover:bg-danger-soft hover:text-danger">
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4.5 6h11M8 6V4.5h4V6m-6 0 .7 9.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8L14 6" />
        </svg>
      </Pending>
      <ErrorTip error={state?.error} />
    </form>
  );
}

export function RenameSection({ uni, sectionId, title }: { uni: string; sectionId: string; title: string }) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState(renameSectionAction, null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="group flex items-center gap-2 text-left" title="Rename section">
        <h2 className="text-[17px] font-medium">{title}</h2>
        <span className="text-[12.5px] text-brand opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Rename</span>
      </button>
    );
  }
  return (
    <form action={action} className="mt-1 flex flex-wrap items-center gap-2">
      <input type="hidden" name="uni" value={uni} />
      <input type="hidden" name="sectionId" value={sectionId} />
      <input
        ref={input}
        name="title"
        defaultValue={title}
        required
        minLength={2}
        maxLength={200}
        aria-label="Section title"
        onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
        className="h-9 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-[15px] outline-none focus:border-brand focus:ring-4 focus:ring-gold-soft"
      />
      <RenameSubmit />
      <button type="button" onClick={() => setEditing(false)} className="h-8 rounded-full px-3 text-[13px] text-muted hover:text-ink">
        Cancel
      </button>
      {state?.error && <p className="w-full text-[13px] text-danger">{state.error}</p>}
    </form>
  );
}

function RenameSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="h-8 rounded-full bg-brand px-3.5 text-[13px] font-medium text-canvas hover:bg-brand-strong disabled:opacity-50">
      {pending ? "Saving…" : "Save name"}
    </button>
  );
}
