import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Field, Input, PageHeader, Select, Stat, cx } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { acknowledgeAlertAction, startSupportAction } from "@/modules/zinny-team-panel/actions";
import { canSeeContentFlags } from "@/modules/zinny-team-panel/lib/access";
import { PARTNER_STATUS_LABELS, PARTNER_STATUSES } from "@/modules/zinny-team-panel/lib/constants";
import { formatCount, formatDate, formatINR, formatINRShort, timeAgo, timeUntil, todayIST, ZINNY_TZ } from "@/modules/zinny-team-panel/lib/format";
import { analytics } from "@/modules/zinny-team-panel/services/analytics";
import { overdueInvoices } from "@/modules/zinny-team-panel/services/billing";
import { reviewCounts } from "@/modules/zinny-team-panel/services/content";
import { listAlerts, listLicences } from "@/modules/zinny-team-panel/services/licences";
import { listPartners } from "@/modules/zinny-team-panel/services/partners";
import { activeSessions, activityLog, actionLabel, supportPicker } from "@/modules/zinny-team-panel/services/support";

export const metadata = { title: "Home" };

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: ZINNY_TZ, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function PlatformHome() {
  const actor = await platformContext();
  const today = todayIST();
  const can = {
    licences: canPlatform(actor, "platform.licences"),
    support: canPlatform(actor, "platform.support_mode"),
    flags: canSeeContentFlags(actor),
    review: canPlatform(actor, "platform.content_review"),
    finance: canPlatform(actor, "platform.finance"),
    partners: canPlatform(actor, "platform.partners"),
    analytics: canPlatform(actor, "platform.view_analytics"),
  };

  const [alerts, licences, sessions, log, picker, review, overdue, partners, stats] = await Promise.all([
    can.licences ? listAlerts(actor, { handled: false }) : [],
    can.licences ? listLicences(actor) : [],
    can.support ? activeSessions(actor) : [],
    can.support ? activityLog(actor, { scope: "support" }, 1) : null,
    can.support ? supportPicker(actor) : null,
    can.flags ? reviewCounts(actor) : null,
    can.finance ? overdueInvoices(actor) : [],
    can.partners ? listPartners(actor) : null,
    can.analytics ? analytics(actor, { weeks: 4, months: 3 }) : null,
  ]);
  const unlicensed = licences.filter((l) => !l.licence && l.status === "active");
  const showNeeds = can.licences || can.flags || can.finance;
  const needsCount = alerts.length + unlicensed.length + overdue.length + (review ? review.openFlags + (can.review ? review.toReview : 0) : 0);

  const summary = [
    alerts.length ? `${alerts.length} licence warning${alerts.length === 1 ? "" : "s"}` : "",
    sessions.length ? `${sessions.length} in support mode now` : "",
    can.review && review?.toReview ? `${review.toReview} course${review.toReview === 1 ? "" : "s"} to review` : "",
    overdue.length ? `${overdue.length} overdue invoice${overdue.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${actor.name.split(" ")[0]}`}
        subtitle={summary.length ? summary.join(" · ") : "Everything is calm across the universities right now."}
      />

      <div className="grid gap-6 xl:grid-cols-[1.55fr_1fr]">
        <div className="min-w-0 space-y-6">
          {showNeeds && (
            <Card>
              <CardTitle hint={needsCount ? `${needsCount} item${needsCount === 1 ? "" : "s"}` : undefined}>Needs attention</CardTitle>
              {needsCount === 0 ? (
                <p className="rounded-2xl bg-canvas px-4 py-6 text-center text-[14px] text-muted">Nothing needs attention right now.</p>
              ) : (
                <div className="space-y-3">
                  {alerts.map((a) => (
                    <div key={a.id} className={cx("flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4", a.level === "critical" ? "bg-danger-soft" : "bg-gold-soft")}>
                      <div className="min-w-0 text-[14px]">
                        <div className="font-medium text-ink">{a.title}</div>
                        <div className={a.level === "critical" ? "text-danger" : "text-gold-strong"}>{a.body}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Link href={`/platform/licences/${a.universityId}`} className="text-[13px] font-medium text-brand hover:underline">
                          Open licence
                        </Link>
                        <ActionForm action={acknowledgeAlertAction} className="contents">
                          <input type="hidden" name="alertId" value={a.id} />
                          <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
                            Mark as handled
                          </SubmitButton>
                        </ActionForm>
                      </div>
                    </div>
                  ))}
                  {unlicensed.map((u) => (
                    <div key={u.universityId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-canvas p-4 text-[14px]">
                      <div>
                        <div className="font-medium">{u.universityName} has no licence</div>
                        <div className="text-muted">Set its plan, caps and term so usage and renewals are tracked.</div>
                      </div>
                      <Link href={`/platform/licences/${u.universityId}`} className="text-[13px] font-medium text-brand hover:underline">
                        Set up licence
                      </Link>
                    </div>
                  ))}
                  {overdue.map((i) => (
                    <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-danger-soft p-4 text-[14px]">
                      <div>
                        <div className="font-medium text-ink">
                          {i.universityName} owes {formatINR(i.totalPaise)}
                        </div>
                        <div className="text-danger">
                          Invoice {i.number} was due on {formatDate(i.dueDate)}.
                        </div>
                      </div>
                      <Link href={`/platform/billing/${i.id}`} className="text-[13px] font-medium text-brand hover:underline">
                        Open invoice
                      </Link>
                    </div>
                  ))}
                  {review && review.openFlags > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-canvas p-4 text-[14px]">
                      <div>
                        <div className="font-medium">
                          {review.openFlags} open content flag{review.openFlags === 1 ? "" : "s"} on {review.flaggedCourses} course{review.flaggedCourses === 1 ? "" : "s"}
                        </div>
                        <div className="text-muted">The university needs to fix these. Account Managers follow up.</div>
                      </div>
                      <Link href="/platform/content?tab=flagged" className="text-[13px] font-medium text-brand hover:underline">
                        Open flags
                      </Link>
                    </div>
                  )}
                  {can.review && review && review.toReview > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-canvas p-4 text-[14px]">
                      <div>
                        <div className="font-medium">
                          {review.toReview} published course{review.toReview === 1 ? "" : "s"} waiting for review
                        </div>
                        <div className="text-muted">Newest first, across every university.</div>
                      </div>
                      <Link href="/platform/content" className="text-[13px] font-medium text-brand hover:underline">
                        Open review queue
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}

          {can.support && (
            <Card>
              <CardTitle hint={<Link href="/platform/support" className="hover:text-brand">All sessions</Link>}>In support mode now</CardTitle>
              {sessions.length === 0 ? (
                <p className="rounded-2xl bg-canvas px-4 py-6 text-center text-[14px] text-muted">Nobody from the Zinny team is inside a university.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {sessions.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0 text-[14px]">
                        <div className="flex items-center gap-2">
                          <span className="now-dot inline-block h-2 w-2 rounded-full bg-gold" aria-hidden />
                          <span className="font-medium">{s.staffName}</span>
                          <span className="text-muted">in</span>
                          <span className="font-medium">{s.universityName}</span>
                        </div>
                        <div className="mt-0.5 text-[13px] text-muted">
                          {s.reason} · started {timeAgo(s.startedAt)} · ends in {timeUntil(s.expiresAt)} · {formatCount(s.actions)} change{s.actions === 1 ? "" : "s"}
                        </div>
                      </div>
                      {s.staffUserId === actor.userId ? (
                        <Badge tone="gold">You</Badge>
                      ) : (
                        <Link href={`/platform/support#session-${s.id}`} className="text-[13px] font-medium text-brand hover:underline">
                          Force-end
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {log && (
            <Card>
              <CardTitle hint={<Link href="/platform/support/log" className="hover:text-brand">Full activity log</Link>}>Recent support activity</CardTitle>
              {log.entries.length === 0 ? (
                <p className="rounded-2xl bg-canvas px-4 py-6 text-center text-[14px] text-muted">No support sessions yet.</p>
              ) : (
                <ul className="divide-y divide-line text-[14px]">
                  {log.entries.slice(0, 8).map((e) => (
                    <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <span className="font-medium">{e.actorName ?? "Zinny system"}</span> <span className="text-muted">{actionLabel(e.action).toLowerCase()}</span>
                        {e.universityName && <span className="text-muted"> at {e.universityName}</span>}
                        <div className="truncate text-[12.5px] text-faint">
                          <code className="font-mono">{e.action}</code>
                          {e.sessionReason ? ` · ${e.sessionReason}` : ""}
                        </div>
                      </div>
                      <span className="whitespace-nowrap text-[12.5px] text-muted">{timeAgo(e.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          {picker && (
            <Card>
              <CardTitle>Start a support session</CardTitle>
              {picker.universities.length === 0 ? (
                <p className="text-[14px] text-muted">There are no universities yet.</p>
              ) : (
                <ActionForm action={startSupportAction} className="space-y-3" resetOnSuccess={false}>
                  <Field label="University">
                    <Select name="universityId" defaultValue={picker.lastUniversityId ?? undefined} required>
                      {picker.universities.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                          {u.status === "suspended" ? " (suspended)" : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Reason" hint="Logged with every change you make inside. Sessions end after 2 hours.">
                    <Input name="reason" placeholder="Ticket 4512: help with batches" required minLength={5} maxLength={300} />
                  </Field>
                  <SubmitButton pendingText="Opening…">Enter support mode</SubmitButton>
                </ActionForm>
              )}
            </Card>
          )}

          {stats && (
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Universities" value={formatCount(stats.universities.active)} hint={stats.universities.suspended ? `${stats.universities.suspended} suspended` : "All active"} />
              <Stat label="Active students" value={formatCount(stats.activeStudents)} hint="With an active enrolment" />
              <Stat label="Enrolments, 4 weeks" value={formatCount(stats.weeks.reduce((s, w) => s + w.enrolments, 0))} hint={`${formatCount(stats.weeks.at(-1)?.enrolments ?? 0)} this week`} />
              <Stat label="Collected this month" value={formatINRShort(stats.months.at(-1)?.paise ?? 0)} hint="By all universities" />
            </div>
          )}

          {partners && (
            <Card>
              <CardTitle hint={<Link href="/platform/partners" className="hover:text-brand">All partners</Link>}>Partners</CardTitle>
              <dl className="grid grid-cols-3 gap-3">
                {PARTNER_STATUSES.filter((s) => s !== "ended").map((s) => (
                  <div key={s} className="rounded-2xl bg-canvas px-3 py-2.5">
                    <dt className="text-[12px] text-muted">{PARTNER_STATUS_LABELS[s]}</dt>
                    <dd className="tabular text-[20px] font-semibold">{formatCount(partners.byStatus[s] ?? 0)}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}

          {can.licences && (
            <p className="px-1 text-[12.5px] text-muted">
              Licence warnings are checked every hour, and straight away when a licence changes. Today is {formatDate(today)}.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
