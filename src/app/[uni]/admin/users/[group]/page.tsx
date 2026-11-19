import { notFound, redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Panel, PanelButton, Panels } from "@/components/panel";
import Link from "next/link";
import { Card, Empty, Field, Input, PageHeader, buttonClass, actionClass, ButtonLabel, cx } from "@/components/ui";
import { ManageRow } from "@/components/manage-row";
import { can, reach } from "@/server/authz/engine";
import { menuFor } from "@/server/authz/menu";
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
import { Pager, pageOf } from "@/components/pager";
import { mergePeople } from "./merge-people";
import { StaffRoleFields } from "./staff-role-fields";

/*
 * Two lists: Students, and Staff. Staff is everyone who works at the institute, teaching and
 * administration together, with a filter for either; they used to be two separate pages.
 */
const TITLES = {
  staff: ["Staff", "Everyone who works here: heads of department and faculty, and the administration."],
  students: ["Students", "Current students, alumni and parents."],
} as const;

const ADDABLE: Record<keyof typeof USER_GROUPS, RoleName[]> = {
  administration: ["institute_admin", "board_owner", "accounts_fees"],
  teaching: ["permanent_faculty", "visiting_faculty", "hod"],
  students: ["student"],
};
const STAFF_GROUPS = ["teaching", "administration"] as const;
const GROUP_LABEL = { teaching: "Teaching", administration: "Administration" } as const;

