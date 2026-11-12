import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Field, Input, Notice, PageHeader, Select, Textarea, buttonClass, cx } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { setStatusAction, updateBasicsAction } from "@/modules/zinny-team-panel/actions";
import { Fact, NoAccess, PlanBadge, RenewalText, StatusBadge, UsageMeter } from "@/modules/zinny-team-panel/components/bits";
import { OpenInstitute } from "@/modules/zinny-team-panel/components/open-institute";
import { PersonActions } from "@/modules/zinny-team-panel/components/person-actions";
import { canSeeContentFlags, isSuperAdmin } from "@/modules/zinny-team-panel/lib/access";
import { COMMON_TIMEZONES, FLAG_LABEL, GST_STATES, MODULE_LABEL, STATE_NAME } from "@/modules/zinny-team-panel/lib/constants";
import { formatCount, formatDate, formatINR, timeAgo } from "@/modules/zinny-team-panel/lib/format";
import { invoicesForUniversity } from "@/modules/zinny-team-panel/services/billing";
import { activeSessions } from "@/modules/zinny-team-panel/services/support";
import { institutePeople } from "@/modules/zinny-team-panel/services/people";
import { getUniversity } from "@/modules/zinny-team-panel/services/universities";
import { ROLE_LABELS } from "@/server/authz/roles";

export const metadata = { title: "Institute" };

