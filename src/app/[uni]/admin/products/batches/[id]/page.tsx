import Link from "next/link";
import { DayTimePicker } from "@/components/day-picker";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Avatar, Badge, Card, CardTitle, Empty, Field, Input, PageHeader, Select, Table, Tabs, Td } from "@/components/ui";
import { SlotList } from "@/components/slots";
import { EnrolmentRequests, SeatLimitForm } from "@/components/enrolment-requests";
import { WeekView } from "@/components/week-view";
import { can } from "@/server/authz/engine";
import { ROLE_LABELS } from "@/server/authz/roles";
import { spaceContext } from "@/server/context";
import { visibleSlots } from "@/server/registry";
import { addDays, formatDate, formatTime, todayIn, weekStart } from "@/server/lib/dates";
import { getBatchPlan, inchargeChoices, plansToCopy } from "@/server/services/batch-plan";
import { batchRoster, getBatchDetail } from "@/server/services/batches";
import { listEnrolmentRequests } from "@/server/services/enrolment";
import { annotateSessions, describeSlots, expandSessions } from "@/server/services/schedule";
import { teachersForDepartment } from "@/server/services/users";
import { RECORDED_BATCH_LABEL } from "@/server/lib/recorded-batch";
import { addFacultyAction, decideEnrolmentAction, overrideAction, removeFacultyAction, seatLimitAction, updateBatchAction } from "../../../actions";
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

