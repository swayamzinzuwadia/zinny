import { ActionForm, SubmitButton } from "@/components/forms";
import { Avatar, Badge, Card, CardTitle, Field, Input, PageHeader, Select } from "@/components/ui";
import { platformContext } from "@/server/context";
import { addRoleAction, inviteMemberAction, removeRoleAction } from "@/modules/zinny-team-panel/actions";
import { NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { isSuperAdmin } from "@/modules/zinny-team-panel/lib/access";
import { PLATFORM_ROLE_HINTS, PLATFORM_ROLE_LABELS, PLATFORM_ROLES } from "@/modules/zinny-team-panel/lib/constants";
import { formatDate } from "@/modules/zinny-team-panel/lib/format";
import { listTeam } from "@/modules/zinny-team-panel/services/team";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const actor = await platformContext();
  if (!isSuperAdmin(actor)) return <NoAccess section="Team" who="Only Super Admins" />;
  const team = await listTeam(actor);

  return (
    <>
      <PageHeader title="Team and roles" subtitle="The Zinny team and what each person can open. Roles take effect on their next page load." />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-3">
          {team.map((m) => {
            const missing = PLATFORM_ROLES.filter((r) => !m.roles.some((x) => x.role === r));
            return (
              <Card key={m.userId} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={m.name} />
                    <div>
                      <div className="font-medium">
                        {m.name} {m.userId === actor.userId && <span className="text-[13px] text-muted">(you)</span>}
                      </div>
                      <div className="text-[13px] text-muted">{m.email}</div>
                    </div>
                    {m.invited && <Badge tone="gold">Invite not accepted yet</Badge>}
                  </div>
                  {missing.length > 0 && (
                    <ActionForm action={addRoleAction} className="flex gap-2">
                      <input type="hidden" name="userId" value={m.userId} />
                      <Select name="role" aria-label={`Role to give ${m.name}`} className="h-8 w-44 text-[13px]">
                        {missing.map((r) => (
                          <option key={r} value={r}>
                            {PLATFORM_ROLE_LABELS[r]}
                          </option>
                        ))}
                      </Select>
                      <SubmitButton size="sm" variant="secondary">
                        Add role
                      </SubmitButton>
                    </ActionForm>
                  )}
                </div>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {m.roles.map((r) => {
                    const own = m.userId === actor.userId && r.role === "super_admin";
                    return (
                      <li key={r.assignmentId} className="flex items-center gap-2 rounded-full bg-canvas py-1 pl-3 pr-1 text-[13px] ring-1 ring-line" title={PLATFORM_ROLE_HINTS[r.role]}>
                        {PLATFORM_ROLE_LABELS[r.role]}
                        <span className="text-faint">since {formatDate(r.since.toISOString().slice(0, 10), { year: false })}</span>
                        {own ? (
                          <span className="px-2 text-faint">yours</span>
                        ) : (
                          <ActionForm action={removeRoleAction} confirm={`Remove ${PLATFORM_ROLE_LABELS[r.role]} from ${m.name}?`}>
                            <input type="hidden" name="assignmentId" value={r.assignmentId} />
                            <button className="rounded-full px-2 py-0.5 text-danger hover:bg-danger-soft" aria-label={`Remove ${PLATFORM_ROLE_LABELS[r.role]} from ${m.name}`}>
                              Remove
                            </button>
                          </ActionForm>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
        <div className="space-y-6">
          <Card className="h-fit">
            <CardTitle>Invite someone</CardTitle>
            <ActionForm action={inviteMemberAction} className="space-y-3">
              <Field label="Name">
                <Input name="name" required minLength={2} />
              </Field>
              <Field label="Email">
                <Input name="email" type="email" required />
              </Field>
              <Field label="Role">
                <Select name="role" defaultValue="support_agent">
                  {PLATFORM_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {PLATFORM_ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              </Field>
              <SubmitButton>Invite to the Zinny team</SubmitButton>
            </ActionForm>
          </Card>
          <Card className="h-fit">
            <CardTitle>What each role opens</CardTitle>
            <dl className="space-y-2 text-[13px]">
              {PLATFORM_ROLES.map((r) => (
                <div key={r}>
                  <dt className="font-medium">{PLATFORM_ROLE_LABELS[r]}</dt>
                  <dd className="text-muted">{PLATFORM_ROLE_HINTS[r]}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
