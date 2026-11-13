import Link from "next/link";
import { Badge, Card, Empty, Input, Notice, PageHeader, buttonClass } from "@/components/ui";
import { platformContext } from "@/server/context";
import { NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { isSuperAdmin } from "@/modules/zinny-team-panel/lib/access";
import { formatCount } from "@/modules/zinny-team-panel/lib/format";
import { dataTableHref } from "@/modules/zinny-team-panel/lib/data-links";
import { listTables } from "@/modules/zinny-team-panel/data-console";

export const metadata = { title: "Data" };

export default async function DataPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await platformContext();
  if (!isSuperAdmin(actor)) return <NoAccess section="Data" who="Only Super Admins" />;
  const q = ((await searchParams).q ?? "").trim();
  const groups = await listTables(actor, { q });
  const tables = groups.reduce((n, g) => n + g.tables.length, 0);
  const rows = groups.reduce((n, g) => n + g.tables.reduce((m, t) => m + t.rows, 0), 0);

  return (
    <>
      <PageHeader
        title="Data"
        subtitle={`Every table in Zinny's database, across every institute: ${formatCount(tables)} tables, ${formatCount(rows)} rows${q ? " matching your search" : ""}. Open a table to browse, add, change or delete rows.`}
      />
      <div className="mb-6">
        <Notice tone="warn">
          You are working on the live database. Changes take effect at once and skip the checks the rest of Zinny applies, so a wrong value can break an institute. Every change is kept in
          the{" "}
          <Link href="/platform/support/log?scope=all" className="font-medium underline underline-offset-2">
            activity log
          </Link>
          .
        </Notice>
      </div>

      <form className="mb-6 flex flex-wrap items-center gap-2" role="search">
        <div className="min-w-0 flex-1 basis-[240px]">
          <Input type="search" name="q" defaultValue={q} placeholder="Search tables, like invoices or plat_" aria-label="Search tables" />
        </div>
        <button className={buttonClass("secondary")}>Search</button>
        {q && (
          <Link href="/platform/data" className={buttonClass("ghost")}>
            Show all tables
          </Link>
        )}
      </form>

      {groups.length === 0 ? (
        <Empty title="No tables match your search">Try part of the name, like enrol or pay_.</Empty>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <Card key={g.group} className="p-5">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[17px] font-medium">{g.label}</h2>
                <span className="text-[13px] text-muted">
                  {g.tables.length} {g.tables.length === 1 ? "table" : "tables"}
                </span>
              </div>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {g.tables.map((t) => (
                  <li key={t.name} className="min-w-0">
                    <Link
                      href={dataTableHref(t.name)}
                      className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3 transition-colors hover:border-brand/40 hover:bg-brand-soft/40"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-medium">{t.label}</span>
                        <span className="block truncate font-mono text-[12px] text-muted">{t.name}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className="tabular text-[14px]">{formatCount(t.rows)}</span>
                        {t.hasUniversity ? <Badge>Per institute</Badge> : <span className="text-[12px] text-faint">Shared</span>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
