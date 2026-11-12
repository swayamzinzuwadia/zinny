import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Empty, Field, Input, PageHeader, Select, Td } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { forceEndSupportAction, leaveSupportAction, startSupportAction } from "@/modules/zinny-team-panel/actions";
import { NoAccess, PanelTable } from "@/modules/zinny-team-panel/components/bits";
import { PersonActions } from "@/modules/zinny-team-panel/components/person-actions";
import { isSuperAdmin } from "@/modules/zinny-team-panel/lib/access";
import { institutePeople } from "@/modules/zinny-team-panel/services/people";
import { ROLE_LABELS } from "@/server/authz/roles";
import { formatCount, formatDateTime, timeAgo, timeUntil } from "@/modules/zinny-team-panel/lib/format";
import { activeSessions, recentSessions, sessionState, supportPicker } from "@/modules/zinny-team-panel/services/support";
import { firstName } from "@/server/lib/names";

export const metadata = { title: "Support mode" };

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ university?: string }> }) {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.support_mode")) return <NoAccess section="Support mode" />;
  const { university } = await searchParams;
  const [active, recent, picker] = await Promise.all([activeSessions(actor), recentSessions(actor, 25), supportPicker(actor)]);
  const now = new Date();
  // An institute's page links here with it picked; otherwise you pick one yourself.
  const picked = picker.universities.some((u) => u.id === university) ? university! : "";
  // Super Admins can also become one of the institute's people instead of acting as themselves.
  const superAdmin = isSuperAdmin(actor);
  const pickedPeople = superAdmin && picked ? await institutePeople(actor, picked, 6) : null;
  const pickedName = picker.universities.find((u) => u.id === picked)?.name;

  return (
    <>
      <PageHeader
        title="Support mode"
        subtitle="The Zinny team only enters an institute's space through support mode. You act as yourself with Institute Admin powers for up to 2 hours, and every change is logged with who, what and when."
        actions={
          <Link href="/platform/support/log" className="inline-flex h-10 items-center whitespace-nowrap rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:border-brand/40">
            Activity log
          </Link>
        }
      />

      <div className="grid gap-6 grid-cols-1 xl:grid-cols-[1.55fr_1fr]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardTitle hint={active.length ? `${active.length} open` : undefined}>Who is in which institute now</CardTitle>
            {active.length === 0 ? (
              <p className="rounded-2xl bg-canvas px-4 py-6 text-center text-[14px] text-muted">Nobody from the Zinny team is inside an institute.</p>
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
              <PanelTable head={["Started", "Who and where", "Reason", "Changes", "Status"]}>
                {recent.map((s) => {
                  const state = sessionState(s, now);
                  return (
                    <tr key={s.id}>
                      <Td className="text-muted 2xl:whitespace-nowrap">{formatDateTime(s.startedAt)}</Td>
                      <Td>
                        <div className="whitespace-nowrap">{s.staffName}</div>
                        <div className="text-[12.5px] text-muted">{s.universityName}</div>
                      </Td>
                      <Td className="min-w-[180px] text-muted">{s.reason}</Td>
                      <Td className="tabular">
                        <Link
                          href={`/platform/support/log?scope=all&university=${s.universityId}&person=${s.staffUserId}`}
                          className="text-brand hover:underline"
                          aria-label={`See the ${formatCount(s.actions)} changes in the activity log`}
                        >
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
                            <Badge tone="warn">Ended by {firstName(s.forcedByName)}</Badge>
                          </span>
                        ) : (
                          <Badge tone="brand">Left</Badge>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </PanelTable>
            )}
          </div>
        </div>

        <div className="min-w-0 space-y-6">
        <Card className="h-fit">
          <CardTitle>Start a support session</CardTitle>
          {picker.universities.length === 0 ? (
            <p className="text-[14px] text-muted">There are no institutes yet.</p>
          ) : (
            <ActionForm action={startSupportAction} className="space-y-4" resetOnSuccess={false}>
              <Field label="Institute">
                <Select name="universityId" defaultValue={picked} required>
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
              <Field label="Reason" hint="Logged with every change you make inside, like the ticket number and what you're fixing.">
                <Input name="reason" placeholder="Ticket 4512: help with batches" required minLength={5} maxLength={300} />
              </Field>
              <SubmitButton pendingText="Opening…">Enter support mode</SubmitButton>
              <p className="text-[12.5px] text-muted">In support mode you act as yourself. Leave from the gold bar at the top when you are done.</p>
            </ActionForm>
          )}
        </Card>
        {superAdmin && (
          <Card className="h-fit">
            <CardTitle hint="Super Admins only">Sign in as one of its people</CardTitle>
            <p className="text-[14px] text-muted">
              To see or fix something exactly as a person has it, sign in as them. You get everything they can do for up to 2 hours, and each change is recorded as them with your name
              alongside.
            </p>
            {pickedPeople && pickedPeople.rows.length > 0 ? (
              <>
                <ul className="mt-4 divide-y divide-line">
                  {pickedPeople.rows.map((p) => (
                    <li key={p.userId} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <Link href={`/platform/people/${p.userId}`} className="block truncate text-[14px] font-medium hover:text-brand">
                          {p.name}
                        </Link>
                        <div className="truncate text-[12.5px] text-muted">{p.roles.map((r) => ROLE_LABELS[r]).join(", ")}</div>
                      </div>
                      <PersonActions userId={p.userId} name={p.name} universityId={picked} self={p.userId === actor.userId} />
                    </li>
                  ))}
                </ul>
                <Link href={`/platform/people?university=${picked}`} className="mt-4 inline-block text-[13px] font-medium text-brand hover:underline">
                  All {formatCount(pickedPeople.total)} people at {pickedName}
                </Link>
              </>
            ) : (
              <form action="/platform/people" className="mt-4 flex flex-wrap gap-2" role="search">
                {picked && <input type="hidden" name="university" value={picked} />}
                <label className="min-w-[180px] flex-1">
                  <span className="sr-only">Find a person</span>
                  <Input name="q" placeholder="Name, email or phone" />
                </label>
                <button className="h-10 rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:border-brand/40">Find person</button>
              </form>
            )}
          </Card>
        )}
        </div>
      </div>
    </>
  );
}
