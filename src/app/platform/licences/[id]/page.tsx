import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, PageHeader } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { acknowledgeAlertAction, saveLicenceAction } from "@/modules/zinny-team-panel/actions";
import { BackLink, NoAccess, RenewalText, StatusBadge, UsageMeter } from "@/modules/zinny-team-panel/components/bits";
import { LicenceFields } from "@/modules/zinny-team-panel/components/licence-fields";
import { CAP_WARNING_RATIO, END_WARNING_DAYS, LICENSABLE_MODULES, PLAN_DEFAULTS, type Plan } from "@/modules/zinny-team-panel/lib/constants";
import { addDays, addMonths, formatDate, formatDateTime, todayIST } from "@/modules/zinny-team-panel/lib/format";
import { licenceFor } from "@/modules/zinny-team-panel/services/licences";

export const metadata = { title: "Licence" };

export default async function LicencePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.licences")) return <NoAccess section="Licences" who="Super Admins, Account Managers and Finance Admins" />;
  const { id } = await params;
  const data = await licenceFor(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { university: u, licence: l, usage, alerts } = data;
  const today = todayIST();
  const d = PLAN_DEFAULTS.standard;
  const initial = l
    ? { plan: l.plan as Plan, studentCap: l.studentCap, staffCap: l.staffCap, modules: l.modules, startDate: l.startDate, endDate: l.endDate, notes: l.notes ?? "" }
    : {
        plan: "standard" as Plan,
        studentCap: d.studentCap,
        staffCap: d.staffCap,
        modules: LICENSABLE_MODULES.map((m) => m.id),
        startDate: today,
        endDate: addDays(addMonths(today, d.months), -1),
        notes: "",
      };

  return (
    <>
      <BackLink href="/platform/licences">Licences</BackLink>
      <PageHeader
        title={`${u.name} licence`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={u.status} />
            {l ? (
              <span>
                Last changed {formatDateTime(l.updatedAt)}. Ends {formatDate(l.endDate)} (<RenewalText daysLeft={data.daysLeft} />)
              </span>
            ) : (
              <span>No licence yet. Usage and renewals are tracked once you save one.</span>
            )}
          </span>
        }
        actions={
          canPlatform(actor, "platform.manage_universities") ? (
            <Link href={`/platform/universities/${u.id}`} className="inline-flex h-10 items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:border-brand/40">
              University details
            </Link>
          ) : undefined
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardTitle>{l ? "Edit licence" : "Set up licence"}</CardTitle>
          <ActionForm action={saveLicenceAction} resetOnSuccess={false} className="space-y-5">
            <input type="hidden" name="universityId" value={u.id} />
            <LicenceFields initial={initial} />
            <SubmitButton>{l ? "Save licence" : "Create licence"}</SubmitButton>
          </ActionForm>
        </Card>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardTitle hint="People with an active role right now">Usage</CardTitle>
            <div className="space-y-4">
              <UsageMeter label="Students" used={usage.students} cap={l?.studentCap ?? null} />
              <UsageMeter label="Staff" used={usage.staff} cap={l?.staffCap ?? null} />
            </div>
            <p className="mt-4 text-[12.5px] text-muted">
              Students hold the student role. Staff hold an administration or teaching role. A person with several roles counts once.
            </p>
          </Card>

          <Card>
            <CardTitle>Warnings</CardTitle>
            {alerts.length === 0 ? (
              <p className="text-[14px] text-muted">
                No warnings. One appears at {Math.round(CAP_WARNING_RATIO * 100)}% of a cap and {END_WARNING_DAYS} days before the licence ends.
              </p>
            ) : (
              <ul className="space-y-3">
                {alerts.map((a) => (
                  <li key={a.id} className={a.level === "critical" ? "rounded-2xl bg-danger-soft p-4" : "rounded-2xl bg-gold-soft p-4"}>
                    <div className="flex flex-wrap items-start justify-between gap-2 text-[14px]">
                      <div>
                        <div className="font-medium text-ink">{a.title}</div>
                        <div className={a.level === "critical" ? "text-danger" : "text-gold-strong"}>{a.body}</div>
                      </div>
                      {a.acknowledgedAt ? (
                        <Badge>Handled</Badge>
                      ) : (
                        <ActionForm action={acknowledgeAlertAction}>
                          <input type="hidden" name="alertId" value={a.id} />
                          <SubmitButton size="sm" variant="secondary">
                            Mark as handled
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
