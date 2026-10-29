import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { addContactAction, addNoteAction, makePrimaryContactAction, removeContactAction, updatePartnerAction } from "@/modules/zinny-team-panel/actions";
import { BackLink, NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { PARTNER_KIND_LABELS, PARTNER_KINDS, PARTNER_STATUS_LABELS, PARTNER_STATUSES } from "@/modules/zinny-team-panel/lib/constants";
import { formatDateTime } from "@/modules/zinny-team-panel/lib/format";
import { getPartner, partnerOwners } from "@/modules/zinny-team-panel/services/partners";

export const metadata = { title: "Partner" };

export default async function PartnerPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.partners")) return <NoAccess section="Partners" who="Super Admins and Partnerships" />;
  const { id } = await params;
  const data = await getPartner(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const owners = await partnerOwners(actor);
  const { partner: p, contacts, notes } = data;

  return (
    <>
      <BackLink href="/platform/partners">Partners</BackLink>
      <PageHeader
        title={p.name}
        subtitle={`${PARTNER_KIND_LABELS[p.kind]} · ${PARTNER_STATUS_LABELS[p.status]} · owned by ${data.ownerName ?? "nobody yet"}`}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardTitle>Details</CardTitle>
            <ActionForm action={updatePartnerAction} resetOnSuccess={false} className="space-y-3">
              <input type="hidden" name="partnerId" value={p.id} />
              <Field label="Name">
                <Input name="name" defaultValue={p.name} required minLength={2} maxLength={160} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Kind">
                  <Select name="kind" defaultValue={p.kind}>
                    {PARTNER_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {PARTNER_KIND_LABELS[k]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Status">
                  <Select name="status" defaultValue={p.status}>
                    {PARTNER_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {PARTNER_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Industry">
                  <Input name="industry" defaultValue={p.industry ?? ""} maxLength={120} />
                </Field>
                <Field label="City">
                  <Input name="city" defaultValue={p.city ?? ""} maxLength={120} />
                </Field>
              </div>
              <Field label="Website">
                <Input name="website" defaultValue={p.website ?? ""} maxLength={300} />
              </Field>
              <Field label="Owner on the Zinny team">
                <Select name="ownerUserId" defaultValue={p.ownerUserId ?? ""}>
                  <option value="">Unassigned</option>
                  {owners.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Summary" hint="What the partnership is about">
                <Textarea name="summary" defaultValue={p.summary ?? ""} maxLength={2000} />
              </Field>
              <SubmitButton>Save partner</SubmitButton>
            </ActionForm>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardTitle>Contacts</CardTitle>
            {contacts.length === 0 ? (
              <p className="text-[14px] text-muted">No contacts yet.</p>
            ) : (
              <ul className="divide-y divide-line text-[14px]">
                {contacts.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0">
                    <div className="min-w-0">
                      <div className="font-medium">
                        {c.name} {c.isPrimary && <Badge tone="brand">Main contact</Badge>}
                      </div>
                      <div className="text-[13px] text-muted">{[c.title, c.email, c.phone].filter(Boolean).join(" · ")}</div>
                    </div>
                    <div className="flex gap-2">
                      {!c.isPrimary && (
                        <ActionForm action={makePrimaryContactAction}>
                          <input type="hidden" name="contactId" value={c.id} />
                          <SubmitButton size="sm" variant="ghost">
                            Make main contact
                          </SubmitButton>
                        </ActionForm>
                      )}
                      <ActionForm action={removeContactAction} confirm={`Remove ${c.name}?`}>
                        <input type="hidden" name="contactId" value={c.id} />
                        <SubmitButton size="sm" variant="danger">
                          Remove
                        </SubmitButton>
                      </ActionForm>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <ActionForm action={addContactAction} className="mt-4 grid gap-2 border-t border-line pt-4 sm:grid-cols-2">
              <input type="hidden" name="partnerId" value={p.id} />
              <Input name="name" placeholder="Name" aria-label="Name" required />
              <Input name="title" placeholder="Job title" aria-label="Job title" />
              <Input name="email" type="email" placeholder="Email" aria-label="Email" />
              <Input name="phone" placeholder="Phone" aria-label="Phone" />
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" name="isPrimary" className="h-4 w-4 accent-[#0b5e4c]" /> Make main contact
              </label>
              <div className="sm:text-right">
                <SubmitButton size="sm" variant="secondary">
                  Add contact
                </SubmitButton>
              </div>
            </ActionForm>
          </Card>

          <Card>
            <CardTitle>Notes</CardTitle>
            <ActionForm action={addNoteAction} className="space-y-2">
              <input type="hidden" name="partnerId" value={p.id} />
              <Textarea name="body" placeholder="Call notes, next steps, what was agreed" required maxLength={4000} aria-label="Note" />
              <SubmitButton size="sm" variant="secondary">
                Add note
              </SubmitButton>
            </ActionForm>
            <ul className="mt-4 space-y-3">
              {notes.map((n) => (
                <li key={n.id} className="rounded-2xl bg-canvas p-3 text-[14px]">
                  <div className="text-[12.5px] text-muted">
                    {n.authorName ?? "Zinny team"} · {formatDateTime(n.createdAt)}
                  </div>
                  <p className="mt-1 whitespace-pre-line">{n.body}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