export default async function BatchPage({ params, searchParams }: { params: Promise<{ uni: string; id: string }>; searchParams: Promise<{ done?: string; tab?: string; section?: string; faculty?: string }> }) {
  const { uni, id } = await params;
  const { done, tab: requestedTab, section: sectionFilter, faculty: facultyFilter } = await searchParams;
  const { actor, university } = await spaceContext(uni);
  const { batch, course, schedule, faculty, seatsTaken, target, incharge } = await getBatchDetail(actor, id);
  const canEdit = can(actor, "batch.update", target);
  const canStaff = can(actor, "batch.assign_faculty", target);
  const canRoster = can(actor, "enrolment.view", target);
  const [roster, teachers, enrolRequests] = await Promise.all([
    canRoster ? batchRoster(actor, id) : Promise.resolve([]),
    canStaff ? teachersForDepartment(actor, batch.departmentId) : Promise.resolve([]),
    listEnrolmentRequests(actor, { batchId: id }),
  ]);
  // Sections, the day-number plan and the dated timetable. A recorded batch has no classes to plan.
  const tab = !batch.recorded && (requestedTab === "plan" || requestedTab === "timetable") ? requestedTab : "overview";
  const base = `/${uni}/admin/products/batches/${id}`;
  const [plan, incharges, copyChoices] = batch.recorded
    ? [null, [], []]
    : await Promise.all([
        getBatchPlan(actor, id),
        canEdit ? inchargeChoices(actor, id) : Promise.resolve([]),
        canEdit && tab === "plan" ? plansToCopy(actor, id) : Promise.resolve([]),
      ]);
  const attention = plan && plan.sections.length > 0 ? plan.timetable.problems.length : 0;

  const today = todayIn(university.timezone);
  const from = weekStart(today < batch.startDate ? batch.startDate : today);
  const weekSessions = expandSessions([schedule], from, addDays(from, 6));
  const sessions = plan ? annotateSessions(weekSessions, id, plan.timetable, actor.userId) : weekSessions;
  const uniform = schedule.slots.every((s) => s.startTime === schedule.slots[0]?.startTime && s.endTime === schedule.slots[0]?.endTime);
  const day = (d: Date) => formatDate(todayIn(university.timezone, d));
  const seatsLeft = batch.seatLimit - seatsTaken;
  const rosterCount = (status: string) => roster.filter((r) => r.status === status).length;
  const rosterSummary = [
    `${rosterCount("active")} active`,
    rosterCount("completed") ? `${rosterCount("completed")} completed` : "",
    rosterCount("held") + rosterCount("approved") ? `${rosterCount("held") + rosterCount("approved")} not paid yet` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
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

      {plan && (
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-[22px] border border-line bg-surface px-5 py-4">
            <div className="flex items-center gap-3">
              {incharge ? <Avatar name={incharge.name} size={40} /> : <span className="h-10 w-10 rounded-full border border-dashed border-line" aria-hidden />}
              <div>
                <div className="text-[13px] text-muted">Batch incharge</div>
                <div className="text-[15px] font-medium">{incharge?.name ?? "No incharge yet"}</div>
              </div>
            </div>
            {canEdit && (
              <ActionForm action={setInchargeAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="uni" value={uni} />
                <input type="hidden" name="batchId" value={id} />
                <Select name="userId" defaultValue={incharge?.userId ?? ""} className="w-64" aria-label="Batch incharge">
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
          </div>
          <Tabs
            active={tab}
            tabs={[
              { key: "overview", label: "Overview", href: base },
              { key: "plan", label: "Sections and plan", href: `${base}?tab=plan`, count: plan.sections.length || undefined },
              { key: "timetable", label: "Timetable", href: `${base}?tab=timetable`, count: attention || undefined },
            ]}
          />
        </>
      )}

      {plan && tab === "plan" && (
        <PlanTab
          uni={uni}
          plan={plan}
          canEdit={canEdit}
          choices={{ onBatch: faculty.map((f) => ({ userId: f.userId, name: f.name })), department: teachers.map((t) => ({ id: t.id, name: t.name })) }}
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
      <div className="grid gap-6 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Card>
            <CardTitle hint={`Week of ${formatDate(from)}`}>This week</CardTitle>
            <WeekView from={from} today={today} sessions={sessions} compact />
          </Card>

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

          {done && <p className="rounded-2xl bg-brand-soft px-4 py-3 text-[14px] text-brand-strong">{done}</p>}
          {enrolRequests.length > 0 && (
            <Card>
              <CardTitle>Waiting for a seat</CardTitle>
              <EnrolmentRequests requests={enrolRequests} uni={uni} action={decideEnrolmentAction} back={`/${uni}/admin/products/batches/${id}`} showCourse={false} />
            </Card>
          )}

          {canRoster && (
            <div>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[17px] font-semibold">Students</h2>
                {roster.length > 0 && <span className="text-[13px] text-muted">{rosterSummary}</span>}
              </div>
              {roster.length === 0 ? (
                <Empty title="No students yet" />
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
            </div>
          )}
        </div>

        <div className="space-y-6">
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

          {canEdit && (
            <Card>
              <CardTitle>Cancel or move a class</CardTitle>
              <ActionForm action={overrideAction} className="space-y-3">
                <input type="hidden" name="uni" value={uni} />
                <input type="hidden" name="batchId" value={id} />
                <div className="grid grid-cols-2 gap-3">
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
                </div>
                <Field label="Moved to" hint="For a moved class.">
                  <Input type="date" name="newDate" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="From">
                    <Input type="time" name="startTime" />
                  </Field>
                  <Field label="To">
                    <Input type="time" name="endTime" />
                  </Field>
                </div>
                <Field label="Note for students">
                  <Input name="note" placeholder="Diwali holiday" />
                </Field>
                <SubmitButton variant="secondary">Save and notify students</SubmitButton>
              </ActionForm>
            </Card>
          )}

          {canEdit && !batch.recorded && (
            <Card>
              <CardTitle>Seats</CardTitle>
              <p className="mb-3 text-sm text-muted">
                {seatsTaken} of {batch.seatLimit} taken. Change it any time; it can&apos;t go below the seats already taken.
              </p>
              <SeatLimitForm uni={uni} batchId={id} seatLimit={batch.seatLimit} taken={seatsTaken} action={seatLimitAction} />
            </Card>
          )}

          {canEdit && (
            <Card>
              <CardTitle>Batch details</CardTitle>
              <ActionForm action={updateBatchAction} className="space-y-4" resetOnSuccess={false}>
                <input type="hidden" name="uni" value={uni} />
                <input type="hidden" name="batchId" value={id} />
                <Field label="Name">
                  <Input name="name" defaultValue={batch.name} />
                </Field>
                {uniform ? (
                  <DayTimePicker
                    days={schedule.slots.map((s) => s.weekday)}
                    start={schedule.slots[0]?.startTime.slice(0, 5)}
                    end={schedule.slots[0]?.endTime.slice(0, 5)}
                  />
                ) : (
                  <p className="text-sm text-muted">
                    Timings differ by day ({schedule.slots.map((s) => formatTime(s.startTime)).join(", ")}). Pick days and one time below to replace them all.
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
                {/* Seats are changed in the Seats card above, so this form can't overwrite them. */}
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
        </div>
      </div>
      )}
    </>
  );
}
