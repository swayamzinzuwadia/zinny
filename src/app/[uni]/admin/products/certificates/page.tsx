import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Empty, Field, Input, Notice, PageHeader, Select, Table, Td } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { createTemplateAction } from "@/modules/certificates/actions";
import { CertificateArt } from "@/modules/certificates/components/certificate-art";
import { StatusBadge } from "@/modules/certificates/components/status-badge";
import { shortDate, type EffectiveStatus } from "@/modules/certificates/lib";
import { DESIGNS } from "@/modules/certificates/render/designs";
import { canManageTemplates, canSeeTemplates, listTemplates, searchCertificates, templatePreviewSvg } from "@/modules/certificates/service";

export const metadata = { title: "Certificates" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const STATUSES: { key: EffectiveStatus | "all"; label: string }[] = [
  { key: "all", label: "Any status" },
  { key: "valid", label: "Valid" },
  { key: "expired", label: "Expired" },
  { key: "revoked", label: "Revoked" },
];

/** Products → Certificates: the university's templates and every certificate issued (within your reach). */
export default async function CertificatesPage({ params, searchParams }: { params: Promise<{ uni: string }>; searchParams: Promise<Search> }) {
  const { uni } = await params;
  const sp = await searchParams;
  const { actor } = await spaceContext(uni);
  const base = `/${uni}/admin/products/certificates`;

  if (!canSeeTemplates(actor)) {
    return (
      <>
        <PageHeader title="Certificates" />
        <Empty title="You don't have access to certificates">Ask an Institute Admin if you need it.</Empty>
      </>
    );
  }

  const canManage = canManageTemplates(actor);
  const templates = await listTemplates(actor, { includeArchived: canManage });
  const active = templates.filter((t) => !t.archivedAt);
  const archived = templates.filter((t) => t.archivedAt);
  const art = await Promise.all(active.map((t) => templatePreviewSvg(actor, t.id)));
  const unsigned = active.filter((t) => t.signatories.length === 0 || t.signatories.some((s) => !s.imageKey));

  const q = one(sp.q).slice(0, 100);
  const statusParam = one(sp.status);
  const status = (STATUSES.some((s) => s.key === statusParam) ? statusParam : "all") as EffectiveStatus | "all";
  const issued = await searchCertificates(actor, { q, status, limit: 100 }).catch(() => null);

  return (
    <>
      <div className="mb-2 text-sm text-muted">Products / Certificates</div>
      <PageHeader
        title="Certificates"
        subtitle="Your certificate templates and every certificate issued. Each course picks its template, validity and reminders on its own Certificates tab."
      />

      <section aria-labelledby="templates" className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="templates" className="text-[19px] font-semibold">
            Templates
          </h2>
          {!canManage && <Badge>View only</Badge>}
        </div>
        {canManage && unsigned.length > 0 && (
          <Notice tone="gold">
            {unsigned.length === 1 ? `${unsigned[0].name} is` : `${unsigned.length} templates are`} missing a signatory or a signature image. Open{" "}
            {unsigned.length === 1 ? "it" : "each one"} to add who signs, so certificates carry their signature.
          </Notice>
        )}
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {active.map((t, i) => (
            <Link key={t.id} href={`${base}/templates/${t.id}`} className="group block">
              <Card className="h-full p-4 transition-colors group-hover:border-brand/40">
                <CertificateArt svg={art[i]} label={`${t.name} template preview`} />
                <div className="mt-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold group-hover:text-brand">{t.name}</span>
                      {t.isDefault && <Badge tone="brand">Default</Badge>}
                    </div>
                    <div className="text-[13px] text-muted">
                      {DESIGNS[t.design].label} design · {t.courses === 1 ? "1 course" : `${t.courses} courses`} · {t.issued} issued
                    </div>
                  </div>
                  <span className="shrink-0 text-[13px] font-medium text-brand">{canManage ? "Edit" : "View"}</span>
                </div>
              </Card>
            </Link>
          ))}
          {canManage && (
            <Card className="h-full">
              <h3 className="mb-1 text-[17px] font-medium">Add a template</h3>
              <p className="mb-4 text-[13px] text-muted">Start from one of the three designs, then set its wording and signatories.</p>
              <ActionForm action={createTemplateAction} className="space-y-3">
                <input type="hidden" name="uni" value={uni} />
                <Field label="Name">
                  <Input name="name" placeholder="Workshop certificate" required minLength={2} maxLength={60} />
                </Field>
                <Field label="Design">
                  <Select name="design" defaultValue="classic">
                    {Object.entries(DESIGNS).map(([key, d]) => (
                      <option key={key} value={key}>
                        {d.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <SubmitButton variant="secondary">Add template</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
        {archived.length > 0 && (
          <p className="text-[13px] text-muted">
            Archived:{" "}
            {archived.map((t, i) => (
              <span key={t.id}>
                {i > 0 && ", "}
                <Link href={`${base}/templates/${t.id}`} className="underline underline-offset-2 hover:text-ink">
                  {t.name}
                </Link>
              </span>
            ))}
          </p>
        )}
      </section>

      {issued && (
        <section aria-labelledby="issued" className="mt-12 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="issued" className="text-[19px] font-semibold">
              Issued certificates
            </h2>
            <form method="get" className="flex flex-wrap gap-2">
              <div className="w-full sm:w-64">
                <Input name="q" defaultValue={q} placeholder="Student, course or code" aria-label="Search certificates" />
              </div>
              <div className="w-40">
                <Select name="status" defaultValue={status} aria-label="Status">
                {STATUSES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
                </Select>
              </div>
              <button type="submit" className="h-10 rounded-full border border-line bg-surface px-4 text-[14px] font-medium hover:border-brand/40">
                Search
              </button>
            </form>
          </div>
          {issued.rows.length === 0 ? (
            <Empty title={q || status !== "all" ? "No certificates match" : "No certificates issued yet"}>
              {q || status !== "all" ? "Try another name or code, or any status." : "They appear here as students complete courses."}
            </Empty>
          ) : (
            <Table head={["Student", "Course", "Code", "Issued", "Status"]}>
              {issued.rows.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <Link href={`${base}/issued/${c.id}`} className="font-medium hover:text-brand">
                      {c.studentName}
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/${uni}/admin/products/courses/${c.courseId}?tab=certificates`} className="hover:text-brand">
                      {c.courseTitle}
                    </Link>
                  </Td>
                  <Td className="tabular whitespace-nowrap font-mono text-[13px]">{c.displayCode}</Td>
                  <Td className="tabular whitespace-nowrap">
                    {shortDate(c.issuedOn)}
                    {c.source === "manual" && <span className="block text-[12px] text-muted">By hand</span>}
                  </Td>
                  <Td>
                    <StatusBadge status={c.status} />
                  </Td>
                </tr>
              ))}
            </Table>
          )}
          {issued.rows.length === 100 && <p className="text-[13px] text-muted">Showing the newest 100. Search to narrow the list.</p>}
        </section>
      )}
    </>
  );
}