export default async function UniversityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.manage_universities")) return <NoAccess section="Institutes" />;
  const { id } = await params;
  const { created } = await searchParams;
  const data = await getUniversity(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { university: u, licence, usage, counts, flags, alerts, admin } = data;
  const can = {
    licences: canPlatform(actor, "platform.licences"),
    finance: canPlatform(actor, "platform.finance"),
    support: canPlatform(actor, "platform.support_mode"),
    flags: canSeeContentFlags(actor),
  };
  const invoices = can.finance ? await invoicesForUniversity(actor, u.id) : [];
  const suspended = u.status === "suspended";
  const superAdmin = isSuperAdmin(actor);
  const people = superAdmin ? await institutePeople(actor, u.id) : null;
  const inside = can.support && (await activeSessions(actor)).some((s) => s.staffUserId === actor.userId && s.universityId === u.id);

  return (
    <>
      <PageHeader
        title={u.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={u.status} />
            <PlanBadge name={data.planName} />
            <span>zinny.app/{u.slug}</span>
            <span className="text-faint">· on Zinny since {formatDate(u.createdAt.toISOString().slice(0, 10))}</span>
          </span>
        }
        actions={
          <>
            {can.support && <OpenInstitute universityId={u.id} slug={u.slug} inside={inside} />}
            {superAdmin && (
              <Link href={`/platform/people?university=${u.id}`} className={cx(buttonClass("secondary"), "whitespace-nowrap")}>
                People
              </Link>
            )}
            {can.support && (
              <Link href={`/platform/support/log?scope=all&university=${u.id}`} className={cx(buttonClass("secondary"), "whitespace-nowrap")}>
                Activity log
              </Link>
            )}
            {can.licences && (
              <Link href={`/platform/licences/${u.id}`} className={cx(buttonClass("primary"), "whitespace-nowrap")}>
                {licence ? "Edit licence" : "Set up licence"}
              </Link>
            )}
          </>
        }
      />

      {created && (
        <div className="mb-6">
          <Notice>
            {u.name} is ready.{" "}
            {admin?.invited ? `We've invited ${admin.name} (${admin.email}) to set a password and sign in.` : `${admin?.name ?? "Its admin"} already has a Zinny account and can sign in now.`}
          </Notice>
        </div>
      )}
      {suspended && (
        <div className="mb-6">
          <Notice tone="danger">
            This institute is suspended. Its people can&apos;t sign in to it and its licence warnings are paused until you reactivate it. The Zinny team can still get in
            through support mode.
          </Notice>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardTitle hint="Changes are saved in the institute's audit log with your name">Basics</CardTitle>
            <ActionForm action={updateBasicsAction} resetOnSuccess={false} className="space-y-4">
              <input type="hidden" name="universityId" value={u.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name">
                  <Input name="name" defaultValue={u.name} required minLength={2} maxLength={120} />
                </Field>
                <Field label="Web address" hint="Changing it breaks old links to this institute.">
                  <Input name="slug" defaultValue={u.slug} required minLength={2} maxLength={40} autoCapitalize="none" spellCheck={false} />
                </Field>
                <Field label="Time zone" hint="Class times and dates use this zone.">
                  <Input name="timezone" defaultValue={u.timezone} list="timezones" required />
                </Field>
                <Field label="Invoice prefix" hint="On its student invoices, 1 to 4 characters.">
                  <Input name="invoicePrefix" defaultValue={u.invoicePrefix} maxLength={4} required className="uppercase" />
                </Field>
                <Field label="Legal name" hint="As registered for GST">
                  <Input name="legalName" defaultValue={u.legalName ?? ""} maxLength={200} />
                </Field>
                <Field label="GSTIN" hint="15 characters, starting with the state code">
                  <Input name="gstin" defaultValue={u.gstin ?? ""} maxLength={15} className="uppercase" />
                </Field>
                <Field label="State" hint="Decides CGST and SGST, or IGST, on invoices">
                  <Select name="stateCode" defaultValue={u.stateCode} required>
                    {!STATE_NAME[u.stateCode] && <option value={u.stateCode}>{u.stateCode}</option>}
                    {GST_STATES.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.name} ({s.code})
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Address">
                <Textarea name="address" defaultValue={u.address ?? ""} maxLength={500} className="min-h-16" />
              </Field>
              <datalist id="timezones">
                {COMMON_TIMEZONES.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <SubmitButton>Save changes</SubmitButton>
            </ActionForm>
          </Card>

          {can.flags && (
            <Card>
              <CardTitle hint={<Link href={`/platform/content?tab=flagged&university=${u.id}`} className="hover:text-brand">Review queue</Link>}>Open content flags</CardTitle>
              {flags.length === 0 ? (
                <p className="text-[14px] text-muted">Content QA hasn&apos;t flagged anything here.</p>
              ) : (
                <ul className="space-y-3">
                  {flags.map((f) => (
                    <li key={f.id} className="rounded-2xl bg-gold-soft p-4 text-[14px]">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <Link href={`/platform/content/${f.courseId}`} className="font-medium text-ink hover:text-brand">
                          {f.courseTitle}
                        </Link>
                        <span className="text-[12.5px] text-gold-strong">
                          {FLAG_LABEL[f.category] ?? f.category} · {timeAgo(f.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 text-ink/80">{f.note}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {people && (
            <Card>
              <CardTitle
                hint={
                  <Link href={`/platform/people?university=${u.id}`} className="hover:text-brand">
                    All {formatCount(people.total)} people
                  </Link>
                }
              >
                People
              </CardTitle>
              {people.rows.length === 0 ? (
                <p className="text-[14px] text-muted">Nobody has a role here yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {people.rows.map((p) => (
                    <li key={p.userId} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <Link href={`/platform/people/${p.userId}`} className="block truncate text-[14px] font-medium hover:text-brand">
                          {p.name}
                        </Link>
                        <div className="truncate text-[12.5px] text-muted">
                          {p.roles.map((r) => ROLE_LABELS[r]).join(", ")} · {p.email}
                          {!p.canSignIn && " · no password yet"}
                        </div>
                      </div>
                      <PersonActions userId={p.userId} name={p.name} universityId={u.id} self={p.userId === actor.userId} />
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 text-[12.5px] text-muted">Admins and staff first. Setting a password and signing in as someone are logged here and in this institute&apos;s own log.</p>
            </Card>
          )}

          {can.finance && (
            <Card>
              <CardTitle hint={<Link href={`/platform/billing/new?university=${u.id}`} className="hover:text-brand">New invoice</Link>}>Zinny invoices</CardTitle>
              {invoices.length === 0 ? (
                <p className="text-[14px] text-muted">No invoices yet.</p>
              ) : (
                <ul className="divide-y divide-line text-[14px]">
                  {invoices.slice(0, 6).map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                      <Link href={`/platform/billing/${i.id}`} className="tabular whitespace-nowrap text-[13px] text-ink hover:text-brand">
                        {i.number}
                      </Link>
                      <span className="tabular">{formatINR(i.totalPaise)}</span>
                      {i.status === "paid" ? <Badge tone="brand">Paid</Badge> : i.overdue ? <Badge tone="danger">Overdue</Badge> : <Badge tone="gold">Due {formatDate(i.dueDate, { year: false })}</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardTitle>People and usage</CardTitle>
            <div className="space-y-4">
              <UsageMeter label="Students" used={usage.students} cap={licence?.studentCap ?? null} />
              <UsageMeter label="Staff" used={usage.staff} cap={licence?.staffCap ?? null} />
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4">
              <Fact label="Departments">{formatCount(counts.departments)}</Fact>
              <Fact label="Courses">
                {formatCount(counts.courses)} <span className="text-muted">({formatCount(counts.published)} published)</span>
              </Fact>
              <Fact label="Active enrolments">{formatCount(counts.activeEnrolments)}</Fact>
              <Fact label="Institute Admin">
                {admin ? (
                  <>
                    {admin.name}
                    <div className="truncate text-[12.5px] text-muted">{admin.email}</div>
                    {admin.invited && <Badge tone="gold">Invite not accepted yet</Badge>}
                  </>
                ) : null}
              </Fact>
            </dl>
          </Card>

          <Card>
            <CardTitle>Licence</CardTitle>
            {licence ? (
              <>
                <dl className="grid grid-cols-2 gap-4">
                  <Fact label="Plan">
                    <PlanBadge name={data.planName} />
                  </Fact>
                  <Fact label="Price before GST">
                    {licence.pricePaise === 0 ? "Free" : formatINR(licence.pricePaise - licence.discountPaise)}
                    {licence.discountPaise > 0 && <div className="text-[12.5px] text-muted">after {formatINR(licence.discountPaise)} discount</div>}
                  </Fact>
                  <Fact label="Term">
                    {formatDate(licence.startDate)} to {formatDate(licence.endDate)}
                    <div className="text-[12.5px]">
                      <RenewalText daysLeft={data.daysLeft} />
                    </div>
                  </Fact>
                </dl>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {licence.modules.length ? (
                    licence.modules.map((m) => <Badge key={m}>{MODULE_LABEL[m] ?? m}</Badge>)
                  ) : (
                    <span className="text-[13px] text-muted">No modules switched on.</span>
                  )}
                </div>
                {alerts.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {alerts.map((a) => (
                      <li key={a.id} className={a.level === "critical" ? "rounded-xl bg-danger-soft px-3 py-2 text-[13px] text-danger" : "rounded-xl bg-gold-soft px-3 py-2 text-[13px] text-gold-strong"}>
                        {a.title}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-[14px] text-muted">No licence yet, so usage and renewals aren&apos;t tracked.</p>
            )}
          </Card>

          <Card>
            <CardTitle>{suspended ? "Reactivate" : "Suspend"}</CardTitle>
            {suspended ? (
              <ActionForm action={setStatusAction} className="space-y-3" confirm={`Reactivate ${u.name}?`}>
                <input type="hidden" name="universityId" value={u.id} />
                <input type="hidden" name="status" value="active" />
                <p className="text-[14px] text-muted">Reactivating lets its people sign in again and turns its licence warnings back on. The change is logged with your name.</p>
                <Field label="Note" hint="Optional">
                  <Input name="reason" placeholder="Renewal signed on 28 Oct" maxLength={300} />
                </Field>
                <SubmitButton variant="secondary">Reactivate institute</SubmitButton>
              </ActionForm>
            ) : (
              <ActionForm action={setStatusAction} className="space-y-3" confirm={`Suspend ${u.name}?`}>
                <input type="hidden" name="universityId" value={u.id} />
                <input type="hidden" name="status" value="suspended" />
                <p className="text-[14px] text-muted">
                  Closes the institute&apos;s space, for example when a licence lapses unpaid. Its people can&apos;t sign in until you reactivate it, and
                  their work is kept. The Zinny team can still get in through support mode. Its licence warnings pause, and the reason goes into its
                  audit log with your name.
                </p>
                <Field label="Reason">
                  <Input name="reason" placeholder="Licence unpaid since 1 Oct" required minLength={5} maxLength={300} />
                </Field>
                <SubmitButton variant="danger">Suspend institute</SubmitButton>
              </ActionForm>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
