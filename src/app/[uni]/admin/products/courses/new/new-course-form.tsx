"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, type ReactNode } from "react";
import { SubmitButton } from "@/components/forms";
import { Card, Field, Input, Notice, Select, buttonClass, cx } from "@/components/ui";
import type { QuickCourseOptions, QuickSection } from "@/server/services/quick-course";
import { quickCourseAction, type QuickCourseState } from "../../../actions";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const NEW_DEPT = "__new";

type Times = { start: string; end: string };

/** One section of the form: a numbered card, with its own error when the save failed there. */
function Section({ id, n, title, hint, error, children }: { id: QuickSection; n: number; title: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <Card id={`section-${id}`} className={cx("scroll-mt-6 p-5 sm:p-6", error && "border-danger/50")}>
      <div className="mb-4 flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[12px] font-semibold text-brand-strong">{n}</span>
        <div className="min-w-0">
          <h2 className="text-[17px] font-medium">{title}</h2>
          {hint && <p className="mt-0.5 text-[13px] text-muted">{hint}</p>}
        </div>
      </div>
      {error && (
        <div className="mb-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

function Check({ checked, onChange, disabled, children }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; children: ReactNode }) {
  return (
    <label className={cx("flex items-start gap-2.5 text-[14px]", disabled ? "opacity-60" : "cursor-pointer")}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-brand" />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

const linkClass = "text-[13px] font-medium text-brand hover:underline";

export function NewCourseForm({
  uni,
  me,
  options,
  showGst,
  marketplace,
  cancelHref,
}: {
  uni: string;
  me: string;
  options: QuickCourseOptions;
  showGst: boolean;
  marketplace: boolean;
  cancelHref: string;
}) {
  const [state, action] = useActionState<QuickCourseState, FormData>(quickCourseAction, null);

  const depts = options.departments;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("0");
  const [gst, setGst] = useState("18");

  const [deptChoice, setDeptChoice] = useState(depts[0]?.id ?? NEW_DEPT);
  const [newDeptName, setNewDeptName] = useState("");
  const dept = depts.find((d) => d.id === deptChoice) ?? null;
  const staff = dept?.staff ?? [];
  const iTeachHere = staff.some((s) => s.id === me);
  const canAddTeachers = dept ? dept.canAddTeachers : options.canAddTeachersAnywhere;

  const [batchOn, setBatchOn] = useState(options.firstBatch);
  const [batchName, setBatchName] = useState("Batch 1");
  const [startDate, setStartDate] = useState(options.defaults.startDate);
  const [endDate, setEndDate] = useState(options.defaults.endDate);
  const [days, setDays] = useState<number[]>([]);
  const [times, setTimes] = useState<Times>({ start: "10:00", end: "11:00" });
  const [perDay, setPerDay] = useState(false);
  const [dayTimes, setDayTimes] = useState<Record<number, Times>>({});
  const [seatLimit, setSeatLimit] = useState("30");
  const [meetingUrl, setMeetingUrl] = useState("");

  const [teacherIds, setTeacherIds] = useState<string[]>(staff.length === 1 ? [staff[0].id] : []);
  const [newTeachers, setNewTeachers] = useState<{ name: string; email: string }[]>([]);
  const [teachMyself, setTeachMyself] = useState(staff.length === 0 && canAddTeachers);
  const [publish, setPublish] = useState(true);

  // A new department starts with nobody teaching in it: offer to teach it yourself.
  function pickDepartment(id: string) {
    setDeptChoice(id);
    const next = depts.find((d) => d.id === id);
    const people = next?.staff ?? [];
    setTeacherIds(people.length === 1 ? [people[0].id] : []);
    setTeachMyself(people.length === 0 && (next ? next.canAddTeachers : options.canAddTeachersAnywhere));
  }

  function toggleDay(d: number) {
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));
  }

  // The section that failed comes into view, with its message.
  useEffect(() => {
    if (state?.section) document.getElementById(`section-${state.section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [state]);

  const errorIn = (s: QuickSection) => (state?.error && state.section === s ? state.error : undefined);

  const payload = JSON.stringify({
    title,
    description,
    price,
    gst: showGst ? gst : null,
    departmentId: dept?.id ?? null,
    newDepartmentName: newDeptName,
    batch: batchOn
      ? {
          name: batchName,
          startDate,
          endDate,
          seatLimit,
          meetingUrl,
          slots: days.map((weekday) => {
            const t = perDay ? (dayTimes[weekday] ?? times) : times;
            return { weekday, startTime: t.start, endTime: t.end };
          }),
        }
      : null,
    teacherIds: teacherIds.filter((id) => staff.some((s) => s.id === id)),
    newTeachers: canAddTeachers ? newTeachers : [],
    teachMyself: canAddTeachers && !iTeachHere && teachMyself,
    publish: batchOn && publish,
  });

  const paid = Number(price.replace(/[,₹\s]/g, "")) > 0;

  return (
    <form action={action} className="max-w-3xl space-y-5">
      <input type="hidden" name="uni" value={uni} />
      <input type="hidden" name="payload" value={payload} />

      {state?.error && !state.section && <Notice tone="danger">{state.error}</Notice>}

      <Section id="course" n={1} title="Course" error={errorIn("course")}>
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Spoken English for beginners" required minLength={3} autoFocus />
        </Field>
        <Field label="Short description" hint="Optional. One or two lines on what students will learn.">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Speak with confidence in 12 weeks" />
        </Field>
        <div className={cx("grid gap-3", showGst && "sm:grid-cols-2")}>
          <Field label="Price (₹)" hint="0 means free. Your own students always join for free; the price is for your website.">
            <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
          </Field>
          {showGst && (
            <Field label="GST" hint={paid ? "Added on top of the price." : undefined}>
              <Select value={gst} onChange={(e) => setGst(e.target.value)}>
                {[0, 5, 12, 18, 28].map((g) => (
                  <option key={g} value={g}>
                    {g}%
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </Section>

      <Section
        id="department"
        n={2}
        title="Department"
        hint={depts.length === 0 ? "Every course sits in a department. You don't have one yet, so one is made for you with this course." : "Every course sits in one department, like Languages or Commerce."}
        error={errorIn("department")}
      >
        {depts.length > 0 && (
          <Field label="Department">
            <Select value={deptChoice} onChange={(e) => pickDepartment(e.target.value)}>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
              {options.canCreateDepartment && <option value={NEW_DEPT}>New department…</option>}
            </Select>
          </Field>
        )}
        {!dept && (
          <Field label={depts.length ? "New department name" : "Department name"} hint="Leave it empty to use General.">
            <Input value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)} placeholder="General" />
          </Field>
        )}
      </Section>

      <Section id="batch" n={3} title="First batch" hint="A batch is one group of students with fixed days and times. Add more later." error={errorIn("batch")}>
        <Check checked={batchOn} onChange={setBatchOn}>
          <span className="font-medium">Add the first batch now</span>
          <span className="block text-muted">Untick to only create the course and add batches later.</span>
        </Check>
        {batchOn && (
          <>
            <Field label="Batch name">
              <Input value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="Batch 1" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Starts on">
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </Field>
              <Field label="Ends on" hint="12 weeks after the start, unless you change it.">
                <Input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
              </Field>
            </div>
            <div>
              <span className="mb-1.5 block text-[13px] font-medium">Class days</span>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d, i) => {
                  const on = days.includes(i + 1);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleDay(i + 1)}
                      className={cx(
                        "inline-flex h-9 w-12 items-center justify-center rounded-lg border text-[13px] focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none",
                        on ? "border-brand bg-brand-soft font-medium text-brand-strong" : "border-line bg-surface hover:border-brand/40",
                      )}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
            {!perDay ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Class starts at">
                  <Input type="time" value={times.start} onChange={(e) => setTimes({ ...times, start: e.target.value })} />
                </Field>
                <Field label="Class ends at">
                  <Input type="time" value={times.end} onChange={(e) => setTimes({ ...times, end: e.target.value })} />
                </Field>
              </div>
            ) : (
              <div className="space-y-2">
                {days.length === 0 && <p className="text-[13px] text-muted">Pick the class days first.</p>}
                {days.map((d) => {
                  const t = dayTimes[d] ?? times;
                  return (
                    <div key={d} className="grid grid-cols-[3rem_1fr_1fr] items-center gap-2">
                      <span className="text-[13px] font-medium">{DAYS[d - 1]}</span>
                      <Input type="time" aria-label={`${DAYS[d - 1]} starts at`} value={t.start} onChange={(e) => setDayTimes({ ...dayTimes, [d]: { ...t, start: e.target.value } })} />
                      <Input type="time" aria-label={`${DAYS[d - 1]} ends at`} value={t.end} onChange={(e) => setDayTimes({ ...dayTimes, [d]: { ...t, end: e.target.value } })} />
                    </div>
                  );
                })}
              </div>
            )}
            <button type="button" className={linkClass} onClick={() => setPerDay(!perDay)}>
              {perDay ? "Use the same time every day" : "Different times on different days"}
            </button>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Seat limit">
                <Input type="number" min={1} value={seatLimit} onChange={(e) => setSeatLimit(e.target.value)} />
              </Field>
              <Field label="Live class link" hint="Optional. Students see it as the Join button.">
                <Input type="url" value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} placeholder="https://meet.google.com/…" />
              </Field>
            </div>
          </>
        )}
      </Section>

      <Section
        id="teachers"
        n={4}
        title="Who teaches it"
        hint={batchOn ? "A batch needs at least one teacher." : "Optional until you add a batch. Anyone added here joins the department's teaching staff."}
        error={errorIn("teachers")}
      >
        {staff.length > 0 && (
          <div className="space-y-2">
            {staff.map((s) => (
              <Check
                key={s.id}
                checked={teacherIds.includes(s.id)}
                onChange={(on) => setTeacherIds((cur) => (on ? [...cur, s.id] : cur.filter((x) => x !== s.id)))}
              >
                {s.id === me ? `${s.name} (you)` : s.name}
                {s.visiting && <span className="text-faint"> · Visiting faculty</span>}
              </Check>
            ))}
          </div>
        )}
        {canAddTeachers ? (
          <>
            {!iTeachHere && (
              <Check checked={teachMyself} onChange={setTeachMyself}>
                <span className="font-medium">I&apos;ll teach it myself</span>
                <span className="block text-muted">You join this department&apos;s teaching staff{batchOn ? " and this batch" : ""}.</span>
              </Check>
            )}
            {newTeachers.map((t, i) => (
              <div key={i} className="rounded-2xl border border-line p-3 sm:p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="New teacher's name">
                    <Input value={t.name} onChange={(e) => setNewTeachers(newTeachers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Priya Nair" />
                  </Field>
                  <Field label="Email">
                    <Input type="email" value={t.email} onChange={(e) => setNewTeachers(newTeachers.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} placeholder="priya@example.com" />
                  </Field>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12px] text-muted">They get an email invitation to set a password.</span>
                  <button type="button" className="text-[13px] font-medium text-danger hover:underline" onClick={() => setNewTeachers(newTeachers.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setNewTeachers([...newTeachers, { name: "", email: "" }])}>
              {newTeachers.length ? "Add another teacher" : "Add a new teacher"}
            </button>
          </>
        ) : (
          staff.length === 0 && <p className="text-[14px] text-muted">Nobody teaches in this department yet. Ask an institute admin to add teaching staff.</p>
        )}
      </Section>

      <Section id="publish" n={5} title="When it's ready" error={errorIn("publish")}>
        <Check checked={batchOn && publish} onChange={setPublish} disabled={!batchOn}>
          <span className="font-medium">Publish now so students can enrol</span>
          <span className="block text-muted">{batchOn ? "Untick to keep it as a draft only staff can see." : "Students enrol in a batch, so add the first batch to publish now."}</span>
        </Check>
        {marketplace && (
          <p className="text-[13px] text-muted">
            Selling on the Zinny marketplace is for recorded courses. Once the course has video lessons, list it from its Marketplace tab.
          </p>
        )}
      </Section>

      <div className="flex flex-wrap items-center gap-3 pb-6">
        <SubmitButton pendingText="Creating…">{batchOn ? "Create course and batch" : "Create course"}</SubmitButton>
        <Link href={cancelHref} className={buttonClass("ghost")}>
          Cancel
        </Link>
        {state?.error && state.section && <span className="text-[13px] text-danger">Nothing was saved. Fix the part marked above and try again.</span>}
      </div>
    </form>
  );
}
