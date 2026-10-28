import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { ActionForm, SubmitButton, type ActionState } from "@/components/forms";
import { Card, CardTitle, Field, Input, PageHeader, Table, Td } from "@/components/ui";
import { systemDb } from "@/db/client";
import { auditLog, supportSessions, universities, users } from "@/db/schema";
import { attempt, str } from "@/server/action";
import { signOut } from "@/server/auth/session";
import { canPlatform } from "@/server/authz/engine";
import { platformContext } from "@/server/context";
import { ForbiddenError } from "@/server/errors";
import { createUniversity, enterSupportMode, listUniversities } from "@/server/services/support";

export const metadata = { title: "Zinny team" };

/** Zinny team panel (PRD page 2): built alongside phase 1, starting with Super Admin and Support Agent. */
export default async function PlatformPage() {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.support_mode")) throw new ForbiddenError();
  const unis = await listUniversities(actor);
  const canCreate = canPlatform(actor, "platform.manage_universities");
  const trail = await systemDb()
    .select({ at: auditLog.at, action: auditLog.action, entity: auditLog.entity, who: users.name, uni: universities.name, reason: supportSessions.reason })
    .from(auditLog)
    .innerJoin(supportSessions, eq(supportSessions.id, auditLog.supportSessionId))
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .leftJoin(universities, eq(universities.id, auditLog.universityId))
    .orderBy(desc(auditLog.at))
    .limit(15);

  async function support(_: ActionState, data: FormData): Promise<ActionState> {
    "use server";
    const a = await platformContext();
    const slug = str(data, "slug");
    let ok = false;
    const res = await attempt(async () => {
      await enterSupportMode(a, str(data, "universityId"), str(data, "reason"));
      ok = true;
    });
    if (ok) redirect(`/${slug}/admin`);
    return res;
  }

  async function create(_: ActionState, data: FormData): Promise<ActionState> {
    "use server";
    const a = await platformContext();
    return attempt(async () => {
      const u = await createUniversity(a, {
        name: str(data, "name"),
        slug: str(data, "slug"),
        adminName: str(data, "adminName"),
        adminEmail: str(data, "adminEmail"),
      });
      return `${u.name} created. Its admin can sign in once they set a password.`;
    });
  }

  async function logout() {
    "use server";
    await signOut();
    redirect("/login");
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div className="text-[18px] font-semibold tracking-tight text-brand">zinny · team</div>
        <form action={logout}>
          <button className="text-sm text-muted">Sign out</button>
        </form>
      </div>
      <PageHeader title="Universities" subtitle="The Zinny team only enters a university's space through support mode. Every action inside is logged." />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <div className="grid gap-3 md:grid-cols-2">
            {unis.map((u) => (
              <Card key={u.id}>
                <div className="font-semibold">{u.name}</div>
                <div className="text-sm text-muted">/{u.slug}</div>
                <ActionForm action={support} className="mt-3 space-y-2">
                  <input type="hidden" name="universityId" value={u.id} />
                  <input type="hidden" name="slug" value={u.slug} />
                  <Input name="reason" placeholder="Reason, e.g. ticket #123" required />
                  <SubmitButton size="sm" variant="secondary">
                    Enter support mode
                  </SubmitButton>
                </ActionForm>
              </Card>
            ))}
          </div>
          <div>
            <h2 className="mb-3 text-[17px] font-semibold">Support-mode log</h2>
            <Table head={["When", "Who", "University", "What", "Reason"]}>
              {trail.map((t, i) => (
                <tr key={i}>
                  <Td className="whitespace-nowrap text-muted">{t.at.toLocaleString("en-IN")}</Td>
                  <Td>{t.who}</Td>
                  <Td>{t.uni}</Td>
                  <Td className="font-mono text-[13px]">{t.action}</Td>
                  <Td className="text-muted">{t.reason}</Td>
                </tr>
              ))}
            </Table>
          </div>
        </div>
        {canCreate && (
          <Card className="h-fit">
            <CardTitle>New university</CardTitle>
            <ActionForm action={create} className="space-y-3">
              <Field label="Name">
                <Input name="name" required />
              </Field>
              <Field label="Web address" hint="zinny.app/your-slug">
                <Input name="slug" placeholder="nmims" required />
              </Field>
              <Field label="Institute Admin name">
                <Input name="adminName" required />
              </Field>
              <Field label="Institute Admin email">
                <Input name="adminEmail" type="email" required />
              </Field>
              <SubmitButton>Create</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
      <p className="mt-8 text-sm text-muted">
        <Link href="/" className="text-brand">
          Back
        </Link>
      </p>
    </main>
  );
}
