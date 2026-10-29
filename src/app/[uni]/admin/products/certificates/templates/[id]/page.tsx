import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Empty, Notice, PageHeader, buttonClass } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import {
  archiveTemplateAction,
  removeSignatureAction,
  restoreTemplateAction,
  setDefaultTemplateAction,
  uploadSignatureAction,
} from "@/modules/certificates/actions";
import { TemplateEditor } from "@/modules/certificates/components/template-editor";
import { DESIGNS } from "@/modules/certificates/render/designs";
import { canManageTemplates, canSeeTemplates, getTemplate, templatePreviewSvg, templateSignatureUrls } from "@/modules/certificates/service";

export const metadata = { title: "Certificate template" };

export default async function TemplatePage({ params }: { params: Promise<{ uni: string; id: string }> }) {
  const { uni, id } = await params;
  const { actor } = await spaceContext(uni);
  const base = `/${uni}/admin/products/certificates`;
  if (!canSeeTemplates(actor)) {
    return (
      <>
        <PageHeader title="Certificate template" />
        <Empty title="You don't have access to certificates">Ask an Institute Admin if you need it.</Empty>
      </>
    );
  }
  const t = await getTemplate(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const canManage = canManageTemplates(actor) && !t.archivedAt;
  const [svg, signatureUrls] = await Promise.all([templatePreviewSvg(actor, id), templateSignatureUrls(actor, id)]);
  const hidden = (
    <>
      <input type="hidden" name="uni" value={uni} />
      <input type="hidden" name="templateId" value={id} />
    </>
  );

  return (
    <>
      <div className="mb-2 text-sm text-muted">
        Products /{" "}
        <Link href={base} className="hover:text-ink">
          Certificates
        </Link>{" "}
        / Templates
      </div>
      <PageHeader
        title={t.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {t.isDefault && <Badge tone="brand">Default</Badge>}
            {t.archivedAt && <Badge>Archived</Badge>}
            <span>
              {DESIGNS[t.design].label} design · used by {t.courses === 1 ? "1 course" : `${t.courses} courses`} · {t.issued} issued
            </span>
          </span>
        }
        actions={
          <a href={`${base}/templates/${id}/sample`} className={buttonClass("secondary")}>
            Download a sample PDF
          </a>
        }
      />

      {t.issued > 0 && !t.archivedAt && (
        <div className="mb-6">
          <Notice tone="neutral">Changes apply to certificates issued from now on. The {t.issued} already issued keep the wording and signatures they were issued with.</Notice>
        </div>
      )}
      {t.archivedAt && (
        <div className="mb-6">
          <Notice tone="warn">This template is archived, so no course can use it. Restore it to edit or use it again.</Notice>
        </div>
      )}

      <TemplateEditor
        uni={uni}
        templateId={id}
        canManage={canManage}
        initial={{ name: t.name, design: t.design, heading: t.heading, intro: t.intro, body: t.body, signatories: t.signatories }}
        initialSvg={svg}
        designs={Object.entries(DESIGNS).map(([key, d]) => ({ key, label: d.label, description: d.description }))}
      />

      {canManage && (
        <div className="mt-6 grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
          <Card>
            <CardTitle hint="PNG or JPEG, up to 500 KB">Signatures</CardTitle>
            {t.signatories.length === 0 ? (
              <p className="text-[14px] text-muted">Add a signatory above and save the template, then upload their signature here.</p>
            ) : (
              <div className="space-y-5">
                {t.signatories.map((s, i) => (
                  <div key={i} className="space-y-3 border-b border-line pb-5 last:border-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3 text-[14px]">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{s.name}</div>
                        {s.title && <div className="truncate text-[13px] text-muted">{s.title}</div>}
                      </div>
                      {signatureUrls[i] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={signatureUrls[i]!} alt={`Signature of ${s.name}`} className="h-12 w-auto max-w-[160px] rounded-lg bg-white object-contain ring-1 ring-line" />
                      ) : (
                        <Badge tone="gold">No signature</Badge>
                      )}
                    </div>
                    <ActionForm action={uploadSignatureAction} className="flex flex-wrap items-center gap-2">
                      {hidden}
                      <input type="hidden" name="index" value={i} />
                      <input
                        type="file"
                        name="signature"
                        accept="image/png,image/jpeg"
                        required
                        aria-label={`Signature image for ${s.name}`}
                        className="min-w-0 flex-1 text-[13px] file:mr-3 file:rounded-full file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-[13px]"
                      />
                      <SubmitButton size="sm" variant="secondary" pendingText="Uploading…">
                        {signatureUrls[i] ? "Replace signature" : "Upload signature"}
                      </SubmitButton>
                    </ActionForm>
                    {signatureUrls[i] && (
                      <ActionForm action={removeSignatureAction}>
                        {hidden}
                        <input type="hidden" name="index" value={i} />
                        <button className="text-[13px] text-muted underline underline-offset-2 hover:text-danger">Remove signature</button>
                      </ActionForm>
                    )}
                  </div>
                ))}
                <p className="text-[12px] text-muted">A signature on a white or transparent background, cropped close, prints best.</p>
              </div>
            )}
          </Card>

          <Card className="h-fit">
            <CardTitle>Template settings</CardTitle>
            <div className="space-y-4 text-[14px]">
              {t.isDefault ? (
                <p className="text-muted">This is the default template. Courses without a template of their own use it.</p>
              ) : (
                <ActionForm action={setDefaultTemplateAction} className="flex flex-wrap items-center justify-between gap-3" resetOnSuccess={false}>
                  {hidden}
                  <span className="text-muted">Use this for every course that hasn&apos;t picked a template.</span>
                  <SubmitButton size="sm" variant="secondary">
                    Make default
                  </SubmitButton>
                </ActionForm>
              )}
              {!t.isDefault && (
                <ActionForm
                  action={archiveTemplateAction}
                  className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4"
                  confirm={`Archive ${t.name}? Courses can no longer pick it. Certificates already issued are not affected.`}
                  resetOnSuccess={false}
                >
                  {hidden}
                  <span className="text-muted">Archive it when no course uses it any more.</span>
                  <SubmitButton size="sm" variant="danger">
                    Archive template
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
          </Card>
        </div>
      )}

      {t.archivedAt && canManageTemplates(actor) && (
        <ActionForm action={restoreTemplateAction} className="mt-6" resetOnSuccess={false}>
          {hidden}
          <SubmitButton variant="secondary">Restore template</SubmitButton>
        </ActionForm>
      )}
    </>
  );
}
