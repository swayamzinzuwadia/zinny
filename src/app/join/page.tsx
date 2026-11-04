import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Field, Input, Select } from "@/components/ui";
import { currentUserId } from "@/server/auth/session";
import { findInstituteByCode, myJoinRequests } from "@/modules/identity/joining";
import { AuthShell } from "@/modules/identity/components/auth-shell";
import { InstituteCodeForm } from "@/modules/identity/components/auth-forms";
import { cancelJoinAction, joinAction } from "./actions";

export const metadata = { title: "Join an institute" };

const STATUS: Record<string, { label: string; tone: "gold" | "brand" | "neutral" | "danger" }> = {
  pending: { label: "Waiting", tone: "gold" },
  approved: { label: "Accepted", tone: "brand" },
  rejected: { label: "Not accepted", tone: "danger" },
  cancelled: { label: "Withdrawn", tone: "neutral" },
};

/**
 * For someone who already has a Zinny account (a marketplace learner, or a student of another
 * institute): enter a joining code, pick a department, and join or send a request.
 */
export default async function JoinPage({ searchParams }: { searchParams: Promise<{ code?: string; sent?: string }> }) {
  const userId = await currentUserId();
  if (!userId) redirect("/login?next=/join");
  const sp = await searchParams;
  const code = (sp.code ?? "").trim();
  const [target, requests] = await Promise.all([code ? findInstituteByCode(code) : null, myJoinRequests(userId)]);

  const history = requests.length > 0 && (
    <div className="mt-8">
      <h2 className="mb-3 text-[15px] font-medium">Your requests</h2>
      <ul className="space-y-2">
        {requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-line bg-surface px-4 py-3 text-[14px]">
            <span className="font-medium">{r.institute}</span>
            <Badge tone={STATUS[r.status]?.tone ?? "neutral"}>{STATUS[r.status]?.label ?? r.status}</Badge>
            {r.status === "approved" && (
              <Link href={`/${r.slug}/learn`} className="ml-auto text-brand hover:underline">
                Open
              </Link>
            )}
            {r.status === "pending" && (
              <ActionForm action={cancelJoinAction} className="ml-auto">
                <input type="hidden" name="requestId" value={r.id} />
                <SubmitButton variant="ghost" size="sm" pendingText="Withdrawing…">
                  Withdraw
                </SubmitButton>
              </ActionForm>
            )}
            {r.decisionNote && <p className="w-full text-[13px] text-muted">{r.decisionNote}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
  const back = (
    <p className="mt-6 text-[14px] text-muted">
      <Link href="/marketplace" className="text-brand hover:underline">
        Back to the marketplace
      </Link>
    </p>
  );

  if (target) {
    return (
      <AuthShell
        title={`Join ${target.name}`}
        subtitle={target.joinMode === "approval" ? "They accept each new student. We'll let you know when they answer." : "You'll join straight away."}
      >
        <ActionForm action={joinAction} className="space-y-4">
          <input type="hidden" name="code" value={target.code} />
          {target.departments.length > 0 && (
            <Field label="Your department" hint="Your institute confirms which departments you belong to.">
              <Select name="departmentId" defaultValue="">
                <option value="">I&apos;m not sure</option>
                {target.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {target.joinMode === "approval" && (
            <Field label="A note for the institute" hint="Optional. For example, your roll number or class.">
              <Input name="message" maxLength={300} />
            </Field>
          )}
          <SubmitButton pendingText="Sending…">{target.joinMode === "approval" ? "Send request" : `Join ${target.name}`}</SubmitButton>
        </ActionForm>
        <p className="mt-4 text-[14px] text-muted">
          <Link href="/join" className="text-brand hover:underline">
            Use a different code
          </Link>
        </p>
        {history}
        {back}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={sp.sent ? "Request sent" : "Join an institute"}
      subtitle={sp.sent ? "The institute will accept or decline it. Until then, the marketplace is yours to use." : "Enter the joining code your institute gave you."}
    >
      <InstituteCodeForm code={code} notFound={!!code} action="/join" />
      {history}
      {back}
    </AuthShell>
  );
}
