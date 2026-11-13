import { notFound } from "next/navigation";
import { Card, CardTitle, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { platformContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { BackLink, NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { DataField } from "@/modules/zinny-team-panel/components/data-fields";
import { addRowAction } from "@/modules/zinny-team-panel/data-actions";
import { describeTable } from "@/modules/zinny-team-panel/data-console";
import { isSuperAdmin } from "@/modules/zinny-team-panel/lib/access";
import { dataTableHref } from "@/modules/zinny-team-panel/lib/data-links";

export const metadata = { title: "Add a row · Data" };

export default async function DataNewRowPage({ params }: { params: Promise<{ table: string }> }) {
  const actor = await platformContext();
  if (!isSuperAdmin(actor)) return <NoAccess section="Data" who="Only Super Admins" />;
  const { table } = await params;
  const t = await describeTable(actor, table).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const required = t.columns.filter((c) => !c.secret && !c.generated && !c.identity && !c.nullable && !c.defaultExpr);

  return (
    <>
      <BackLink href={dataTableHref(t.name)}>{t.label}</BackLink>
      <PageHeader
        title={`Add a row to ${t.label.toLowerCase()}`}
        subtitle={
          <>
            Fill in what you need. Empty fields are left to the database: it fills in defaults like ids and dates, and leaves the rest empty.
            {required.length > 0 && (
              <>
                {" "}
                Required: <span className="font-mono text-[13px]">{required.map((c) => c.name).join(", ")}</span>.
              </>
            )}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0">
          <CardTitle hint={`${t.columns.length} columns`}>New row</CardTitle>
          <ActionForm action={addRowAction} resetOnSuccess={false}>
            <input type="hidden" name="table" value={t.name} />
            <div className="grid grid-cols-1 gap-x-5 gap-y-5 lg:grid-cols-2">
              {t.columns.map((c) => (
                <div key={c.name} className={c.kind === "json" || c.kind === "array" ? "lg:col-span-2" : undefined}>
                  <DataField column={c} value={null} mode="insert" />
                </div>
              ))}
            </div>
            <div className="mt-6">
              <SubmitButton pendingText="Adding…">Add row</SubmitButton>
            </div>
          </ActionForm>
        </Card>
        <Card className="h-fit p-5 text-[13px] text-muted">
          <CardTitle>Before you add</CardTitle>
          <ul className="list-disc space-y-2 pl-4">
            <li>Ids that link to other rows must belong to rows that already exist.</li>
            <li>Amounts ending in _paise are in paise: ₹1 is 100.</li>
            <li>Dates and times are India time.</li>
            <li>Passwords, tokens and secrets can&apos;t be set here.</li>
            <li>The new row goes into the activity log with its values.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
