import Link from "next/link";
import { DayTimePicker } from "@/components/day-picker";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Panel, PanelButton, Panels } from "@/components/panel";
import { ActionLink, Avatar, Badge, Card, CardTitle, Empty, Field, Input, Notice, PageHeader, Select, Table, Tabs, Td } from "@/components/ui";
import { SlotList } from "@/components/slots";
import { EnrolmentRequests, SeatLimitForm } from "@/components/enrolment-requests";
import { can } from "@/server/authz/engine";
import { ROLE_LABELS } from "@/server/authz/roles";
import { spaceContext } from "@/server/context";
import { visibleSlots } from "@/server/registry";
import { formatDate, formatTime, todayIn } from "@/server/lib/dates";
import { getBatchPlan, inchargeChoices, plansToCopy } from "@/server/services/batch-plan";
import { batchRoster, getBatchDetail } from "@/server/services/batches";
import { listEnrolmentRequests, studentsToAdd } from "@/server/services/enrolment";
import { describeSlots } from "@/server/services/schedule";
import { teachersForDepartment } from "@/server/services/users";
import { RECORDED_BATCH_LABEL } from "@/server/lib/recorded-batch";
import { addFacultyAction, decideEnrolmentAction, overrideAction, removeFacultyAction, seatLimitAction, updateBatchAction } from "../../../actions";
import { AddStudentForm } from "./add-student-form";
import { BatchCalendar, calendarView } from "./batch-calendar";
import { setInchargeAction } from "./plan-actions";
import { PlanTab } from "./plan-tab";
import { TimetableTab } from "./timetable-tab";

/** A student's place in the batch, in words; only the in-between states (paying, accepted) need attention. */
const ROSTER_STATUS: Record<string, { label: string; tone: "brand" | "neutral" | "warn" }> = {
  active: { label: "Active", tone: "brand" },
  completed: { label: "Completed", tone: "neutral" },
  held: { label: "Paying now", tone: "warn" },
  approved: { label: "Accepted, not paid yet", tone: "warn" },
};

