import Link from "next/link";
import { Avatar, Empty, PageHeader, Select, Td, cx } from "@/components/ui";
import { ROLE_LABELS } from "@/server/authz/roles";
import { platformContext } from "@/server/context";
import { NoAccess, PanelTable, WIDE_ONLY } from "@/modules/zinny-team-panel/components/bits";
import { PersonActions } from "@/modules/zinny-team-panel/components/person-actions";
import { isSuperAdmin } from "@/modules/zinny-team-panel/lib/access";
import { formatCount, formatDate } from "@/modules/zinny-team-panel/lib/format";
import {
  ACCOUNT_STATES,
  FILTER_ROLES,
  PEOPLE_GROUPS,
  PEOPLE_SORTS,
  isAccountState,
  isFilterRole,
  isPeopleGroup,
  isPeopleSort,
  listPeople,
  peopleCounts,
  type PeopleGroup,
  type PeopleSort,
  type PersonRow,
  type SortDir,
} from "@/modules/zinny-team-panel/services/people";
import { universityOptions } from "@/modules/zinny-team-panel/services/universities";

export const metadata = { title: "Users" };

type Search = { q?: string; university?: string; group?: string; role?: string; account?: string; phone?: string; from?: string; to?: string; sort?: string; dir?: string; page?: string };

const CUSTOM = new Set<string>(["custom_institute", "custom_department", "custom_platform"]);
const FIELD = "mt-1 h-10 w-full rounded-full border border-line bg-surface px-4 text-[14px] text-ink outline-none focus:border-brand focus:ring-4 focus:ring-gold-soft";

/** Role labels for a row, with custom roles by their own names. */
function roleNames(p: PersonRow): string[] {
  const builtIn = p.roles.filter((r) => !CUSTOM.has(r)).map((r) => ROLE_LABELS[r]);
  const custom = p.customRoleNames.length ? p.customRoleNames : p.roles.some((r) => CUSTOM.has(r)) ? [ROLE_LABELS.custom_institute] : [];
  return [...new Set([...builtIn, ...custom])];
}

