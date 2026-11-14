import Link from "next/link";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Badge, Card, CardTitle, Field, Input, buttonClass, cx } from "@/components/ui";
import { can, type Actor } from "@/server/core";
import { markRestPresentAction } from "../actions";
import { registerHref, startHref } from "../links";
import type { TodayClass } from "../overview";
import { addDays, clockIn, formatTime } from "../time";
import { StateBadge } from "./bits";
import { StartClassButton } from "./client";
import { registerButton } from "./staff";

/**
 * "Today" on the dashboard: every class of the day in the person's reach, each with what
 * they can do to it right here. Take attendance opens the register (everyone starts as
 * present); "Everyone was present" saves it in one click; Cancel and Move change the
 * timetable and tell the students, without leaving the dashboard.
 */
export function TodayPanel({
  uni,
  actor,
  classes,
  today,
  tz,
  cancelAction,
  moveAction,
  notice,
  bare = false,
}: {
  uni: string;
  actor: Actor;
  classes: TodayClass[];
  today: string;
  tz: string;
  cancelAction: FormAction;
  moveAction: FormAction;
  /** What just happened to a class that left the list (cancelled or moved). */
  notice?: string;
  /** Without its own card: the dashboard puts it under a heading in "Today and needs you". */
  bare?: boolean;
}) {
  const body = (
    <>
      {notice && <p className="mb-3 rounded-xl bg-brand-soft px-4 py-3 text-[14px] text-brand-strong">{notice}</p>}
      {classes.length === 0 ? (
        <p className="py-2 text-[14px] text-muted">No classes today in your batches.</p>
      ) : (
        <ul className="divide-y divide-line">
          {classes.map((s) => {
            const target = { universityId: actor.universityId!, departmentIds: [s.departmentId], batchIds: [s.batchId] };
            const canEdit = can(actor, "batch.update", target) && s.kind === "regular" && s.state !== "ended";
            const locked = !!s.live?.lockedAt;
            const markable = s.canMark && s.state !== "upcoming" && !locked;
            const fresh = markable && s.entries.every((e) => !e.status);
            // One primary per row: Start class while the class can be started, else the register.
            const startFirst = s.canStart && !!s.link && s.state !== "ended";
            const hidden = (
              <>
                <input type="hidden" name="uni" value={uni} />
                <input type="hidden" name="batchId" value={s.batchId} />
                <input type="hidden" name="date" value={s.date} />
                <input type="hidden" name="start" value={s.startTime} />
                <input type="hidden" name="label" value={`${s.courseTitle}, ${s.batchName}`} />
              </>
            );
            return (
              <li key={s.key} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="tabular text-[13px] text-muted">
                        {formatTime(s.startTime)} to {formatTime(s.endTime)}
                      </span>
                      {s.state !== "upcoming" && <StateBadge state={s.state} />}
                      {s.kind === "extra" && <Badge>Extra class</Badge>}
                      {s.kind === "rescheduled" && <Badge>Moved here</Badge>}
                      {locked && <Badge>Locked</Badge>}
                    </div>
                    <Link href={`/${uni}/admin/products/batches/${s.batchId}`} className="text-[14px] font-medium hover:text-brand">
                      {s.courseTitle}, {s.batchName}
                    </Link>
                  </div>
                  <div className="tabular shrink-0 text-right text-[14px]">
                    {s.state === "upcoming" || !s.recorded ? (
                      <span className="text-muted">
                        {s.total} student{s.total === 1 ? "" : "s"}
                      </span>
                    ) : (
                      <>
                        <span className="font-medium">{s.present + s.late}</span>
                        <span className="text-muted">
                          {" "}
                          of {s.total} {s.state === "ended" ? "attended" : "joined"}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1">
                  {s.canStart && s.link && (
                    <StartClassButton action={startHref(uni, s.batchId, s.date)} startTime={s.startTime} variant={startFirst ? "primary" : "quiet"} />
                  )}
                  {s.canMark && s.state !== "upcoming" && (
                    <Link
                      href={registerHref(uni, s.batchId, s.date, s.startTime)}
                      className={buttonClass(startFirst ? "quiet" : fresh ? "primary" : "secondary", "sm")}
                    >
                      {registerButton(s)}
                    </Link>
                  )}
                  {/* Kept mounted once marked, so "8 students marked present" stays after the refresh. */}
                  {markable && (
                    <ActionForm action={markRestPresentAction} resetOnSuccess={false} className={fresh ? undefined : "contents"}>
                      {hidden}
                      {fresh && (
                        <SubmitButton size="sm" variant="quiet" pendingText="Saving…">
                          Mark everyone present
                        </SubmitButton>
                      )}
                    </ActionForm>
                  )}
                  {s.canMark && s.state === "upcoming" && <span className="text-[13px] text-muted">Attendance opens at {clockIn(s.window.opensAt, tz)}</span>}
                  {canEdit && (
                    <ActionForm action={cancelAction} resetOnSuccess={false} confirm={`Cancel ${s.courseTitle}, ${s.batchName} at ${formatTime(s.startTime)} today? Its students are told straight away.`}>
                      {hidden}
                      <SubmitButton size="sm" variant="quiet" pendingText="Cancelling…">
                        Cancel class
                      </SubmitButton>
                    </ActionForm>
                  )}
                  {canEdit && (
                    <details className="group w-full sm:w-auto">
                      <summary className={cx(buttonClass("quiet", "sm"), "cursor-pointer list-none")}>Move class</summary>
                      <ActionForm action={moveAction} resetOnSuccess={false} className="mt-3 grid grid-cols-1 gap-3 rounded-xl bg-canvas p-4 sm:grid-cols-3">
                        {hidden}
                        <Field label="New day">
                          <Input type="date" name="newDate" defaultValue={addDays(today, 1)} min={today} required />
                        </Field>
                        <Field label="From">
                          <Input type="time" name="startTime" defaultValue={s.startTime} required />
                        </Field>
                        <Field label="To">
                          <Input type="time" name="endTime" defaultValue={s.endTime} required />
                        </Field>
                        <div className="sm:col-span-3">
                          <Field label="Note for students (optional)">
                            <Input name="note" maxLength={200} placeholder="Teacher is unwell" />
                          </Field>
                        </div>
                        <div className="sm:col-span-3">
                          <SubmitButton size="sm" pendingText="Moving…">
                            Move class and tell students
                          </SubmitButton>
                        </div>
                      </ActionForm>
                    </details>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
  if (bare) return body;
  return (
    <Card>
      <CardTitle hint={classes.length ? `${classes.length} class${classes.length === 1 ? "" : "es"}` : undefined}>Today&apos;s classes</CardTitle>
      {body}
    </Card>
  );
}
