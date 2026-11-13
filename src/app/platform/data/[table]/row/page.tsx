import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardTitle, Field, Input, Notice, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { platformContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { BackLink, NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { DataField } from "@/modules/zinny-team-panel/components/data-fields";
import { deleteRowAction, saveRowAction } from "@/modules/zinny-team-panel/data-actions";
import { DELETE_WORD, getRow } from "@/modules/zinny-team-panel/data-console";
import { isSuperAdmin } from "@/modules/zinny-team-panel/lib/access";
import { dataTableHref, encodeRowKey } from "@/modules/zinny-team-panel/lib/data-links";
import { formatCount } from "@/modules/zinny-team-panel/lib/format";

export const metadata = { title: "Row · Data" };

export default async function DataRowPage({ params, searchParams }: { params: Promise<{ table: string }>; searchParams: Promise<{ key?: string; added?: string }> }) {
  const actor = await platformContext();
  if (!isSuperAdmin(actor)) return <NoAccess section="Data" who="Only Super Admins" />;
  const { table } = await params;
  const sp = await searchParams;
  const detail = await getRow(actor, table, sp.key ?? "").catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { table: t, row, institute, pointers } = detail;
  const linked = pointers.filter((p) => p.rows > 0);
  const key = encodeRowKey(row.key);
  const uni = t.name === "universities" ? row.values.id : row.values.university_id;
  const editable = t.columns.filter((c) => !c.secret);
  const hidden = t.columns.filter((c) => c.secret);

  return (
    <>
      <BackLink href={dataTableHref(t.name)}>{t.label}</BackLink>
      <PageHeader
        title={`Row in ${t.label.toLowerCase()}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-[13px]">{t.name}</span>
            <span className="break-all font-mono text-[13px] text-faint">{row.key.join(" · ")}</span>
          </span>
        }
      />

      {sp.added && (
        <div className="mb-5">
          <Notice>Added the row. The change is in the activity log.</Notice>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0">
          <CardTitle hint={`${t.columns.length} columns`}>Edit row</CardTitle>
          <ActionForm action={saveRowAction} resetOnSuccess={false}>
            <input type="hidden" name="table" value={t.name} />
            <input type="hidden" name="key" value={key} />
            <div className="grid grid-cols-1 gap-x-5 gap-y-5 lg:grid-cols-2">
              {editable.map((c) => (
                <div key={c.name} className={c.kind === "json" || c.kind === "array" || (c.kind === "text" && (row.values[c.name]?.length ?? 0) > 100) ? "lg:col-span-2" : undefined}>
                  <DataField column={c} value={row.values[c.name]} mode="update" linkLabel={detail.linkLabels[c.name]?.[row.values[c.name] ?? ""]} />
                </div>
              ))}
              {hidden.map((c) => (
                <div key={c.name}>
                  <DataField column={c} value={row.values[c.name]} mode="update" />
                  {t.name === "users" && c.name === "password_hash" && (
                    <Link href={`/platform/people/${row.values.id}`} className="mt-1.5 inline-block text-[12.5px] font-medium text-brand hover:underline">
                      Set this person&apos;s password
                    </Link>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
              <span className="text-[13px] text-muted">Only the values you change are written.</span>
            </div>
          </ActionForm>
        </Card>

        <div className="min-w-0 space-y-6">
          <Card className="p-5">
            <CardTitle>About this row</CardTitle>
            <dl className="space-y-3 text-[14px]">
              <div>
                <dt className="text-[12.5px] text-muted">Table</dt>
                <dd className="font-mono text-[13px]">{t.name}</dd>
              </div>
              <div>
                <dt className="text-[12.5px] text-muted">{t.primaryKey.length ? `Primary key (${t.primaryKey.join(", ")})` : "Position on disk"}</dt>
                <dd className="break-all font-mono text-[13px]">{row.key.join(" · ")}</dd>
              </div>
              {uni && (
                <div>
                  <dt className="text-[12.5px] text-muted">Institute</dt>
                  <dd>
                    <Link href={`/platform/institutes/${uni}`} className="font-medium text-brand hover:underline">
                      {institute ?? uni}
                    </Link>
                  </dd>
                </div>
              )}
              {t.name === "users" && row.values.id && (
                <div>
                  <dt className="text-[12.5px] text-muted">Person</dt>
                  <dd>
                    <Link href={`/platform/people/${row.values.id}`} className="font-medium text-brand hover:underline">
                      Open on People
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
          </Card>

          {t.incoming.length > 0 && (
            <Card className="p-5">
              <CardTitle>Rows that point here</CardTitle>
              {linked.length === 0 ? (
                <p className="text-[13px] text-muted">No other rows link to this one.</p>
              ) : (
                <ul className="space-y-1.5 text-[14px]">
                  {linked.map((p) => (
                    <li key={`${p.table}.${p.column}`} className="flex min-w-0 items-baseline justify-between gap-3">
                      <Link href={dataTableHref(p.table, { filter: p.column, value: p.value })} className="min-w-0 truncate text-brand hover:underline">
                        <span className="font-mono text-[13px]">{p.table}</span>
                        <span className="text-[12px] text-muted"> by {p.column}</span>
                      </Link>
                      <span className="tabular shrink-0">{formatCount(p.rows)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card className="p-5">
            <CardTitle>Delete this row</CardTitle>
            <p className="mb-3 text-[13px] text-muted">This can&apos;t be undone. Rows that point here have to be deleted first, unless the database removes them with it.</p>
            <ActionForm action={deleteRowAction}>
              <input type="hidden" name="table" value={t.name} />
              <input type="hidden" name="key" value={key} />
              <Field label={`Type ${DELETE_WORD} to confirm`}>
                <Input name="confirm" autoComplete="off" placeholder={DELETE_WORD} />
              </Field>
              <div className="mt-3">
                <SubmitButton variant="danger" pendingText="Deleting…">
                  Delete row
                </SubmitButton>
              </div>
            </ActionForm>
          </Card>

        </div>
      </div>
    </>
  );
}
