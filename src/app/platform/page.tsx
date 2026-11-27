import Link from "next/link";
import type { ReactNode } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { DateRangeFilter } from "@/components/date-range-filter";
import { describeSpan, resolveRange } from "@/components/date-range";
import { Badge, Card, CardTitle, Field, Input, PageHeader, Select, Stat, cx, ActionLink } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { acknowledgeAlertAction, startSupportAction } from "@/modules/zinny-team-panel/actions";
import { canSeeContentFlags } from "@/modules/zinny-team-panel/lib/access";
import { BarChart } from "@/modules/zinny-team-panel/components/bar-chart";
import { RangeStat } from "@/modules/zinny-team-panel/components/range-stat";
import { daysLeftText } from "@/modules/zinny-team-panel/components/licence-reminder";
import { formatCount, formatDate, formatINR, formatINRShort, formatRupees, plural, timeAgo, timeUntil, todayIST, ZINNY_TZ } from "@/modules/zinny-team-panel/lib/format";
import { billingOverview } from "@/modules/zinny-team-panel/services/automation";
import { overview } from "@/modules/zinny-team-panel/services/analytics";
import { overdueInvoices } from "@/modules/zinny-team-panel/services/billing";
import { reviewCounts } from "@/modules/zinny-team-panel/services/content";
import { listAlerts, listLicences } from "@/modules/zinny-team-panel/services/licences";
import { activeSessions, activityLog, actionLabel, supportPicker } from "@/modules/zinny-team-panel/services/support";
import { licencesEndingSoon } from "@/modules/zinny-team-panel/services/universities";

export const metadata = { title: "Overview" };

/** "Good morning" for the hour in India, where the Zinny team works. */
function greeting(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: ZINNY_TZ, hour: "2-digit", hour12: false }).format(now)) % 24;
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

type Search = { range?: string; from?: string; to?: string };

