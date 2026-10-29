import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Empty, Field, Input, PageHeader, Select, Table, Td, buttonClass } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { createPartnerAction } from "@/modules/zinny-team-panel/actions";
import { NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { PARTNER_KIND_LABELS, PARTNER_KINDS, PARTNER_STATUS_LABELS, PARTNER_STATUSES } from "@/modules/zinny-team-panel/lib/constants";
import { timeAgo } from "@/modules/zinny-team-panel/lib/format";
import { listPartners } from "@/modules/zinny-team-panel/services/partners";

export const metadata = { title: "Partners" };

const STATUS_TONE = { prospect: "neutral", in_talks: "gold", active: "brand", paused: "warn", ended: "neutral" } as const;

export default async function PartnersPage({ searchParams }: { searchParams: Promise<{ kind?: string; status?: string; q?: string }> }) {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.partners")) return <NoAccess section="Partners" who="Super Admins and Partnerships" />;
  const f = await searchParams;
  const { partners } = await listPartners(actor, f);
  const filtered = !!(f.kind || f.status || f.q);

  return (
    <>
      <PageHeader title="Sponsors and partners" subtitle="Sponsors and corporate partners for the marketplace, with their contacts, status and notes." />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <form className="mb-4 flex flex-wrap gap-2">
            <Select name="kind" defaultValue={f.kind ?? ""} aria-label="Kind" className="w-44">
              <option value="">Every kind</option>
              {PARTNER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PARTNER_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
            <Select name="status" defaultValue={f.status ?? ""} aria-label="Status" className="w-40">
              <option value="">Any status</option>
              {PARTNER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PARTNER_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
            <Input name="q" defaultValue={f.q ?? ""} placeholder="Name, industry or city" aria-label="Search" className="w-56" />
            <button className={buttonClass("secondary")}>Show</button>
            {filtered && (
              <Link href="/platform/partners" className={buttonClass("ghost")}>
                Clear
              </Link>
            )}
          </form>
          {partners.length === 0 ? (
            <Empty title={filtered ? "No partners match" : "No partners yet"}>{filtered ? "Try another filter." : "Add the first one on the right."}</Empty>
          ) : (
            <Table head={["Partner", "Kind", "Status", "Main contact", "Owner", "Last note"]}>
              {partners.map((p) => (
                <tr key={p.id} className="hover:bg-canvas/60">
                  <Td>
                    <Link href={`/platform/partners/${p.id}`} className="font-medium text-ink hover:text-brand">
                      {p.name}
                    </Link>
                    <div className="text-[12.5px] text-muted">{[p.industry, p.city].filter(Boolean).join(" · ")}</div>
                  </Td>
                  <Td>{PARTNER_KIND_LABELS[p.kind]}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[p.status]}>{PARTNER_STATUS_LABELS[p.status]}</Badge>
                  </Td>
                  <Td>
                    {p.primaryName ?? <span className="text-faint">None</span>}
                    {p.primaryEmail && <div className="text-[12.5px] text-muted">{p.primaryEmail}</div>}
                  </Td>
                  <Td className="text-muted">{p.ownerName ?? "Unassigned"}</Td>
                  <Td className="whitespace-nowrap text-muted">{p.lastNoteAt ? timeAgo(p.lastNoteAt) : "None"}</Td>
                </tr>
              ))}
            </Table>
          )}
        </div>

        <Card className="h-fit">
          <CardTitle>New partner</CardTitle>
          <ActionForm action={createPartnerAction} className="space-y-3">
            <Field label="Name">
              <Input name="name" required minLength={2} maxLength={160} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kind">
                <Select name="kind" required>
                  {PARTNER_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {PARTNER_KIND_LABELS[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Status">
                <Select name="status" defaultValue="prospect" required>
                  {PARTNER_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {PARTNER_STATUS_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Industry">
                <Input name="industry" maxLength={120} />
              </Field>
              <Field label="City">
                <Input name="city" maxLength={120} />
              </Field>
            </div>
            <Field label="Website">
              <Input name="website" placeholder="brightpath.in" maxLength={300} />
            </Field>
            <div className="border-t border-line pt-3">
              <p className="mb-2 text-[13px] font-medium">Main contact (optional)</p>
              <div className="space-y-3">
                <Input name="contactName" placeholder="Name" aria-label="Contact name" />
                <Input name="contactTitle" placeholder="Job title" aria-label="Contact job title" />
                <Input name="contactEmail" type="email" placeholder="Email" aria-label="Contact email" />
                <Input name="contactPhone" placeholder="Phone" aria-label="Contact phone" />
              </div>
            </div>
            <SubmitButton>Add partner</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
