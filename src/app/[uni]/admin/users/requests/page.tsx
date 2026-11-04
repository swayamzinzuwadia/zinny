import { ActionForm, SubmitButton } from "@/components/forms";
import { Avatar, Badge, Card, CardTitle, Empty, Notice, PageHeader, buttonClass, inputClass } from "@/components/ui";
import { can, reach } from "@/server/authz/engine";
import { spaceContext } from "@/server/context";
import { listDepartments } from "@/server/services/departments";
import { appUrl } from "@/server/auth/config";
import { canAdmit, getJoinSettings, listJoinRequests } from "@/modules/identity/joining";
import { formatWhen } from "@/modules/identity/emails";
import { decideJoinAction, joinModeAction, newJoinCodeAction } from "./actions";

export const metadata = { title: "Join requests" };

/**
 * Students who used the institute's joining code and are waiting to be let in. Accepting
 * puts them in the ticked departments; they then see those departments' courses only.
 * Admins see every request; a HOD sees the ones for their department.
 */
export default async function JoinRequestsPage({ params, searchParams }: { params: Promise<{ uni: string }>; searchParams: Promise<{ done?: string }> }) {
  const { uni } = await params;
  const { done } = await searchParams;
  const { actor, university } = await spaceContext(uni);

  if (!canAdmit(actor)) {
    return (
      <>
        <PageHeader title="Join requests" />
        <Empty title="You don't have access to join requests">Institute Admins and Heads of Department accept new students.</Empty>
      </>
    );
  }

  const r = reach(actor, "user.admit", university.id);
  const [pending, decided, allDepartments, settings] = await Promise.all([
    listJoinRequests(actor, "pending"),
    listJoinRequests(actor, "decided"),
    listDepartments(actor),
    getJoinSettings(actor),
  ]);
  const mine = allDepartments.filter((d) => r.all || r.departmentIds.has(d.id));
  const deptName = new Map(allDepartments.map((d) => [d.id, d.name]));
  const isAdmin = can(actor, "settings.manage", { universityId: university.id });
  const tz = university.timezone;
  const link = `${appUrl()}/signup?code=${settings.code}`;

  return (
    <>
      <PageHeader
        title="Join requests"
        subtitle={
          r.all
            ? "Students who used your joining code. Accept them into their departments: they see only those departments' courses."
            : "Students asking to join your department. Accept them, and they see your department's courses."
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {done && <Notice>{done}</Notice>}
          {pending.length === 0 && <Empty title="No one is waiting">New requests appear here, and on your dashboard.</Empty>}
          {pending.map((q) => (
            <Card key={q.id}>
              <div className="flex items-start gap-3">
                <Avatar name={q.name} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{q.name}</div>
                  <div className="text-[13px] break-all text-muted">{q.email}</div>
                  <div className="mt-1 text-[13px] text-muted">
                    Asked {formatWhen(q.createdAt, tz)}
                    {q.departmentId && deptName.has(q.departmentId) ? ` · for ${deptName.get(q.departmentId)}` : " · didn't pick a department"}
                  </div>
                  {q.message && <p className="mt-2 rounded-xl bg-canvas px-3 py-2 text-[14px]">“{q.message}”</p>}
                </div>
              </div>
              <ActionForm action={decideJoinAction} className="mt-4 space-y-3">
                <input type="hidden" name="uni" value={uni} />
                <input type="hidden" name="requestId" value={q.id} />
                <input type="hidden" name="name" value={q.name} />
                <fieldset>
                  <legend className="mb-1.5 text-[13px] font-medium">Departments</legend>
                  <div className="flex flex-wrap gap-2">
                    {mine.map((d) => (
                      <label key={d.id} className="cursor-pointer">
                        <input type="checkbox" name="departmentId" value={d.id} defaultChecked={d.id === q.departmentId} className="peer sr-only" />
                        <span className="inline-flex h-9 items-center rounded-full border border-line px-3.5 text-[13px] peer-checked:border-brand peer-checked:bg-brand-soft peer-checked:font-medium peer-checked:text-brand-strong peer-focus-visible:ring-2 peer-focus-visible:ring-gold">
                          {d.name}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <input name="note" maxLength={300} placeholder="A note for the student (optional)" className={inputClass} />
                <div className="flex flex-wrap gap-2">
                  <button type="submit" name="choice" value="accept" className={buttonClass("primary", "sm")}>
                    Accept into ticked departments
                  </button>
                  <button type="submit" name="choice" value="decline" className={buttonClass("ghost", "sm")}>
                    Decline
                  </button>
                </div>
              </ActionForm>
            </Card>
          ))}

          {decided.length > 0 && (
            <Card>
              <CardTitle>Answered</CardTitle>
              <ul className="divide-y divide-line text-[14px]">
                {decided.map((q) => (
                  <li key={q.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                    <span className="font-medium">{q.name}</span>
                    <span className="text-muted">{q.email}</span>
                    <Badge tone={q.status === "approved" ? "brand" : "neutral"}>{q.status === "approved" ? "Accepted" : "Declined"}</Badge>
                    {q.decidedAt && <span className="ml-auto text-[13px] text-muted">{formatWhen(q.decidedAt, tz)}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <Card className="h-fit text-[14px]">
          <CardTitle>Joining code</CardTitle>
          <div className="tabular text-[28px] font-semibold tracking-[0.2em] text-brand-strong">{settings.code}</div>
          <p className="mt-2 text-muted">
            Students enter it when they sign up, or later under Join an institute. Share this link too:
          </p>
          <p className="mt-1 break-all text-ink">{link}</p>
          <p className="mt-4 text-muted">
            {settings.mode === "approval" ? "Each student waits here until someone accepts them." : "Students with the code join straight away. Add their departments under Students."}
          </p>
          {isAdmin && (
            <>
              <ActionForm action={joinModeAction} className="mt-4 space-y-2" resetOnSuccess={false}>
                <input type="hidden" name="uni" value={uni} />
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-[13px] font-medium">When a student uses the code</legend>
                  {(
                    [
                      ["approval", "Ask Admins or HODs to accept them"],
                      ["instant", "Let them in straight away"],
                    ] as const
                  ).map(([value, label]) => (
                    <label key={value} className="flex cursor-pointer items-center gap-2.5">
                      <input type="radio" name="mode" value={value} defaultChecked={settings.mode === value} className="accent-brand" />
                      {label}
                    </label>
                  ))}
                </fieldset>
                <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
                  Save
                </SubmitButton>
              </ActionForm>
              <ActionForm action={newJoinCodeAction} className="mt-4 border-t border-line pt-4" confirm="The old code will stop working. Make a new one?">
                <input type="hidden" name="uni" value={uni} />
                <SubmitButton size="sm" variant="ghost" pendingText="Making a new code…">
                  Make a new code
                </SubmitButton>
              </ActionForm>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
