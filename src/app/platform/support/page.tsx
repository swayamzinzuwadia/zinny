import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Empty, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { forceEndSupportAction, leaveSupportAction, startSupportAction } from "@/modules/zinny-team-panel/actions";
import { NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { formatCount, formatDateTime, timeAgo, timeUntil } from "@/modules/zinny-team-panel/lib/format";
import { activeSessions, recentSessions, sessionState, supportPicker } from "@/modules/zinny-team-panel/services/support";

export const metadata = { title: "Support mode" };

export default async function SupportPage() {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.support_mode")) return <NoAccess section="Support mode" who="Super Admins and Support Agents" />;
  const [active, recent, picker] = await Promise.all([activeSessions(actor), recentSessions(actor, 25), supportPicker(actor)]);
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Support mode"
        subtitle="The Zinny team only enters a university's space through support mode. You act as yourself with Institute Admin powers for up to 2 hours, and every change is logged with who, what and when."
        actions={
          <Link href="/platform/support/log" className="inline-flex h-10 items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:border-brand/40">
            Activity log
          </Link>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1.55fr_1fr]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardTitle hint={active.length ? `${active.length} open` : undefined}>Who is in which university now</CardTitle>
            {active.length === 0 ? (
              <p className="rounded-2xl bg-canvas px-4 py-6 text-center text-[14px] text-muted">Nobody from the Zinny team is inside a university.</p>
            ) : (
              <ul className="space-y-3">
                {active.map((s) => {
                  const mine = s.staffUserId === actor.userId;
                  return (
                    <li key={s.id} id={`session-${s.id}`} className="scroll-mt-6 rounded-2xl border border-gold/40 bg-gold-soft/50 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 text-[14px]">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="now-dot inline-block h-2 w-2 rounded-full bg-gold" aria-hidden />
                            <span className="font-medium">{s.staffName}</span>
                            <span className="text-muted">in</span>
                            <span className="font-medium">{s.universityName}</span>
                            {mine && <Badge tone="gold">You</Badge>}
                          </div>
                          <div className="mt-1 text-muted">&ldquo;{s.reason}&rdquo;</div>
                          <div className="mt-1 text-[12.5px] text-muted">
                            Started {timeAgo(s.startedAt, now)} · ends in {timeUntil(s.expiresAt, now)} · {formatCount(s.actions)} change{s.actions === 1 ? "" : "s"} so far ·{" "}
                            <Link href={`/platform/support/log?scope=all&university=${s.universityId}&person=${s.staffUserId}`} className="text-brand hover:underline">
                              See activity
                            </Link>
                          </div>
                        </div>
                        {mine && (
                          <div className="flex items-center gap-3">
                            <a href={`/${s.slug}/admin`} className="text-[13px] font-medium text-brand hover:underline">
                              Go to {s.universityName}
                            </a>
                            <ActionForm action={leaveSupportAction}>
                              <input type="hidden" name="sessionId" value={s.id} />
                              <SubmitButton size="sm" variant="secondary">
                                Leave support mode
                              </SubmitButton>
                            </ActionForm>
                          </div>
                        )}
                      </div>
                      {!mine && (
                        <ActionForm action={forceEndSupportAction} className="mt-3 flex flex-wrap items-end gap-2" confirm={`End ${s.staffName}'s session at ${s.universityName} now?`}>
                          <input type="hidden" name="sessionId" value={s.id} />
                          <label className="min-w-[220px] flex-1">
                            <span className="sr-only">Why are you ending this session?</span>
                            <Input name="endReason" placeholder="Why you are ending it, e.g. ticket closed" required minLength={5} maxLength={300} />
                          </label>
                          <SubmitButton variant="danger" pendingText="Ending…">
                            Force-end session
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <div>
            <h2 className="mb-3 text-[17px] font-medium">Latest sessions</h2>
            {recent.length === 0 ? (
              <Empty title="No support sessions yet" />
            ) : (
              <Table head={["Started", "Who", "University", "Reason", "Changes", "Status"]}>
                {recent.map((s) => {
                  const state = sessionState(s, now);
                  return (
                    <tr key={s.id}>
                      <Td className="whitespace-nowrap text-muted">{formatDateTime(s.startedAt)}</Td>
                      <Td>{s.staffName}</Td>
                      <Td>{s.universityName}</Td>
                      <Td className="max-w-[260px] text-muted">{s.reason}</Td>
                      <Td className="tabular">
                        <Link href={`/platform/support/log?scope=all&university=${s.universityId}&person=${s.staffUserId}`} className="hover:text-brand">
                          {formatCount(s.actions)}
                        </Link>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {state === "open" ? (
                          <Badge tone="gold">Open</Badge>
                        ) : state === "expired" ? (
                          <Badge>Timed out</Badge>
                        ) : s.forcedByName ? (
                          <span title={`Ended by ${s.forcedByName}`}>
                            <Badge tone="warn">Ended by {s.forcedByName.split(" ")[0]}</Badge>
                          </span>
                        ) : (
                          <Badge tone="brand">Left</Badge>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </div>
        </div>

        <Card className="h-fit">
          <CardTitle>Start a support session</CardTitle>
          {picker.universities.length === 0 ? (
            <p className="text-[14px] text-muted">There are no universities yet.</p>
          ) : (
            <ActionForm action={startSupportAction} className="space-y-4" resetOnSuccess={false}>
              <Field label="University">
                <Select name="universityId" defaultValue={picker.lastUniversityId ?? undefined} required>
                  {picker.universities.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                      {u.status === "suspended" ? " (suspended)" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reason" hint="Logged with every change you make inside, like the ticket number and what you're fixing.">
                <Input name="reason" placeholder="Ticket 4512: help with batches" required minLength={5} maxLength={300} />
              </Field>
              <SubmitButton pendingText="Opening…">Enter support mode</SubmitButton>
              <p className="text-[12.5px] text-muted">You act as yourself, never as another person. Leave from the gold bar at the top when you are done.</p>
            </ActionForm>
          )}
        </Card>
      </div>
    </>
  );
}
