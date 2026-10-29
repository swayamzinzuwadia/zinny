import Link from "next/link";
import { Badge, Empty, Field, Input, PageHeader, Select, Table, Td, buttonClass } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { BackLink, FilterProblems, NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { formatDateTime } from "@/modules/zinny-team-panel/lib/format";
import { activityLog, activityLogOptions, actionLabel, EXPORT_LIMIT, parseLogFilters, type LogFilters } from "@/modules/zinny-team-panel/services/support";

export const metadata = { title: "Activity log" };

type Search = Record<string, string | string[] | undefined>;

function query(f: LogFilters, extra: Record<string, string> = {}) {
  const p = new URLSearchParams();
  if (f.scope === "all") p.set("scope", "all");
  if (f.universityId) p.set("university", f.universityId);
  if (f.personId) p.set("person", f.personId);
  if (f.action) p.set("action", f.action);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** A short, readable summary of an entry's details. */
function details(data: Record<string, unknown>) {
  const skip = new Set(["universityId"]);
  const parts = Object.entries(data ?? {})
    .filter(([k, v]) => !skip.has(k) && v !== null && v !== undefined && v !== "")
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  return parts.join(" · ");
}

export default async function ActivityLogPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.support_mode")) return <NoAccess section="the activity log" who="Super Admins and Support Agents" />;
  const q = await searchParams;
  const { filters, problems } = parseLogFilters(q);
  const pageRaw = Number(Array.isArray(q.page) ? q.page[0] : q.page);
  const [log, options] = await Promise.all([activityLog(actor, filters, Number.isInteger(pageRaw) ? pageRaw : 1), activityLogOptions(actor, filters.scope)]);
  const filtered = !!(filters.universityId || filters.personId || filters.action || filters.from || filters.to);
  const actionOptions = filters.action && !options.actions.includes(filters.action) ? [filters.action, ...options.actions] : options.actions;

  return (
    <>
      <BackLink href="/platform/support">Support mode</BackLink>
      <PageHeader
        title="Activity log"
        subtitle="Who did what, where and when. Support sessions show every change made inside a university; all Zinny team activity adds licences, invoices, roles and the rest."
        actions={
          <a href={`/platform/support/log/export${query(filters)}`} className={buttonClass("secondary")} download>
            Download CSV
          </a>
        }
      />

      <FilterProblems problems={problems} />

      <form className="mb-6 grid gap-3 rounded-[22px] border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_150px_150px_auto] lg:items-end">
        <Field label="Show">
          <Select name="scope" defaultValue={filters.scope}>
            <option value="support">Support sessions</option>
            <option value="all">All Zinny team activity</option>
          </Select>
        </Field>
        <Field label="University">
          <Select name="university" defaultValue={filters.universityId ?? ""}>
            <option value="">Every university</option>
            {options.universities.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Person">
          <Select name="person" defaultValue={filters.personId ?? ""}>
            <option value="">Everyone on the team</option>
            {options.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Action">
          <Select name="action" defaultValue={filters.action ?? ""}>
            <option value="">Any action</option>
            {actionOptions.map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From">
          <Input name="from" type="date" defaultValue={filters.from ?? ""} />
        </Field>
        <Field label="To">
          <Input name="to" type="date" defaultValue={filters.to ?? ""} />
        </Field>
        <div className="flex gap-2">
          <button className={buttonClass("primary")}>Apply filters</button>
          {filtered && (
            <Link href={`/platform/support/log${filters.scope === "all" ? "?scope=all" : ""}`} className={buttonClass("ghost")}>
              Clear
            </Link>
          )}
        </div>
      </form>

      {log.entries.length === 0 ? (
        <Empty title={filtered ? "Nothing matches these filters" : "Nothing logged yet"}>
          {filtered ? "Widen the dates or clear a filter." : "Entries appear here as soon as someone enters support mode."}
        </Empty>
      ) : (
        <>
          <Table head={["When (IST)", "Who", "University", "What happened", "Details"]}>
            {log.entries.map((e) => (
              <tr key={e.id} className="align-top">
                <Td className="whitespace-nowrap text-muted">{formatDateTime(e.at)}</Td>
                <Td>
                  <div>{e.actorName ?? "Zinny system"}</div>
                  {e.supportSessionId && (
                    <div className="mt-1">
                      <Badge tone="gold">In support mode</Badge>
                    </div>
                  )}
                </Td>
                <Td>{e.universityName ?? <span className="text-faint">Zinny team</span>}</Td>
                <Td>
                  <div>{actionLabel(e.action)}</div>
                  <code className="font-mono text-[12px] text-faint">{e.action}</code>
                </Td>
                <Td className="max-w-[340px] text-[13px] text-muted">
                  {e.sessionReason && <div className="text-ink/80">Reason: {e.sessionReason}</div>}
                  <div className="break-words">{details(e.data)}</div>
                </Td>
              </tr>
            ))}
          </Table>
          <div className="mt-4 flex items-center justify-between text-[14px]">
            <span className="text-muted">
              Page {log.page}
              {filtered ? " of the filtered log" : ""}. Downloads include up to {EXPORT_LIMIT.toLocaleString("en-IN")} rows.
            </span>
            <div className="flex gap-2">
              {log.page > 1 && (
                <Link href={`/platform/support/log${query(filters, { page: String(log.page - 1) })}`} className={buttonClass("secondary", "sm")}>
                  Newer
                </Link>
              )}
              {log.hasMore && (
                <Link href={`/platform/support/log${query(filters, { page: String(log.page + 1) })}`} className={buttonClass("secondary", "sm")}>
                  Older
                </Link>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
