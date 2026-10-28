import Link from "next/link";
import { DayTimePicker } from "@/components/day-picker";
import { ActionForm, SubmitButton } from "@/components/forms";
import { SwitchRequests } from "@/components/switch-requests";
import { Badge, Card, CardTitle, Empty, Field, Input, Notice, PageHeader, SeatMap, Select, Tabs } from "@/components/ui";
import { can } from "@/server/authz/engine";
import { spaceContext } from "@/server/context";
import { listBatches } from "@/server/services/batches";
import { courseTarget, getCourse } from "@/server/services/courses";
import { listSwitchRequests } from "@/server/services/enrolment";
import { formatINR } from "@/server/services/finance";
import { teachersForDepartment } from "@/server/services/users";
import { withTenant } from "@/server/tenant";
import { ROLE_LABELS } from "@/server/authz/roles";
import {
  addLessonAction,
  addSectionAction,
  createBatchAction,
  setCourseStatusAction,
  updateCourseAction,
} from "../../../actions";

const TABS = [
  ["curriculum", "Curriculum"],
  ["batches", "Batches"],
  ["assignments", "Assignments"],
  ["live", "Live classes"],
  ["certificates", "Certificates"],
  ["settings", "Settings"],
] as const;

export default async function CoursePage({ params, searchParams }: { params: Promise<{ uni: string; id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { uni, id } = await params;
  const { tab = "batches" } = await searchParams;
  const { actor, university } = await spaceContext(uni);
  const { course, department, curriculum } = await getCourse(actor, id);
  const { target } = await withTenant(actor, (tx) => courseTarget(tx, university.id, id));
  const canEdit = can(actor, "course.update", target);
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
      <Tabs active={tab} tabs={TABS.map(([key, label]) => ({ key, label, href: `${base}?tab=${key}`, count: key === "batches" && tab === "batches" ? batches.length : undefined }))} />

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

      {tab === "curriculum" && (
        <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            {curriculum.length === 0 && <Empty title="No sections yet">Group lessons into sections, like Week 1 or Module 1.</Empty>}
            {curriculum.map((s, i) => (
              <Card key={s.id}>
                <CardTitle hint={`${s.lessons.length} lessons`}>
                  {i + 1}. {s.title}
                </CardTitle>
                <ul className="mb-4 space-y-1 text-sm">
                  {s.lessons.map((l) => (
                    <li key={l.id} className="flex items-center gap-2">
                      <Badge>{l.kind}</Badge> {l.title}
                    </li>
                  ))}
                </ul>
                {canEdit && (
                  <ActionForm action={addLessonAction} className="flex flex-wrap gap-2">
                    <input type="hidden" name="uni" value={uni} />
                    <input type="hidden" name="courseId" value={id} />
                    <input type="hidden" name="sectionId" value={s.id} />
                    <Input name="title" placeholder="Lesson title" required className="min-w-0 flex-1" />
                    <Select name="kind" className="w-28">
                      <option value="video">Video</option>
                      <option value="text">Text</option>
                      <option value="pdf">PDF</option>
                      <option value="live">Live</option>
                    </Select>
                    <SubmitButton size="sm" variant="secondary">
                      Add
                    </SubmitButton>
                  </ActionForm>
                )}
              </Card>
            ))}
          </div>
          {canEdit && (
            <Card className="h-fit">
              <CardTitle>Add a section</CardTitle>
              <ActionForm action={addSectionAction} className="space-y-3">
                <input type="hidden" name="uni" value={uni} />
                <input type="hidden" name="courseId" value={id} />
                <Input name="title" placeholder="Module 1: Foundations" required />
                <SubmitButton variant="secondary">Add section</SubmitButton>
              </ActionForm>
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

      {["assignments", "live", "certificates"].includes(tab) && (
        <Empty title="Coming in the next sprint">
          {tab === "live"
            ? "Live classes and attendance will follow each batch's timetable."
            : tab === "certificates"
              ? "Certificate templates and renewal rules."
              : "Assignments per batch, graded by the batch's faculty."}
        </Empty>
      )}
    </>
  );
}
