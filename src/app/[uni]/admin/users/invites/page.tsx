import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Avatar, Badge, Card, CardTitle, Empty, PageHeader, Stat, Table, Td } from "@/components/ui";
import { can } from "@/server/authz/engine";
import { spaceContext } from "@/server/context";
import { canSeeInvites, listInvites, type InviteRow } from "@/modules/identity/invites";
import { getSignInSettings } from "@/modules/identity/settings";
import { formatWhen } from "@/modules/identity/emails";
import { ConfirmButton } from "@/modules/identity/components/profile-forms";
import { phoneSignInAction, resendInviteAction, revokeInviteAction } from "./actions";

export const metadata = { title: "Invitations" };

const STATUS: Record<InviteRow["status"], { label: string; tone: "gold" | "neutral" | "brand" | "warn" }> = {
  pending: { label: "Waiting", tone: "brand" },
  expired: { label: "Link expired", tone: "gold" },
  not_sent: { label: "Not sent", tone: "neutral" },
};

function relative(d: Date, now: Date) {
  const mins = Math.round((now.getTime() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default async function InvitesPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);

  if (!canSeeInvites(actor)) {
    return (
      <>
        <PageHeader title="Invitations" />
        <Empty title="You don't have access to invitations">Institute Admins and Heads of Department manage invitations.</Empty>
      </>
    );
  }

  const now = new Date();
  const { open, accepted } = await listInvites(actor, { now });
  const isAdmin = can(actor, "settings.manage", { universityId: university.id });
  const settings = isAdmin ? await getSignInSettings(actor) : null;
  const tz = university.timezone;
  const waiting = open.filter((r) => r.status === "pending").length;
  const expired = open.filter((r) => r.status === "expired").length;
  const notSent = open.filter((r) => r.status === "not_sent").length;

  return (
    <>
      <PageHeader
        title="Invitations"
        subtitle={
          <>
            People you add get an email to set their password. The link works once, for 7 days. Resend it if it expired or got lost; revoke it if it
            went to the wrong person. {can(actor, "user.manage_roles", { universityId: university.id }) ? "" : "You see faculty in your own department."}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Waiting to join" value={waiting} />
        <Stat label="Links expired" value={expired} hint={expired ? "Resend so they can join" : undefined} />
        <Stat label="Never sent" value={notSent} />
        <Stat label="Joined in 30 days" value={accepted.length} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          {open.length === 0 ? (
            <Empty title="Everyone has joined">
              Nobody is waiting on an invitation. Add people under{" "}
              <Link href={`/${uni}/admin/users/students`} className="text-brand hover:underline">
                Users
              </Link>{" "}
              and they&apos;ll be invited automatically.
            </Empty>
          ) : (
            <Table head={["Person", "Role", "Status", ""]}>
              {open.map((r) => (
                <tr key={r.userId} className={r.status === "expired" ? "bg-gold-soft/40" : undefined}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar name={r.name} size={34} />
                      <div className="min-w-0">
                        <div className="font-medium">{r.name}</div>
                        <div className="truncate text-[13px] text-muted">{r.email}</div>
                      </div>
                    </div>
                  </Td>
                  <Td className="text-[14px]">{r.roleLabel}</Td>
                  <Td>
                    <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                    <div className="mt-1 text-[12px] text-muted">
                      {r.sentAt
                        ? `Sent ${relative(r.sentAt, now)}${r.sends > 1 ? ` (${r.sends} times)` : ""}`
                        : r.sends > 0
                          ? "Previous link revoked"
                          : "No email sent yet"}
                      {r.status === "pending" && r.expiresAt && <span className="block">Works until {formatWhen(r.expiresAt, tz)}</span>}
                      {r.status === "expired" && r.expiresAt && <span className="block text-gold-strong">Expired {formatWhen(r.expiresAt, tz)}</span>}
                    </div>
                  </Td>
                  <Td className="text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <ActionForm action={resendInviteAction} className="text-left">
                        <input type="hidden" name="uni" value={uni} />
                        <input type="hidden" name="userId" value={r.userId} />
                        <SubmitButton size="sm" variant={r.status === "pending" ? "secondary" : "primary"} pendingText="Sending…">
                          {r.status === "not_sent" ? "Send invitation" : "Resend"}
                        </SubmitButton>
                      </ActionForm>
                      {r.inviteId && (
                        <ConfirmButton
                          action={revokeInviteAction}
                          fields={{ uni, inviteId: r.inviteId }}
                          confirm={`Revoke the invitation for ${r.name}? The link stops working. They keep their role until you remove it under Users.`}
                          pendingText="Revoking…"
                          variant="danger"
                        >
                          Revoke
                        </ConfirmButton>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}

          {accepted.length > 0 && (
            <Card>
              <CardTitle hint="Last 30 days">Recently joined</CardTitle>
              <ul className="divide-y divide-line">
                {accepted.map((a) => (
                  <li key={`${a.userId}-${a.acceptedAt.getTime()}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[14px]">
                    <span>
                      <span className="font-medium">{a.name}</span> <span className="text-muted">· {a.roleLabel}</span>
                    </span>
                    <span className="text-[13px] text-muted">Joined {relative(a.acceptedAt, now)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {settings && (
            <Card className="h-fit">
              <CardTitle>Sign-in options</CardTitle>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">Sign in with a mobile number</div>
                  <p className="mt-1 text-[13px] text-muted">
                    Adds a Mobile number tab to the sign-in page. People get a 6-digit code by SMS to the number on their profile.
                  </p>
                </div>
                <Badge tone={settings.phoneSignIn ? "brand" : "neutral"}>{settings.phoneSignIn ? "On" : "Off"}</Badge>
              </div>
              <ActionForm action={phoneSignInAction} className="mt-4" resetOnSuccess={false}>
                <input type="hidden" name="uni" value={uni} />
                <input type="hidden" name="on" value={settings.phoneSignIn ? "0" : "1"} />
                <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
                  {settings.phoneSignIn ? "Turn off phone sign-in" : "Turn on phone sign-in"}
                </SubmitButton>
              </ActionForm>
            </Card>
          )}
          <Card className="h-fit text-[14px]">
            <CardTitle>How invitations work</CardTitle>
            <ul className="space-y-2 text-muted">
              <li>Adding someone under Users, or by CSV import, sends their invitation automatically.</li>
              <li>Resending sends a new link. Any older link stops working.</li>
              <li>Revoking stops the link but keeps their role. Remove the role under Users to take away access.</li>
              <li>Someone who already has a Zinny password isn&apos;t invited: they sign in as usual.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
