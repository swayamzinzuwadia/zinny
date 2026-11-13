import Link from "next/link";
import { SlotList } from "@/components/slots";
import { SwitchRequests } from "@/components/switch-requests";
import { EnrolmentRequests } from "@/components/enrolment-requests";
import { TodayBoard } from "@/components/today-board";
import { Badge, Card, CardTitle, SeatMap, Stat, cx } from "@/components/ui";
import { can, reach } from "@/server/authz/engine";
import { spaceContext } from "@/server/context";
import { slotsInReach } from "@/server/registry";
import { formatDate } from "@/server/lib/dates";
import { dashboard } from "@/server/services/dashboard";
import { listEnrolmentRequests, listSwitchRequests } from "@/server/services/enrolment";
import { canAdmit, getJoinSettings, listJoinRequests } from "@/modules/identity/joining";
import { InviteStrip } from "@/modules/identity/components/invite-strip";
import { cookies } from "next/headers";
import { SetupChecklistCard } from "@/components/setup-checklist";
import { setupChecklist, setupHiddenCookie } from "@/server/services/setup";
import { decideEnrolmentAction, dismissSetupAction } from "./actions";
import { formatINR } from "@/server/services/finance";
import { firstName } from "@/server/lib/names";
import { ActionForm, SubmitButton } from "@/components/forms";
import { QuickActions } from "@/components/quick-actions";
import { addDays } from "@/server/lib/dates";
import { listDepartments } from "@/server/services/departments";
import { quickChoices } from "@/server/services/daily";
import { feeChoices, overdueFees } from "@/modules/payments/fees";
import { inr } from "@/modules/payments/money";
import { todaysClasses } from "@/modules/live-classes/overview";
import { TodayPanel } from "@/modules/live-classes/components/today-panel";
import { attentionCounts } from "@/modules/website-builder/overview";
import { modules } from "@/server/registry";
import {
  announceAction,
  cancelClassAction,
  decideJoinInlineAction,
  extraClassAction,
  moveClassAction,
  quickAddStudentAction,
  recordFeeAction,
  remindOverdueAction,
} from "./daily-actions";

export const metadata = { title: "Dashboard" };

