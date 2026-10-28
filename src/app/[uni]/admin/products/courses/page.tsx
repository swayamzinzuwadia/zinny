import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Empty, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { can } from "@/server/authz/engine";
import { spaceContext } from "@/server/context";
import { listCourses } from "@/server/services/courses";
import { listDepartments } from "@/server/services/departments";
import { formatINR } from "@/server/services/finance";
import { createCourseAction } from "../../actions";

export const metadata = { title: "Courses" };

const STATUS_TONE = { published: "brand", draft: "neutral", archived: "warn" } as const;

export default async function CoursesPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  const [courses, depts] = await Promise.all([listCourses(actor), listDepartments(actor)]);
  const creatable = depts.filter((d) => can(actor, "course.create", { universityId: university.id, departmentIds: [d.id] }));

  return (
    <>
      <PageHeader title="Courses" subtitle="Each course lives in one department. Batches inside it set the days, timings and seats." />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div>
          {courses.length === 0 ? (
            <Empty title="No courses yet">{creatable.length ? "Create the first one on the right." : "Courses you teach will show here."}</Empty>
          ) : (
            <Table head={["Course", "Department", "Batches", "Students", "Price", "Status"]}>
              {courses.map((c) => (
                <tr key={c.id} className="hover:bg-canvas/60">
                  <Td>
                    <Link href={`/${uni}/admin/products/courses/${c.id}`} className="font-medium text-ink hover:text-brand">
                      {c.title}
                    </Link>
                  </Td>
                  <Td className="text-muted">{c.departmentName}</Td>
                  <Td className="tabular-nums">{c.batchCount}</Td>
                  <Td className="tabular-nums">{c.studentCount}</Td>
                  <Td className="tabular-nums">{c.pricePaise ? formatINR(c.pricePaise) : "Free"}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[c.status]}>{c.status[0].toUpperCase() + c.status.slice(1)}</Badge>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </div>

        {creatable.length > 0 && (
          <Card className="h-fit">
            <CardTitle>New course</CardTitle>
            <ActionForm action={createCourseAction} className="space-y-4">
              <input type="hidden" name="uni" value={uni} />
              <Field label="Title">
                <Input name="title" placeholder="Data Analytics" required />
              </Field>
              <Field label="Department">
                <Select name="departmentId" required>
                  {creatable.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Short description">
                <Input name="description" placeholder="What students will learn" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Price (₹)" hint="0 for free">
                  <Input name="price" inputMode="decimal" defaultValue="0" />
                </Field>
                <Field label="GST">
                  <Select name="gst" defaultValue="18">
                    {[0, 5, 12, 18, 28].map((g) => (
                      <option key={g} value={g}>
                        {g}%
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <SubmitButton>Create and add batches</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
