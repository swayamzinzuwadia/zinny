import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Avatar, Badge, Card, CardTitle, Empty, PageHeader, Stat, Table, Td, cx } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { cancelChallengeAction } from "@/modules/gamification/actions";
import { METRICS } from "@/modules/gamification/catalog";
import { getChallenge, ordinal } from "@/modules/gamification/challenges";
import { ProgressBar } from "@/modules/gamification/components/board";
import { NoAccess, unlessForbidden } from "@/modules/gamification/components/staff";
import { formatDay } from "@/modules/gamification/util";

export const metadata = { title: "Challenge" };

const STATUS = {
  active: { label: "Running", tone: "brand" },
  upcoming: { label: "Starts soon", tone: "neutral" },
  ended: { label: "Ended", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "warn" },
} as const;

export default async function ChallengePage({ params }: { params: Promise<{ uni: string; id: string }> }) {
  const { uni, id } = await params;
  const { actor, university } = await spaceContext(uni);
  const data = await unlessForbidden(
    getChallenge(actor, id).catch((e) => {
      if (e instanceof NotFoundError) notFound();
      throw e;
    }),
  );
  if (!data) return <NoAccess title="Challenge" />;
  const { challenge: c, rows, winners } = data;
  const s = STATUS[data.status];
  const unit = (n: number) => METRICS[c.metric].unit(n);
  const finished = rows.filter((r) => r.reachedAt).length;
  const time = (d: Date) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: university.timezone }).format(d);

  return (
    <>
      <div className="mb-2 text-sm text-muted">
        <Link href={`/${uni}/admin/leaderboards/challenges`} className="hover:text-ink">
          Challenges
        </Link>{" "}
        / {data.scopeName}
      </div>
      <PageHeader
        title={c.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={s.tone}>{s.label}</Badge>
            <span>
              {data.goal}, {formatDay(c.startDate, { year: false })} to {formatDay(c.endDate)}
            </span>
          </span>
        }
        actions={
          data.canManage && (data.status === "active" || data.status === "upcoming") ? (
            <ActionForm action={cancelChallengeAction} resetOnSuccess={false} confirm="Cancel this challenge? Students will no longer see it.">
              <input type="hidden" name="uni" value={uni} />
              <input type="hidden" name="challengeId" value={c.id} />
              <SubmitButton variant="danger">Cancel challenge</SubmitButton>
            </ActionForm>
          ) : null
        }
      />
      {c.description && <p className="-mt-4 mb-6 max-w-2xl text-[15px] text-muted">{c.description}</p>}

      <div className="mb-6 grid grid-cols-3 gap-3">
        <Stat label="Students" value={rows.length || "–"} />
        <Stat label="Reached the target" value={data.status === "upcoming" || data.status === "cancelled" ? "–" : finished} />
        <Stat
          label={data.status === "ended" ? "Ended on" : data.status === "upcoming" ? "Starts on" : "Days left"}
          value={data.status === "ended" ? formatDay(c.endDate, { year: false }) : data.status === "upcoming" ? formatDay(c.startDate, { year: false }) : (data.daysLeft ?? "–")}
          hint={data.status === "active" && data.daysLeft === 0 ? "Last day" : undefined}
        />
      </div>

      {data.status === "ended" && (
        <Card className="mb-6">
          <CardTitle hint={c.closedAt ? "Final" : "Being finalised"}>Winners</CardTitle>
          {winners.length === 0 ? (
            <p className="text-[14px] text-muted">Nobody reached the target this time.</p>
          ) : (
            <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {winners.map((w) => (
                <li key={w.userId} className={cx("flex items-center gap-3 rounded-2xl border p-3", w.position === 1 ? "border-brand-deep bg-brand-deep text-canvas" : "border-line")}>
                  <span
                    className={cx(
                      "tabular inline-flex h-8 min-w-8 items-center justify-center rounded-full px-1 text-[13px] font-semibold",
                      w.position === 1 ? "bg-canvas text-brand-deep" : "bg-brand-soft text-brand-strong",
                    )}
                  >
                    {ordinal(w.position!)}
                  </span>
                  <Avatar name={w.name} size={32} />
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium">{w.name}</div>
                    <div className={cx("text-[12px]", w.position === 1 ? "text-canvas/70" : "text-muted")}>Reached it {time(w.reachedAt!)}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}

      {data.status === "upcoming" || data.status === "cancelled" ? (
        <Empty title={data.status === "upcoming" ? "Not started yet" : "This challenge was cancelled"}>
          {data.status === "upcoming" ? `Progress shows here from ${formatDay(c.startDate)}.` : "Students no longer see it."}
        </Empty>
      ) : rows.length === 0 ? (
        <Empty title="No students in this batch yet" />
      ) : (
        <Table head={["", "Student", "Progress", "Reached the target"]}>
          {rows.map((r) => (
            <tr key={r.userId}>
              <Td className="tabular w-12 text-muted">{r.position ? ordinal(r.position) : ""}</Td>
              <Td>
                <span className="flex items-center gap-2.5">
                  <Avatar name={r.name} size={28} />
                  <span className="font-medium">{r.name}</span>
                </span>
              </Td>
              <Td className="w-[40%]">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <ProgressBar value={r.value} target={c.target} label={`${r.name}: ${r.value} of ${c.target}`} />
                  </div>
                  <span className="tabular w-24 shrink-0 text-right text-[13px] text-muted">
                    {Math.min(r.value, c.target).toLocaleString("en-IN")} of {c.target.toLocaleString("en-IN")} {unit(c.target)}
                  </span>
                </div>
              </Td>
              <Td className="text-[13px] text-muted">{r.reachedAt ? time(r.reachedAt) : ""}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
