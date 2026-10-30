import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar, Badge, Card, CardTitle, Empty, Table, Td } from "@/components/ui";
import { ROLE_LABELS } from "@/server/authz/roles";
import { platformContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { Fact, NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { OpenInstitute } from "@/modules/zinny-team-panel/components/open-institute";
import { isSuperAdmin } from "@/modules/zinny-team-panel/lib/access";
import { formatDate, formatDateTime, formatINR, timeAgo } from "@/modules/zinny-team-panel/lib/format";
import { personDetail } from "@/modules/zinny-team-panel/services/people";
import { actionLabel, activeSessions } from "@/modules/zinny-team-panel/services/support";

export const metadata = { title: "Person" };

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

  return (
    <>
      <header className="mb-6 flex items-center gap-4">
        <Avatar name={p.name} size={56} />
        <div className="min-w-0">
          <h1 className="truncate text-[26px] font-semibold tracking-tight">{p.name}</h1>
          <p className="truncate text-[14px] text-muted">{p.email}</p>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardTitle>Institutes and roles</CardTitle>
            {institutes.length === 0 ? (
              <p className="text-[14px] text-muted">Not at any institute.</p>
            ) : (
              <ul className="space-y-4">
                {institutes.map((u) => (
                  <li key={u.universityId} className="rounded-2xl bg-canvas p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <Link href={`/platform/universities/${u.universityId}`} className="font-medium hover:text-brand">
                        {u.universityName}
                      </Link>
                      <OpenInstitute universityId={u.universityId!} slug={u.universitySlug!} inside={inside.has(u.universityId!)} variant="secondary" />
                    </div>
                    <ul className="mt-3 space-y-1.5 text-[14px]">
                      {roles
                        .filter((r) => r.universityId === u.universityId)
                        .map((r) => {
                          const ended = !!r.revokedAt || (!!r.endsAt && r.endsAt <= now);
                          return (
                            <li key={r.id} className="flex flex-wrap items-center gap-2">
                              <Badge tone={ended ? "neutral" : "brand"}>{ROLE_LABELS[r.role]}</Badge>
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
