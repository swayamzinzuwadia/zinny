import Link from "next/link";
import { Notice, PageHeader } from "@/components/ui";
import { platformContext } from "@/server/context";
import { NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { DataPage } from "@/modules/zinny-team-panel/components/data-motion";
import { DataTables } from "@/modules/zinny-team-panel/components/data-tables";
import { isSuperAdmin } from "@/modules/zinny-team-panel/lib/access";
import { formatCount } from "@/modules/zinny-team-panel/lib/format";
import { listTables } from "@/modules/zinny-team-panel/data-console";

export const metadata = { title: "Data" };

export default async function DataIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; group?: string }>;
}) {
  const actor = await platformContext();
  if (!isSuperAdmin(actor))
    return <NoAccess section="Data" who="Only Super Admins" />;
  const sp = await searchParams;
  const groups = await listTables(actor);
  const tables = groups.reduce((n, g) => n + g.tables.length, 0);
  const rows = groups.reduce(
    (n, g) => n + g.tables.reduce((m, t) => m + t.rows, 0),
    0,
  );

  return (
    <DataPage>
      <PageHeader
        title="Data"
        subtitle={`Every table in Zinny's database, across every institute: ${formatCount(tables)} tables and ${formatCount(rows)} rows. Pick a table to browse, add, change or delete its rows.`}
      />
      <div className="mb-6">
        <Notice tone="warn">
          You are working on the live database. Changes take effect at once and
          skip the checks the rest of Zinny applies, so a wrong value can break
          an institute. Every change is kept in the{" "}
          <Link
            href="/platform/support/log?scope=all"
            className="font-medium underline underline-offset-2"
          >
            activity log
          </Link>
          .
        </Notice>
      </div>
      <DataTables
        groups={groups}
        initialQuery={(sp.q ?? "").trim()}
        initialGroup={sp.group ?? ""}
      />
    </DataPage>
  );
}
