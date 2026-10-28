import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardTitle, Empty, Field, Input, PageHeader, Select } from "@/components/ui";
import { can } from "@/server/authz/engine";
import { spaceContext } from "@/server/context";
import { listDepartments } from "@/server/services/departments";
import { listPeople } from "@/server/services/users";
import { createDepartmentAction, setHodAction } from "../../actions";

export const metadata = { title: "Departments" };

export default async function DepartmentsPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  const depts = await listDepartments(actor);
  const canManage = can(actor, "department.manage", { universityId: university.id });
  const teaching = canManage ? await listPeople(actor, "teaching") : [];

  return (
    <>
      <PageHeader title="Departments" subtitle="Each department shows its Head, faculty and courses." />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="grid gap-3 md:grid-cols-2">
          {depts.length === 0 && <Empty title="No departments yet" />}
          {depts.map((d) => (
            <Card key={d.id}>
              <div className="flex items-baseline justify-between">
                <div className="font-semibold">{d.name}</div>
                <span className="text-xs font-medium text-faint">{d.code}</span>
              </div>
              <div className="mt-2 text-sm text-muted">Head: {d.hods.join(", ") || "not set"}</div>
              <div className="text-sm text-muted">
                {d.facultyCount} faculty · {d.courseCount} courses
              </div>
              {canManage && teaching.length > 0 && (
                <ActionForm action={setHodAction} className="mt-3 flex gap-2">
                  <input type="hidden" name="uni" value={uni} />
                  <input type="hidden" name="departmentId" value={d.id} />
                  <Select name="userId" className="h-8 min-w-0 flex-1 text-[13px]">
                    {teaching.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                  <SubmitButton size="sm" variant="secondary">
                    Set Head
                  </SubmitButton>
                </ActionForm>
              )}
            </Card>
          ))}
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
              <SubmitButton>Create</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