export default async function UsersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await platformContext();
  if (!isSuperAdmin(actor)) return <NoAccess section="Users" who="Only Super Admins" />;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const universityId = sp.university ?? "";
  const group: PeopleGroup = sp.group && isPeopleGroup(sp.group) ? sp.group : "all";
  const pageNo = Math.max(1, Number(sp.page) || 1);
  const role = sp.role && isFilterRole(sp.role) ? sp.role : undefined;
  const account = sp.account && isAccountState(sp.account) ? sp.account : undefined;
  const phone = sp.phone === "yes" || sp.phone === "no" ? sp.phone : undefined;
  const joinedFrom = sp.from ?? "";
  const joinedTo = sp.to ?? "";
  const sort: PeopleSort = sp.sort && isPeopleSort(sp.sort) ? sp.sort : "name";
  const dir: SortDir = sp.dir === "desc" ? "desc" : "asc";

  const [{ rows, hasMore, page }, counts, institutes] = await Promise.all([
    listPeople(actor, { q, universityId, group, role, account, phone, joinedFrom, joinedTo, sort, dir, page: pageNo }),
    peopleCounts(actor, universityId),
    universityOptions(actor),
  ]);
  const href = (over: Partial<Record<keyof Search, string>>) => {
    const p = new URLSearchParams();
    const next = {
      q,
      university: universityId,
      group: group === "all" ? "" : group,
      role: role ?? "",
      account: account ?? "",
      phone: phone ?? "",
      from: joinedFrom,
      to: joinedTo,
      sort: sort === "name" ? "" : sort,
      dir: dir === "asc" ? "" : dir,
      page: "",
      ...over,
    };
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    const s = p.toString();
    return `/platform/people${s ? `?${s}` : ""}`;
  };
  const filtered = !!(q || universityId || role || account || phone || joinedFrom || joinedTo);
  const reset = { q: "", university: "", role: "", account: "", phone: "", from: "", to: "", sort: "", dir: "" };

  /** A column header that sorts by that column, and flips the direction when it already is the sort. */
  const sortHead = (key: PeopleSort, className?: string) => ({
    className,
    label: (
      <Link
        href={href({ sort: key === "name" ? "" : key, dir: sort === key && dir === "asc" ? "desc" : "" })}
        aria-label={`Sort by ${PEOPLE_SORTS[key].toLowerCase()}${sort === key ? (dir === "asc" ? ", now ascending" : ", now descending") : ""}`}
        className={cx("inline-flex items-center gap-1 hover:text-ink", sort === key && "font-medium text-ink")}
      >
        {PEOPLE_SORTS[key]}
        <span aria-hidden className="text-[11px]">
          {sort === key ? (dir === "asc" ? "▲" : "▼") : ""}
        </span>
      </Link>
    ),
  });

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Every account on Zinny: institute admins, staff, students, parents, marketplace learners and the Zinny team. Edit anyone's details, set their password or sign in as them from their row, or open them for more. Only Super Admins can open this page, and each view is kept in the activity log."
      />

      <nav className="mb-5 flex flex-wrap gap-1 rounded-full border border-line bg-surface p-1 sm:w-fit" aria-label="Filter users by group">
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

      <form className="mb-5 grid gap-3 rounded-[22px] border border-line bg-surface p-4 sm:grid-cols-2 xl:grid-cols-4" role="search">
        {group !== "all" && <input type="hidden" name="group" value={group} />}
        <label className="block text-[13px] text-muted xl:col-span-2">
          Search
          <input name="q" defaultValue={q} placeholder="Name, email or phone" className={FIELD} />
        </label>
        <label className="block text-[13px] text-muted">
          Institute
          <Select name="university" defaultValue={universityId} className="mt-1 h-10 w-full rounded-full">
            <option value="">All institutes</option>
            {institutes.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="block text-[13px] text-muted">
          Role
          <Select name="role" defaultValue={role ?? ""} className="mt-1 h-10 w-full rounded-full">
            <option value="">Any role</option>
            {FILTER_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </label>
        <label className="block text-[13px] text-muted">
          Account
          <Select name="account" defaultValue={account ?? ""} className="mt-1 h-10 w-full rounded-full">
            <option value="">Any account</option>
            {(Object.keys(ACCOUNT_STATES) as (keyof typeof ACCOUNT_STATES)[]).map((a) => (
              <option key={a} value={a}>
                {ACCOUNT_STATES[a]}
              </option>
            ))}
          </Select>
        </label>
        <label className="block text-[13px] text-muted">
          Mobile number
          <Select name="phone" defaultValue={phone ?? ""} className="mt-1 h-10 w-full rounded-full">
            <option value="">Either</option>
            <option value="yes">Has a mobile number</option>
            <option value="no">No mobile number</option>
          </Select>
        </label>
        <label className="block text-[13px] text-muted">
          Joined from
          <input type="date" name="from" defaultValue={joinedFrom} className={FIELD} />
        </label>
        <label className="block text-[13px] text-muted">
          Joined to
          <input type="date" name="to" defaultValue={joinedTo} className={FIELD} />
        </label>
        <label className="block text-[13px] text-muted">
          Sort by
          <Select name="sort" defaultValue={sort} className="mt-1 h-10 w-full rounded-full">
            {(Object.keys(PEOPLE_SORTS) as PeopleSort[]).map((k) => (
              <option key={k} value={k}>
                {PEOPLE_SORTS[k]}
              </option>
            ))}
          </Select>
        </label>
        <label className="block text-[13px] text-muted">
          Order
          <Select name="dir" defaultValue={dir} className="mt-1 h-10 w-full rounded-full">
            <option value="asc">Ascending (A to Z, oldest first)</option>
            <option value="desc">Descending (Z to A, newest first)</option>
          </Select>
        </label>
        <div className="flex items-end gap-4 sm:col-span-2">
          <button className="h-10 rounded-full bg-brand px-5 text-[14px] font-medium text-canvas hover:bg-brand-strong">Apply filters</button>
          {(filtered || sort !== "name" || dir !== "asc") && (
            <Link href={href(reset)} className="text-[14px] font-medium text-brand hover:underline">
              Clear filters
            </Link>
          )}
        </div>
      </form>

      {rows.length === 0 ? (
        <Empty title="No users match">Try another search, or clear the filters.</Empty>
      ) : (
        <PanelTable
          head={[
            sortHead("name"),
            sortHead("institute"),
            "Role",
            { label: "Phone", className: WIDE_ONLY },
            sortHead("account"),
            sortHead("joined", WIDE_ONLY),
            { label: <span className="sr-only">Actions</span> },
          ]}
        >
          {rows.map((p) => (
            <tr key={`${p.userId}-${p.universityId ?? "none"}`} className="hover:bg-canvas/60">
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
                {p.universityId ? (
                  <Link href={`/platform/institutes/${p.universityId}`} className="hover:text-brand">
                    {p.universityName}
                  </Link>
                ) : p.roles.length ? (
                  <span className="text-muted">Zinny team</span>
                ) : (
                  <span className="text-faint">No institute</span>
                )}
              </Td>
              <Td>
                <span className="text-[13px]">{p.roles.length === 0 ? <span className="text-muted">Marketplace account</span> : roleNames(p).join(", ")}</span>
              </Td>
              <Td className={cx(WIDE_ONLY, "whitespace-nowrap tabular")}>{p.phone ?? <span className="text-faint">Not set</span>}</Td>
              <Td className="whitespace-nowrap">{p.canSignIn ? "Active" : <span className="text-gold-strong">Invited</span>}</Td>
              <Td className={cx(WIDE_ONLY, "whitespace-nowrap tabular")}>{formatDate(p.joinedAt.toISOString().slice(0, 10))}</Td>
              <Td className="text-right">
                <PersonActions userId={p.userId} name={p.name} email={p.email} phone={p.phone} universityId={p.universityId} self={p.userId === actor.userId} />
              </Td>
            </tr>
          ))}
        </PanelTable>
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
