import Link from "next/link";
import type { ReactNode } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardTitle, Field, Input, PageHeader, Select, Stat, cx } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { acknowledgeAlertAction, startSupportAction } from "@/modules/zinny-team-panel/actions";
import { canSeeContentFlags } from "@/modules/zinny-team-panel/lib/access";
import { formatCount, formatDate, formatINR, formatINRShort, timeAgo, timeUntil } from "@/modules/zinny-team-panel/lib/format";
import { analytics } from "@/modules/zinny-team-panel/services/analytics";
import { overdueInvoices } from "@/modules/zinny-team-panel/services/billing";
import { reviewCounts } from "@/modules/zinny-team-panel/services/content";
import { listAlerts, listLicences } from "@/modules/zinny-team-panel/services/licences";
import { activeSessions, activityLog, actionLabel, supportPicker } from "@/modules/zinny-team-panel/services/support";

export const metadata = { title: "Overview" };

export default async function PlatformHome() {
  const actor = await platformContext();
  const can = {
    licences: canPlatform(actor, "platform.licences"),
    support: canPlatform(actor, "platform.support_mode"),
    flags: canSeeContentFlags(actor),
    review: canPlatform(actor, "platform.content_review"),
    finance: canPlatform(actor, "platform.finance"),
    analytics: canPlatform(actor, "platform.view_analytics"),
  };

  const [alerts, licences, sessions, log, picker, review, overdue, stats] = await Promise.all([
    can.licences ? listAlerts(actor, { handled: false }) : [],
    can.licences ? listLicences(actor) : [],
    can.support ? activeSessions(actor) : [],
    can.support ? activityLog(actor, { scope: "support" }, 1) : null,
    can.support ? supportPicker(actor) : null,
    can.flags ? reviewCounts(actor) : null,
    can.finance ? overdueInvoices(actor) : [],
    can.analytics ? analytics(actor, { weeks: 4, months: 3 }) : null,
  ]);
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

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={summary.length ? summary.join(" · ") : seesEverything ? "Nothing needs attention across the institutes right now." : undefined}
      />

      {stats && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Institutes" value={formatCount(stats.universities.active)} hint={stats.universities.suspended ? `${stats.universities.suspended} suspended` : "All active"} />
          <Stat label="Active students" value={formatCount(stats.activeStudents)} hint={`Of ${formatCount(stats.students)} students`} />
          <Stat label="Enrolments, 4 weeks" value={formatCount(stats.weeks.reduce((s, w) => s + w.enrolments, 0))} hint={`${formatCount(stats.weeks.at(-1)?.enrolments ?? 0)} this week`} />
          <Stat label="Student fees this month" value={formatINRShort(stats.months.at(-1)?.paise ?? 0)} hint="Paid by students to institutes" />
        </div>
      )}

      <div className={cx("grid grid-cols-1 items-start gap-4", showNeeds && showSide && "xl:grid-cols-[1.55fr_1fr]")}>
        {showNeeds && (
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
                        <Link href={`/platform/licences/${a.universityId}`} className="text-[13px] text-brand hover:underline">
                          Open licence
                        </Link>
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
                          <Link href={`/platform/support#session-${s.id}`} className="text-[13px] text-brand hover:underline">
                            Force-end
                          </Link>
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
    <Link href={href} className="text-[13px] font-medium text-brand hover:underline">
      {children}
    </Link>
  );
}
