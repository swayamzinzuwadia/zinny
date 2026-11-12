import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Empty, Field, Input, Notice, PageHeader, Select, buttonClass } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { can } from "@/server/core";
import { DESCRIPTION_MAX, NAME_MAX, listCategories, type Category } from "@/modules/payments/categories";
import { archiveCategoryAction, createCategoryAction, restoreCategoryAction, updateCategoryAction } from "@/modules/payments/invoice-actions";

export const metadata = { title: "Invoice categories" };
export const dynamic = "force-dynamic";

const RATES = [0, 5, 12, 18, 28];

function Fields({ c, gstEnabled }: { c?: Category; gstEnabled: boolean }) {
  return (
    <>
      <Field label="Name" hint="What the invoice is for, like Exam fees or Hostel.">
        <Input name="name" defaultValue={c?.name ?? ""} required minLength={2} maxLength={NAME_MAX} />
      </Field>
      <Field label="Description (optional)">
        <Input name="description" defaultValue={c?.description ?? ""} maxLength={DESCRIPTION_MAX} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Default GST rate" hint={gstEnabled ? "New invoices start with this." : "Used once GST is turned on."}>
          <Select name="gstRate" defaultValue={String((c?.defaultGstRateBp ?? 1800) / 100)}>
            {RATES.map((r) => (
              <option key={r} value={r}>
                {r === 0 ? "0% (exempt)" : `${r}%`}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="SAC code (optional)" hint="Empty uses the institute's code.">
          <Input name="sacCode" defaultValue={c?.sacCode ?? ""} inputMode="numeric" pattern="99[0-9]{2}([0-9]{2})?" className="font-mono" placeholder="999299" />
        </Field>
      </div>
    </>
  );
}

export default async function CategoriesPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  const base = `/${uni}/admin/finance/invoices`;
  if (!can(actor, "finance.view", { universityId: university.id })) {
    return (
      <>
        <PageHeader title="Invoice categories" />
        <Empty title="You don't have access to invoice categories">Your role doesn&apos;t include Finance. Ask an Institute Admin if you need it.</Empty>
      </>
    );
  }
  const canManage = can(actor, "finance.manage", { universityId: university.id });
  const all = await listCategories(actor, { includeArchived: true });
  const live = all.filter((c) => !c.archived);
  const archived = all.filter((c) => c.archived);
  const gstEnabled = university.gstEnabled;

  return (
    <>
      <PageHeader
        title="Invoice categories"
        subtitle="Your own headings for what you bill. Each one sets the GST rate and SAC code its invoices start with, and gets its own line in the totals."
        actions={
          <Link href={base} className={buttonClass("secondary", "sm")}>
            All invoices
          </Link>
        }
      />

      {!gstEnabled && (
        <div className="mb-6">
          <Notice tone="neutral">
            GST is turned off for this institute, so invoices carry no tax whatever the rate here says. The rates are kept for when GST is turned back on.{" "}
            <Link href={`/${uni}/admin/finance/sales/settings`} className="font-medium text-brand hover:underline">
              Invoice settings
            </Link>
          </Notice>
        </div>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Card className="p-0">
            <ul className="divide-y divide-line">
              {live.map((c) => (
                <li key={c.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-medium">{c.name}</span>
                        {c.builtIn && <Badge tone="brand">Built in</Badge>}
                      </div>
                      {c.description && <div className="mt-0.5 text-[13px] text-muted">{c.description}</div>}
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-muted">
                        {c.builtIn ? (
                          <span>GST follows each course&apos;s own rate</span>
                        ) : (
                          <>
                            <span>GST {c.defaultGstRateBp / 100}%</span>
                            <span>
                              SAC <span className="font-mono">{c.sacCode ?? "institute's code"}</span>
                            </span>
                          </>
                        )}
                        <Link href={`${base}?category=${c.id}`} className="font-medium text-brand hover:underline">
                          {c.builtIn ? "See invoices" : `${c.invoices} ${c.invoices === 1 ? "invoice" : "invoices"}`}
                        </Link>
                      </div>
                    </div>
                    {canManage && !c.builtIn && (
                      <ActionForm action={archiveCategoryAction} confirm={`Archive ${c.name}? It stays on its invoices but can't be picked for new ones.`}>
                        <input type="hidden" name="uni" value={uni} />
                        <input type="hidden" name="categoryId" value={c.id} />
                        <SubmitButton variant="ghost" size="sm" pendingText="Archiving…">
                          Archive
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                  {canManage && !c.builtIn && (
                    <details className="group mt-2">
                      <summary className="cursor-pointer list-none text-[13px] font-medium text-brand hover:underline [&::-webkit-details-marker]:hidden">
                        <span className="group-open:hidden">Rename or change defaults</span>
                        <span className="hidden group-open:inline">Close</span>
                      </summary>
                      <ActionForm action={updateCategoryAction} className="mt-3 space-y-3 rounded-2xl bg-canvas p-4 ring-1 ring-line" resetOnSuccess={false}>
                        <input type="hidden" name="uni" value={uni} />
                        <input type="hidden" name="categoryId" value={c.id} />
                        <Fields c={c} gstEnabled={gstEnabled} />
                        <SubmitButton size="sm" pendingText="Saving…">
                          Save category
                        </SubmitButton>
                      </ActionForm>
                    </details>
                  )}
                  {c.builtIn && <p className="mt-2 text-[12.5px] text-muted">Course fees can&apos;t be renamed or archived: every order invoice needs it.</p>}
                </li>
              ))}
            </ul>
          </Card>

          {archived.length > 0 && (
            <Card className="p-0">
              <div className="border-b border-line px-6 py-4">
                <h2 className="text-[17px] font-medium">Archived</h2>
                <p className="mt-0.5 text-[13px] text-muted">Still shown on the invoices that used them. Restore one to pick it again.</p>
              </div>
              <ul className="divide-y divide-line">
                {archived.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5">
                    <div className="min-w-0">
                      <span className="text-[15px] text-muted">{c.name}</span>
                      <span className="ml-3 text-[12.5px] text-muted">
                        {c.invoices} {c.invoices === 1 ? "invoice" : "invoices"}
                      </span>
                    </div>
                    {canManage && (
                      <ActionForm action={restoreCategoryAction}>
                        <input type="hidden" name="uni" value={uni} />
                        <input type="hidden" name="categoryId" value={c.id} />
                        <SubmitButton variant="secondary" size="sm" pendingText="Restoring…">
                          Restore
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        {canManage ? (
          <Card>
            <CardTitle>Add a category</CardTitle>
            <ActionForm action={createCategoryAction} className="space-y-4">
              <input type="hidden" name="uni" value={uni} />
              <Fields gstEnabled={gstEnabled} />
              <SubmitButton pendingText="Adding…">Add category</SubmitButton>
            </ActionForm>
          </Card>
        ) : (
          <Card>
            <CardTitle>Categories</CardTitle>
            <p className="text-[14px] text-muted">Only Accounts &amp; Fees and Institute Admins can add or change categories.</p>
          </Card>
        )}
      </div>
    </>
  );
}
