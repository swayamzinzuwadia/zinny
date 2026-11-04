import Link from "next/link";
import { Badge, ButtonLink, Empty, PageHeader, Td } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { NoAccess, PanelTable, PlanBadge, RenewalText, StatusBadge, UsageMeter, WIDE_ONLY } from "@/modules/zinny-team-panel/components/bits";
import { OpenInstitute } from "@/modules/zinny-team-panel/components/open-institute";
import { isSuperAdmin } from "@/modules/zinny-team-panel/lib/access";
import { formatCount, formatDate } from "@/modules/zinny-team-panel/lib/format";
import { activeSessions } from "@/modules/zinny-team-panel/services/support";
import { listUniversities } from "@/modules/zinny-team-panel/services/universities";

export const metadata = { title: "Institutes" };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "suspended", label: "Suspended" },
  { key: "renewing", label: "Renewing in 30 days" },
  { key: "unlicensed", label: "No licence" },
] as const;

export default async function UniversitiesPage({ searchParams }: { searchParams: Promise<{ show?: string; q?: string }> }) {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.manage_universities")) return <NoAccess section="Institutes" />;
  const { show = "all", q = "" } = await searchParams;
  const all = await listUniversities(actor);
  const term = q.trim().toLowerCase().slice(0, 80);
  const rows = all
    .filter((u) =>
      show === "active"
        ? u.status === "active"
        : show === "suspended"
          ? u.status === "suspended"
          : show === "renewing"
            ? u.daysLeft !== null && u.daysLeft <= 30
            : show === "unlicensed"
              ? !u.plan
              : true,
    )
    .filter((u) => !term || u.name.toLowerCase().includes(term) || u.slug.includes(term));
  const count = (key: string) =>
    key === "all"
      ? all.length
      : all.filter((u) =>
          key === "active" ? u.status === "active" : key === "suspended" ? u.status === "suspended" : key === "renewing" ? u.daysLeft !== null && u.daysLeft <= 30 : !u.plan,
        ).length;
  const canLicence = canPlatform(actor, "platform.licences");
  const canPeople = isSuperAdmin(actor);
  const canSupport = canPlatform(actor, "platform.support_mode");
  const inside = new Set(canSupport ? (await activeSessions(actor)).filter((s) => s.staffUserId === actor.userId).map((s) => s.universityId) : []);

  return (
    <>
      <PageHeader
        title="Institutes"
        subtitle="Every institute on Zinny, with its people, plan and renewal date. Students and staff count people with an active role."
        actions={<ButtonLink href="/platform/institutes/new">New institute</ButtonLink>}
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1 rounded-full border border-line bg-surface p-1" aria-label="Filter institutes">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`/platform/institutes?show=${f.key}${term ? `&q=${encodeURIComponent(term)}` : ""}`}
              aria-current={show === f.key ? "page" : undefined}
              className={
                show === f.key ? "rounded-full bg-brand px-4 py-1.5 text-[14px] font-medium text-canvas" : "rounded-full px-4 py-1.5 text-[14px] text-muted hover:text-ink"
              }
            >
              {f.label} <span className={show === f.key ? "text-gold" : "text-faint"}>{count(f.key)}</span>
            </Link>
          ))}
        </nav>
        <form className="flex gap-2" role="search">
          <input type="hidden" name="show" value={show} />
          <input
            name="q"
            defaultValue={term}
            placeholder="Search by name or web address"
            aria-label="Search institutes"
            className="h-10 w-64 rounded-full border border-line bg-surface px-4 text-[14px] outline-none focus:border-brand focus:ring-4 focus:ring-gold-soft"
          />
        </form>
      </div>

      {rows.length === 0 ? (
        <Empty title={all.length ? "No institutes match" : "No institutes yet"}>
          {all.length ? "Try another filter or search." : "Create the first one to give it its own space and invite its admin."}
        </Empty>
      ) : (
        <PanelTable
          head={[
            "Institute",
            { label: "Status", className: WIDE_ONLY },
            "Students",
            { label: "Staff", className: WIDE_ONLY },
            { label: "Plan", className: WIDE_ONLY },
            "Renewal",
            { label: <span className="sr-only">Actions</span> },
          ]}
        >
          {rows.map((u) => (
            <tr key={u.id} className="hover:bg-canvas/60">
              <Td>
                <Link href={`/platform/institutes/${u.id}`} className="font-medium text-ink hover:text-brand">
                  {u.name}
                </Link>
                <div className="text-[12.5px] text-muted">zinny.app/{u.slug}</div>
                {u.status !== "active" && (
                  <div className="mt-1 xl:hidden">
                    <StatusBadge status={u.status} />
                  </div>
                )}
              </Td>
              <Td className={WIDE_ONLY}>
                <StatusBadge status={u.status} />
              </Td>
              <Td>
                <UsageMeter used={u.students} cap={u.studentCap} compact />
              </Td>
              <Td className={WIDE_ONLY}>
                <UsageMeter used={u.staff} cap={u.staffCap} compact />
              </Td>
              <Td className={WIDE_ONLY}>
                <PlanBadge plan={u.plan} />
              </Td>
              <Td className="whitespace-nowrap">
                {u.endDate ? (
                  <>
                    <div className="tabular">{formatDate(u.endDate)}</div>
                    <div className="text-[12.5px]">
                      <RenewalText daysLeft={u.daysLeft} />
                    </div>
                  </>
                ) : (
                  <span className="text-faint">Not set</span>
                )}
                {u.openAlerts > 0 && (
                  <div className="mt-1">
                    <Badge tone="gold">
                      {formatCount(u.openAlerts)} warning{u.openAlerts === 1 ? "" : "s"}
                    </Badge>
                  </div>
                )}
              </Td>
              <Td>
                <div className="flex flex-col items-end gap-1.5 whitespace-nowrap">
                  {canPeople && (
                    <Link href={`/platform/people?university=${u.id}`} className="text-[13px] font-medium text-brand hover:underline">
                      People
                    </Link>
                  )}
                  {canLicence && (
                    <Link href={`/platform/licences/${u.id}`} className="text-[13px] font-medium text-brand hover:underline">
                      Licence
                    </Link>
                  )}
                  {canSupport && <OpenInstitute universityId={u.id} slug={u.slug} inside={inside.has(u.id)} asLink />}
                </div>
              </Td>
            </tr>
          ))}
        </PanelTable>
      )}
    </>
  );
}
