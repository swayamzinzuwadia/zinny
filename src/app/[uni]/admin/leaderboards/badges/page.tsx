import { ActionForm, SubmitButton } from "@/components/forms";
import { Avatar, Badge, Card, CardTitle, Empty, Field, Input, PageHeader, Select, cx } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { createBadgeAction, setBadgeActiveAction, updateBadgeAction } from "@/modules/gamification/actions";
import { listBadges } from "@/modules/gamification/badges";
import { METRIC_KEYS, METRICS } from "@/modules/gamification/catalog";
import { BadgeIcon, IconPicker } from "@/modules/gamification/components/badge-icon";
import { NoAccess, SectionNav, unlessForbidden } from "@/modules/gamification/components/staff";
import { plural } from "@/modules/gamification/util";

export const metadata = { title: "Badges" };

function when(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone }).format(d);
}

export default async function BadgesPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  const data = await unlessForbidden(listBadges(actor));
  if (!data) return <NoAccess title="Badges" />;
  const { badges, recent, scopes } = data;
  const canCreate = scopes.universityWide || scopes.departments.length > 0;

  return (
    <>
      <SectionNav uni={uni} active="/badges" />
      <PageHeader title="Badges" subtitle="Milestones students collect. Each badge is earned once, and the student gets a notification." />
      <div className={cx("grid gap-6", canCreate && "xl:grid-cols-[1fr_360px]")}>
        <div className="min-w-0 space-y-6">
          {badges.length === 0 ? (
            <Empty title="No badges yet">{canCreate ? "Create the first one on the right, like Bookworm for 10 lessons." : "Badges your institute sets up will show here."}</Empty>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {badges.map((b) => (
                <Card key={b.id} className={cx("flex flex-col p-5", !b.active && "bg-canvas/60")}>
                  <div className="flex items-start gap-4">
                    <BadgeIcon icon={b.icon} size={56} state={b.active ? "earned" : "locked"} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[16px] font-medium">{b.name}</h2>
                        {!b.active && <Badge tone="warn">Off</Badge>}
                      </div>
                      <p className="text-[14px] text-muted">{b.criterion}</p>
                      {b.description && <p className="mt-1 text-[13px] text-faint">{b.description}</p>}
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[13px]">
                    <Badge tone={b.departmentId ? "neutral" : "brand"}>{b.scopeName}</Badge>
                    <span className="tabular text-muted">Earned by {plural(b.earnedBy, "student", "students")}</span>
                  </div>
                  {b.canManage && (
                    <div className="mt-4 flex flex-wrap items-start gap-2 border-t border-line pt-4">
                      <details className="w-full">
                        <summary className="inline-flex h-8 cursor-pointer list-none items-center rounded-full border border-line bg-surface px-3.5 text-[13px] font-medium hover:border-brand/40">
                          Edit badge
                        </summary>
                        <ActionForm action={updateBadgeAction} resetOnSuccess={false} className="mt-3 space-y-3">
                          <input type="hidden" name="uni" value={uni} />
                          <input type="hidden" name="badgeId" value={b.id} />
                          <Field label="Name">
                            <Input name="name" defaultValue={b.name} required maxLength={60} />
                          </Field>
                          <Field label="Description">
                            <Input name="description" defaultValue={b.description} maxLength={200} />
                          </Field>
                          <Field label={`Target (${METRICS[b.metric].label.toLowerCase()})`} hint="Lowering it gives the badge to students who now qualify.">
                            <Input name="threshold" type="number" min={1} defaultValue={b.threshold} required />
                          </Field>
                          <IconPicker name="icon" defaultValue={b.icon} />
                          <SubmitButton size="sm">Save badge</SubmitButton>
                        </ActionForm>
                      </details>
                      <ActionForm action={setBadgeActiveAction} resetOnSuccess={false}>
                        <input type="hidden" name="uni" value={uni} />
                        <input type="hidden" name="badgeId" value={b.id} />
                        <input type="hidden" name="active" value={b.active ? "false" : "true"} />
                        <SubmitButton size="sm" variant={b.active ? "danger" : "secondary"}>
                          {b.active ? "Turn off" : "Turn on"}
                        </SubmitButton>
                      </ActionForm>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}

          {recent.length > 0 && (
            <Card>
              <CardTitle>Recently earned</CardTitle>
              <ul className="divide-y divide-line">
                {recent.map((r) => (
                  <li key={`${r.badgeId}-${r.userId}`} className="flex items-center gap-3 py-2.5 text-[14px]">
                    <Avatar name={r.name} size={30} />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{r.name}</span> <span className="text-muted">earned {r.badge.name}</span>
                    </span>
                    <BadgeIcon icon={r.badge.icon} size={28} />
                    <span className="tabular w-14 shrink-0 text-right text-[13px] text-muted">{when(r.awardedAt, university.timezone)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        {canCreate && (
          <Card className="h-fit">
            <CardTitle>New badge</CardTitle>
            <ActionForm action={createBadgeAction} className="space-y-4">
              <input type="hidden" name="uni" value={uni} />
              <Field label="Name">
                <Input name="name" placeholder="Bookworm" required maxLength={60} />
              </Field>
              <Field label="Description" hint="Optional. Shown to students with the badge.">
                <Input name="description" placeholder="Finished 10 lessons" maxLength={200} />
              </Field>
              <div className="grid grid-cols-[1fr_110px] gap-3">
                <Field label="Counts">
                  <Select name="metric" defaultValue="lessons_completed">
                    {METRIC_KEYS.map((m) => (
                      <option key={m} value={m}>
                        {METRICS[m].label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Target">
                  <Input name="threshold" type="number" inputMode="numeric" min={1} defaultValue={10} required />
                </Field>
              </div>
              <IconPicker />
              <Field label="Applies to">
                <Select name="departmentId" defaultValue={scopes.universityWide ? "" : scopes.departments[0]?.id}>
                  {scopes.universityWide && <option value="">Whole university</option>}
                  {scopes.departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} only
                    </option>
                  ))}
                </Select>
              </Field>
              <SubmitButton>Create badge</SubmitButton>
              <p className="text-[12px] text-muted">Students who already qualify get the badge straight away.</p>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
