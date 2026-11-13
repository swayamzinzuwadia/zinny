import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar, Badge, Card, CardTitle, Empty, Table, Td, buttonClass, cx } from "@/components/ui";
import { ROLE_LABELS } from "@/server/authz/roles";
import { platformContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { Fact, NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { OpenInstitute } from "@/modules/zinny-team-panel/components/open-institute";
import { SetPasswordForm } from "@/modules/zinny-team-panel/components/set-password-form";
import { SignInAsButton } from "@/modules/zinny-team-panel/components/sign-in-as-button";
import { PLATFORM_ROLE_LABELS, isPlatformRole } from "@/modules/zinny-team-panel/lib/constants";
import { ViewAsButton } from "@/modules/zinny-team-panel/components/view-as-button";
import { isSuperAdmin } from "@/modules/zinny-team-panel/lib/access";
import { dataRowHref } from "@/modules/zinny-team-panel/lib/data-links";
import { formatDate, formatDateTime, formatINR, timeAgo } from "@/modules/zinny-team-panel/lib/format";
import { personDetail } from "@/modules/zinny-team-panel/services/people";
import { actionLabel, activeSessions } from "@/modules/zinny-team-panel/services/support";
import { LEARNER_ROLES } from "@/modules/zinny-team-panel/services/view-as";
import type { RoleName } from "@/db/schema";

export const metadata = { title: "Person" };

const LEARNER = new Set<RoleName>(LEARNER_ROLES);

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await platformContext();
  if (!isSuperAdmin(actor)) return <NoAccess section="People" who="Only Super Admins" />;
  const { id } = await params;
  const data = await personDetail(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { person: p, roles, courses, payments, activity } = data;
  const inside = new Set((await activeSessions(actor)).filter((s) => s.staffUserId === actor.userId).map((s) => s.universityId));
  const now = new Date();
  const institutes = [...new Map(roles.filter((r) => r.universityId).map((r) => [r.universityId!, r])).values()];
  const paid = payments.filter((o) => o.paidAt).reduce((n, o) => n + o.totalPaise, 0);
  const self = p.id === actor.userId;
  const teamRoles = roles.filter((r) => !r.universityId && !r.revokedAt && (!r.endsAt || r.endsAt > now));

  return (
    <>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={p.name} size={56} />
          <div className="min-w-0">
            <h1 className="truncate text-[26px] font-semibold tracking-tight">{p.name}</h1>
            <p className="truncate text-[14px] text-muted">{p.email}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-start justify-end gap-2">
          {!self && <SignInAsButton userId={p.id} name={p.name} variant="primary" />}
          <SetPasswordForm userId={p.id} name={p.name} />
          <Link href={dataRowHref("users", [p.id])} className={cx(buttonClass("secondary"), "whitespace-nowrap")}>
            Open in Data
          </Link>
        </div>
      </header>
      <p className="-mt-2 mb-6 max-w-3xl text-[13px] text-muted">
        <b className="font-medium text-ink">Sign in as</b> makes you this person, with everything they can do, for up to 2 hours. <b className="font-medium text-ink">View as, read only</b> only looks
        at their learner app and changes nothing. Both are logged here and in their institute&apos;s log.
      </p>

      <div className="grid gap-6 grid-cols-1 xl:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardTitle>Institutes and roles</CardTitle>
            {teamRoles.length > 0 && (
              <div className="mb-4 rounded-2xl bg-canvas p-4">
                <div className="font-medium">Zinny team</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {teamRoles.map((r) => (
                    <Badge key={r.id} tone="brand">
                      {r.customRoleName ?? (isPlatformRole(r.role) ? PLATFORM_ROLE_LABELS[r.role] : ROLE_LABELS[r.role])}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {institutes.length === 0 ? (
              <p className="text-[14px] text-muted">{teamRoles.length ? "Not at any institute." : "Not at any institute. This is a marketplace account."}</p>
            ) : (
              <ul className="space-y-4">
                {institutes.map((u) => (
                  <li key={u.universityId} className="rounded-2xl bg-canvas p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <Link href={`/platform/institutes/${u.universityId}`} className="font-medium hover:text-brand">
                        {u.universityName}
                      </Link>
                      <span className="flex flex-wrap gap-2">
                        {roles.some((r) => r.universityId === u.universityId && !r.revokedAt && LEARNER.has(r.role)) && (
                          <ViewAsButton universityId={u.universityId!} userId={p.id} label={roles.some((r) => r.universityId === u.universityId && r.role === "parent") ? "View as parent, read only" : "View as, read only"} />
                        )}
                        {!self && roles.some((r) => r.universityId === u.universityId && !r.revokedAt) && <SignInAsButton userId={p.id} name={p.name} universityId={u.universityId} />}
                        <OpenInstitute universityId={u.universityId!} slug={u.universitySlug!} inside={inside.has(u.universityId!)} size="sm" />
                      </span>
                    </div>
                    <ul className="mt-3 space-y-1.5 text-[14px]">
                      {roles
                        .filter((r) => r.universityId === u.universityId)
                        .map((r) => {
                          const ended = !!r.revokedAt || (!!r.endsAt && r.endsAt <= now);
                          return (
                            <li key={r.id} className="flex flex-wrap items-center gap-2">
                              <Badge tone={ended ? "neutral" : "brand"}>{r.customRoleName ?? ROLE_LABELS[r.role]}</Badge>
                              {r.departmentName && <span className="text-muted">{r.departmentName}</span>}
                              {r.batchName && <span className="text-muted">{r.batchName}</span>}
                              {ended && <span className="text-[12.5px] text-faint">Ended</span>}
                              {!ended && r.endsAt && <span className="text-[12.5px] text-muted">Until {formatDate(r.endsAt.toISOString().slice(0, 10))}</span>}
                            </li>
                          );
                        })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <section>
            <h2 className="mb-3 text-[17px] font-medium">Courses</h2>
            {courses.length === 0 ? (
              <Empty title="No courses yet" />
            ) : (
              <Table head={["Course", "Batch", "Institute", "Status", "Enrolled"]}>
                {courses.map((c) => (
                  <tr key={c.id}>
                    <Td className="font-medium">{c.courseTitle}</Td>
                    <Td>{c.batchName}</Td>
                    <Td>{c.universityName}</Td>
                    <Td>
                      <Badge tone={c.status === "active" ? "brand" : "neutral"}>{c.status}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap tabular">{c.enrolledAt ? formatDate(c.enrolledAt.toISOString().slice(0, 10)) : "Not yet"}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-[17px] font-medium">Payments</h2>
            {payments.length === 0 ? (
              <Empty title="No payments yet" />
            ) : (
              <Table head={["Course", "Invoice", "Institute", "Amount", "Status", "Paid"]}>
                {payments.map((o) => (
                  <tr key={o.id}>
                    <Td className="font-medium">{o.courseTitle}</Td>
                    <Td className="tabular">{o.invoiceNumber ?? <span className="text-faint">None</span>}</Td>
                    <Td>{o.universityName}</Td>
                    <Td className="whitespace-nowrap tabular">{formatINR(o.totalPaise)}</Td>
                    <Td>
                      <Badge tone={o.status === "paid" ? "brand" : "neutral"}>{o.status}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap tabular">{o.paidAt ? formatDate(o.paidAt.toISOString().slice(0, 10)) : "Not paid"}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <Card>
            <CardTitle>Details</CardTitle>
            <dl className="grid gap-4">
              <Fact label="Email">{p.email}</Fact>
              <Fact label="Mobile">{p.phone}</Fact>
              <Fact label="Account">{p.canSignIn ? "Active, has a password" : "Invited, hasn't set a password"}</Fact>
              <Fact label="Joined Zinny">{formatDateTime(p.joinedAt)}</Fact>
              <Fact label="Total paid">{formatINR(paid)}</Fact>
            </dl>
          </Card>

          <Card>
            <CardTitle>Recent activity</CardTitle>
            {activity.length === 0 ? (
              <p className="text-[14px] text-muted">Nothing logged yet.</p>
            ) : (
              <ul className="space-y-3 text-[14px]">
                {activity.map((a) => (
                  <li key={a.id}>
                    <div>{actionLabel(a.action)}</div>
                    <div className="text-[12.5px] text-muted">
                      {a.universityName ? `${a.universityName} · ` : ""}
                      {timeAgo(a.at, now)}
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
