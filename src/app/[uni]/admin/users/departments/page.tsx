import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardTitle, Empty, Field, Input, PageHeader, Select } from "@/components/ui";
import { can } from "@/server/authz/engine";
import { spaceContext } from "@/server/context";
import { listCourses } from "@/server/services/courses";
import { listDepartments } from "@/server/services/departments";
import { listPeople } from "@/server/services/users";
import { marketplaceOnlyCourseIds } from "@/modules/marketplace/listings";
import { createDepartmentAction, setHodAction } from "../../actions";

export const metadata = { title: "Departments" };

export default async function DepartmentsPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  const canManage = can(actor, "department.manage", { universityId: university.id });
  const [depts, teaching, allCourses, forSale] = await Promise.all([
    listDepartments(actor),
    canManage ? listPeople(actor, "teaching") : Promise.resolve([]),
    listCourses(actor),
    marketplaceOnlyCourseIds(actor),
  ]);
  // Counted as on the Courses page: courses sold only on the marketplace aren't listed there.
  const courses = allCourses.filter((c) => !forSale.has(c.id));
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  /** Teaching staff of a department: roles in the department itself, or in a batch of one of its courses. */
  const staffOf = (deptId: string, deptName: string) => {
    const titles = courses.filter((c) => c.departmentId === deptId).map((c) => `${c.title} · `);
    const inDept = (scope: string) => scope === deptName || titles.some((t) => scope.startsWith(t));
    return {
      people: teaching.filter((p) => p.roles.some((r) => inDept(r.scope))),
      headId: teaching.find((p) => p.roles.some((r) => r.role === "hod" && r.scope === deptName))?.id ?? "",
    };
  };

  return (
    <>
      <PageHeader title="Departments" subtitle="Each department has a Head, its faculty and its courses. Students see only their departments' courses." />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="grid gap-3 md:grid-cols-2">
          {depts.length === 0 && <Empty title="No departments yet" />}
          {depts.map((d) => {
            const staff = staffOf(d.id, d.name);
            return (
              <Card key={d.id} className="h-fit">
                <div className="flex items-baseline justify-between">
                  <div className="font-semibold">{d.name}</div>
                  <span className="text-xs font-medium text-muted">{d.code}</span>
                </div>
                <div className="mt-2 text-sm text-muted">Head: {d.hods.join(", ") || "Not set"}</div>
                <div className="text-sm text-muted">
                  {d.facultyCount} faculty · {plural(courses.filter((c) => c.departmentId === d.id).length, "course")}
                </div>
                {canManage && staff.people.length > 0 && (
                  <ActionForm action={setHodAction} className="mt-3 flex gap-2" resetOnSuccess={false}>
                    <input type="hidden" name="uni" value={uni} />
                    <input type="hidden" name="departmentId" value={d.id} />
                    <Select name="userId" defaultValue={staff.headId} required aria-label={`Head of ${d.name}`} className="h-8 min-w-0 flex-1 text-[13px]">
                      {!staff.headId && (
                        <option value="" disabled>
                          Choose a person
                        </option>
                      )}
                      {staff.people.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                    <SubmitButton size="sm" variant="secondary">
                      Make head
                    </SubmitButton>
                  </ActionForm>
                )}
              </Card>
            );
          })}
        </div>
        {canManage && (
          <Card className="h-fit">
            <CardTitle>New department</CardTitle>
            <ActionForm action={createDepartmentAction} className="space-y-4">
              <input type="hidden" name="uni" value={uni} />
              <Field label="Name">
                <Input name="name" placeholder="Computer Science" required />
              </Field>
              <Field label="Code" hint="Used in CSV imports, like CS or MKT.">
                <Input name="code" placeholder="CS" required />
              </Field>
              <SubmitButton>Add department</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