function ago(d: Date) {
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export default async function Dashboard({ params, searchParams }: { params: Promise<{ uni: string }>; searchParams: Promise<{ done?: string }> }) {
  const { uni } = await params;
  const { done } = await searchParams;
  const { actor, university } = await spaceContext(uni);
  const base = `/${uni}/admin`;
  const data = await dashboard(actor);
  // "Get set up" for a new institute: until every step is done, or the admin hides it.
  const hidden = (await cookies()).get(setupHiddenCookie(university.id))?.value === "1";
  const checklist = hidden ? null : await setupChecklist(actor, uni);
  const setup = checklist && checklist.done < checklist.total ? checklist : null;
  const courseReach = reach(actor, "course.create", university.id);
  const canNewCourse = can(actor, "department.manage", { universityId: university.id }) || courseReach.all || courseReach.departmentIds.size > 0;
  const requests = data.canDecideSwitches ? await listSwitchRequests(actor) : [];
  // Students asking for a seat (faculty, HODs, admins) and asking to join (admins, HODs), and
  // the joining code for the people who accept new students.
  const admits = canAdmit(actor);
  const installed = new Set(modules().map((m) => m.id));
  const canAttendance = installed.has("live-classes") && (() => {
    const r = reach(actor, "attendance.view", university.id);
    return r.all || r.departmentIds.size > 0 || r.batchIds.size > 0;
  })();
  const canFinanceView = installed.has("payments") && can(actor, "finance.view", { universityId: university.id });
  const canFinanceManage = canFinanceView && can(actor, "finance.manage", { universityId: university.id });
  const canWebsite = installed.has("website-builder") && can(actor, "website.manage", { universityId: university.id });
  const [enrolRequests, joinRequests, joining, today, choices, fee, overdue, site, departments] = await Promise.all([
    listEnrolmentRequests(actor),
    admits ? listJoinRequests(actor) : Promise.resolve([]),
    admits ? getJoinSettings(actor) : Promise.resolve(null),
    canAttendance ? todaysClasses(actor) : Promise.resolve(null),
    quickChoices(actor),
    installed.has("payments") ? feeChoices(actor) : Promise.resolve(null),
    canFinanceView ? overdueFees(actor) : Promise.resolve(null),
    canWebsite ? attentionCounts(actor) : Promise.resolve(null),
    admits ? listDepartments(actor) : Promise.resolve([]),
  ]);
  const admitReach = reach(actor, "user.admit", university.id);
  const admitDepts = departments.filter((d) => admitReach.all || admitReach.departmentIds.has(d.id));
  const deptName = new Map(departments.map((d) => [d.id, d.name]));

  const live = data.board.find((s) => s.state === "live");
  const summary = [
    data.canSeeBatches
      ? data.board.length
        ? `${data.board.length} class${data.board.length === 1 ? "" : "es"} today`
        : "No classes today"
      : data.money
        ? `${data.money.monthOrders} paid orders this month`
        : "",
    live ? `Live now: ${live.courseTitle}` : "",
    requests.length ? `${requests.length} switch request${requests.length === 1 ? "" : "s"} waiting` : "",
    enrolRequests.length ? `${enrolRequests.length} student${enrolRequests.length === 1 ? "" : "s"} waiting for a seat` : "",
    joinRequests.length ? `${joinRequests.length} join request${joinRequests.length === 1 ? "" : "s"}` : "",
    data.expiring.length
      ? data.expiring.length === 1
        ? "1 batch needs faculty soon"
        : `${data.expiring.length} batches need faculty soon`
      : "",
  ].filter(Boolean);

  // Only people who can open batches are told a batch is filling up.
  const fillingFast = data.canDecideSwitches ? data.seats.filter((s) => s.fill >= 0.8 && s.fill < 1) : [];
  // Refunds show once, in "Needs you", and only to people who can send them (not the Board).
  const canRefund = can(actor, "finance.refund", { universityId: university.id });
  const refunds = canRefund ? (data.money?.refundsDue ?? 0) : 0;
  const refundReasons = new Set(data.money?.refundReasons ?? []);
  const refundWhy =
    refundReasons.size !== 1
      ? "Students paid for a seat they can't use. Refund them in full."
      : refundReasons.has("paid_twice")
        ? `Paid twice for the same course: ${refunds === 1 ? "the student already has" : "each student already has"} a seat. Refund in full.`
        : "Paid after the seat hold ran out and the batch had filled. Refund in full.";
  const overdueCount = overdue?.count ?? 0;
  const newEnquiries = site?.enquiries ?? 0;
  const needsCount = requests.length + enrolRequests.length + joinRequests.length + data.expiring.length + fillingFast.length + refunds + (overdueCount ? 1 : 0) + (newEnquiries ? 1 : 0);
  // Kept while it shows a confirmation, e.g. for faculty who just answered their last request.
  const showNeeds = data.canDecideSwitches || canRefund || enrolRequests.length > 0 || joinRequests.length > 0 || overdueCount > 0 || newEnquiries > 0 || !!done;
  const avgOrder = data.money && data.money.monthOrders ? Math.round(data.money.monthPaise / data.money.monthOrders / 100) * 100 : 0;
  const seatsFilled = Math.round((data.seats.reduce((n, s) => n + s.taken, 0) / Math.max(1, data.seats.reduce((n, s) => n + s.limit, 0))) * 100);

  return (
    <div className="space-y-6">
      {setup && <SetupChecklistCard uni={uni} checklist={setup} dismiss={dismissSetupAction} />}
      <TodayBoard data={data} firstName={firstName(actor.name)} base={base} summary={summary} />
      <QuickActions
        uni={uni}
        today={data.today}
        tomorrow={addDays(data.today, 1)}
        place={choices.place}
        departments={choices.departments}
        announce={choices.announce}
        schedule={choices.schedule}
        fee={fee}
        actions={{ addStudent: quickAddStudentAction, recordFee: recordFeeAction, announce: announceAction, extraClass: extraClassAction }}
      />
      <div className={cx("grid grid-cols-1 gap-6", today && showNeeds && "xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]")}>
        {today && (
          <TodayPanel uni={uni} actor={actor} classes={today.classes} today={today.today} tz={today.tz} cancelAction={cancelClassAction} moveAction={moveClassAction} />
        )}
        {showNeeds && (
          <Card>
            <CardTitle hint={needsCount ? `${needsCount} item${needsCount === 1 ? "" : "s"}` : undefined}>Needs you</CardTitle>
            {needsCount === 0 && !done && (
              <p className="rounded-2xl bg-canvas px-4 py-6 text-center text-[14px] text-muted">Nothing needs you right now.</p>
            )}
            <div className="space-y-3">
              {done && <p className="rounded-2xl bg-brand-soft px-4 py-3 text-[14px] text-brand-strong">{done}</p>}
              {joinRequests.slice(0, 5).map((q) => (
                <div key={q.id} className="rounded-2xl bg-gold-soft p-4 text-[14px]">
                  <div className="font-medium">{q.name} asked to join</div>
                  <div className="text-muted">
                    {q.email}
                    {q.departmentId && deptName.get(q.departmentId) ? `, for ${deptName.get(q.departmentId)}` : ""}
                  </div>
                  {q.message && <div className="mt-1 text-muted">&ldquo;{q.message}&rdquo;</div>}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <ActionForm action={decideJoinInlineAction} resetOnSuccess={false} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="uni" value={uni} />
                      <input type="hidden" name="requestId" value={q.id} />
                      <input type="hidden" name="name" value={q.name} />
                      <input type="hidden" name="choice" value="accept" />
                      {q.departmentId && admitDepts.some((d) => d.id === q.departmentId) ? (
                        <input type="hidden" name="departmentId" value={q.departmentId} />
                      ) : (
                        <select name="departmentId" aria-label={`Department for ${q.name}`} className="h-8 rounded-full border border-line bg-surface px-3 text-[13px]">
                          {admitDepts.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <SubmitButton size="sm" pendingText="Accepting…">
                        Accept
                      </SubmitButton>
                    </ActionForm>
                    <ActionForm action={decideJoinInlineAction} resetOnSuccess={false}>
                      <input type="hidden" name="uni" value={uni} />
                      <input type="hidden" name="requestId" value={q.id} />
                      <input type="hidden" name="name" value={q.name} />
                      <input type="hidden" name="choice" value="decline" />
                      <SubmitButton size="sm" variant="secondary" pendingText="Declining…">
                        Decline
                      </SubmitButton>
                    </ActionForm>
                  </div>
                </div>
              ))}
              {joinRequests.length > 5 && (
                <Link href={`${base}/users/requests`} className="block text-[14px] font-medium text-brand-strong hover:underline">
                  See all {joinRequests.length} join requests
                </Link>
              )}
              {enrolRequests.length > 0 && <EnrolmentRequests requests={enrolRequests} uni={uni} action={decideEnrolmentAction} back={base} />}
              {/* Kept on the page with an empty list, so its "moved to …" confirmation stays after the last request is answered. */}
              {data.canDecideSwitches && <SwitchRequests uni={uni} requests={requests} bare />}
              {data.expiring.map((e) => (
                <div key={e.batchId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gold-soft p-4">
                  <div className="text-[14px]">
                    <div className="font-medium text-ink">
                      {e.courseTitle}, {e.batchName} needs a new faculty member
                    </div>
                    <div className="text-gold-strong">Visiting faculty access ends on {formatDate(e.endsOn)}, before the batch does.</div>
                  </div>
                  <Link
                    href={`${base}/products/batches/${e.batchId}`}
                    className="rounded-full bg-brand px-3.5 py-1.5 text-[13px] font-medium text-canvas"
                  >
                    Assign faculty
                  </Link>
                </div>
              ))}
              {fillingFast.map((s) => (
                <div key={s.batchId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-canvas p-4 text-[14px]">
                  <div>
                    <div className="font-medium">
                      {s.courseTitle}, {s.batchName} is almost full
                    </div>
                    <div className="text-muted">
                      {s.limit - s.taken - s.held} of {s.limit} seats left. Consider opening another batch.
                    </div>
                  </div>
                  <Link href={`${base}/products/batches/${s.batchId}`} className="text-[13px] font-medium text-brand hover:underline">
                    Open batch
                  </Link>
                </div>
              ))}
              {overdueCount > 0 && overdue && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gold-soft p-4 text-[14px]">
                  <div>
                    <div className="font-medium text-ink">
                      {overdueCount} invoice{overdueCount === 1 ? " is" : "s are"} overdue, {inr(overdue.totalPaise)} in all
                    </div>
                    <div className="text-gold-strong">
                      {overdue.reachable ? `${overdue.reachable} can be reminded in Zinny.` : "Billed to people without an account here: remind them yourself."}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {canFinanceManage && overdue.reachable > 0 && (
                      <ActionForm action={remindOverdueAction} resetOnSuccess={false}>
                        <input type="hidden" name="uni" value={uni} />
                        <SubmitButton size="sm" pendingText="Sending…">
                          Send reminders
                        </SubmitButton>
                      </ActionForm>
                    )}
                    <Link href={`${base}/finance/invoices?status=overdue`} className="text-[13px] font-medium text-brand hover:underline">
                      See invoices
                    </Link>
                  </div>
                </div>
              )}
              {newEnquiries > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-canvas p-4 text-[14px]">
                  <div className="font-medium">
                    {newEnquiries} new enquir{newEnquiries === 1 ? "y" : "ies"} from your website
                  </div>
                  <Link href={`${base}/website/sections/enquiries`} className="rounded-full bg-brand px-3.5 py-1.5 text-[13px] font-medium text-canvas">
                    Answer enquiries
                  </Link>
                </div>
              )}
              {refunds > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-danger-soft p-4 text-[14px]">
                  <div>
                    <div className="font-medium text-ink">
                      {refunds} refund{refunds === 1 ? "" : "s"} to process
                    </div>
                    <div className="text-danger">{refundWhy}</div>
                  </div>
                  <Link href={`${base}/finance/sales?status=refund_due`} className="text-[13px] font-medium text-brand hover:underline">
                    Open sales
                  </Link>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      {joining && (
        <InviteStrip uni={uni} institute={university.name} code={joining.code} mode={joining.mode} canManage={can(actor, "settings.manage", { universityId: university.id })} />
      )}

      <div>
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {!data.canSeeBatches && data.money ? (
            <>
              <Stat label="Collected this month" value={formatINR(data.money.monthPaise)} hint="Including GST" />
              <Stat label="Paid orders this month" value={data.money.monthOrders} />
              <Stat label="Average order" value={formatINR(avgOrder)} hint="Including GST" />
              <Stat label="Payments in progress" value={data.money.pending} hint="Seats held while students pay" />
            </>
          ) : (
            <>
              <Stat
                label="Enrolled students"
                value={data.students}
                hint={data.thisWeek ? `${data.thisWeek} joined this week` : "No new joins this week"}
              />
              <Stat label="Open batches" value={data.openBatches} hint={`Across ${data.courses} course${data.courses === 1 ? "" : "s"}`} />
              {data.money ? (
                <>
                  <Stat
                    label="Collected this month"
                    value={formatINR(data.money.monthPaise)}
                    hint={`Including GST, ${data.money.monthOrders} paid order${data.money.monthOrders === 1 ? "" : "s"}`}
                  />
                  <Stat label="Seats filled" value={`${seatsFilled}%`} hint="Across your open batches" />
                </>
              ) : (
                <>
                  <Stat label="Classes today" value={data.board.length} hint={live ? `Live: ${live.courseTitle}` : undefined} />
                  <Stat label="Seats filled" value={`${seatsFilled}%`} hint="Across your open batches" />
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.55fr_1fr]">
        {data.canSeeBatches && (
          <Card>
            <CardTitle hint="Taken and free">Seats by batch</CardTitle>
            {data.seats.length === 0 ? (
              <p className="text-[14px] text-muted">
                No open batches yet.{" "}
                {canNewCourse && (
                  <Link href={`${base}/products/courses/new`} className="font-medium text-brand hover:underline">
                    Create a course with its first batch
                  </Link>
                )}
              </p>
            ) : (
              <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
                {data.seats.map((s) => (
                  <Link key={s.batchId} href={`${base}/products/batches/${s.batchId}`} className="group block">
                    <div className="mb-2 flex items-baseline justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[14px] font-medium group-hover:text-brand">{s.courseTitle}</div>
                        <div className="truncate text-[13px] text-muted">
                          {s.batchName}
                          {s.startsOn && `, starts ${formatDate(s.startsOn, { year: false })}`}
                        </div>
                      </div>
                      {s.fill >= 1 ? (
                        <Badge tone="danger">Full</Badge>
                      ) : (
                        <span className="tabular shrink-0 text-[13px] text-muted">
                          {s.taken}/{s.limit}
                        </span>
                      )}
                    </div>
                    <SeatMap limit={s.limit} taken={s.taken} held={s.held} />
                  </Link>
                ))}
              </div>
            )}
          </Card>
        )}

        <Card className={cx(!data.canSeeBatches && "xl:col-span-2")}>
          <CardTitle>Updates</CardTitle>
          {data.updates.length === 0 ? (
            <p className="text-[14px] text-muted">You&apos;re all caught up.</p>
          ) : (
            <ul className="space-y-4">
              {data.updates.map((n) => (
                <li key={n.id} className="flex gap-3 text-[14px]">
                  <span
                    className={cx(
                      "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                      n.kind.includes("expiring") || n.kind.includes("refund") ? "bg-gold" : "bg-brand",
                    )}
                  />
                  <div className="min-w-0">
                    <div className="font-medium">{n.title}</div>
                    {n.body && <div className="text-muted">{n.body}</div>}
                    <div className="mt-0.5 text-[12px] text-faint">{ago(n.createdAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <SlotList
        slot="dashboardCards"
        className="grid gap-6 xl:grid-cols-2"
        entries={slotsInReach("dashboardCards", actor, university.id).filter((e) => !(today && e.key === "attendance-today"))}
        props={{ uni, actor, university, today: data.today }}
      />
    </div>
  );
}
