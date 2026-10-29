import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Field, Input, Notice, PageHeader, Stat, cx } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { AppError, NotFoundError } from "@/server/errors";
import { lockRegisterAction, saveLinksAction, unlockRegisterAction } from "@/modules/live-classes/actions";
import { KindNote, LinkText, StateBadge } from "@/modules/live-classes/components/bits";
import { RefreshEvery, StartClassButton } from "@/modules/live-classes/components/client";
import { RegisterForm, type RegisterRow } from "@/modules/live-classes/components/register-form";
import { WindowRail } from "@/modules/live-classes/components/window-rail";
import { attendanceHref, registerHref, startHref } from "@/modules/live-classes/links";
import { register, START_OPENS_MINUTES, type Register } from "@/modules/live-classes/staff";
import { clockIn, formatDay, formatTime } from "@/modules/live-classes/time";

export const metadata = { title: "Attendance register" };
export const dynamic = "force-dynamic";

const NOTICES: Record<string, string> = {
  too_early: `You can start a class from ${START_OPENS_MINUTES} minutes before it begins.`,
  ended: "This class has already ended, so it can't be started.",
  no_link: "This class has no meeting link. Add one below, or on the batch page, then start it.",
  forbidden: "You can't start this class. Only its faculty, the HOD and admins can.",
  not_found: "That class isn't on this batch's timetable.",
};

function detail(e: Register["entries"][number], tz: string): string {
  if (e.source === "join") return `Joined at ${clockIn(e.joinedAt!, tz)}${e.joins > 1 ? `, ${e.joins} times` : ""}`;
  if (e.source === "staff") return `Marked by ${e.markedBy ?? "staff"}${e.joinedAt ? `. Joined at ${clockIn(e.joinedAt, tz)}` : ""}`;
  if (e.source === "system") return "Automatic: didn't join";
  if (e.source === "auto") return "Automatic: didn't join";
  return e.lateEnrolment ? "Not counted" : "Hasn't joined yet";
}

