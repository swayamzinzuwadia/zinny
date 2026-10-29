import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Empty, Field, Input, PageHeader, Select, cx } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { createChallengeAction } from "@/modules/gamification/actions";
import { CHALLENGE_METRICS, METRICS } from "@/modules/gamification/catalog";
import { listChallenges } from "@/modules/gamification/challenges";
import { ProgressBar } from "@/modules/gamification/components/board";
import { NoAccess, SectionNav, unlessForbidden } from "@/modules/gamification/components/staff";
import { addDays, formatDay, plural } from "@/modules/gamification/util";

export const metadata = { title: "Challenges" };

type Item = Awaited<ReturnType<typeof listChallenges>>["active"][number];

const STATUS = {
  active: { label: "Running", tone: "brand" },
  upcoming: { label: "Starts soon", tone: "neutral" },
  ended: { label: "Ended", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "warn" },
} as const;

function daysLeftText(n: number) {
  return n === 0 ? "Ends today" : n === 1 ? "Ends tomorrow" : `${n} days left`;
}

function ChallengeCard({ uni, c }: { uni: string; c: Item }) {
  const s = STATUS[c.status];
  return (
    <Link href={`/${uni}/admin/leaderboards/challenges/${c.id}`} className="group block">
      <Card className="h-full p-5 transition group-hover:border-brand/40">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[16px] font-medium group-hover:text-brand">{c.title}</h3>
            <p className="text-[13px] text-muted">{c.scopeName}</p>
          </div>
          <Badge tone={s.tone}>{s.label}</Badge>
        </div>
        <p className="mt-3 text-[14px]">{c.goal}</p>
        <p className="text-[13px] text-muted">
          {formatDay(c.startDate, { year: false })} to {formatDay(c.endDate)}
        </p>
        {(c.status === "active" || c.status === "ended") && (
          <div className="mt-4 space-y-2">
            <ProgressBar value={c.finished} target={Math.max(1, c.members)} label={`${c.finished} of ${c.members} students finished`} />
            <div className="flex flex-wrap justify-between gap-2 text-[13px]">
              <span className="text-muted">
                {c.finished} of {plural(c.members, "student", "students")} {c.status === "ended" ? "finished" : "finished so far"}
              </span>
              {c.daysLeft !== null && <span className={cx(c.daysLeft <= 1 ? "font-medium text-gold-strong" : "text-muted")}>{daysLeftText(c.daysLeft)}</span>}
            </div>
            {c.leader && (
              <p className="text-[13px] text-muted">
                {c.status === "ended" ? "First" : "Leading"}: <span className="font-medium text-ink">{c.leader.name}</span>, {c.leader.value.toLocaleString("en-IN")}{" "}
                {METRICS[c.metric].unit(c.leader.value)}
              </p>
            )}
          </div>
        )}
        {c.status === "upcoming" && <p className="mt-3 text-[13px] text-muted">{plural(c.members, "student", "students")} will take part.</p>}
      </Card>
    </Link>
  );
}

export default async function ChallengesPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  const data = await unlessForbidden(listChallenges(actor));
  if (!data) return <NoAccess title="Challenges" />;
  const canCreate = data.scopes.length > 0;
  const groups = [
    { key: "active", title: "Running now", items: data.active },
    { key: "upcoming", title: "Starting soon", items: data.upcoming },
    { key: "ended", title: "Ended", items: data.ended },
  ].filter((g) => g.items.length > 0);

  return (
    <>
      <SectionNav uni={uni} active="/challenges" />
      <PageHeader title="Challenges" subtitle="Time-bound goals for a batch or a whole course. Progress updates live, and the students who reach the target first are listed when it ends." />
      <div className={cx("grid gap-6", canCreate && "xl:grid-cols-[1fr_360px]")}>
        <div className="min-w-0 space-y-8">
          {groups.length === 0 && (
            <Empty title="No challenges yet">{canCreate ? "Set the first one on the right, like 8 lessons in two weeks." : "Challenges for your batches will show here."}</Empty>
          )}
          {groups.map((g) => (
            <section key={g.key}>
              <h2 className="mb-3 text-[17px] font-medium">
                {g.title} <span className="text-[14px] font-normal text-muted">{g.items.length}</span>
              </h2>
              <div className="grid gap-4 md:grid-cols-2">
                {g.items.map((c) => (
                  <ChallengeCard key={c.id} uni={uni} c={c} />
                ))}
              </div>
            </section>
          ))}
        </div>

        {canCreate && (
          <Card className="h-fit">
            <CardTitle>New challenge</CardTitle>
            <ActionForm action={createChallengeAction} className="space-y-4">
              <input type="hidden" name="uni" value={uni} />
              <Field label="Title">
                <Input name="title" placeholder="Weekend sprint" required maxLength={80} />
              </Field>
              <Field label="Description" hint="Optional. Tell students why it matters.">
                <Input name="description" placeholder="Catch up before the mid-term test" maxLength={300} />
              </Field>
              <Field label="For">
                <Select name="scope" required>
                  {data.scopes.map((g) => (
                    <optgroup key={g.courseTitle} label={g.courseTitle}>
                      {g.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-[1fr_110px] gap-3">
                <Field label="Counts">
                  <Select name="metric" defaultValue="lessons_completed">
                    {CHALLENGE_METRICS.map((m) => (
                      <option key={m} value={m}>
                        {METRICS[m].label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Target">
                  <Input name="target" type="number" inputMode="numeric" min={1} defaultValue={8} required />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Starts">
                  <Input name="startDate" type="date" defaultValue={data.today} required />
                </Field>
                <Field label="Ends">
                  <Input name="endDate" type="date" defaultValue={addDays(data.today, 13)} min={data.today} required />
                </Field>
              </div>
              <SubmitButton>Set challenge</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
