import Link from "next/link";
import { DayTimePicker } from "@/components/day-picker";
import { ActionForm, SubmitButton } from "@/components/forms";
import { SwitchRequests } from "@/components/switch-requests";
import { Badge, Card, CardTitle, Empty, Field, Input, Notice, PageHeader, SeatMap, Select, Tabs } from "@/components/ui";
import { SlotOutlet } from "@/components/slots";
import { can } from "@/server/authz/engine";
import { spaceContext } from "@/server/context";
import { visibleSlots } from "@/server/registry";
import { listBatches } from "@/server/services/batches";
import { getCourse } from "@/server/services/courses";
import { listSwitchRequests } from "@/server/services/enrolment";
import { formatINR } from "@/server/services/finance";
import { teachersForDepartment } from "@/server/services/users";
import { ROLE_LABELS } from "@/server/authz/roles";
import { createBatchAction, setCourseStatusAction, updateCourseAction } from "../../../actions";

type Search = Record<string, string | string[] | undefined>;

export default async function CoursePage({ params, searchParams }: { params: Promise<{ uni: string; id: string }>; searchParams: Promise<Search> }) {
  const { uni, id } = await params;
  const search = await searchParams;
  const { actor, university } = await spaceContext(uni);
  const { course, department, target } = await getCourse(actor, id);
  const canEdit = can(actor, "course.update", target);

  // Core keeps Batches and Settings; modules add their tabs through the adminCourseTabs slot.
  const moduleTabs = visibleSlots("adminCourseTabs", actor, target);
  const tabs = [
    { key: "batches", label: "Batches", order: 150 },
    ...moduleTabs.map((t) => ({ key: t.key, label: t.label, order: t.order })),
    { key: "settings", label: "Settings", order: 10_000 },
  ].sort((a, b) => a.order - b.order);
  const requested = typeof search.tab === "string" ? search.tab : "batches";
  const tab = tabs.some((t) => t.key === requested) ? requested : "batches";
  const moduleTab = moduleTabs.find((t) => t.key === tab);
  const canAddBatch = can(actor, "batch.create", { universityId: university.id, departmentIds: [course.departmentId] });
  const base = `/${uni}/admin/products/courses/${id}`;

  const batches = tab === "batches" ? await listBatches(actor, id) : [];
  const requests = tab === "batches" && canAddBatch ? (await listSwitchRequests(actor)).filter((r) => r.courseId === id) : [];
  const teachers = tab === "batches" && canAddBatch ? await teachersForDepartment(actor, course.departmentId) : [];

  return (
    <>
      <div className="mb-2 text-sm text-muted">
        <Link href={`/${uni}/admin/products/courses`} className="hover:text-ink">
          Courses
        </Link>{" "}
        / {department.name}
      </div>
      <PageHeader
        title={course.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={course.status === "published" ? "brand" : "neutral"}>{course.status}</Badge>
            <span>{course.pricePaise ? `${formatINR(course.pricePaise)} + ${course.gstRateBp / 100}% GST` : "Free"}</span>
          </span>
        }
        actions={
          canEdit && course.status !== "published" ? (
            <ActionForm action={setCourseStatusAction} resetOnSuccess={false}>
              <input type="hidden" name="uni" value={uni} />
              <input type="hidden" name="courseId" value={id} />
              <input type="hidden" name="status" value="published" />
              <SubmitButton>Publish</SubmitButton>
            </ActionForm>
          ) : null
        }
      />
      <Tabs active={tab} tabs={tabs.map(({ key, label }) => ({ key, label, href: `${base}?tab=${key}`, count: key === "batches" && tab === "batches" ? batches.length : undefined }))} />

      {tab === "batches" && (
        <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            {batches.length === 0 ? (
              <Empty title="No batches yet">Add a batch for each schedule students can pick: weekday morning, evening, weekend.</Empty>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {batches.map((b) => (
                  <Link key={b.batchId} href={`/${uni}/admin/products/batches/${b.batchId}`}>
                    <Card className="h-full hover:border-brand/40">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-semibold">{b.batchName}</div>
                        {b.status !== "open" && <Badge>{b.status}</Badge>}
                      </div>
                      <div className="mt-1 text-sm text-muted">{b.timings}</div>
                      <div className="text-sm text-muted">Starts {new Date(b.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "long" })}</div>
                      <div className="mt-3 flex items-center justify-between text-sm">
                        <span className={b.seatsLeft === 0 ? "font-medium text-danger" : "font-medium text-brand"}>
                          {b.seatsLeft === 0 ? "Full" : `${b.seatsLeft} seats left`}
                        </span>
                        <span className="tabular text-faint">
                          {b.seatsTaken}/{b.seatLimit}
                        </span>
                      </div>
                      <div className="mt-2">
                        <SeatMap limit={b.seatLimit} taken={b.seatsTaken} />
                      </div>
                      <div className="mt-2 truncate text-xs text-muted">{b.faculty?.join(", ") || "No faculty"}</div>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
            {canAddBatch && <SwitchRequests uni={uni} requests={requests} />}
          </div>

          {canAddBatch && (
            <Card className="h-fit">
              <CardTitle>Add a batch</CardTitle>
              {teachers.length === 0 ? (
                <Notice tone="warn">Add faculty to {department.name} under Users → Teaching first. Every batch needs at least one.</Notice>
              ) : (
                <ActionForm action={createBatchAction} className="space-y-4">
                  <input type="hidden" name="uni" value={uni} />
                  <input type="hidden" name="courseId" value={id} />
                  <Field label="Batch name">
                    <Input name="name" placeholder="Weekday morning" required />
                  </Field>
                  <DayTimePicker />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Start date">
                      <Input type="date" name="startDate" required />
                    </Field>
                    <Field label="End date">
                      <Input type="date" name="endDate" required />
                    </Field>
                  </div>
                  <Field label="Seat limit">
                    <Input type="number" name="seatLimit" min={1} defaultValue={30} required />
                  </Field>
                  <div>
                    <span className="mb-1.5 block text-[13px] font-medium">Faculty</span>
                    <div className="space-y-1">
                      {teachers.map((t) => (
                        <label key={t.id} className="flex items-center gap-2 text-sm">
                          <input type="checkbox" name="faculty" value={t.id} className="accent-brand" />
                          {t.name} <span className="text-faint">{ROLE_LABELS[t.role]}</span>
                          {t.role === "visiting_faculty" && <input type="hidden" name="visiting" value={t.id} />}
                        </label>
                      ))}
                    </div>
                  </div>
                  <Field label="Live class link" hint="Optional. Shown as the Join button on the timetable.">
                    <Input name="meetingUrl" type="url" placeholder="https://meet.google.com/…" />
                  </Field>
                  <SubmitButton>Add batch</SubmitButton>
                </ActionForm>
              )}
            </Card>
          )}
        </div>
      )}

      {tab === "settings" && (
        <Card className="max-w-xl">
          <CardTitle>Course settings</CardTitle>
          <ActionForm action={updateCourseAction} className="space-y-4" resetOnSuccess={false}>
            <input type="hidden" name="uni" value={uni} />
            <input type="hidden" name="courseId" value={id} />
            <Field label="Title">
              <Input name="title" defaultValue={course.title} disabled={!canEdit} />
            </Field>
            <Field label="Description">
              <Input name="description" defaultValue={course.description} disabled={!canEdit} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Price (₹)">
                <Input name="price" defaultValue={course.pricePaise / 100} disabled={!canEdit} />
              </Field>
              <Field label="GST">
                <Select name="gst" defaultValue={course.gstRateBp / 100} disabled={!canEdit}>
                  {[0, 5, 12, 18, 28].map((g) => (
                    <option key={g} value={g}>
                      {g}%
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="certificate" defaultChecked={course.certificateEnabled} disabled={!canEdit} className="accent-brand" />
              Issue a certificate on completion
            </label>
            {canEdit && <SubmitButton>Save</SubmitButton>}
          </ActionForm>
          {canEdit && course.status === "published" && (
            <ActionForm action={setCourseStatusAction} className="mt-6 border-t border-line pt-4" resetOnSuccess={false}>
              <input type="hidden" name="uni" value={uni} />
              <input type="hidden" name="courseId" value={id} />
              <input type="hidden" name="status" value="draft" />
              <SubmitButton variant="secondary">Unpublish</SubmitButton>
            </ActionForm>
          )}
        </Card>
      )}

      {moduleTab && (
        <SlotOutlet
          slot="adminCourseTabs"
          entry={moduleTab}
          props={{
            uni,
            actor,
            university,
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
            searchParams: search,
          }}
        />
      )}
    </>
  );
}