export default async function PlatformHome({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await platformContext();
  const today = todayIST();
  const range = resolveRange(await searchParams, today);
  const can = {
    licences: canPlatform(actor, "platform.licences"),
    support: canPlatform(actor, "platform.support_mode"),
    flags: canSeeContentFlags(actor),
    review: canPlatform(actor, "platform.content_review"),
    finance: canPlatform(actor, "platform.finance"),
    analytics: canPlatform(actor, "platform.view_analytics"),
  };

  const [allAlerts, licences, ending, sessions, log, picker, review, overdue, stats, billing] = await Promise.all([
    can.licences ? listAlerts(actor, { handled: false }) : [],
    can.licences ? listLicences(actor) : [],
    can.licences ? licencesEndingSoon(actor, 30, today) : [],
    can.support ? activeSessions(actor) : [],
    can.support ? activityLog(actor, { scope: "support" }, 1) : null,
    can.support ? supportPicker(actor) : null,
    can.flags ? reviewCounts(actor) : null,
    can.finance ? overdueInvoices(actor) : [],
    can.analytics ? overview(actor, range, today) : null,
    can.licences || can.finance ? billingOverview(actor) : null,
  ]);
  // Licence end dates have their own list below, with the days left and a renew action.
  const alerts = can.licences ? allAlerts.filter((a) => a.kind !== "licence_end") : allAlerts;
  const unlicensed = licences.filter((l) => !l.licence && l.status === "active");
  const showNeeds = can.licences || can.flags || can.finance;
  const showFlags = !!review && review.openFlags > 0;
  const showToReview = can.review && !!review && review.toReview > 0;
  // One per row below, so the count matches what you see.
  const needsCount = alerts.length + unlicensed.length + overdue.length + (showFlags ? 1 : 0) + (showToReview ? 1 : 0);

  const summary = [
    alerts.length ? `${alerts.length} licence warning${alerts.length === 1 ? "" : "s"}` : "",
    unlicensed.length ? `${unlicensed.length} without a licence` : "",
    sessions.length ? `${sessions.length} in support mode now` : "",
    showFlags ? `${review!.openFlags} open content flag${review!.openFlags === 1 ? "" : "s"}` : "",
    showToReview ? `${review!.toReview} course${review!.toReview === 1 ? "" : "s"} to review` : "",
    overdue.length ? `${overdue.length} overdue invoice${overdue.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  // "Nothing needs attention" is only true for someone who can see every kind of warning.
  const seesEverything = can.licences && can.support && can.flags && can.review && can.finance;
  const showSide = !!picker || can.support;

  const firstName = actor.name.split(/\s+/)[0];
  const asOf = `${describeSpan(range.from, range.to)}`;
  const compare = `${describeSpan(range.prev.from, range.prev.to)}`;

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        subtitle={summary.length ? summary.join(" · ") : seesEverything ? "Nothing needs attention across the institutes right now." : undefined}
      />

      {stats && (
        <section aria-label="Numbers for the chosen dates" className="mb-6">
          <DateRangeFilter basePath="/platform" active={range} today={today} />
          <p className="mt-3 mb-4 text-[13px] text-muted">
            Showing <span className="font-medium text-ink">{asOf}</span>, compared with {compare}.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <RangeStat label="New institutes" value={formatCount(stats.current.newInstitutes)} now={stats.current.newInstitutes} before={stats.previous.newInstitutes} format={formatCount} />
            <RangeStat label="New learners" value={formatCount(stats.current.newLearners)} now={stats.current.newLearners} before={stats.previous.newLearners} format={formatCount} />
            <RangeStat label="Enrolments" value={formatCount(stats.current.enrolments)} now={stats.current.enrolments} before={stats.previous.enrolments} format={formatCount} />
            <RangeStat
              label="Collected"
              value={formatINRShort(stats.current.collectedPaise)}
              now={stats.current.collectedPaise}
              before={stats.previous.collectedPaise}
              format={formatINRShort}
              hint={`${formatCount(stats.current.sales)} sale${stats.current.sales === 1 ? "" : "s"}, was ${formatINRShort(stats.previous.collectedPaise)}`}
            />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardTitle hint={`By ${stats.granularity}`}>Enrolments</CardTitle>
              <BarChart
                title={`Enrolments by ${stats.granularity}, ${asOf}`}
                emptyText="No enrolments in these dates."
                bars={stats.series.map((b, i) => ({ key: b.key, label: b.label, value: b.enrolments, display: formatCount(b.enrolments), current: i === stats.series.length - 1 && range.to === today }))}
              />
            </Card>
            <Card>
              <CardTitle hint={`By ${stats.granularity}`}>Collected</CardTitle>
              <BarChart
                title={`Collected by ${stats.granularity}, ${asOf}`}
                emptyText="No payments in these dates."
                bars={stats.series.map((b, i) => ({ key: b.key, label: b.label, value: b.paise, display: formatINRShort(b.paise), current: i === stats.series.length - 1 && range.to === today }))}
              />
            </Card>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Stat label="Active institutes" value={formatCount(stats.now.activeInstitutes)} hint={stats.now.suspended ? `${stats.now.suspended} suspended` : "None suspended"} />
            <Stat label="Active students" value={formatCount(stats.now.activeStudents)} hint={`Of ${formatCount(stats.now.students)} students`} />
            <Stat label="Licences running" value={formatCount(stats.now.licencesRunning)} hint="As of today" />
          </div>
          <p className="mt-2 text-[12.5px] text-faint">The last three show today&apos;s position, whatever dates are chosen.</p>
        </section>
      )}

      <div className={cx("grid grid-cols-1 items-start gap-4", showNeeds && showSide && "xl:grid-cols-[1.55fr_1fr]")}>
        {showNeeds && (
          <div className="min-w-0 space-y-4">
            {can.licences && <EndingLicences items={ending} />}
            <Card className="min-w-0">
              <CardTitle hint={needsCount ? `${needsCount} item${needsCount === 1 ? "" : "s"}` : undefined}>Needs attention</CardTitle>
              {needsCount === 0 ? (
                <p className="text-[14px] text-muted">Nothing needs attention right now.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {alerts.map((a) => (
                    <NeedsRow
                      key={a.id}
                      dot={a.level === "critical" ? "danger" : "gold"}
                      title={a.title}
                      detail={a.body}
                      action={
                        <>
                          <ActionLink href={`/platform/licences/${a.universityId}`}>
                            Open licence
                          </ActionLink>
                          <ActionForm action={acknowledgeAlertAction} className="contents">
                            <input type="hidden" name="alertId" value={a.id} />
                            <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
                              Mark as handled
                            </SubmitButton>
                          </ActionForm>
                        </>
                      }
                    />
                  ))}
                  {unlicensed.map((u) => (
                    <NeedsRow
                      key={u.universityId}
                      title={`${u.universityName} has no licence`}
                      detail="Set its plan, caps and term so usage and renewals are tracked."
                      action={<RowLink href={`/platform/licences/${u.universityId}`}>Set up licence</RowLink>}
                    />
                  ))}
                  {overdue.map((i) => (
                    <NeedsRow
                      key={i.id}
                      title={
                        <>
                          {i.universityName} owes <span className="tabular text-danger">{formatINR(i.totalPaise)}</span>
                        </>
                      }
                      detail={`Invoice ${i.number} was due on ${formatDate(i.dueDate)}.`}
                      action={<RowLink href={`/platform/billing/${i.id}`}>Open invoice</RowLink>}
                    />
                  ))}
                  {showFlags && review && (
                    <NeedsRow
                      title={`${review.openFlags} open content flag${review.openFlags === 1 ? "" : "s"} on ${review.flaggedCourses} course${review.flaggedCourses === 1 ? "" : "s"}`}
                      detail="The institute needs to fix these. Account Managers follow up."
                      action={<RowLink href="/platform/content?tab=flagged">Open flags</RowLink>}
                    />
                  )}
                  {showToReview && review && (
                    <NeedsRow
                      title={`${review.toReview} published course${review.toReview === 1 ? "" : "s"} waiting for review`}
                      detail="Newest first, across every institute."
                      action={<RowLink href="/platform/content">Open review queue</RowLink>}
                    />
                  )}
                </ul>
              )}
            </Card>
            {billing && (
              <Link
                href={can.finance ? "/platform/billing" : "/platform/plans"}
                className="group flex flex-wrap items-center gap-x-5 gap-y-1 rounded-2xl border border-line bg-surface px-5 py-3.5 text-[14px] [transition-property:border-color] duration-150 hover:border-brand/40"
              >
                <span className="font-medium text-ink">Billing</span>
                {billing.plans !== null && <span className="tabular text-muted">{plural(billing.plans, "plan")}</span>}
                {billing.renewing !== null && (
                  <span className="tabular text-muted">{billing.renewing === 0 ? "No renewals" : plural(billing.renewing, "renewal")} due in 30 days</span>
                )}
                {billing.unpaidPaise !== null && (
                  <span className="tabular text-muted">{billing.unpaidPaise === 0 ? "Nothing unpaid" : `${formatRupees(billing.unpaidPaise)} unpaid`}</span>
                )}
                <span className="ml-auto text-[13px] font-medium text-brand group-hover:underline">Open</span>
              </Link>
            )}
          </div>
        )}

        {showSide && (
          <div className="min-w-0 space-y-4">
            {picker && (
              <Card>
                <CardTitle>Start a support session</CardTitle>
                {picker.universities.length === 0 ? (
                  <p className="text-[14px] text-muted">There are no institutes yet.</p>
                ) : (
                  <ActionForm action={startSupportAction} className="space-y-3" resetOnSuccess={false}>
                    <Field label="Institute">
                      <Select name="universityId" defaultValue="" required>
                        <option value="" disabled>
                          Pick an institute
                        </option>
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

            {can.support && (
              <Card>
                <CardTitle
                  hint={
                    <Link href="/platform/support" className="hover:text-brand">
                      All sessions
                    </Link>
                  }
                >
                  Support
                </CardTitle>
                <h3 className="text-[13px] text-muted">In support mode now</h3>
                {sessions.length === 0 ? (
                  <p className="mt-1 text-[14px]">Nobody from the Zinny team is inside an institute.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {sessions.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                        <div className="min-w-0 text-[14px]">
                          <div className="flex items-center gap-2">
                            <span className="now-dot inline-block h-2 w-2 shrink-0 rounded-full bg-gold" aria-hidden />
                            <span>
                              <span className="font-medium">{s.staffName}</span> <span className="text-muted">in</span> {s.universityName}
                            </span>
                          </div>
                          <div className="mt-0.5 text-[13px] text-muted">
                            {s.reason} · started {timeAgo(s.startedAt)} · ends in {timeUntil(s.expiresAt)} · {formatCount(s.actions)} change{s.actions === 1 ? "" : "s"}
                          </div>
                        </div>
                        {s.staffUserId === actor.userId ? (
                          <span className="text-[13px] text-muted">You</span>
                        ) : (
                          <ActionLink href={`/platform/support#session-${s.id}`} icon="close">
                            Force-end
                          </ActionLink>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {log && (
                  <>
                    <div className="mt-5 flex items-baseline justify-between gap-3">
                      <h3 className="text-[13px] text-muted">Recent activity</h3>
                      <Link href="/platform/support/log" className="text-[13px] text-muted hover:text-brand">
                        Full activity log
                      </Link>
                    </div>
                    {log.entries.length === 0 ? (
                      <p className="mt-1 text-[14px]">No support sessions yet.</p>
                    ) : (
                      <ul className="divide-y divide-line text-[14px]">
                        {log.entries.slice(0, 5).map((e) => (
                          <li key={e.id} className="min-w-0 py-2.5">
                            <div>
                              <span className="font-medium">{e.actorName ?? "Zinny system"}</span> <span className="text-muted">{actionLabel(e.action).toLowerCase()}</span>
                              {e.universityName && <span className="text-muted"> at {e.universityName}</span>}
                            </div>
                            <div className="truncate text-[13px] text-muted">
                              {timeAgo(e.at)}
                              {e.sessionReason && ` · ${e.sessionReason}`}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </Card>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/** One flat "Needs attention" row: a small dot, what is wrong, then its action. */
function NeedsRow({ title, detail, action, dot = "gold" }: { title: ReactNode; detail: ReactNode; action: ReactNode; dot?: "gold" | "danger" }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-1 items-start gap-3 text-[14px]">
        <span aria-hidden className={cx("mt-[7px] h-2 w-2 shrink-0 rounded-full", dot === "danger" ? "bg-danger" : "bg-gold")} />
        <div className="min-w-0">
          <div className="font-medium text-ink">{title}</div>
          <div className="text-[13px] text-muted">{detail}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 pl-5">{action}</div>
    </li>
  );
}

function RowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <ActionLink href={href}>{children}</ActionLink>
  );
}

/** Institutes whose licence ends within 30 days (or already has), soonest first. Gold marks "needs attention". */
function EndingLicences({ items }: { items: Awaited<ReturnType<typeof licencesEndingSoon>> }) {
  const shown = items.slice(0, 6);
  return (
    <Card className="min-w-0">
      <CardTitle hint={items.length ? `${items.length} in the next 30 days` : undefined}>Licences ending soon</CardTitle>
      {items.length === 0 ? (
        <p className="text-[14px] text-muted">No licence ends in the next 30 days.</p>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {shown.map((l) => (
              <li key={l.universityId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium text-ink">{l.name}</div>
                  <div className="tabular text-[13px] text-muted">
                    {l.planName} · {l.level.ended ? "ended" : "ends"} {formatDate(l.endDate)}
                  </div>
                </div>
                <Badge tone={l.level.ended ? "danger" : "gold"}>{daysLeftText(l.daysLeft)}</Badge>
                <ActionLink href={`/platform/licences/${l.universityId}`}>Renew licence</ActionLink>
              </li>
            ))}
          </ul>
          {items.length > shown.length && (
            <div className="mt-3 border-t border-line pt-3">
              <ActionLink href="/platform/institutes?ending=1" icon="view">
                See all {items.length} ending soon
              </ActionLink>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