export default async function BatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ uni: string; id: string }>;
  searchParams: Promise<{
    done?: string;
    tab?: string;
    section?: string;
    faculty?: string;
    week?: string;
    month?: string;
  }>;
}) {
  const { uni, id } = await params;
  const { done, tab: requestedTab, section: sectionFilter, faculty: facultyFilter, week, month } = await searchParams;
  const { actor, university } = await spaceContext(uni);
  const { batch, course, schedule, faculty, seatsTaken, target, incharge } = await getBatchDetail(actor, id);
  const canEdit = can(actor, "batch.update", target);
  const canStaff = can(actor, "batch.assign_faculty", target);
  const canRoster = can(actor, "enrolment.view", target);
  const [roster, teachers, enrolRequests, addable] = await Promise.all([
    canRoster ? batchRoster(actor, id) : Promise.resolve([]),
    canStaff ? teachersForDepartment(actor, batch.departmentId) : Promise.resolve([]),
    listEnrolmentRequests(actor, { batchId: id }),
    canEdit && !batch.recorded ? studentsToAdd(actor, id) : Promise.resolve([]),
  ]);
  /*
   * The page reads first: this week's classes, then the students, the plan and the timetable.
   * Everything that changes the batch itself (details, seats, faculty, incharge) is in Settings.
   * A recorded batch has no classes to plan, so it has no plan or timetable tab.
   */
  const canSettings = canEdit || canStaff;
  const allowed = ["overview", ...(canRoster ? ["students"] : []), ...(batch.recorded ? [] : ["plan", "timetable"]), ...(canSettings ? ["settings"] : [])];
  const tab = requestedTab && allowed.includes(requestedTab) ? requestedTab : "overview";
  const base = `/${uni}/admin/products/batches/${id}`;
  const [plan, incharges, copyChoices] = batch.recorded
    ? [null, [], []]
    : await Promise.all([getBatchPlan(actor, id), canEdit ? inchargeChoices(actor, id) : Promise.resolve([]), canEdit && tab === "plan" ? plansToCopy(actor, id) : Promise.resolve([])]);
  const attention = plan && plan.sections.length > 0 ? plan.timetable.problems.length : 0;

  const today = todayIn(university.timezone);
  const view = calendarView({ week, month }, batch, today);
  const uniform = schedule.slots.every((s) => s.startTime === schedule.slots[0]?.startTime && s.endTime === schedule.slots[0]?.endTime);
  const day = (d: Date) => formatDate(todayIn(university.timezone, d));
  const seatsLeft = batch.seatLimit - seatsTaken;
  const rosterCount = (status: string) => roster.filter((r) => r.status === status).length;
  const rosterSummary = [`${rosterCount("active")} active`, rosterCount("completed") ? `${rosterCount("completed")} completed` : "", rosterCount("held") + rosterCount("approved") ? `${rosterCount("held") + rosterCount("approved")} not paid yet` : ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <Panels>
      <PageHeader
        title={batch.recorded ? RECORDED_BATCH_LABEL : batch.name}
        subtitle={
          <>
            <Link href={`/${uni}/admin/products/courses/${course.id}?tab=batches`} className="text-brand hover:underline">
              {course.title}
            </Link>
            {batch.recorded ? " · marketplace buyers, at their own pace" : ` · ${describeSlots(schedule.slots)} · ${formatDate(batch.startDate)} to ${formatDate(batch.endDate)}`}
          </>
        }
        actions={
          batch.recorded ? undefined : (
            <Badge tone={seatsLeft <= 0 ? "danger" : "brand"}>
              {seatsLeft <= 0 ? "Full" : `${seatsLeft} ${seatsLeft === 1 ? "seat" : "seats"} left`} · {seatsTaken}/{batch.seatLimit} taken
            </Badge>
          )
        }
      />

      <Tabs
        active={tab}
        tabs={[
          {
            key: "overview",
            label: batch.recorded ? "Overview" : "This week",
            href: base,
          },
          ...(canRoster
            ? [
                {
                  key: "students",
                  label: "Students",
                  href: `${base}?tab=students`,
                  count: roster.length || undefined,
                },
              ]
            : []),
          ...(plan
            ? [
                {
                  key: "plan",
                  label: "Sections and plan",
                  href: `${base}?tab=plan`,
                  count: plan.sections.length || undefined,
                },
                {
                  key: "timetable",
                  label: "Timetable",
                  href: `${base}?tab=timetable`,
                  count: attention || undefined,
                },
              ]
            : []),
          ...(canSettings
            ? [
                {
                  key: "settings",
                  label: "Settings",
                  href: `${base}?tab=settings`,
                },
              ]
            : []),
        ]}
      />

      {done && <p className="mb-6 rounded-2xl bg-brand-soft px-4 py-3 text-[14px] text-brand-strong">{done}</p>}

      {plan && tab === "plan" && (
        <PlanTab
          uni={uni}
          plan={plan}
          canEdit={canEdit}
          choices={{
            onBatch: faculty.map((f) => ({ userId: f.userId, name: f.name })),
            department: teachers.map((t) => ({ id: t.id, name: t.name })),
          }}
          copyChoices={copyChoices}
        />
      )}

      {plan && tab === "timetable" && (
        <TimetableTab
          uni={uni}
          plan={plan}
          canEdit={canEdit}
          viewerUserId={actor.userId}
          filter={{ section: sectionFilter, faculty: facultyFilter }}
          heading={{
            title: `${course.title}: ${batch.name}`,
            detail: `${describeSlots(schedule.slots)} · ${formatDate(batch.startDate)} to ${formatDate(batch.endDate)}${incharge ? ` · Incharge: ${incharge.name}` : ""}`,
          }}
        />
      )}

      {tab === "overview" && (
        <>
          {/* Cancelling or moving a class is the one change made from here, so it waits behind its button. */}
          {canEdit && !batch.recorded && (
            <Panel id="class" title="Cancel, move or add a class" hint="Students are told straight away, and the timetable updates.">
              <ActionForm action={overrideAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <input type="hidden" name="uni" value={uni} />
                <input type="hidden" name="batchId" value={id} />
                <Field label="What">
                  <Select name="kind">
                    <option value="cancelled">Cancel class</option>
                    <option value="rescheduled">Move class</option>
                    <option value="extra">Extra class</option>
                  </Select>
                </Field>
                <Field label="Date">
                  <Input type="date" name="date" required />
                </Field>
                <Field label="Moved to" hint="For a moved class.">
                  <Input type="date" name="newDate" />
                </Field>
                <Field label="From">
                  <Input type="time" name="startTime" />
                </Field>
                <Field label="To">
                  <Input type="time" name="endTime" />
                </Field>
                <Field label="Note for students">
                  <Input name="note" placeholder="Diwali holiday" />
                </Field>
                <div className="sm:col-span-2 lg:col-span-3">
                  <SubmitButton variant="secondary">Save and notify students</SubmitButton>
                </div>
              </ActionForm>
            </Panel>
          )}
          {enrolRequests.length > 0 && canRoster && (
            <div className="mb-6">
              <Notice tone="gold">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {enrolRequests.length} {enrolRequests.length === 1 ? "student is" : "students are"} waiting for a seat in this batch.
                  </span>
                  <ActionLink href={`${base}?tab=students`} icon="view">
                    See requests
                  </ActionLink>
                </span>
              </Notice>
            </div>
          )}
          <div className="grid gap-6 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-6">
              {plan && (
                <Card id="calendar">
                  <BatchCalendar base={base} view={view} timetable={plan.timetable} sections={plan.sections} today={today} batch={batch} fallbackFaculty={faculty.map((f) => f.name)} />
                </Card>
              )}

              <SlotList
                slot="adminBatchSections"
                entries={visibleSlots("adminBatchSections", actor, target)}
                props={{
                  uni,
                  actor,
                  university,
                  batch: {
                    id: batch.id,
                    courseId: batch.courseId,
                    departmentId: batch.departmentId,
                    name: batch.name,
                    startDate: batch.startDate,
                    endDate: batch.endDate,
                    seatLimit: batch.seatLimit,
                    status: batch.status,
                    meetingUrl: batch.meetingUrl,
                    target,
                  },
                  course: {
                    id: course.id,
                    title: course.title,
                    departmentId: course.departmentId,
                    programId: course.programId,
                    status: course.status,
                    certificateEnabled: course.certificateEnabled,
                    pricePaise: course.pricePaise,
                  },
                  target,
                }}
              />
              {enrolRequests.length > 0 && !canRoster && (
                <Card>
                  <CardTitle>Waiting for a seat</CardTitle>
                  <EnrolmentRequests requests={enrolRequests} uni={uni} action={decideEnrolmentAction} back={base} showCourse={false} />
                </Card>
              )}
            </div>

            <div className="space-y-6">
              {canEdit && !batch.recorded && (
                <PanelButton panel="class" variant="secondary" icon="move" className="w-full">
                  Cancel or move a class
                </PanelButton>
              )}
              <Card>
                <CardTitle hint={canStaff ? <ActionLink href={`${base}?tab=settings`}>Manage faculty</ActionLink> : undefined}>Faculty</CardTitle>
                {faculty.length === 0 ? (
                  <p className="text-sm text-muted">No faculty yet.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {faculty.map((f) => (
                      <li key={f.userId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                        <Avatar name={f.name} size={32} />
                        <div className="min-w-0 text-sm">
                          <div className="truncate font-medium">{f.name}</div>
                          <div className="truncate text-[13px] text-muted">
                            {incharge?.userId === f.userId ? "Batch incharge · " : ""}
                            {ROLE_LABELS[f.role]}
                            {f.endsAt && ` · until ${day(f.endsAt)}`}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {plan && !incharge && <p className="mt-3 text-[13px] text-muted">No batch incharge yet.</p>}
                {plan && incharge && !faculty.some((f) => f.userId === incharge.userId) && <p className="mt-3 text-[13px] text-muted">Batch incharge: {incharge.name}</p>}
              </Card>
              <Card>
                <CardTitle>At a glance</CardTitle>
                <dl className="space-y-2.5 text-sm">
                  {!batch.recorded && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Seats</dt>
                      <dd className="tabular-nums">
                        {seatsTaken} of {batch.seatLimit} taken
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Enrolment</dt>
                    <dd>
                      {batch.status === "closed" ? "Closed" : "Open"}
                      {batch.approvalRequired ? ", faculty approve each student" : ""}
                    </dd>
                  </div>
                  {!batch.recorded && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Live class link</dt>
                      <dd className="min-w-0 truncate">
                        {batch.meetingUrl ? (
                          <a href={batch.meetingUrl} target="_blank" rel="noreferrer" className="text-brand underline underline-offset-2">
                            {batch.meetingUrl.replace(/^https?:\/\//, "")}
                          </a>
                        ) : (
                          "Not set"
                        )}
                      </dd>
                    </div>
                  )}
                </dl>
              </Card>
            </div>
          </div>
        </>
      )}

      {tab === "students" && canRoster && (
        <>
          {canEdit && !batch.recorded && (
            <Panel id="student" title="Add a student" hint={`${seatsTaken}/${batch.seatLimit} seats taken`} className="max-w-xl">
              <AddStudentForm
                uni={uni}
                batchId={id}
                students={addable.map((s) => ({
                  name: s.name,
                  email: s.email,
                }))}
                full={seatsLeft <= 0}
              />
            </Panel>
          )}
          {enrolRequests.length > 0 && (
            <Card className="mb-6">
              <CardTitle>Waiting for a seat</CardTitle>
              <EnrolmentRequests requests={enrolRequests} uni={uni} action={decideEnrolmentAction} back={`${base}?tab=students`} showCourse={false} />
            </Card>
          )}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-[17px] font-semibold">Students</h2>
              {roster.length > 0 && <span className="text-[13px] text-muted">{rosterSummary}</span>}
            </div>
            {canEdit && !batch.recorded && (
              <PanelButton panel="student" size="sm">
                Add a student
              </PanelButton>
            )}
          </div>
          {roster.length === 0 ? (
            <Empty title="No students yet">{canEdit && !batch.recorded ? "Add a student here, or share the course so students pick this batch themselves." : undefined}</Empty>
          ) : (
            <Table head={["Name", "Email", "Status", "Enrolled"]}>
              {roster.map((r) => (
                <tr key={r.userId}>
                  <Td className="font-medium">{r.name}</Td>
                  <Td className="text-muted">{r.email}</Td>
                  <Td>
                    <Badge tone={ROSTER_STATUS[r.status]?.tone ?? "neutral"}>{ROSTER_STATUS[r.status]?.label ?? r.status}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-muted">{r.enrolledAt ? day(r.enrolledAt) : "—"}</Td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}

      {tab === "settings" && canSettings && (
        <div className="grid items-start gap-6 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px]">
          {canEdit && (
            <Card>
              <CardTitle>Batch details</CardTitle>
              <ActionForm action={updateBatchAction} className="max-w-xl space-y-4" resetOnSuccess={false}>
                <input type="hidden" name="uni" value={uni} />
                <input type="hidden" name="batchId" value={id} />
                <Field label="Name">
                  <Input name="name" defaultValue={batch.name} />
                </Field>
                {uniform ? (
                  <DayTimePicker days={schedule.slots.map((s) => s.weekday)} start={schedule.slots[0]?.startTime.slice(0, 5)} end={schedule.slots[0]?.endTime.slice(0, 5)} />
                ) : (
                  <p className="text-sm text-muted">
                    Timings differ by day ({schedule.slots.map((s) => formatTime(s.startTime)).join(", ")}
                    ). Pick days and one time below to replace them all.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Start date">
                    <Input type="date" name="startDate" defaultValue={batch.startDate} />
                  </Field>
                  <Field label="End date">
                    <Input type="date" name="endDate" defaultValue={batch.endDate} />
                  </Field>
                </div>
                {/* Seats are changed in the Seats card, so this form can't overwrite them. */}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Enrolment">
                    <Select name="status" defaultValue={batch.status === "closed" ? "closed" : "open"}>
                      <option value="open">Open</option>
                      <option value="closed">Closed</option>
                    </Select>
                  </Field>
                </div>
                <Field label="Live class link">
                  <Input name="meetingUrl" type="url" defaultValue={batch.meetingUrl ?? ""} />
                </Field>
                <label className="flex items-start gap-2.5 text-sm">
                  <input type="checkbox" name="approvalRequired" defaultChecked={batch.approvalRequired} className="mt-0.5 accent-brand" />
                  <span>
                    <span className="font-medium">Faculty approve each enrolment</span>
                    <span className="block text-muted">Students ask for a seat, and you accept or decline.</span>
                  </span>
                </label>
                <SubmitButton>Save batch details</SubmitButton>
              </ActionForm>
            </Card>
          )}

          <div className="space-y-6">
            {plan && (
              <Card>
                <CardTitle>Batch incharge</CardTitle>
                <div className="flex items-center gap-3">
                  {incharge ? <Avatar name={incharge.name} size={40} /> : <span className="h-10 w-10 rounded-full border border-dashed border-line" aria-hidden />}
                  <div className="text-[15px] font-medium">{incharge?.name ?? "No incharge yet"}</div>
                </div>
                {canEdit && (
                  <ActionForm action={setInchargeAction} className="mt-4 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="uni" value={uni} />
                    <input type="hidden" name="batchId" value={id} />
                    <Select name="userId" defaultValue={incharge?.userId ?? ""} className="min-w-0 flex-1" aria-label="Batch incharge">
                      <option value="">No incharge</option>
                      {incharges.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} · {ROLE_LABELS[c.role as keyof typeof ROLE_LABELS]}
                        </option>
                      ))}
                    </Select>
                    <SubmitButton size="sm" variant="secondary">
                      {incharge ? "Change incharge" : "Set incharge"}
                    </SubmitButton>
                  </ActionForm>
                )}
              </Card>
            )}

            <Card>
              <CardTitle>Faculty</CardTitle>
              <ul className="mb-4 divide-y divide-line">
                {faculty.map((f) => (
                  <li key={f.userId} className="flex items-center justify-between py-2 text-sm">
                    <span>
                      <span className="font-medium">{f.name}</span>{" "}
                      <span className="text-muted">
                        {ROLE_LABELS[f.role]}
                        {f.endsAt && ` · until ${day(f.endsAt)}`}
                      </span>
                    </span>
                    {canStaff && faculty.length > 1 && (
                      <ActionForm action={removeFacultyAction}>
                        <input type="hidden" name="uni" value={uni} />
                        <input type="hidden" name="batchId" value={id} />
                        <input type="hidden" name="userId" value={f.userId} />
                        <SubmitButton size="sm" variant="ghost">
                          Remove
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
              {canStaff && (
                <ActionForm action={addFacultyAction} className="flex gap-2">
                  <input type="hidden" name="uni" value={uni} />
                  <input type="hidden" name="batchId" value={id} />
                  <Select name="userId" className="min-w-0 flex-1">
                    <option value="">Add faculty…</option>
                    {teachers
                      .filter((t) => !faculty.some((f) => f.userId === t.id))
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </Select>
                  <input type="hidden" name="role" value="permanent_faculty" />
                  <SubmitButton size="sm" variant="secondary">
                    Add faculty
                  </SubmitButton>
                </ActionForm>
              )}
            </Card>

            {canEdit && !batch.recorded && (
              <Card>
                <CardTitle>Seats</CardTitle>
                <p className="mb-3 text-sm text-muted">
                  {seatsTaken} of {batch.seatLimit} taken. Change it any time; it can&apos;t go below the seats already taken.
                </p>
                <SeatLimitForm uni={uni} batchId={id} seatLimit={batch.seatLimit} taken={seatsTaken} action={seatLimitAction} />
              </Card>
            )}
          </div>
        </div>
      )}
    </Panels>
  );
}
