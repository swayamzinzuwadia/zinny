import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Badge, ButtonLink, Empty, PageHeader, cx, ActionLink } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { NoAccess, PlanBadge, RenewalText, UsageMeter } from "@/modules/zinny-team-panel/components/bits";
import { DataPage, IntentLink, Morph, Swap } from "@/modules/zinny-team-panel/components/data-motion";
import { instituteMorphName } from "@/modules/zinny-team-panel/components/institute-names";
import {
  PAGE_SIZE,
  effectiveStatus,
  instituteHref,
  parseInstituteQuery,
  queryInstitutes,
  type InstituteQuery,
  type SortKey,
  type StatusFilter,
} from "@/modules/zinny-team-panel/components/institute-query";
import { InstituteSearch } from "@/modules/zinny-team-panel/components/institute-search";
import { OpenInstitute } from "@/modules/zinny-team-panel/components/open-institute";
import { formatCount, formatDate } from "@/modules/zinny-team-panel/lib/format";
import { activeSessions } from "@/modules/zinny-team-panel/services/support";
import { listUniversities } from "@/modules/zinny-team-panel/services/universities";

export const metadata = { title: "Institutes" };

const STATUS_LABEL: Record<StatusFilter, string> = { active: "Active", trial: "Trial", frozen: "Frozen", suspended: "Suspended" };

/** One grid for the header and every row, so the columns line up. Staff and plan appear from 1280 px. */
const GRID =
  "grid items-center gap-x-4 px-5 grid-cols-[minmax(0,1fr)_92px_150px_150px_104px] xl:grid-cols-[minmax(0,2.2fr)_96px_150px_130px_120px_150px_112px]";
const WIDE = "hidden xl:block";