/** One class's attendance register: the roster with automatic statuses, changes with notes, lock and unlock. */
export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ uni: string; id: string; date: string }>;
  searchParams: Promise<{ start?: string; notice?: string }>;
}) {
  const { uni, id, date } = await params;
  const { start, notice } = await searchParams;
  const { actor } = await spaceContext(uni);
  const now = new Date();
  const result = await register(actor, { batchId: id, date, startTime: start && /^\d{2}:\d{2}$/.test(start) ? start : null }, now).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof AppError && e.code !== "forbidden") return e;
    throw e;
  });

  if (result instanceof AppError) {
    const to = (result.details as { to?: { date: string; startTime: string } } | undefined)?.to;
    return (
      <>
        <PageHeader title={`Class on ${formatDay(date)}`} />
        <Notice tone="warn">{result.message}</Notice>
        <div className="mt-4 flex gap-4 text-[14px]">
          {to && (
            <Link className="font-medium text-brand hover:underline" href={registerHref(uni, id, to.date, to.startTime)}>
              Open the register for {formatDay(to.date)}
            </Link>
          )}
          <Link className="text-brand hover:underline" href={attendanceHref(uni, id)}>
            Back to attendance
          </Link>
        </div>
      </>
    );
  }

  const r = result;
  const s = r.session;
  const locked = !!r.lockedAt;
  const editable = r.canMark && !locked && r.markable;
  const rows: RegisterRow[] = r.entries.map((e) => ({
    userId: e.person.id,
    name: e.person.name,
    email: e.person.email,
    status: e.status,
    detail: detail(e, r.tz),
    note: e.note ?? "",
    current: e.current,
    lateEnrolment: e.lateEnrolment,
  }));
  const ref = { uni, batchId: id, date: s.date, start: s.startTime };
  const canStartNow = r.canManage && s.state !== "ended" && s.window.startsAt.getTime() - now.getTime() <= START_OPENS_MINUTES * 60_000;

  return (
    <>
      {(s.state === "live" || s.state === "open") && <RefreshEvery seconds={30} />}
      <div className="mb-2 text-sm text-muted">
        <Link href={`/${uni}/admin/products/batches/${id}`} className="hover:text-ink">
          {r.courseTitle}, {r.batch.name}
        </Link>{" "}
        /{" "}
        <Link href={attendanceHref(uni, id)} className="hover:text-ink">
          Attendance
        </Link>
      </div>
      <PageHeader
        title={`${formatDay(s.date)}, ${formatTime(s.startTime)} to ${formatTime(s.endTime)}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StateBadge state={s.state} />
            {locked && <Badge>Locked by {r.lockedBy ?? "staff"}</Badge>}
            <KindNote s={s} />
            {r.startedAt && <span>Started at {clockIn(r.startedAt, r.tz)}{r.startedBy ? ` by ${r.startedBy}` : ""}</span>}
          </span>
        }
        actions={canStartNow && r.meetingUrl ? <StartClassButton action={startHref(uni, id, s.date)} startTime={s.startTime} size="md" /> : null}
      />

      {notice && NOTICES[notice] && (
        <div className="mb-5">
          <Notice tone="warn">{NOTICES[notice]}</Notice>
        </div>
      )}

      {r.sameDay.length > 1 && (
        <div className="mb-5 flex flex-wrap gap-2 text-[13px]">
          <span className="self-center text-muted">Classes this day:</span>
          {r.sameDay.map((x) => (
            <Link
              key={x.startTime}
              href={registerHref(uni, id, x.date, x.startTime)}
              className={cx("rounded-full border px-3 py-1", x.startTime === s.startTime ? "border-brand bg-brand-soft text-brand-strong" : "border-line hover:border-brand/40")}
            >
              {formatTime(x.startTime)}
            </Link>
          ))}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Present" value={s.present} />
        <Stat label="Late" value={s.late} hint={`Joined after ${clockIn(new Date(s.window.startsAt.getTime() + 10 * 60_000), r.tz)}`} />
        <Stat label="Absent" value={s.absent} />
        <Stat label={s.state === "ended" ? "Attendance" : "Not joined yet"} value={s.state === "ended" ? (s.percent === null ? "–" : `${s.percent}%`) : s.pending} hint={`Out of ${s.total}`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <section>
          {!r.markable && (
            <div className="mb-4">
              <Notice tone="neutral">
                The register opens at {clockIn(s.window.opensAt, r.tz)}, when students can start joining. Statuses fill in as they join.
              </Notice>
            </div>
          )}
          {locked && (
            <div className="mb-4">
              <Notice tone="neutral">
                This register is locked{r.canUnlock ? ". Unlock it to make a correction." : ". Ask a HOD or admin to unlock it if something needs correcting."}
              </Notice>
            </div>
          )}
          {s.state === "ended" && !s.recorded && !locked && (
            <div className="mb-4">
              <Notice tone="neutral">Nobody joined this class through Zinny. If it was held, mark who attended; until then it doesn&apos;t count towards percentages.</Notice>
            </div>
          )}
          {rows.length === 0 ? (
            <Notice tone="neutral">No students in this batch.</Notice>
          ) : (
            <RegisterForm uni={uni} batchId={id} date={s.date} start={s.startTime} rows={rows} editable={editable} />
          )}
        </section>

        <div className="space-y-6">
          <Card>
            <CardTitle>When students can join</CardTitle>
            <WindowRail window={s.window} tz={r.tz} now={now} />
          </Card>

          {r.canMark && (s.state === "live" || s.state === "ended") && (
            <Card>
              <CardTitle>{locked ? "Locked" : "Lock the register"}</CardTitle>
              {locked ? (
                <>
                  <p className="text-[14px] text-muted">
                    Locked by {r.lockedBy ?? "staff"} on {formatDay(new Date(r.lockedAt!).toISOString().slice(0, 10))}. Faculty can&apos;t change it now.
                  </p>
                  {r.canUnlock && (
                    <ActionForm action={unlockRegisterAction} className="mt-3" resetOnSuccess={false}>
                      <Hidden {...ref} />
                      <SubmitButton variant="secondary">Unlock register</SubmitButton>
                    </ActionForm>
                  )}
                </>
              ) : (
                <ActionForm
                  action={lockRegisterAction}
                  resetOnSuccess={false}
                  confirm={s.pending ? `Lock the register? ${s.pending} student${s.pending === 1 ? "" : "s"} without a status will be marked absent.` : undefined}
                >
                  <Hidden {...ref} />
                  <p className="mb-3 text-[14px] text-muted">
                    Locking saves the register as final. {s.pending ? "Students without a status are marked absent. " : ""}Only a HOD or admin can unlock it.
                  </p>
                  <SubmitButton variant="secondary">Lock register</SubmitButton>
                </ActionForm>
              )}
            </Card>
          )}

          <Card>
            <CardTitle>Links</CardTitle>
            <div className="mb-3 text-[14px]">
              <div className="text-muted">Students join at</div>
              {r.meetingUrl ? (
                <a href={r.meetingUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                  <LinkText url={r.meetingUrl} />
                </a>
              ) : (
                <span className="text-gold-strong">No link yet. Students can&apos;t join until there is one.</span>
              )}
              {r.meetingUrl && <div className="text-[12px] text-muted">{r.usesBatchLink ? "The batch's link" : "This class's own link"}</div>}
            </div>
            {r.recordingUrl && (
              <div className="mb-3 text-[14px]">
                <div className="text-muted">Recording</div>
                <a href={r.recordingUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                  <LinkText url={r.recordingUrl} />
                </a>
              </div>
            )}
            {r.canManage && (
              <ActionForm action={saveLinksAction} resetOnSuccess={false} className="space-y-3 border-t border-line pt-3">
                <Hidden {...ref} />
                <Field label="Link for this class only" hint="Leave empty to use the batch's link.">
                  <Input name="meetingUrl" type="url" placeholder="https://meet.google.com/…" defaultValue={r.usesBatchLink ? "" : (r.meetingUrl ?? "")} />
                </Field>
                {s.state !== "upcoming" && (
                  <Field label="Recording link" hint="Students see it in their past classes.">
                    <Input name="recordingUrl" type="url" placeholder="https://drive.google.com/…" defaultValue={r.recordingUrl ?? ""} />
                  </Field>
                )}
                <SubmitButton variant="secondary">Save links</SubmitButton>
              </ActionForm>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Hidden({ uni, batchId, date, start }: { uni: string; batchId: string; date: string; start: string }) {
  return (
    <>
      <input type="hidden" name="uni" value={uni} />
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="start" value={start} />
    </>
  );
}
