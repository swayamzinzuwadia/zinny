"use client";

import { createContext, useActionState, useContext, useEffect, useState, type ReactNode } from "react";
import { ActionForm, ClashPrompt, SubmitButton, type ClashFormAction, type ClashState, type FormAction } from "./forms";
import { Card, Field, Input, Select, Textarea, cx } from "./ui";

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
  actions: { addStudent: ClashFormAction; recordFee: FormAction; announce: FormAction; extraClass: FormAction };
};

type Key = "student" | "fee" | "announce" | "extra" | "invite";

const rupees = (paise: number) => (paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });

type Ctx = { p: QuickActionsProps; invite: ReactNode; offered: { key: Key; label: string }[]; open: Key | null; setOpen: (k: Key | null) => void };
const QuickCtx = createContext<Ctx | null>(null);

/**
 * The dashboard's quick actions: the forms an institute fills in every day, opened in
 * place with sensible defaults (the batch's price, its usual class time, cash, today).
 * Only the actions this person may take are offered. The buttons (`QuickActionButtons`) sit
 * in the Today board's corner; the opened form (`QuickActionPanel`) shows under the board.
 * `invite` is the joining code and its sharing options, for the people who accept students.
 */
export function QuickActions({ invite, children, ...p }: QuickActionsProps & { invite?: ReactNode; children: ReactNode }) {
  const offered: { key: Key; label: string }[] = [
    ...(p.place.length || p.departments.length ? [{ key: "student" as const, label: "Add a student" }] : []),
    ...(p.fee && p.fee.students.length ? [{ key: "fee" as const, label: "Record a fee payment" }] : []),
    ...(p.announce.length ? [{ key: "announce" as const, label: "Send an announcement" }] : []),
    ...(p.schedule.length ? [{ key: "extra" as const, label: "Add an extra class" }] : []),
    ...(invite ? [{ key: "invite" as const, label: "Invite students" }] : []),
  ];
  const [open, setOpen] = useState<Key | null>(null);
  return <QuickCtx.Provider value={{ p, invite, offered, open, setOpen }}>{children}</QuickCtx.Provider>;
}

/** The quick action buttons, as pills on the green board. */
export function QuickActionButtons() {
  const c = useContext(QuickCtx);
  if (!c || c.offered.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Quick actions">
      {c.offered.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-expanded={c.open === o.key}
          aria-controls="quick-action-panel"
          onClick={() => c.setOpen(c.open === o.key ? null : o.key)}
          className={cx(
            "h-9 rounded-full border px-4 text-[14px] font-medium transition-colors",
            c.open === o.key ? "border-canvas bg-canvas text-brand-deep" : "border-canvas/25 text-canvas hover:bg-canvas/10",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The opened quick action's form, in a card under the board. */
export function QuickActionPanel() {
  const c = useContext(QuickCtx);
  if (!c || !c.open) return null;
  const { p, open } = c;
  const label = c.offered.find((o) => o.key === open)?.label ?? "";
  return (
    <Card id="quick-action-panel">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[16px] font-medium">{label}</h2>
        <button type="button" onClick={() => c.setOpen(null)} className="text-[13px] font-medium text-brand hover:underline">
          Close
        </button>
      </div>
      {open === "student" && <AddStudentForm {...p} />}
      {open === "fee" && p.fee && <FeeForm {...p} fee={p.fee} />}
      {open === "announce" && <AnnounceForm {...p} />}
      {open === "extra" && <ExtraClassForm {...p} />}
      {open === "invite" && <div className="mt-4">{c.invite}</div>}
    </Card>
  );
}

function Hidden({ uni }: { uni: string }) {
  return <input type="hidden" name="uni" value={uni} />;
}

type Controlled = { value: string; onChange: (e: { target: { value: string } }) => void };

function PaymentFields({
  modes,
  pricePaise,
  gstEnabled,
  amountLabel,
  amount,
  reference,
}: {
  modes: { value: string; label: string }[];
  pricePaise: number | null;
  gstEnabled: boolean;
  amountLabel: string;
  amount?: Controlled;
  reference?: Controlled;
}) {
  const [mode, setMode] = useState("cash");
  return (
    <>
      <Field label={gstEnabled ? `${amountLabel} before GST (₹)` : `${amountLabel} (₹)`} hint={pricePaise ? `Leave empty for the course price, ₹${rupees(pricePaise)}.` : undefined}>
        <Input name="amount" inputMode="decimal" placeholder={pricePaise ? rupees(pricePaise) : "3500"} {...amount} />
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
          <Input name="reference" maxLength={80} className="font-mono" {...reference} />
        </Field>
      )}
    </>
  );
}

function AddStudentForm({ uni, place, departments, fee, actions }: QuickActionsProps) {
  const [batchId, setBatchId] = useState(place[0]?.id ?? "");
  const [paid, setPaid] = useState(false);
  const batch = place.find((b) => b.id === batchId) ?? null;
  const [state, formAction] = useActionState<ClashState, FormData>(actions.addStudent, null);
  // A clash warning holds until the form changes or is answered.
  const [clash, setClash] = useState<string | null>(null);
  // Controlled, because React clears a form's uncontrolled fields after every submit: the
  // person must not retype the student after a clash warning or an error.
  const [who, setWho] = useState({ name: "", email: "", phone: "", amount: "", reference: "" });
  const set = (k: keyof typeof who) => (e: { target: { value: string } }) => setWho((w) => ({ ...w, [k]: e.target.value }));
  useEffect(() => {
    setClash(state?.clash ?? null);
    if (state?.ok) {
      setWho({ name: "", email: "", phone: "", amount: "", reference: "" });
      setPaid(false);
    }
  }, [state]);
  return (
    <form action={formAction} onChange={() => clash && setClash(null)} className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
      <Hidden uni={uni} />
      <Field label="Full name">
        <Input name="name" required autoComplete="off" value={who.name} onChange={set("name")} />
      </Field>
      <Field label="Email" hint="They sign in with it. We email them a link to set a password.">
        <Input name="email" type="email" required autoComplete="off" value={who.email} onChange={set("email")} />
      </Field>
      <Field label="Phone (optional)">
        <Input name="phone" inputMode="tel" maxLength={20} value={who.phone} onChange={set("phone")} />
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
      {fee && batch && paid && (
        <PaymentFields
          modes={fee.modes}
          pricePaise={batch.pricePaise || null}
          gstEnabled={fee.gstEnabled}
          amountLabel="Fee"
          amount={{ value: who.amount, onChange: set("amount") }}
          reference={{ value: who.reference, onChange: set("reference") }}
        />
      )}
      <div className="md:col-span-2">
        {clash ? (
          <ClashPrompt warning={clash} onCancel={() => setClash(null)} />
        ) : (
          <SubmitButton pendingText="Adding…">{batch ? (paid ? "Add student and record fee" : "Add student to batch") : "Add student"}</SubmitButton>
        )}
        {state?.error && <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
        {state?.ok && <p className="mt-3 rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand-strong">{state.ok}</p>}
      </div>
    </form>
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