export default async function PeoplePage({ params, searchParams }: { params: Promise<{ uni: string; group: string }>; searchParams: Promise<{ q?: string; show?: string; page?: string }> }) {
  const { uni, group } = await params;
  // The two old staff pages lead to the one list, already filtered.
  if (group === "teaching" || group === "administration") redirect(`/${uni}/admin/users/staff?show=${group}`);
  if (group !== "staff" && group !== "students") notFound();
  const g: "staff" | "students" = group;
  const { actor, university } = await spaceContext(uni);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  // Which staff lists this person may see is the menu's decision (a HOD has Teaching, not Administration).
  const open = new Set(menuFor(actor, university.id).flatMap((s) => s.items.map((i) => i.href)));
  const staffGroups = STAFF_GROUPS.filter((k) => open.has(`/users/${k}`));
  const show = g === "staff" && staffGroups.some((k) => k === sp.show) ? (sp.show as (typeof STAFF_GROUPS)[number]) : null;
  const lists = await Promise.all((g === "students" ? (["students"] as const) : staffGroups).map(async (k) => [k, await listPeople(actor, k)] as const));
  // Someone with a teaching and an administration role is one person in the list, with both roles.
  const all = mergePeople(lists);
  const everyone = show ? all.filter((p) => p.kinds.has(show)) : all;
  const needle = q.toLowerCase();
  const matching = needle ? everyone.filter((p) => p.name.toLowerCase().includes(needle) || p.email.toLowerCase().includes(needle)) : everyone;
  // 30 to a page, so a large institute's list stays one screen or two.
  const paged = pageOf(matching, sp.page, 30);
  const people = paged.rows;
  const pageHref = (n: number) => {
    const keep = new URLSearchParams({ ...(show && { show }), ...(q && { q }), ...(n > 1 && { page: String(n) }) }).toString();
    return `/${uni}/admin/users/${g}${keep ? `?${keep}` : ""}`;
  };
  const listHref = `/${uni}/admin/users/${g}${show ? `?show=${show}` : ""}`;
  const isAdmin = can(actor, "user.manage_roles", { universityId: university.id });
  const hodReach = reach(actor, "user.manage_roles", university.id);
  const depts = await listDepartments(actor);
  const myDepts = depts.filter((d) => isAdmin || hodReach.departmentIds.has(d.id));
  const canAdd = isAdmin || (g === "staff" && myDepts.length > 0);
  // A HOD adds faculty to their own departments; an admin adds anyone.
  const teachingRoles = g === "staff" && myDepts.length > 0 ? (isAdmin ? ADDABLE.teaching : (["permanent_faculty", "visiting_faculty"] as RoleName[])) : [];
  const adminRoles = g === "staff" && isAdmin ? ADDABLE.administration : [];
  const custom = canAdd && g === "staff" ? await customRoleChoices(actor, university.id) : [];
  const choice = (kind: string, roles: RoleName[]) => [...roles.map((r) => ({ value: r as string, label: ROLE_LABELS[r] })), ...custom.filter((c) => c.kind === kind).map((c) => ({ value: `custom:${c.id}`, label: c.name }))];
  const teachingChoices = teachingRoles.length > 0 ? choice("custom_department", teachingRoles) : [];
  const adminChoices = adminRoles.length > 0 ? choice("custom_institute", adminRoles) : [];
  const canGraduate = can(actor, "user.graduate", { universityId: university.id });
  // Students only see the courses of their departments; Admins and HODs decide which.
  const admit = reach(actor, "user.admit", university.id);
  const admitDepts = depts.filter((d) => admit.all || admit.departmentIds.has(d.id));
  // Students can be ticked and put into a batch together by people who admit students.
  const placeBatches = g === "students" ? (await quickChoices(actor)).place : [];
  const bulk = placeBatches.length > 0;
  const studentDepts = g === "students" ? await studentDepartmentMap(actor, people.map((p) => p.id)) : new Map<string, { id: string; name: string }[]>();
  const filters = [{ key: null as string | null, label: "Everyone", count: all.length }, ...staffGroups.map((k) => ({ key: k as string | null, label: GROUP_LABEL[k], count: all.filter((p) => p.kinds.has(k)).length }))];

  return (
    // The list has the page to itself; the form to add someone waits behind its button, and is open already while the list is empty.
    <Panels initial={canAdd && everyone.length === 0 ? "add" : undefined}>
      <PageHeader title={TITLES[g][0]} subtitle={TITLES[g][1]} actions={canAdd ? <PanelButton panel="add">{g === "students" ? "Add a student" : "Add a person"}</PanelButton> : null} />
      {canAdd && (
        <Panel id="add" title={g === "students" ? "Add a student" : "Add a person"} hint="They get an email invitation to set their password." className="max-w-2xl">
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
            {g === "staff" ? <StaffRoleFields teaching={teachingChoices} administration={adminChoices} departments={myDepts.map((d) => ({ id: d.id, name: d.name }))} /> : <input type="hidden" name="role" value="student" />}
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
            <SubmitButton>{g === "students" ? "Add student" : "Add person"}</SubmitButton>
          </ActionForm>
        </Panel>
      )}
      <div>
        <div className="min-w-0">
          {g === "staff" && staffGroups.length > 1 && (
            <nav aria-label="Show" className="mb-4 flex flex-wrap gap-1 text-[13.5px]">
              {filters.map((f) => (
                <Link
                  key={f.label}
                  href={`/${uni}/admin/users/staff${f.key ? `?show=${f.key}` : ""}`}
                  aria-current={show === f.key ? "page" : undefined}
                  className={cx("rounded-full px-3 py-1.5", show === f.key ? "bg-brand-soft font-medium text-brand-strong" : "text-muted hover:text-ink")}
                >
                  {f.label}
                  <span className="ml-1.5 text-faint">{f.count}</span>
                </Link>
              ))}
            </nav>
          )}
          {everyone.length > 0 && (
            <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
              {show && <input type="hidden" name="show" value={show} />}
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
                {q ? `${matching.length} of ${everyone.length}` : everyone.length} {everyone.length === 1 ? "person" : "people"}
              </span>
            </form>
          )}
          {people.length === 0 ? (
            <Empty title={q ? `Nobody matches “${q}”` : "Nobody here yet"}>
              {q ? (
                "Check the spelling, or search by email instead."
              ) : g === "staff" && depts.length === 0 && canAdd ? (
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
                  Add students with the button above, import a list under Bulk import, or share your joining code from the{" "}
                  <Link href={`/${uni}/admin`} className="font-medium text-brand hover:underline">
                    dashboard
                  </Link>
                  .
                </>
              ) : canAdd ? (
                "Add someone with the button above."
              ) : undefined}
            </Empty>
          ) : (
            <>
              {bulk && <BulkPlaceBar uni={uni} batches={placeBatches.map((b) => ({ id: b.id, label: b.label, seatsLeft: b.seatsLeft }))} action={addToBatchAction} />}
              <Card className="p-0!">
                <ul className="divide-y divide-line">
                  {people.map((p) => {
                    const isStudentLike = g === "students" && p.roles.some((r) => r.role === "student" || r.role === "alumni");
                    const myDeptList = studentDepts.get(p.id) ?? [];
                    // Your own Institute Admin role can't be removed (the server refuses), so there's no button for it.
                    const removable = p.roles.filter(
                      (r) =>
                        (isAdmin || ["permanent_faculty", "visiting_faculty"].includes(r.role)) && canAdd && !(r.role === "institute_admin" && p.id === actor.userId),
                    );
                    const canDepts = isStudentLike && admitDepts.length > 0;
                    const canManageStudent = g === "students" && canGraduate && p.roles.some((r) => r.role === "student");
                    const hasPanel = removable.length > 0 || canDepts || canManageStudent;
                    return (
                      <ManageRow
                        key={p.id}
                        label={p.name}
                        lead={bulk ? p.roles.some((r) => r.role === "student") ? <BulkTick userId={p.id} name={p.name} /> : null : undefined}
                        panel={
                          hasPanel ? (
                            <div className="grid gap-5 text-[14px] sm:grid-cols-2 xl:grid-cols-3">
                              {removable.length > 0 && (
                                <div>
                                  <h3 className="mb-2 text-[13px] text-muted">Roles</h3>
                                  <ul className="space-y-2">
                                    {removable.map((r) => (
                                      <li key={r.assignmentId} className="flex flex-wrap items-center justify-between gap-2">
                                        <span>
                                          {r.label} <span className="text-muted">· {r.scope}</span>
                                        </span>
                                        <ActionForm action={revokeRoleAction} confirm={`Remove ${r.label} from ${p.name}?`}>
                                          <input type="hidden" name="uni" value={uni} />
                                          <input type="hidden" name="assignmentId" value={r.assignmentId} />
                                          <button aria-label={`Remove ${r.label} from ${p.name}`} className={actionClass("Remove")}>
                                            <ButtonLabel>Remove role</ButtonLabel>
                                          </button>
                                        </ActionForm>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {canDepts && (
                                <ActionForm action={studentDepartmentsAction} className="space-y-2">
                                  <input type="hidden" name="uni" value={uni} />
                                  <input type="hidden" name="userId" value={p.id} />
                                  <h3 className="text-[13px] text-muted">Departments</h3>
                                  {admitDepts.map((d) => (
                                    <label key={d.id} className="flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        name="studentDepartmentId"
                                        value={d.id}
                                        defaultChecked={myDeptList.some((x) => x.id === d.id)}
                                        className="h-4 w-4 accent-brand"
                                      />
                                      {d.name}
                                    </label>
                                  ))}
                                  {/* Departments this viewer can't change stay as they are. */}
                                  {myDeptList
                                    .filter((x) => !admitDepts.some((d) => d.id === x.id))
                                    .map((x) => (
                                      <input key={x.id} type="hidden" name="studentDepartmentId" value={x.id} />
                                    ))}
                                  <SubmitButton size="sm" variant="secondary">
                                    Save departments
                                  </SubmitButton>
                                </ActionForm>
                              )}
                              {canManageStudent && (
                                <div className="space-y-4">
                                  <ActionForm action={linkParentAction} className="space-y-2">
                                    <input type="hidden" name="uni" value={uni} />
                                    <input type="hidden" name="userId" value={p.id} />
                                    <h3 className="text-[13px] text-muted">Parent</h3>
                                    <Input name="parentName" placeholder="Parent's name" aria-label="Parent's name" required />
                                    <Input name="parentEmail" type="email" placeholder="Parent's email" aria-label="Parent's email" required />
                                    <SubmitButton size="sm" variant="secondary">
                                      Link parent
                                    </SubmitButton>
                                  </ActionForm>
                                  <ActionForm action={graduateAction} confirm={`Move ${p.name} to alumni? Program courses will be removed; certificates stay.`}>
                                    <input type="hidden" name="uni" value={uni} />
                                    <input type="hidden" name="userId" value={p.id} />
                                    <SubmitButton size="sm" variant="secondary">
                                      Graduate to alumni
                                    </SubmitButton>
                                  </ActionForm>
                                </div>
                              )}
                            </div>
                          ) : undefined
                        }
                      >
                        <div className="flex flex-wrap items-baseline gap-x-2 text-[14px]">
                          <span className="font-medium">{p.name}</span>
                          <span className="min-w-0 truncate text-[13px] text-muted">{p.email}</span>
                        </div>
                        <div className="mt-0.5 text-[13px] text-muted">
                          {p.roles.map((r, i) => {
                            const ended = r.endsAt && r.endsAt <= new Date();
                            return (
                              <span key={r.assignmentId}>
                                {i > 0 && " · "}
                                {r.label}
                                {` · ${r.scope}`}
                                {r.endsAt &&
                                  (ended ? (
                                    <span className="text-danger"> · Access ended</span>
                                  ) : (
                                    ` · until ${formatDate(todayIn(university.timezone, r.endsAt))}`
                                  ))}
                              </span>
                            );
                          })}
                          {isStudentLike &&
                            (myDeptList.length === 0 ? (
                              <span className="inline-flex items-center gap-1.5">
                                {" · "}
                                <span aria-hidden className="h-2 w-2 rounded-full bg-gold" />
                                <span className="text-ink">No department yet: sees no courses</span>
                              </span>
                            ) : (
                              ` · ${myDeptList.map((d) => d.name).join(", ")}`
                            ))}
                        </div>
                      </ManageRow>
                    );
                  })}
                </ul>
              </Card>
              <Pager {...paged} hrefFor={pageHref} />
            </>
          )}
        </div>

      </div>
    </Panels>
  );
}

export function generateMetadata() {
  return { title: "People" };
}
