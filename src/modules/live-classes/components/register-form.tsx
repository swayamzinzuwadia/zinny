"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/components/forms";
import { Avatar, buttonClass, cx, inputClass } from "@/components/ui";
import { saveRegisterAction } from "../actions";
import type { AttendanceStatus } from "../time";

export type RegisterRow = {
  userId: string;
  name: string;
  email: string;
  status: AttendanceStatus | null;
  /** "Joined 9:02 am", "Marked by Farah", "Automatic: didn't join". */
  detail: string;
  note: string;
  current: boolean;
  lateEnrolment: boolean;
};

const OPTIONS: { value: AttendanceStatus; label: string; on: string }[] = [
  { value: "present", label: "Present", on: "bg-brand text-canvas" },
  { value: "late", label: "Late", on: "bg-gold text-brand-deep" },
  { value: "absent", label: "Absent", on: "bg-danger text-canvas" },
];

function SaveButton({ dirty }: { dirty: number }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || dirty === 0} className={buttonClass("primary")}>
      {pending ? "Saving…" : dirty === 0 ? "No changes" : `Save ${dirty} change${dirty === 1 ? "" : "s"}`}
    </button>
  );
}

/**
 * The register: one row per student with Present / Late / Absent and a note. Only changed
 * rows are sent and saved. Read-only when the register is locked or the viewer can't mark.
 */
export function RegisterForm({
  uni,
  batchId,
  date,
  start,
  rows,
  editable,
}: {
  uni: string;
  batchId: string;
  date: string;
  start: string;
  rows: RegisterRow[];
  editable: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(saveRegisterAction, null);
  const initial = useMemo(() => Object.fromEntries(rows.map((r) => [r.userId, { status: r.status, note: r.note }])), [rows]);
  const [values, setValues] = useState(initial);
  const [openNote, setOpenNote] = useState<Record<string, boolean>>({});
  useEffect(() => setValues(initial), [initial]);
  const dirty = rows.filter((r) => values[r.userId]?.status !== r.status || (values[r.userId]?.note ?? "") !== r.note).length;

  const setAll = (status: AttendanceStatus) =>
    setValues((v) => Object.fromEntries(rows.map((r) => [r.userId, { ...v[r.userId], status: v[r.userId]?.status ?? status }])));

  return (
    <form action={action}>
      <input type="hidden" name="uni" value={uni} />
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="start" value={start} />
      {editable && rows.some((r) => !values[r.userId]?.status) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-muted">
          <span>Students without a status:</span>
          <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setAll("present")}>
            Mark the rest present
          </button>
          <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setAll("absent")}>
            Mark the rest absent
          </button>
        </div>
      )}
      <ul className="divide-y divide-line rounded-[22px] border border-line bg-surface">
        {rows.map((r) => {
          const v = values[r.userId] ?? { status: null, note: "" };
          const changed = v.status !== r.status || (v.note ?? "") !== r.note;
          const showNote = openNote[r.userId] || !!v.note;
          return (
            <li key={r.userId} className={cx("px-4 py-3 sm:px-5", changed && "bg-gold-soft/40")}>
              <input type="hidden" name="student" value={r.userId} />
              <input type="hidden" name={`was:${r.userId}`} value={r.status ?? ""} />
              <input type="hidden" name={`wasNote:${r.userId}`} value={r.note} />
              <input type="hidden" name={`status:${r.userId}`} value={v.status ?? ""} />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Avatar name={r.name} size={34} />
                <div className="min-w-[180px] flex-1">
                  <div className="font-medium">
                    {r.name}
                    {!r.current && <span className="ml-2 text-[12px] font-normal text-muted">No longer in this batch</span>}
                    {r.lateEnrolment && <span className="ml-2 text-[12px] font-normal text-muted">Joined the batch after this class</span>}
                  </div>
                  <div className="text-[13px] text-muted">{r.detail}</div>
                </div>
                <div role="radiogroup" aria-label={`Attendance for ${r.name}`} className="flex rounded-full border border-line bg-canvas p-0.5">
                  {OPTIONS.map((o) => {
                    const on = v.status === o.value;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={!editable}
                        onClick={() => setValues((x) => ({ ...x, [r.userId]: { ...v, status: o.value } }))}
                        className={cx(
                          "rounded-full px-3 py-1 text-[13px] transition-colors disabled:cursor-default",
                          on ? cx("font-medium", o.on) : "text-muted enabled:hover:text-ink",
                        )}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
                {editable && !showNote && (
                  <button type="button" className="text-[13px] text-brand hover:underline" onClick={() => setOpenNote((x) => ({ ...x, [r.userId]: true }))}>
                    Add note
                  </button>
                )}
              </div>
              {showNote ? (
                <div className="mt-2 sm:pl-[50px]">
                  <input
                    name={`note:${r.userId}`}
                    value={v.note ?? ""}
                    maxLength={300}
                    readOnly={!editable}
                    placeholder="Why, for example: joined from a phone, connection dropped"
                    onChange={(e) => setValues((x) => ({ ...x, [r.userId]: { ...v, note: e.target.value } }))}
                    className={cx(inputClass, "h-9 text-[13px]")}
                    aria-label={`Note for ${r.name}`}
                  />
                </div>
              ) : (
                <input type="hidden" name={`note:${r.userId}`} value={v.note ?? ""} />
              )}
            </li>
          );
        })}
      </ul>
      {editable && (
        <div className="sticky bottom-3 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-full border border-line bg-surface/95 px-4 py-2 backdrop-blur">
          <span className="text-[13px] text-muted">{dirty ? "Unsaved changes are highlighted." : "Statuses update when students join."}</span>
          <SaveButton dirty={dirty} />
        </div>
      )}
      {state?.error && <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
      {state?.ok && <p className="mt-3 rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand-strong">{state.ok}</p>}
    </form>
  );
}
