import Link from "next/link";
import { SwitchRequests } from "@/components/switch-requests";
import { TodayBoard } from "@/components/today-board";
import { Badge, Card, CardTitle, SeatMap, Stat, cx } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { formatDate } from "@/server/lib/dates";
import { dashboard } from "@/server/services/dashboard";
import { listSwitchRequests } from "@/server/services/enrolment";
import { formatINR } from "@/server/services/finance";

export const metadata = { title: "Dashboard" };

function ago(d: Date) {
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export default async function Dashboard({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  const base = `/${uni}/admin`;
  const data = await dashboard(actor);
  const requests = data.canDecideSwitches ? await listSwitchRequests(actor) : [];

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
    data.expiring.length
      ? data.expiring.length === 1
        ? "1 batch needs faculty soon"
        : `${data.expiring.length} batches need faculty soon`
      : "",
    data.money?.refundsDue ? `${data.money.refundsDue} refund${data.money.refundsDue === 1 ? "" : "s"} due` : "",
  ].filter(Boolean);

  // Only people who can open batches are told a batch is filling up.
  const fillingFast = data.canDecideSwitches ? data.seats.filter((s) => s.fill >= 0.8 && s.fill < 1) : [];
  const refunds = data.money?.refundsDue ?? 0;
  const needsCount = requests.length + data.expiring.length + fillingFast.length + refunds;
  const showNeeds = data.canDecideSwitches || !!data.money;
  const avgOrder = data.money && data.money.monthOrders ? Math.round(data.money.monthPaise / data.money.monthOrders) : 0;

  return (
    <div className="space-y-6">
      <TodayBoard data={data} firstName={actor.name.split(" ")[0]} base={base} summary={summary} />

      <div className={cx("grid gap-6", showNeeds && "xl:grid-cols-[1.55fr_1fr]")}>
        {showNeeds && (
          <Card>
            <CardTitle hint={needsCount ? `${needsCount} item${needsCount === 1 ? "" : "s"}` : undefined}>Needs you</CardTitle>
            {needsCount === 0 && (
              <p className="rounded-2xl bg-canvas px-4 py-6 text-center text-[14px] text-muted">Nothing needs you right now.</p>
            )}
            <div className="space-y-3">
              {requests.length > 0 && <SwitchRequests uni={uni} requests={requests} bare />}
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
              {refunds > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-danger-soft p-4 text-[14px]">
                  <div>
                    <div className="font-medium text-ink">
                      {refunds} refund{refunds === 1 ? "" : "s"} to process
                    </div>
                    <div className="text-danger">Paid after the seat hold ran out and the batch had filled.</div>
                  </div>
                  <Link href={`${base}/finance/sales`} className="text-[13px] font-medium text-brand hover:underline">
                    Open sales
                  </Link>
                </div>
              )}
            </div>
          </Card>
        )}

        <div className={cx("grid grid-cols-2 gap-4 self-start", !showNeeds && "xl:grid-cols-4")}>
          {!data.canSeeBatches && data.money ? (
            <>
              <Stat label="Paid orders this month" value={data.money.monthOrders} />
              <Stat label="Average order" value={formatINR(avgOrder)} hint="Including GST" />
              <Stat label="Payments in progress" value={data.money.pending} hint="Seats held while students pay" />
              <Stat label="Refunds due" value={refunds} hint={refunds ? "Paid after the batch filled" : "All clear"} />
            </>
          ) : (
            <>
              <Stat
                label="Active students"
                value={data.students}
                hint={data.thisWeek ? `${data.thisWeek} joined this week` : "No new joins this week"}
              />
              <Stat label="Open batches" value={data.openBatches} hint={`Across ${data.courses} course${data.courses === 1 ? "" : "s"}`} />
              {data.money ? (
                <>
                  <Stat
                    label="Collected this month"
                    value={formatINR(data.money.monthPaise)}
                    hint={`${data.money.monthOrders} paid orders`}
                  />
                  <Stat
                    label="Refunds due"
                    value={data.money.refundsDue}
                    hint={data.money.refundsDue ? "Paid after the batch filled" : "All clear"}
                  />
                </>
              ) : (
                <>
                  <Stat label="Classes today" value={data.board.length} hint={live ? `Live: ${live.courseTitle}` : undefined} />
                  <Stat
                    label="Seats filled"
                    value={`${Math.round(
                      (data.seats.reduce((n, s) => n + s.taken, 0) /
                        Math.max(
                          1,
                          data.seats.reduce((n, s) => n + s.limit, 0),
                        )) *
                        100,
                    )}%`}
                    hint="Across your open batches"
                  />
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.55fr_1fr]">
        {data.canSeeBatches && (
          <Card>
            <CardTitle hint="Filled, being paid for, free">Seats by batch</CardTitle>
            {data.seats.length === 0 ? (
              <p className="text-[14px] text-muted">No open batches yet.</p>
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
    </div>
  );
}
