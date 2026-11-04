import Link from "next/link";
import { DayTimePicker } from "@/components/day-picker";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Empty, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { SlotList } from "@/components/slots";
import { EnrolmentRequests, SeatLimitForm } from "@/components/enrolment-requests";
import { WeekView } from "@/components/week-view";
import { can } from "@/server/authz/engine";
import { ROLE_LABELS } from "@/server/authz/roles";
import { spaceContext } from "@/server/context";
import { visibleSlots } from "@/server/registry";
import { addDays, formatDate, formatTime, todayIn, weekStart } from "@/server/lib/dates";
import { batchRoster, getBatchDetail } from "@/server/services/batches";
import { listEnrolmentRequests } from "@/server/services/enrolment";
import { describeSlots, expandSessions } from "@/server/services/schedule";
import { teachersForDepartment } from "@/server/services/users";
import { addFacultyAction, decideEnrolmentAction, overrideAction, removeFacultyAction, seatLimitAction, updateBatchAction } from "../../../actions";

export default async function BatchPage({ params, searchParams }: { params: Promise<{ uni: string; id: string }>; searchParams: Promise<{ done?: string }> }) {
  const { uni, id } = await params;
  const { done } = await searchParams;
  const { actor, university } = await spaceContext(uni);
  const { batch, course, schedule, faculty, seatsTaken, target } = await getBatchDetail(actor, id);
  const canEdit = can(actor, "batch.update", target);
  const canStaff = can(actor, "batch.assign_faculty", target);
  const canRoster = can(actor, "enrolment.view", target);
  const [roster, teachers, enrolRequests] = await Promise.all([
    canRoster ? batchRoster(actor, id) : Promise.resolve([]),
    canStaff ? teachersForDepartment(actor, batch.departmentId) : Promise.resolve([]),
    listEnrolmentRequests(actor, { batchId: id }),
  ]);

  const today = todayIn(university.timezone);
  const from = weekStart(today < batch.startDate ? batch.startDate : today);
  const sessions = expandSessions([schedule], from, addDays(from, 6));
  const uniform = schedule.slots.every((s) => s.startTime === schedule.slots[0]?.startTime && s.endTime === schedule.slots[0]?.endTime);

  return (
    <>
      <div className="mb-2 text-sm text-muted">
        <Link href={`/${uni}/admin/products/courses/${course.id}?tab=batches`} className="hover:text-ink">
          {course.title}
        </Link>{" "}
        / Batch
      </div>
      <PageHeader
        title={batch.name}
        subtitle={`${describeSlots(schedule.slots)} · ${formatDate(batch.startDate)} to ${formatDate(batch.endDate)}`}
        actions={
          <Badge tone={seatsTaken >= batch.seatLimit ? "danger" : "brand"}>
            {seatsTaken >= batch.seatLimit ? "Full" : `${batch.seatLimit - seatsTaken} seats left`} · {seatsTaken}/{batch.seatLimit}
          </Badge>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardTitle hint={`Week of ${formatDate(from)}`}>Timetable</CardTitle>
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
              <h2 className="mb-3 text-[17px] font-semibold">Students</h2>
              {roster.length === 0 ? (
                <Empty title="No students yet" />
              ) : (
                <Table head={["Name", "Email", "Status", "Enrolled"]}>
                  {roster.map((r) => (
                    <tr key={r.userId}>
                      <Td className="font-medium">{r.name}</Td>
                      <Td className="text-muted">{r.email}</Td>
                      <Td>
                        <Badge tone={r.status === "active" ? "brand" : "warn"}>
                          {r.status === "held" ? "Paying now" : r.status === "approved" ? "Accepted, not paid yet" : r.status}
                        </Badge>
                      </Td>
                      <Td className="text-muted">{r.enrolledAt ? r.enrolledAt.toLocaleDateString("en-IN") : "—"}</Td>
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
                    <span className="text-faint">
                      {ROLE_LABELS[f.role]}
                      {f.endsAt && ` · until ${f.endsAt.toLocaleDateString("en-IN")}`}
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
                  Add
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
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Moved to">
                    <Input type="date" name="newDate" />
                  </Field>
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
                <SubmitButton>Save</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
