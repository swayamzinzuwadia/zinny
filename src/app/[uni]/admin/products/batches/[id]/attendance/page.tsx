import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Empty, Field, Input, PageHeader, Stat, Table, Td, cx } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { setThresholdAction } from "@/modules/live-classes/actions";
import { KindNote, Pct, PctBar, StateBadge } from "@/modules/live-classes/components/bits";
import { RefreshEvery, StartClassButton } from "@/modules/live-classes/components/client";
import { registerHref, startHref } from "@/modules/live-classes/links";
import { batchAttendance } from "@/modules/live-classes/overview";
import { canSetThreshold } from "@/modules/live-classes/staff";
import { formatDay, formatTime, relativeDay } from "@/modules/live-classes/time";

export const metadata = { title: "Attendance" };
export const dynamic = "force-dynamic";

/** A batch's attendance (PRD page 7): every class with % present, each student's %, students below the threshold. */
export default async function AttendancePage({ params }: { params: Promise<{ uni: string; id: string }> }) {
  const { uni, id } = await params;
  const { actor } = await spaceContext(uni);
  const data = await batchAttendance(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const below = data.students.filter((s) => s.below && s.current);
  const showThreshold = canSetThreshold(actor);
  const onNow = data.past.find((s) => s.state === "live") ?? data.upcoming.find((s) => s.state === "open");

  return (
    <>
      <RefreshEvery seconds={60} />
      <div className="mb-2 text-sm text-muted">
        <Link href={`/${uni}/admin/products/courses/${data.batch.courseId}?tab=live`} className="hover:text-ink">
          {data.courseTitle}
        </Link>{" "}
        /{" "}
        <Link href={`/${uni}/admin/products/batches/${id}`} className="hover:text-ink">
          {data.batch.name}
        </Link>{" "}
        / Attendance
      </div>
      <PageHeader title={`Attendance, ${data.batch.name}`} subtitle={`${data.courseTitle}. Students below ${data.threshold}% are highlighted and get a reminder each Monday.`} />

      {onNow && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[22px] bg-gold-soft px-5 py-4">
          <div className="text-[15px]">
            <span className="font-medium">
              {onNow.state === "live" ? "On now" : "Opening now"}: {formatTime(onNow.startTime)} to {formatTime(onNow.endTime)}.
            </span>{" "}
            <span className="text-gold-strong">
              {onNow.present + onNow.late} of {onNow.total} joined
            </span>
          </div>
          <div className="flex gap-2">
            {data.canManage && <StartClassButton action={startHref(uni, id, onNow.date)} startTime={onNow.startTime} />}
            <Link href={registerHref(uni, id, onNow.date, onNow.startTime)} className="inline-flex h-8 items-center rounded-full border border-line bg-surface px-3.5 text-[13px] font-medium hover:border-brand/40">
              {data.canMark ? "Take attendance" : "Open register"}
            </Link>
          </div>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Attendance" value={<Pct value={data.overall} threshold={data.threshold} />} hint="Present and late, all recorded classes" />
        <Stat label="Classes recorded" value={data.recordedClasses} hint={data.unrecordedClasses ? `${data.unrecordedClasses} not recorded in Zinny` : "Every class so far"} />
        <Stat label={`Below ${data.threshold}%`} value={below.length} hint={below.length ? "Highlighted below" : "Nobody right now"} />
        <Stat label="Students" value={data.students.filter((s) => s.current).length} hint="Active in this batch" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <section>
          <h2 className="mb-3 text-[17px] font-semibold">Students</h2>
          {data.students.length === 0 ? (
            <Empty title="No students yet" />
          ) : (
            <Table head={["Student", "Attendance", "Present", "Late", "Absent", "Classes"]}>
              {data.students.map((s) => (
                <tr key={s.userId} className={cx(s.below && s.current && "bg-gold-soft/50")}>
                  <Td>
                    <div className="font-medium">{s.person.name}</div>
                    <div className="text-[13px] text-muted">
                      {s.person.email}
                      {!s.current && " · moved to another batch"}
                    </div>
                  </Td>
                  <Td className="w-48">
                    <div className="flex items-center gap-3">
                      <Pct value={s.percent} threshold={data.threshold} className="w-11 text-right" />
                      <div className="flex-1">
                        <PctBar value={s.percent} threshold={data.threshold} />
                      </div>
                    </div>
                    {s.below && s.current && <div className="mt-1 text-[12px] font-medium text-gold-strong">Below {data.threshold}%</div>}
                  </Td>
                  <Td className="tabular">{s.present}</Td>
                  <Td className="tabular">{s.late}</Td>
                  <Td className="tabular">{s.absent}</Td>
                  <Td className="tabular text-muted">{s.held}</Td>
                </tr>
              ))}
            </Table>
          )}
        </section>

        <div className="space-y-6">
          {data.upcoming.length > 0 && (
            <Card>
              <CardTitle>Coming up</CardTitle>
              <ul className="space-y-2 text-[14px]">
                {data.upcoming.map((s) => (
                  <li key={s.key} className="flex items-center justify-between gap-3">
                    <Link href={registerHref(uni, id, s.date, s.startTime)} className="hover:text-brand">
                      {relativeDay(s.date, data.today)}, {formatTime(s.startTime)}
                    </Link>
                    <span className="flex items-center gap-2">
                      <KindNote s={s} />
                      {s.state === "open" && <StateBadge state={s.state} />}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {showThreshold && (
            <Card>
              <CardTitle>Attendance threshold</CardTitle>
              <ActionForm action={setThresholdAction} resetOnSuccess={false} className="space-y-3">
                <input type="hidden" name="uni" value={uni} />
                <Field label="Minimum attendance" hint="For every batch in the university. Students below it are highlighted and alerted each week, with a summary for their HOD.">
                  <div className="flex items-center gap-2">
                    <Input name="threshold" type="number" min={1} max={100} step={1} defaultValue={data.threshold} className="w-24" required />
                    <span className="text-muted">%</span>
                  </div>
                </Field>
                <SubmitButton variant="secondary">Save threshold</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-[17px] font-semibold">Classes</h2>
        {data.past.length === 0 ? (
          <Empty title="No classes held yet">Each class appears here once it starts, with the share of students present.</Empty>
        ) : (
          <Table head={["Class", "Present", "Late", "Absent", "Attendance", "Register"]}>
            {data.past.map((s) => (
              <tr key={s.key}>
                <Td>
                  <Link href={registerHref(uni, id, s.date, s.startTime)} className="font-medium hover:text-brand">
                    {formatDay(s.date)}, {formatTime(s.startTime)}
                  </Link>
                  <div>
                    <KindNote s={s} />
                  </div>
                </Td>
                <Td className="tabular">{s.counts ? s.present : "–"}</Td>
                <Td className="tabular">{s.counts ? s.late : "–"}</Td>
                <Td className="tabular">{s.counts ? s.absent : "–"}</Td>
                <Td className="w-48">
                  {s.counts ? (
                    <div className="flex items-center gap-3">
                      <Pct value={s.percent} threshold={data.threshold} className="w-11 text-right" />
                      <div className="flex-1">
                        <PctBar value={s.percent} threshold={data.threshold} />
                      </div>
                    </div>
                  ) : s.state === "live" ? (
                    <span className="text-[13px] text-muted">
                      {s.present + s.late} of {s.total} joined so far
                    </span>
                  ) : (
                    <span className="text-[13px] text-faint">Not recorded in Zinny</span>
                  )}
                </Td>
                <Td>
                  {s.state === "live" ? (
                    <StateBadge state="live" />
                  ) : s.live?.lockedAt ? (
                    <Badge>Locked</Badge>
                  ) : s.counts ? (
                    <Badge>Not locked</Badge>
                  ) : (
                    <Link href={registerHref(uni, id, s.date, s.startTime)} className="text-[13px] text-brand hover:underline">
                      {data.canMark ? "Take attendance" : "View"}
                    </Link>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </>
  );
}
