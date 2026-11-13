"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "./forms";
import { Card, CardTitle, Field, Input, Select, Textarea, cx } from "./ui";

export type QuickBatch = {
  id: string;
  courseId: string;
  label: string;
  pricePaise: number;
  seatsLeft: number;
  startTime: string | null;
  endTime: string | null;
};

export type QuickActionsProps = {
  uni: string;
  today: string;
  tomorrow: string;
  place: QuickBatch[];
  departments: { id: string; name: string }[];
  announce: QuickBatch[];
  schedule: QuickBatch[];
  fee: {
    gstEnabled: boolean;
    courses: { id: string; title: string; pricePaise: number }[];
    students: { id: string; name: string; email: string }[];
    modes: { value: string; label: string }[];
  } | null;
  actions: { addStudent: FormAction; recordFee: FormAction; announce: FormAction; extraClass: FormAction };
};

type Key = "student" | "fee" | "announce" | "extra";

const rupees = (paise: number) => (paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });

/**
 * The dashboard's quick actions: the forms an institute fills in every day, opened in
 * place with sensible defaults (the batch's price, its usual class time, cash, today).
 * Only the actions this person may take are offered.
 */
export function QuickActions(p: QuickActionsProps) {
  const offered: { key: Key; label: string }[] = [
    ...(p.place.length || p.departments.length ? [{ key: "student" as const, label: "Add a student" }] : []),
    ...(p.fee && p.fee.students.length ? [{ key: "fee" as const, label: "Record a fee payment" }] : []),
    ...(p.announce.length ? [{ key: "announce" as const, label: "Send an announcement" }] : []),
    ...(p.schedule.length ? [{ key: "extra" as const, label: "Add an extra class" }] : []),
  ];
  const [open, setOpen] = useState<Key | null>(null);
  if (offered.length === 0) return null;
  return (
    <Card>
      <CardTitle>Quick actions</CardTitle>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Quick actions">
        {offered.map((o) => (
          <button
            key={o.key}
            type="button"
            aria-expanded={open === o.key}
            onClick={() => setOpen(open === o.key ? null : o.key)}
            className={cx(
              "rounded-full border px-4 py-2 text-[14px] font-medium transition-colors",
              open === o.key ? "border-brand bg-brand text-canvas" : "border-line bg-surface hover:border-brand/40",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {open === "student" && <AddStudentForm {...p} />}
      {open === "fee" && p.fee && <FeeForm {...p} fee={p.fee} />}
      {open === "announce" && <AnnounceForm {...p} />}
      {open === "extra" && <ExtraClassForm {...p} />}
    </Card>
  );
}

function Hidden({ uni }: { uni: string }) {
  return <input type="hidden" name="uni" value={uni} />;
}

function PaymentFields({ modes, pricePaise, gstEnabled, amountLabel }: { modes: { value: string; label: string }[]; pricePaise: number | null; gstEnabled: boolean; amountLabel: string }) {
  const [mode, setMode] = useState("cash");
  return (
    <>
      <Field label={gstEnabled ? `${amountLabel} before GST (₹)` : `${amountLabel} (₹)`} hint={pricePaise ? `Leave empty for the course price, ₹${rupees(pricePaise)}.` : undefined}>
        <Input name="amount" inputMode="decimal" placeholder={pricePaise ? rupees(pricePaise) : "3500"} />
      </Field>
      <Field label="Paid by">
        <Select name="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
          {modes.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>
      {mode !== "cash" && (
        <Field label="Reference" hint="UPI transaction id, bank UTR or cheque number.">
          <Input name="reference" maxLength={80} className="font-mono" />
        </Field>
      )}
    </>
  );
}

function AddStudentForm({ uni, place, departments, fee, actions }: QuickActionsProps) {
  const [batchId, setBatchId] = useState(place[0]?.id ?? "");
  const [paid, setPaid] = useState(false);
  const batch = place.find((b) => b.id === batchId) ?? null;
  return (
    <ActionForm action={actions.addStudent} className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
      <Hidden uni={uni} />
      <Field label="Full name">
        <Input name="name" required autoComplete="off" />
      </Field>
      <Field label="Email" hint="They sign in with it. We email them a link to set a password.">
        <Input name="email" type="email" required autoComplete="off" />
      </Field>
      <Field label="Phone (optional)">
        <Input name="phone" inputMode="tel" maxLength={20} />
      </Field>
      <Field label="Batch" hint={batch ? `${batch.seatsLeft} seat${batch.seatsLeft === 1 ? "" : "s"} left` : "They see the department's courses and can join a batch later."}>
        <Select name="batchId" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
          {place.map((b) => (
            <option key={b.id} value={b.id} disabled={b.seatsLeft <= 0}>
              {b.label}
              {b.seatsLeft <= 0 ? " (full)" : ""}
            </option>
          ))}
          {departments.length > 0 && <option value="">No batch yet</option>}
        </Select>
      </Field>
      {!batchId && departments.length > 0 && (
        <Field label="Department" hint="They see this department's courses.">
          <Select name="departmentId" defaultValue={departments[0].id}>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {fee && batch && (
        <label className="flex items-center gap-2 text-[14px] md:col-span-2">
          <input type="checkbox" name="paid" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="accent-brand" />
          Paid now: record the fee and give them a receipt
        </label>
      )}
      {fee && batch && paid && <PaymentFields modes={fee.modes} pricePaise={batch.pricePaise || null} gstEnabled={fee.gstEnabled} amountLabel="Fee" />}
      <div className="md:col-span-2">
        <SubmitButton pendingText="Adding…">{batch ? (paid ? "Add student and record fee" : "Add student to batch") : "Add student"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

function FeeForm({ uni, fee, actions }: QuickActionsProps & { fee: NonNullable<QuickActionsProps["fee"]> }) {
  const [courseId, setCourseId] = useState(fee.courses[0]?.id ?? "");
  const course = fee.courses.find((c) => c.id === courseId) ?? null;
  return (
    <ActionForm action={actions.recordFee} className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
      <Hidden uni={uni} />
      <Field label="Student">
        <Select name="student" required aria-label="Student">
          {fee.students.map((s) => (
            <option key={s.id} value={s.email}>
              {s.name} · {s.email}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="For">
        <Select name="courseId" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          {fee.courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
          <option value="">Something else</option>
        </Select>
      </Field>
      {!course && (
        <Field label="What the fee is for">
          <Input name="description" maxLength={120} placeholder="Semester 2 exam fee" required />
        </Field>
      )}
      <PaymentFields modes={fee.modes} pricePaise={course?.pricePaise || null} gstEnabled={fee.gstEnabled} amountLabel="Amount" />
      <p className="text-[13px] text-muted md:col-span-2">This issues an invoice dated today, marked paid. The student sees it under Invoices.</p>
      <div className="md:col-span-2">
        <SubmitButton pendingText="Recording…">Record payment</SubmitButton>
      </div>
    </ActionForm>
  );
}

function AnnounceForm({ uni, announce, actions }: QuickActionsProps) {
  return (
    <ActionForm action={actions.announce} className="mt-5 space-y-4">
      <Hidden uni={uni} />
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium">Send to</legend>
        <div className="flex flex-wrap gap-2">
          {announce.map((b) => (
            <label key={b.id} className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
              <input type="checkbox" name="batchId" value={b.id} defaultChecked={announce.length === 1} className="accent-brand" />
              {b.label}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Headline">
        <Input name="title" required maxLength={120} placeholder="No class on Friday" />
      </Field>
      <Field label="Message (optional)">
        <Textarea name="body" maxLength={1000} rows={3} placeholder="We make it up on Saturday at the usual time." />
      </Field>
      <p className="text-[13px] text-muted">Students get it in Zinny and by email, the way they chose in their notification settings.</p>
      <SubmitButton pendingText="Sending…">Send announcement</SubmitButton>
    </ActionForm>
  );
}

function ExtraClassForm({ uni, schedule, tomorrow, today, actions }: QuickActionsProps) {
  const [batchId, setBatchId] = useState(schedule[0]?.id ?? "");
  const batch = schedule.find((b) => b.id === batchId) ?? schedule[0];
  return (
    <ActionForm action={actions.extraClass} className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
      <Hidden uni={uni} />
      <div className="md:col-span-2">
        <Field label="Batch">
          <Select name="batchId" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
            {schedule.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Day">
        <Input type="date" name="date" defaultValue={tomorrow} min={today} required />
      </Field>
      {/* Keyed by batch, so the times start from the batch's usual class time. */}
      <div key={batch?.id} className="grid grid-cols-2 gap-3">
        <Field label="From">
          <Input type="time" name="startTime" defaultValue={batch?.startTime ?? "10:00"} required />
        </Field>
        <Field label="To">
          <Input type="time" name="endTime" defaultValue={batch?.endTime ?? "11:00"} required />
        </Field>
      </div>
      <div className="md:col-span-2">
        <Field label="Note for students (optional)">
          <Input name="note" maxLength={200} placeholder="Revision before the test" />
        </Field>
      </div>
      <div className="md:col-span-2">
        <SubmitButton pendingText="Adding…">Add extra class and tell students</SubmitButton>
      </div>
    </ActionForm>
  );
}
