import Link from "next/link";
import { Avatar, Badge, Empty, PageHeader, Select, Table, Td } from "@/components/ui";
import { ROLE_LABELS } from "@/server/authz/roles";
import { platformContext } from "@/server/context";
import { NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { isSuperAdmin } from "@/modules/zinny-team-panel/lib/access";
import { formatCount, formatDate } from "@/modules/zinny-team-panel/lib/format";
import { PEOPLE_GROUPS, isPeopleGroup, listPeople, peopleCounts, type PeopleGroup } from "@/modules/zinny-team-panel/services/people";
import { universityOptions } from "@/modules/zinny-team-panel/services/universities";

export const metadata = { title: "People" };

type Search = { q?: string; university?: string; group?: string; page?: string };

export default async function PeoplePage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await platformContext();
  if (!isSuperAdmin(actor)) return <NoAccess section="People" who="Only Super Admins" />;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const universityId = sp.university ?? "";
  const group: PeopleGroup = sp.group && isPeopleGroup(sp.group) ? sp.group : "all";
  const pageNo = Math.max(1, Number(sp.page) || 1);

  const [{ rows, hasMore, page }, counts, institutes] = await Promise.all([
    listPeople(actor, { q, universityId, group, page: pageNo }),
    peopleCounts(actor, universityId),
    universityOptions(actor),
  ]);
  const href = (over: Partial<Record<keyof Search, string>>) => {
    const p = new URLSearchParams();
    const next = { q, university: universityId, group: group === "all" ? "" : group, page: "", ...over };
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    const s = p.toString();
    return `/platform/people${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="People"
        subtitle="Every account at every institute. Only Super Admins can open this page, and each view is kept in the activity log."
        actions={
          <Link href="/platform/universities" className="inline-flex h-10 items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:border-brand/40">
            Institutes
          </Link>
        }
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1 rounded-full border border-line bg-surface p-1" aria-label="Filter people">
          {(Object.keys(PEOPLE_GROUPS) as PeopleGroup[]).map((g) => (
            <Link
              key={g}
              href={href({ group: g === "all" ? "" : g })}
              aria-current={group === g ? "page" : undefined}
              className={group === g ? "rounded-full bg-brand px-4 py-1.5 text-[14px] font-medium text-canvas" : "rounded-full px-4 py-1.5 text-[14px] text-muted hover:text-ink"}
            >
              {PEOPLE_GROUPS[g].label} <span className={group === g ? "text-gold" : "text-faint"}>{formatCount(counts[g])}</span>
            </Link>
          ))}
        </nav>
        <form className="flex flex-wrap gap-2" role="search">
          {group !== "all" && <input type="hidden" name="group" value={group} />}
          <Select name="university" defaultValue={universityId} aria-label="Institute" className="h-10 w-56 rounded-full">
            <option value="">All institutes</option>
            {institutes.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
          <input
            name="q"
            defaultValue={q}
            placeholder="Search name, email or phone"
            aria-label="Search people"
            className="h-10 w-64 rounded-full border border-line bg-surface px-4 text-[14px] outline-none focus:border-brand focus:ring-4 focus:ring-gold-soft"
          />
          <button className="h-10 rounded-full bg-brand px-5 text-[14px] font-medium text-canvas hover:bg-brand-strong">Search</button>
        </form>
      </div>

      {rows.length === 0 ? (
        <Empty title="No one matches">Try another search, or clear the filters.</Empty>
      ) : (
        <Table head={["Person", "Institute", "Role", "Phone", "Account", "Joined"]}>
          {rows.map((p) => (
            <tr key={`${p.userId}-${p.universityId}`} className="hover:bg-canvas/60">
              <Td>
                <Link href={`/platform/people/${p.userId}`} className="flex items-center gap-3">
                  <Avatar name={p.name} size={34} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink hover:text-brand">{p.name}</span>
                    <span className="block truncate text-[12.5px] text-muted">{p.email}</span>
                  </span>
                </Link>
              </Td>
              <Td>
                <Link href={`/platform/universities/${p.universityId}`} className="hover:text-brand">
                  {p.universityName}
                </Link>
              </Td>
              <Td>
                <span className="flex flex-wrap gap-1">
                  {p.roles.map((r) => (
                    <Badge key={r} tone={r === "student" ? "brand" : "neutral"}>
                      {ROLE_LABELS[r]}
                    </Badge>
                  ))}
                </span>
              </Td>
              <Td className="whitespace-nowrap tabular">{p.phone ?? <span className="text-faint">Not set</span>}</Td>
              <Td className="whitespace-nowrap">{p.canSignIn ? "Active" : <span className="text-gold-strong">Invited</span>}</Td>
              <Td className="whitespace-nowrap tabular">{formatDate(p.joinedAt.toISOString().slice(0, 10))}</Td>
            </tr>
          ))}
        </Table>
      )}

      {(page > 1 || hasMore) && (
        <div className="mt-5 flex items-center justify-between text-[14px]">
          {page > 1 ? (
            <Link href={href({ page: String(page - 1) })} className="font-medium text-brand hover:underline">
              Previous page
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">Page {page}</span>
          {hasMore ? (
            <Link href={href({ page: String(page + 1) })} className="font-medium text-brand hover:underline">
              Next page
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </>
  );
}
