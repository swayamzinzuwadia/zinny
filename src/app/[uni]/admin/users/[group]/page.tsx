import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import Link from "next/link";
import { Badge, Card, CardTitle, Empty, Field, Input, PageHeader, Select, Table, Td, buttonClass } from "@/components/ui";
import { can, reach } from "@/server/authz/engine";
import { ROLE_LABELS, USER_GROUPS } from "@/server/authz/roles";
import { spaceContext } from "@/server/context";
import { formatDate, todayIn } from "@/server/lib/dates";
import { listDepartments } from "@/server/services/departments";
import { customRoleChoices } from "@/server/services/roles";
import { listPeople } from "@/server/services/users";
import { studentDepartmentMap } from "@/server/services/students";
import type { RoleName } from "@/db/schema";
import { addPersonAction, graduateAction, linkParentAction, revokeRoleAction, studentDepartmentsAction } from "../../actions";
import { addToBatchAction } from "../../daily-actions";
import { BulkPlaceBar, BulkTick } from "@/components/bulk-place";
import { quickChoices } from "@/server/services/daily";

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

export default async function PeoplePage({ params, searchParams }: { params: Promise<{ uni: string; group: string }>; searchParams: Promise<{ q?: string }> }) {
  const { uni, group } = await params;
  if (!(group in USER_GROUPS)) notFound();
  const g = group as keyof typeof USER_GROUPS;
  const { actor, university } = await spaceContext(uni);
  const q = ((await searchParams).q ?? "").trim();
  const everyone = await listPeople(actor, g);
  const needle = q.toLowerCase();
  const people = needle ? everyone.filter((p) => p.name.toLowerCase().includes(needle) || p.email.toLowerCase().includes(needle)) : everyone;
  const listHref = `/${uni}/admin/users/${g}`;
  const isAdmin = can(actor, "user.manage_roles", { universityId: university.id });
  const hodReach = reach(actor, "user.manage_roles", university.id);
  const depts = await listDepartments(actor);
  const myDepts = depts.filter((d) => isAdmin || hodReach.departmentIds.has(d.id));
  const canAdd = isAdmin || (g === "teaching" && myDepts.length > 0);
  const roles = isAdmin ? ADDABLE[g] : (["permanent_faculty", "visiting_faculty"] as RoleName[]);
  const customKind = g === "administration" ? "custom_institute" : g === "teaching" ? "custom_department" : null;
  const custom = (await customRoleChoices(actor, university.id)).filter((c) => c.kind === customKind);
  const canGraduate = can(actor, "user.graduate", { universityId: university.id });
  // Students only see the courses of their departments; Admins and HODs decide which.
  const admit = reach(actor, "user.admit", university.id);
  const admitDepts = depts.filter((d) => admit.all || admit.departmentIds.has(d.id));
  // Students can be ticked and put into a batch together by people who admit students.
  const placeBatches = g === "students" ? (await quickChoices(actor)).place : [];
  const bulk = placeBatches.length > 0;
  const studentDepts = g === "students" ? await studentDepartmentMap(actor, people.map((p) => p.id)) : new Map<string, { id: string; name: string }[]>();

  return (
    <>
      <PageHeader title={TITLES[g][0]} subtitle={TITLES[g][1]} />
      <div className="grid gap-6 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          {everyone.length > 0 && (
            <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
              <Input type="search" name="q" defaultValue={q} placeholder="Search by name or email" aria-label="Search by name or email" className="max-w-xs" />
              <button type="submit" className={buttonClass("secondary")}>
                Search
              </button>
              {q && (
                <Link href={listHref} className={buttonClass("ghost")}>
                  Clear
                </Link>
              )}
              <span className="text-[13px] text-muted">
                {q ? `${people.length} of ${everyone.length}` : everyone.length} {everyone.length === 1 ? "person" : "people"}
              </span>
            </form>
          )}
          {people.length === 0 ? (
            <Empty title={q ? `Nobody matches “${q}”` : "Nobody here yet"}>
              {q ? (
                "Check the spelling, or search by email instead."
              ) : g === "teaching" && depts.length === 0 ? (
                <>
                  Teachers belong to a department, and there isn&apos;t one yet.{" "}
                  <Link href={`/${uni}/admin/products/courses/new`} className="font-medium text-brand hover:underline">
                    Create a course
                  </Link>{" "}
                  to make its department and add its teacher on one page, or{" "}
                  <Link href={`/${uni}/admin/users/departments`} className="font-medium text-brand hover:underline">
                    add a department
                  </Link>{" "}
                  first.
                </>
              ) : g === "students" && canAdd ? (
                <>
                  Add students on the right, import a list under Bulk import, or share your joining code from the{" "}
                  <Link href={`/${uni}/admin`} className="font-medium text-brand hover:underline">
                    dashboard
                  </Link>
                  .
                </>
              ) : canAdd ? (
                "Add someone on the right."
              ) : undefined}
            </Empty>
          ) : (
            <>
            {bulk && <BulkPlaceBar uni={uni} batches={placeBatches.map((b) => ({ id: b.id, label: b.label, seatsLeft: b.seatsLeft }))} action={addToBatchAction} />}
            <Table head={bulk ? ["", "Name", "Roles", ""] : ["Name", "Roles", ""]}>
              {people.map((p) => (
                <tr key={p.id}>
                  {bulk && (
                    <Td className="w-8">
                      {p.roles.some((r) => r.role === "student") && <BulkTick userId={p.id} name={p.name} />}
                    </Td>
                  )}
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
                            {r.endsAt && (
                              <span className="text-[13px] text-muted">
                                {ended ? "Access ended" : `Until ${formatDate(todayIn(university.timezone, r.endsAt))}`}
                              </span>
                            )}
                            {/* Your own Institute Admin role can't be removed (the server refuses), so there's no button for it. */}
                            {(isAdmin || ["permanent_faculty", "visiting_faculty"].includes(r.role)) &&
                              canAdd &&
                              !(r.role === "institute_admin" && p.id === actor.userId) && (
                                <ActionForm action={revokeRoleAction} confirm={`Remove ${r.label} from ${p.name}?`}>
                                  <input type="hidden" name="uni" value={uni} />
                                  <input type="hidden" name="assignmentId" value={r.assignmentId} />
                                  <button aria-label={`Remove ${r.label} from ${p.name}`} className="text-[13px] text-muted underline underline-offset-2 hover:text-danger">
                                    Remove
                                  </button>
                                </ActionForm>
                              )}
                          </div>
                        );
                      })}
                      {g === "students" && p.roles.some((r) => r.role === "student" || r.role === "alumni") && (
                        <div className="flex flex-wrap items-center gap-1.5 text-sm">
                          {(studentDepts.get(p.id) ?? []).length === 0 ? (
                            <Badge tone="gold">No department yet: sees no courses</Badge>
                          ) : (
                            (studentDepts.get(p.id) ?? []).map((d) => (
                              <span key={d.id} className="rounded-full border border-line px-2.5 py-0.5 text-[13px] text-muted">
                                {d.name}
                              </span>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </Td>
                  <Td className="text-right">
                    {g === "students" && admitDepts.length > 0 && p.roles.some((r) => r.role === "student" || r.role === "alumni") && (
                      <details className="mb-2 text-left">
                        <summary className="cursor-pointer text-sm text-brand">Departments</summary>
                        <ActionForm action={studentDepartmentsAction} className="mt-3 w-64 space-y-2">
                          <input type="hidden" name="uni" value={uni} />
                          <input type="hidden" name="userId" value={p.id} />
                          {admitDepts.map((d) => (
                            <label key={d.id} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                name="studentDepartmentId"
                                value={d.id}
                                defaultChecked={(studentDepts.get(p.id) ?? []).some((x) => x.id === d.id)}
                                className="accent-brand"
                              />
                              {d.name}
                            </label>
                          ))}
                          {/* Departments this viewer can't change stay as they are. */}
                          {(studentDepts.get(p.id) ?? [])
                            .filter((x) => !admitDepts.some((d) => d.id === x.id))
                            .map((x) => (
                              <input key={x.id} type="hidden" name="studentDepartmentId" value={x.id} />
                            ))}
                          <SubmitButton size="sm" variant="secondary">
                            Save departments
                          </SubmitButton>
                        </ActionForm>
                      </details>
                    )}
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
            </>
          )}
        </div>

        {canAdd && (
          <Card className="h-fit">
            <CardTitle>Add a person</CardTitle>
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
                  {custom.map((c) => (
                    <option key={c.id} value={`custom:${c.id}`}>
                      {c.name}
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
              {g === "students" && admitDepts.length > 0 && (
                <fieldset>
                  <legend className="mb-1.5 text-[13px] font-medium">Departments</legend>
                  <div className="flex flex-wrap gap-2">
                    {admitDepts.map((d) => (
                      <label key={d.id} className="cursor-pointer">
                        <input type="checkbox" name="studentDepartmentId" value={d.id} className="peer sr-only" />
                        <span className="inline-flex h-9 items-center rounded-full border border-line px-3.5 text-[13px] peer-checked:border-brand peer-checked:bg-brand-soft peer-checked:font-medium peer-checked:text-brand-strong peer-focus-visible:ring-2 peer-focus-visible:ring-gold">
                          {d.name}
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[13px] text-muted">The student sees only these departments&apos; courses.</p>
                </fieldset>
              )}
              <SubmitButton>Add person</SubmitButton>
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
