import Link from "next/link";
import type { ReactNode } from "react";
import { SlotList } from "@/components/slots";
import { SwitchRequests } from "@/components/switch-requests";
import { EnrolmentRequests } from "@/components/enrolment-requests";
import { TodayBoard } from "@/components/today-board";
import { Card, CardTitle, Stat, cx } from "@/components/ui";
import type { DashboardCard, DashboardCardProps, DashboardLine, DashboardRow } from "@/contracts/module";
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
import { ActionForm, SubmitButton } from "@/components/forms";
import { QuickActionButtons, QuickActionPanel, QuickActions } from "@/components/quick-actions";
import { addDays } from "@/server/lib/dates";
import { listDepartments } from "@/server/services/departments";
import { quickChoices } from "@/server/services/daily";
import { feeChoices, overdueFees } from "@/modules/payments/fees";
import { todaysClasses } from "@/modules/live-classes/overview";
import { TodayPanel } from "@/modules/live-classes/components/today-panel";
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

/** "Needs you" shows this many rows; the rest open in place under "See all". */
const NEEDS_CAP = 5;

function ago(d: Date) {
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** Dashboards show whole rupees; paise stay on invoices, receipts and payment forms. */
const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

const linkClass = "shrink-0 text-[13px] font-medium text-brand hover:underline";

/** A module's compact dashboard form. One failing module never takes the dashboard down. */
async function compact<T>(entry: DashboardCard, fn: ((p: DashboardCardProps) => Promise<T[]>) | undefined, props: DashboardCardProps): Promise<T[]> {
  if (!fn) return [];
  try {
    return await fn(props);
  } catch (e) {
    console.error(`[slots] dashboardCards.${entry.key} failed:`, e);
    return [];
  }
}

/** One "Needs you" row: what is waiting, then one action on the right. */
function Row({ dot, children, action }: { dot?: "warn" | "danger"; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[14px]">
      <div className="flex min-w-0 flex-[1_1_16rem] gap-2.5">
        {dot && <span aria-hidden className={cx("mt-[7px] h-2 w-2 shrink-0 rounded-full", dot === "danger" ? "bg-danger" : "bg-gold")} />}
        <div className="min-w-0">{children}</div>
      </div>
      {action}
    </div>
  );
}

type Item = { key: string; rows: number; node: ReactNode };

export default async function Dashboard({
  params,
  searchParams,
}: {
  params: Promise<{ uni: string }>;
  searchParams: Promise<{ done?: string; classDone?: string }>;
}) {
  const { uni } = await params;
  const { done, classDone } = await searchParams;
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
  const canAttendance =
    installed.has("live-classes") &&
    (() => {
      const r = reach(actor, "attendance.view", university.id);
      return r.all || r.departmentIds.size > 0 || r.batchIds.size > 0;
    })();
  const canFinanceView = installed.has("payments") && can(actor, "finance.view", { universityId: university.id });
  const canFinanceManage = canFinanceView && can(actor, "finance.manage", { universityId: university.id });
  const slotProps: DashboardCardProps = {
    uni,
    actor,
    university,
    today: data.today,
  };
  const entries = slotsInReach("dashboardCards", actor, university.id);
  const [enrolRequests, joinRequests, joining, today, choices, fee, overdue, departments, moduleRows, monthLines] = await Promise.all([
    listEnrolmentRequests(actor),
    admits ? listJoinRequests(actor) : Promise.resolve([]),
    admits ? getJoinSettings(actor) : Promise.resolve(null),
    canAttendance ? todaysClasses(actor) : Promise.resolve(null),
    quickChoices(actor),
    installed.has("payments") ? feeChoices(actor) : Promise.resolve(null),
    canFinanceView ? overdueFees(actor) : Promise.resolve(null),
    admits ? listDepartments(actor) : Promise.resolve([]),
    Promise.all(entries.map((e) => compact<DashboardRow>(e, e.needsYou, slotProps))).then((r) => r.flat()),
    Promise.all(entries.map((e) => compact<DashboardLine>(e, e.thisMonth, slotProps))).then((r) => r.flat()),
  ]);
  const admitReach = reach(actor, "user.admit", university.id);
  const admitDepts = departments.filter((d) => admitReach.all || admitReach.departmentIds.has(d.id));
  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const live = data.board.find((s) => s.state === "live");

  // Refunds show once, in "Needs you", and only to people who can send them (not the Board).
  const canRefund = can(actor, "finance.refund", {
    universityId: university.id,
  });
  const refunds = canRefund ? (data.money?.refundsDue ?? 0) : 0;
  const refundReasons = new Set(data.money?.refundReasons ?? []);
  const refundWhy =
    refundReasons.size !== 1
      ? "Students paid for a seat they can't use. Refund them in full."
      : refundReasons.has("paid_twice")
        ? `Paid twice for the same course: ${refunds === 1 ? "the student already has" : "each student already has"} a seat. Refund in full.`
        : "Paid after the seat hold ran out and the batch had filled. Refund in full.";
  const overdueCount = overdue?.count ?? 0;

  /* ─────────────── Needs you: people first, then warnings, then work ─────────────── */
  const items: Item[] = [];
  for (const q of joinRequests.slice(0, 5)) {
    items.push({
      key: `join-${q.id}`,
      rows: 1,
      node: (
        <Row
          action={
            <div className="flex flex-wrap items-center gap-1">
              <ActionForm action={decideJoinInlineAction} resetOnSuccess={false} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="uni" value={uni} />
                <input type="hidden" name="requestId" value={q.id} />
                <input type="hidden" name="name" value={q.name} />
                <input type="hidden" name="choice" value="accept" />
                {q.departmentId && admitDepts.some((d) => d.id === q.departmentId) ? (
                  <input type="hidden" name="departmentId" value={q.departmentId} />
                ) : (
                  <select
                    name="departmentId"
                    aria-label={`Department for ${q.name}`}
                    className="h-8 rounded-full border border-line bg-surface px-3 text-[13px]"
                  >
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
                <SubmitButton size="sm" variant="ghost" pendingText="Declining…">
                  Decline
                </SubmitButton>
              </ActionForm>
            </div>
          }
        >
          <div className="font-medium">{q.name} asked to join</div>
          <div className="text-[13px] text-muted">
            {q.email}
            {q.departmentId && deptName.get(q.departmentId) ? `, for ${deptName.get(q.departmentId)}` : ""}
            {q.message ? `. “${q.message}”` : ""}
          </div>
        </Row>
      ),
    });
  }
  if (joinRequests.length > 5)
    items.push({
      key: "join-all",
      rows: 1,
      node: (
        <Link href={`${base}/users/requests`} className={linkClass}>
          See all {joinRequests.length} join requests
        </Link>
      ),
    });
  if (enrolRequests.length > 0)
    items.push({
      key: "enrol",
      rows: enrolRequests.length,
      node: <EnrolmentRequests requests={enrolRequests} uni={uni} action={decideEnrolmentAction} back={base} />,
    });
  // Kept on the page with an empty list, so its "moved to …" confirmation stays after the last request is answered.
  if (data.canDecideSwitches)
    items.push({
      key: "switch",
      rows: requests.length,
      node: <SwitchRequests uni={uni} requests={requests} bare />,
    });
  for (const e of data.expiring)
    items.push({
      key: `expiring-${e.batchId}`,
      rows: 1,
      node: (
        <Row
          dot="warn"
          action={
            <Link href={`${base}/products/batches/${e.batchId}`} className={linkClass}>
              Assign faculty
            </Link>
          }
        >
          <div className="font-medium">
            {e.courseTitle}, {e.batchName} needs a new faculty member
          </div>
          <div className="text-[13px] text-muted">Visiting faculty access ends on {formatDate(e.endsOn)}, before the batch does.</div>
        </Row>
      ),
    });
  if (overdueCount > 0 && overdue)
    items.push({
      key: "overdue",
      rows: 1,
      node: (
        <Row
          action={
            <div className="flex flex-wrap items-center gap-3">
              {canFinanceManage && overdue.reachable > 0 && (
                <ActionForm action={remindOverdueAction} resetOnSuccess={false}>
                  <input type="hidden" name="uni" value={uni} />
                  <SubmitButton size="sm" variant="secondary" pendingText="Sending…">
                    Send reminders
                  </SubmitButton>
                </ActionForm>
              )}
              <Link href={`${base}/finance/invoices?status=overdue`} className={linkClass}>
                See invoices
              </Link>
            </div>
          }
        >
          <div className="font-medium">
            {overdueCount} invoice{overdueCount === 1 ? " is" : "s are"} overdue, <span className="tabular text-danger">{rupees(overdue.totalPaise)}</span> in
            all
          </div>
          <div className="text-[13px] text-muted">
            {overdue.reachable ? `${overdue.reachable} can be reminded in Zinny.` : "Billed to people without an account here: remind them yourself."}
          </div>
        </Row>
      ),
    });
  if (refunds > 0)
    items.push({
      key: "refunds",
      rows: 1,
      node: (
        <Row
          dot="danger"
          action={
            <Link href={`${base}/finance/sales?status=refund_due`} className={linkClass}>
              Open sales
            </Link>
          }
        >
          <div className="font-medium">
            {refunds} refund{refunds === 1 ? "" : "s"} to process
          </div>
          <div className="text-[13px] text-muted">{refundWhy}</div>
        </Row>
      ),
    });
  for (const r of moduleRows)
    items.push({
      key: `m-${r.key}`,
      rows: 1,
      node: (
        <Row
          dot={r.tone}
          action={
            <Link href={r.href} className={linkClass}>
              {r.link}
            </Link>
          }
        >
          <div className="font-medium">{r.text}</div>
          {r.detail && <div className="text-[13px] text-muted">{r.detail}</div>}
        </Row>
      ),
    });
  // Fill the first NEEDS_CAP rows; a group (switch or seat requests) stays whole.
  let used = 0;
  const shown: Item[] = [];
  const more: Item[] = [];
  for (const it of items) {
    if (used < NEEDS_CAP || it.rows === 0) {
      shown.push(it);
      used += it.rows;
    } else more.push(it);
  }
  // An empty group only carries its confirmation message: it goes first, without a row of its own.
  shown.sort((x, y) => Number(x.rows > 0) - Number(y.rows > 0));
  const needsCount = items.reduce((n, it) => n + it.rows, 0);
  // Kept while it shows a confirmation, e.g. for faculty who just answered their last request.
  const showNeeds = data.canDecideSwitches || canRefund || needsCount > 0 || !!done;

  /* ─────────────── Updates: grouped, without what "Needs you" already says ─────────────── */
  const covered = new Set<string>(moduleRows.flatMap((r) => r.covers ?? []));
  if (data.canDecideSwitches) covered.add("switch.requested");
  if (data.expiring.length) covered.add("batch.faculty_expiring");
  if (admits) covered.add("join.requested");
  if (enrolRequests.length) covered.add("enrolment.requested");
  if (canRefund) ["finance.refund_due", "payment.refund_due"].forEach((k) => covered.add(k));
  const groups = new Map<string, { first: (typeof data.updates)[number]; count: number }>();
  for (const n of data.updates) {
    if (covered.has(n.kind)) continue;
    const g = groups.get(n.kind);
    if (g) g.count++;
    else groups.set(n.kind, { first: n, count: 1 });
  }
  const updates = [...groups.values()].slice(0, 5);

  const seatsFilled = Math.round(
    (data.seats.reduce((n, s) => n + s.taken, 0) /
      Math.max(
        1,
        data.seats.reduce((n, s) => n + s.limit, 0),
      )) *
      100,
  );
  const avgOrder = data.money && data.money.monthOrders ? Math.round(data.money.monthPaise / data.money.monthOrders / 100) * 100 : 0;
  const filling = data.seats.slice(0, 6);
  const todayClasses = today && (today.classes.length > 0 || classDone) ? today : null;
  const leftCard = !!todayClasses || showNeeds;
  // Module cards without a compact form keep their own small card in the last row.
  const cardEntries = entries.filter((e) => !e.needsYou && !e.thisMonth && !(today && e.key === "attendance-today"));

  const invite = joining ? (
    <InviteStrip
      uni={uni}
      institute={university.name}
      code={joining.code}
      mode={joining.mode}
      canManage={can(actor, "settings.manage", { universityId: university.id })}
      bare
    />
  ) : undefined;

  return (
    <div className="space-y-6">
      {setup && <SetupChecklistCard uni={uni} checklist={setup} dismiss={dismissSetupAction} />}
      <QuickActions
        uni={uni}
        today={data.today}
        tomorrow={addDays(data.today, 1)}
        place={choices.place}
        departments={choices.departments}
        announce={choices.announce}
        schedule={choices.schedule}
        fee={fee}
        actions={{
          addStudent: quickAddStudentAction,
          recordFee: recordFeeAction,
          announce: announceAction,
          extraClass: extraClassAction,
        }}
        invite={setup ? undefined : invite}
      >
        <TodayBoard data={data} base={base} actions={<QuickActionButtons />} />
        <QuickActionPanel />
      </QuickActions>
      {/* While "Get set up" shows, inviting students is a step of its own: keep the full card. */}
      {setup && joining && (
        <InviteStrip
          uni={uni}
          institute={university.name}
          code={joining.code}
          mode={joining.mode}
          canManage={can(actor, "settings.manage", {
            universityId: university.id,
          })}
        />
      )}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {!data.canSeeBatches && data.money ? (
          <>
            <Stat label="Collected this month" value={rupees(data.money.monthPaise)} hint="Including GST" />
            <Stat label="Paid orders this month" value={data.money.monthOrders} />
            <Stat label="Average order" value={rupees(avgOrder)} hint="Including GST" />
            <Stat label="Payments in progress" value={data.money.pending} hint="Seats held while students pay" />
          </>
        ) : (
          <>
            <Stat label="Enrolled students" value={data.students} hint={data.thisWeek ? `${data.thisWeek} joined this week` : "No new joins this week"} />
            <Stat label="Open batches" value={data.openBatches} hint={`Across ${data.courses} course${data.courses === 1 ? "" : "s"}`} />
            {data.money ? (
              <Stat
                label="Collected this month"
                value={rupees(data.money.monthPaise)}
                hint={`Including GST, ${data.money.monthOrders} paid order${data.money.monthOrders === 1 ? "" : "s"}`}
              />
            ) : (
              <Stat label="Classes today" value={data.board.length} hint={live ? `Live: ${live.courseTitle}` : undefined} />
            )}
            <Stat label="Seats filled" value={`${seatsFilled}%`} hint="Across your open batches" />
          </>
        )}
      </div>

      {
        <div className={cx("grid grid-cols-1 items-start gap-4", leftCard && "xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]")}>
          {leftCard && (
            <Card>
              {todayClasses && (
                <section className={cx(showNeeds && "mb-5 border-b border-line pb-5")}>
                  <CardTitle hint={`${todayClasses.classes.length} class${todayClasses.classes.length === 1 ? "" : "es"}`}>Today&apos;s classes</CardTitle>
                  <TodayPanel
                    uni={uni}
                    actor={actor}
                    classes={todayClasses.classes}
                    today={todayClasses.today}
                    tz={todayClasses.tz}
                    cancelAction={cancelClassAction}
                    moveAction={moveClassAction}
                    notice={classDone?.slice(0, 300)}
                    bare
                  />
                </section>
              )}
              {showNeeds && (
                <section>
                  <CardTitle hint={needsCount ? `${needsCount} item${needsCount === 1 ? "" : "s"}` : undefined}>Needs you</CardTitle>
                  {done && <p className="mb-3 rounded-xl bg-brand-soft px-4 py-3 text-[14px] text-brand-strong">{done}</p>}
                  {needsCount === 0 && !done && <p className="text-[14px] text-muted">Nothing needs you right now.</p>}
                  <ul className="divide-y divide-line">
                    {shown.map((it) => (
                      <li key={it.key} className={it.rows === 0 ? "border-0 p-0" : "py-3 first:pt-0 last:pb-0"}>
                        {it.node}
                      </li>
                    ))}
                  </ul>
                  {more.length > 0 && (
                    <details className="group mt-3 border-t border-line pt-3">
                      <summary className="cursor-pointer list-none text-[13px] font-medium text-brand hover:underline">
                        <span className="group-open:hidden">See all {needsCount}</span>
                        <span className="hidden group-open:inline">Show fewer</span>
                      </summary>
                      <ul className="mt-3 divide-y divide-line">
                        {more.map((it) => (
                          <li key={it.key} className="py-3 first:pt-0 last:pb-0">
                            {it.node}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </section>
              )}
            </Card>
          )}

          <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-1">
            {data.canSeeBatches && (
              <Card>
                <CardTitle hint={data.seats.length > filling.length ? `${filling.length} of ${data.seats.length}` : undefined}>Batches filling up</CardTitle>
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
                  <ul className="divide-y divide-line">
                    {filling.map((s) => (
                      <li key={s.batchId} className="py-3 first:pt-0 last:pb-0">
                        <Link href={`${base}/products/batches/${s.batchId}`} className="group block">
                          <div className="flex items-baseline justify-between gap-3 text-[14px]">
                            <span className="min-w-0 truncate">
                              <span className="font-medium group-hover:text-brand">{s.courseTitle}</span>
                              <span className="text-muted">, {s.batchName}</span>
                            </span>
                            <span className={cx("tabular shrink-0 text-[13px]", s.fill >= 1 ? "text-danger" : "text-muted")}>
                              {s.fill >= 1 ? "Full" : `${s.taken}/${s.limit}`}
                            </span>
                          </div>
                          <div
                            className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"
                            role="img"
                            aria-label={`${s.taken} of ${s.limit} seats taken${s.held ? `, ${s.held} being paid for` : ""}`}
                          >
                            <div
                              className="h-full rounded-full bg-brand"
                              style={{
                                width: `${Math.min(100, s.fill * 100)}%`,
                              }}
                            />
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {data.seats.length > 0 && (
                  <Link href={`${base}/products/courses`} className="mt-4 inline-block text-[13px] font-medium text-brand hover:underline">
                    See all courses and batches
                  </Link>
                )}
              </Card>
            )}
            <Card>
              <CardTitle>Updates</CardTitle>
              {updates.length === 0 ? (
                <p className="text-[14px] text-muted">Nothing new beyond what&apos;s above.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {updates.map(({ first: n, count }) => (
                    <li key={n.id} className="py-3 text-[14px] first:pt-0 last:pb-0">
                      <div className="font-medium">{n.title}</div>
                      <div className="line-clamp-2 text-[13px] text-muted">
                        {count > 1 ? `And ${count - 1} more like it. ` : n.body ? `${n.body} ` : ""}
                        <span className="text-faint">{ago(n.createdAt)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      }

      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {monthLines.length > 0 && (
          <Card>
            <CardTitle>This month</CardTitle>
            <ul className="divide-y divide-line">
              {monthLines.map((l) => (
                <li key={l.key} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[14px]">{l.label}</span>
                    <span className="tabular text-[20px] font-medium leading-none">{l.value}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[13px]">
                    <span className="text-muted">{l.hint}</span>
                    <Link href={l.href} className="font-medium text-brand hover:underline">
                      {l.link}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <SlotList slot="dashboardCards" className="contents" entries={cardEntries} props={slotProps} />
      </div>
    </div>
  );
}
