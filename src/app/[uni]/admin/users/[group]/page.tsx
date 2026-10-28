import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Empty, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { can, reach } from "@/server/authz/engine";
import { ROLE_LABELS, USER_GROUPS } from "@/server/authz/roles";
import { spaceContext } from "@/server/context";
import { listDepartments } from "@/server/services/departments";
import { listPeople } from "@/server/services/users";
import type { RoleName } from "@/db/schema";
import { addPersonAction, graduateAction, linkParentAction, revokeRoleAction } from "../../actions";

const TITLES = {
  administration: ["Administration", "Institute Admin, Board / Owner and Accounts & Fees."],
  teaching: ["Teaching", "Heads of Department, permanent and visiting faculty."],
  students: ["Students", "Current students, alumni and parents."],
} as const;

const ADDABLE: Record<keyof typeof USER_GROUPS, RoleName[]> = {
  administration: ["institute_admin", "board_owner", "accounts_fees"],
  teaching: ["permanent_faculty", "visiting_faculty", "hod"],
  students: ["student"],
};

export default async function PeoplePage({ params }: { params: Promise<{ uni: string; group: string }> }) {
  const { uni, group } = await params;
  if (!(group in USER_GROUPS)) notFound();
  const g = group as keyof typeof USER_GROUPS;
  const { actor, university } = await spaceContext(uni);
  const people = await listPeople(actor, g);
  const isAdmin = can(actor, "user.manage_roles", { universityId: university.id });
  const hodReach = reach(actor, "user.manage_roles", university.id);
  const depts = await listDepartments(actor);
  const myDepts = depts.filter((d) => isAdmin || hodReach.departmentIds.has(d.id));
  const canAdd = isAdmin || (g === "teaching" && myDepts.length > 0);
  const roles = isAdmin ? ADDABLE[g] : (["permanent_faculty", "visiting_faculty"] as RoleName[]);
  const canGraduate = can(actor, "user.graduate", { universityId: university.id });

  return (
    <>
      <PageHeader title={TITLES[g][0]} subtitle={TITLES[g][1]} />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div>
          {people.length === 0 ? (
            <Empty title="Nobody here yet" />
          ) : (
            <Table head={["Name", "Roles", ""]}>
              {people.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-sm text-muted">{p.email}</div>
                  </Td>
                  <Td>
                    <div className="flex flex-col gap-1.5">
                      {p.roles.map((r) => {
                        const ended = r.endsAt && r.endsAt <= new Date();
                        return (
                          <div key={r.assignmentId} className="flex flex-wrap items-center gap-2 text-sm">
                            <Badge tone={ended ? "danger" : r.role === "alumni" ? "neutral" : "brand"}>{r.label}</Badge>
                            <span className="text-muted">{r.scope}</span>
                            {r.endsAt && <span className="text-xs text-faint">{ended ? "access ended" : `until ${r.endsAt.toLocaleDateString("en-IN")}`}</span>}
                            {(isAdmin || ["permanent_faculty", "visiting_faculty"].includes(r.role)) && canAdd && (
                              <ActionForm action={revokeRoleAction} confirm={`Remove ${r.label} from ${p.name}?`}>
                                <input type="hidden" name="uni" value={uni} />
                                <input type="hidden" name="assignmentId" value={r.assignmentId} />
                                <button className="text-xs text-faint hover:text-danger">remove</button>
                              </ActionForm>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </Td>
                  <Td className="text-right">
                    {g === "students" && canGraduate && p.roles.some((r) => r.role === "student") && (
                      <details className="text-left">
                        <summary className="cursor-pointer text-sm text-brand">Manage</summary>
                        <div className="mt-3 w-64 space-y-4">
                          <ActionForm action={graduateAction} confirm={`Move ${p.name} to alumni? Program courses will be removed; certificates stay.`}>
                            <input type="hidden" name="uni" value={uni} />
                            <input type="hidden" name="userId" value={p.id} />
                            <SubmitButton size="sm" variant="secondary">
                              Graduate to alumni
                            </SubmitButton>
                          </ActionForm>
                          <ActionForm action={linkParentAction} className="space-y-2">
                            <input type="hidden" name="uni" value={uni} />
                            <input type="hidden" name="userId" value={p.id} />
                            <Input name="parentName" placeholder="Parent's name" required />
                            <Input name="parentEmail" type="email" placeholder="Parent's email" required />
                            <SubmitButton size="sm" variant="secondary">
                              Link parent
                            </SubmitButton>
                          </ActionForm>
                        </div>
                      </details>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </div>

        {canAdd && (
          <Card className="h-fit">
            <CardTitle>Add someone</CardTitle>
            <ActionForm action={addPersonAction} className="space-y-4">
              <input type="hidden" name="uni" value={uni} />
              <Field label="Name">
                <Input name="name" required />
              </Field>
              <Field label="Email">
                <Input name="email" type="email" required />
              </Field>
              <Field label="Phone">
                <Input name="phone" inputMode="tel" />
              </Field>
              <Field label="Role">
                <Select name="role">
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              </Field>
              {g === "teaching" && (
                <>
                  <Field label="Department">
                    <Select name="departmentId" required>
                      {myDepts.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Access ends" hint="Required for visiting faculty.">
                    <Input name="endsAt" type="date" />
                  </Field>
                </>
              )}
              <SubmitButton>Add</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}

export function generateMetadata() {
  return { title: "People" };
}