export default async function InstitutesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.manage_universities")) return <NoAccess section="Institutes" />;
  const f = parseInstituteQuery(await searchParams);
  const all = await listUniversities(actor);
  const view = queryInstitutes(all, f);
  const canLicence = canPlatform(actor, "platform.licences");
  const canSupport = canPlatform(actor, "platform.support_mode");
  const inside = new Set(canSupport ? (await activeSessions(actor)).filter((s) => s.staffUserId === actor.userId).map((s) => s.universityId) : []);
  const filtered = !!(f.q || f.status || f.plan || f.ending);
  const first = view.matching ? (view.page - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(view.page * PAGE_SIZE, view.matching);
  const key = JSON.stringify([f, view.page]);

  return (
    <DataPage>
      <PageHeader
        title="Institutes"
        subtitle="Every institute on Zinny with its status, people, plan and licence end date. Students and staff count people with an active role."
        actions={<ButtonLink href="/platform/institutes/new">New institute</ButtonLink>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <Suspense fallback={<div className="h-10 w-full rounded-full border border-line bg-surface sm:w-[340px]" />}>
          <InstituteSearch />
        </Suspense>
        <nav className="flex flex-wrap gap-1" aria-label="Filter by status">
          <Chip href={instituteHref({ ...f, status: "", page: 1 })} on={!f.status} count={Object.values(view.counts).slice(0, 4).reduce((a, b) => a + b, 0)}>
            All
          </Chip>
          {(Object.keys(STATUS_LABEL) as StatusFilter[]).map((s) => (
            <Chip key={s} href={instituteHref({ ...f, status: f.status === s ? "" : s, page: 1 })} on={f.status === s} count={view.counts[s]}>
              {STATUS_LABEL[s]}
            </Chip>
          ))}
        </nav>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13.5px]">
        <nav className="flex flex-wrap items-center gap-1" aria-label="Filter by plan">
          <span className="mr-1 text-muted">Plan</span>
          <Chip small href={instituteHref({ ...f, plan: "", page: 1 })} on={!f.plan}>
            Any
          </Chip>
          {view.plans.map((p) => (
            <Chip small key={p.key} href={instituteHref({ ...f, plan: f.plan === p.key ? "" : p.key, page: 1 })} on={f.plan === p.key} count={p.count}>
              {p.name}
            </Chip>
          ))}
          <Chip small href={instituteHref({ ...f, plan: f.plan === "none" ? "" : "none", page: 1 })} on={f.plan === "none"}>
            No licence
          </Chip>
        </nav>
        <nav aria-label="Filter by licence end">
          <Chip small gold href={instituteHref({ ...f, ending: !f.ending, page: 1 })} on={f.ending} count={view.counts.ending}>
            Licence ends in 30 days
          </Chip>
        </nav>
      </div>

      <div className="mb-2 flex items-center justify-between gap-3 text-[13px] text-muted" aria-live="polite">
        <span className="tabular">
          {view.matching === 0
            ? "No institutes"
            : view.matching === view.total
              ? `${formatCount(view.total)} institutes`
              : `${formatCount(view.matching)} of ${formatCount(view.total)} institutes`}
        </span>
        {filtered && (
          <Link href="/platform/institutes" className="underline underline-offset-2 hover:text-brand">
            Clear search and filters
          </Link>
        )}
      </div>

      <Swap id={key}>
        {view.matching === 0 ? (
          <Empty title={all.length ? "No institutes match" : "No institutes yet"}>
            {all.length ? (
              <>
                Nothing fits{f.q ? ` “${f.q}”` : " these filters"}. Check the spelling, or widen the filters.
                <div className="mt-4">
                  <ActionLink href="/platform/institutes" icon="restore">
                    Clear search and filters
                  </ActionLink>
                </div>
              </>
            ) : (
              "Create the first one to give it its own space and invite its admin."
            )}
          </Empty>
        ) : (
          <div role="table" aria-label="Institutes" aria-rowcount={view.matching} className="rounded-2xl border border-line bg-surface">
            <div role="rowgroup" className="sticky top-14 z-10 rounded-t-2xl border-b border-line bg-surface/95 backdrop-blur">
              <div role="row" className={cx(GRID, "py-3 text-[13px] text-muted")}>
                <Head f={f} k="name">
                  Institute
                </Head>
                <Head f={f} k="status">
                  Status
                </Head>
                <Head f={f} k="students">
                  Students
                </Head>
                <div role="columnheader" className={WIDE}>
                  Staff
                </div>
                <div role="columnheader" className={WIDE}>
                  Plan
                </div>
                <Head f={f} k="licence">
                  Licence ends
                </Head>
                <div role="columnheader" className="sr-only">
                  Actions
                </div>
              </div>
            </div>
            <div role="rowgroup" className="divide-y divide-line">
              {view.rows.map((u) => {
                const status = effectiveStatus(u);
                return (
                  <Morph key={u.id} name={instituteMorphName(u.id)}>
                    <div role="row" className={cx(GRID, "group relative py-3.5 [transition-property:background-color] duration-150 hover:bg-canvas/70 last:rounded-b-2xl focus-within:bg-canvas/70")}>
                      <div role="cell" className="min-w-0">
                        <IntentLink href={`/platform/institutes/${u.id}`} className="block truncate text-[14.5px] font-medium text-ink after:absolute after:inset-0 after:content-[''] hover:text-brand focus-visible:outline-none">
                          {u.name}
                        </IntentLink>
                        <div className="truncate text-[12.5px] text-muted">zinny.app/{u.slug}</div>
                      </div>
                      <div role="cell">
                        <StatusPill status={status} />
                      </div>
                      <div role="cell">
                        <UsageMeter used={u.students} cap={u.studentCap} compact />
                      </div>
                      <div role="cell" className={WIDE}>
                        <UsageMeter used={u.staff} cap={u.staffCap} compact />
                      </div>
                      <div role="cell" className={WIDE}>
                        <PlanBadge name={u.planName} />
                      </div>
                      <div role="cell" className="whitespace-nowrap">
                        {u.endDate ? (
                          <>
                            <div className="tabular text-[14px]">{formatDate(u.endDate)}</div>
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
                      </div>
                      <div role="cell" className="relative z-10 flex flex-col items-end gap-1 whitespace-nowrap">
                        {canLicence && (
                          <ActionLink href={`/platform/licences/${u.id}`} icon="view">
                            Licence
                          </ActionLink>
                        )}
                        {canSupport && (
                          <span className={WIDE}>
                            <OpenInstitute universityId={u.id} slug={u.slug} inside={inside.has(u.id)} asLink />
                          </span>
                        )}
                      </div>
                    </div>
                  </Morph>
                );
              })}
            </div>
          </div>
        )}

        {view.pages > 1 && (
          <nav className="mt-4 flex items-center justify-between gap-3 text-[13.5px]" aria-label="Pages">
            <span className="tabular text-muted">
              {first} to {last} of {formatCount(view.matching)}
            </span>
            <div className="flex items-center gap-2">
              {view.page > 1 && (
                <ActionLink href={instituteHref({ ...f, page: view.page - 1 })} icon="back">
                  Previous page
                </ActionLink>
              )}
              <span className="tabular text-muted">
                Page {view.page} of {view.pages}
              </span>
              {view.page < view.pages && (
                <ActionLink href={instituteHref({ ...f, page: view.page + 1 })} icon="forward">
                  Next page
                </ActionLink>
              )}
            </div>
          </nav>
        )}
      </Swap>
    </DataPage>
  );
}

/** A column heading you can click to sort by; the arrow shows the direction in use. */
function Head({ f, k, children }: { f: InstituteQuery; k: SortKey; children: ReactNode }) {
  const on = f.sort === k;
  const nextDir = on ? (f.dir === "asc" ? "desc" : "asc") : k === "name" || k === "status" || k === "licence" ? "asc" : "desc";
  return (
    <div role="columnheader" aria-sort={on ? (f.dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link
        href={instituteHref({ ...f, sort: k, dir: nextDir, page: 1 })}
        scroll={false}
        className={cx("-mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 [transition-property:color,background-color] duration-150 hover:bg-canvas hover:text-ink", on && "font-medium text-ink")}
      >
        {children}
        <svg aria-hidden viewBox="0 0 10 10" className={cx("size-2.5 [transition-property:transform,opacity] duration-200", on ? "opacity-100" : "opacity-0", on && f.dir === "desc" && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 8.5v-7M2 4.5l3-3 3 3" />
        </svg>
      </Link>
    </div>
  );
}

function StatusPill({ status }: { status: StatusFilter }) {
  return status === "active" ? (
    <Badge tone="brand">Active</Badge>
  ) : status === "suspended" ? (
    <Badge tone="danger">Suspended</Badge>
  ) : status === "trial" ? (
    <Badge tone="gold">Trial</Badge>
  ) : (
    <Badge>Frozen</Badge>
  );
}

function Chip({ href, on, count, small, gold, children }: { href: string; on: boolean; count?: number; small?: boolean; gold?: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={on ? "true" : undefined}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full whitespace-nowrap [transition-property:background-color,color,border-color] duration-150",
        small ? "px-3 py-1 text-[13px]" : "px-3.5 py-1.5 text-[13.5px]",
        on ? (gold ? "bg-gold-soft font-medium text-gold-strong ring-1 ring-gold" : "bg-brand font-medium text-canvas") : "border border-line bg-surface text-muted hover:border-faint hover:text-ink",
      )}
    >
      {children}
      {count !== undefined && <span className={cx("tabular", on ? (gold ? "text-gold-strong" : "text-gold") : "text-faint")}>{formatCount(count)}</span>}
    </Link>
  );
}
