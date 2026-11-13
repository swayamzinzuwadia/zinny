import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge,
  ButtonLink,
  Empty,
  Field,
  Input,
  Notice,
  PageHeader,
  Select,
  buttonClass,
  cx,
} from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { platformContext } from "@/server/context";
import { NotFoundError, ValidationError } from "@/server/errors";
import { NoAccess } from "@/modules/zinny-team-panel/components/bits";
import {
  DataCell,
  typeLabel,
} from "@/modules/zinny-team-panel/components/data-fields";
import { SelectAll } from "@/modules/zinny-team-panel/components/select-all";
import { deleteSelectedAction } from "@/modules/zinny-team-panel/data-actions";
import {
  DELETE_WORD,
  PAGE_SIZE,
  instituteOptions,
  listRows,
  type RowPage,
  type RowQuery,
} from "@/modules/zinny-team-panel/data-console";
import { isSuperAdmin } from "@/modules/zinny-team-panel/lib/access";
import {
  dataRowHref,
  dataTableHref,
  encodeRowKey,
} from "@/modules/zinny-team-panel/lib/data-links";
import { formatCount } from "@/modules/zinny-team-panel/lib/format";

type Search = {
  q?: string;
  university?: string;
  sort?: string;
  dir?: string;
  page?: string;
  filter?: string;
  value?: string;
  deleted?: string;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ table: string }>;
}) {
  return { title: `${(await params).table} · Data` };
}

export default async function DataTablePage({
  params,
  searchParams,
}: {
  params: Promise<{ table: string }>;
  searchParams: Promise<Search>;
}) {
  const actor = await platformContext();
  if (!isSuperAdmin(actor))
    return <NoAccess section="Data" who="Only Super Admins" />;
  const { table } = await params;
  const sp = await searchParams;
  const query: RowQuery = {
    q: sp.q,
    universityId: sp.university || undefined,
    sort: sp.sort || undefined,
    dir: sp.dir === "desc" ? "desc" : sp.dir === "asc" ? "asc" : undefined,
    page: Number(sp.page) || 1,
    filter: sp.filter || undefined,
    value: sp.filter ? (sp.value ?? "") : undefined,
  };

  let data: RowPage;
  let problem: string | null = null;
  try {
    data = await listRows(actor, table, query);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (!(e instanceof ValidationError)) throw e;
    problem = e.message;
    data = await listRows(actor, table, { q: sp.q });
  }
  const t = data.table;
  const institutes = t.hasUniversity ? await instituteOptions(actor) : [];

  const state: Record<string, string | undefined> = {
    q: sp.q?.trim() || undefined,
    university: problem ? undefined : sp.university || undefined,
    sort: problem ? undefined : sp.sort || undefined,
    dir: problem ? undefined : sp.dir || undefined,
    filter: problem ? undefined : sp.filter || undefined,
    value: problem || !sp.filter ? undefined : sp.value,
  };
  const href = (over: Record<string, string | undefined>) =>
    dataTableHref(t.name, { ...state, ...over });
  const sortHref = (col: string) =>
    href({
      sort: col,
      dir: data.sort === col && data.dir === "asc" ? "desc" : "asc",
      page: undefined,
    });
  const filtered = !!(state.q || state.university || state.filter);
  const first = (data.page - 1) * PAGE_SIZE + 1;

  return (
    <>
      <PageHeader
        title={t.label}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13px]">{t.name}</span>
            <Badge>{t.groupLabel}</Badge>
            <span>
              {formatCount(data.total)} {data.total === 1 ? "row" : "rows"}
              {filtered ? " match" : ""} · {t.columns.length} columns
            </span>
            {t.primaryKey.length === 0 && (
              <Badge tone="warn">No primary key</Badge>
            )}
          </span>
        }
        actions={
          <ButtonLink href={`/platform/data/${t.name}/new`}>
            Add a row
          </ButtonLink>
        }
      />

      {sp.deleted && (
        <div className="mb-4">
          <Notice>Deleted the row. The change is in the activity log.</Notice>
        </div>
      )}
      {problem && (
        <div className="mb-4">
          <Notice tone="warn">{problem} Showing every row instead.</Notice>
        </div>
      )}
      {t.primaryKey.length === 0 && (
        <p className="mb-4 max-w-3xl text-[13px] text-muted">
          This table has no primary key, so rows are found by where they sit on
          disk. A row moves when it is changed: open it again from this list
          before changing it a second time.
        </p>
      )}

      <form
        className="mb-4 grid grid-cols-1 items-end gap-3 rounded-[22px] border border-line bg-surface p-4 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_minmax(0,280px)_auto]"
        role="search"
      >
        <Field label="Search">
          <Input
            type="search"
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Text, choices and ids"
          />
        </Field>
        {t.hasUniversity && (
          <Field label="Institute">
            <Select name="university" defaultValue={state.university ?? ""}>
              <option value="">Every institute</option>
              {institutes.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {state.sort && <input type="hidden" name="sort" value={state.sort} />}
        {state.dir && <input type="hidden" name="dir" value={state.dir} />}
        {state.filter && (
          <input type="hidden" name="filter" value={state.filter} />
        )}
        {state.filter && (
          <input type="hidden" name="value" value={state.value ?? ""} />
        )}
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass("secondary")}>Search</button>
          {filtered && (
            <Link href={dataTableHref(t.name)} className={buttonClass("ghost")}>
              Clear
            </Link>
          )}
        </div>
      </form>

      {state.filter && (
        <div className="mb-4">
          <Notice>
            Showing rows where <span className="font-mono">{state.filter}</span>{" "}
            is{" "}
            {state.value ? (
              <span className="break-all font-mono">{state.value}</span>
            ) : (
              "null"
            )}
            .{" "}
            <Link
              href={href({
                filter: undefined,
                value: undefined,
                page: undefined,
              })}
              className="font-medium underline underline-offset-2"
            >
              Show every row
            </Link>
          </Notice>
        </div>
      )}

      {/* The form stays when the last rows go, so its "Deleted" message stays on screen. */}
      <ActionForm action={deleteSelectedAction} resetOnSuccess>
        <input type="hidden" name="table" value={t.name} />
        {data.rows.length === 0 ? (
          <Empty title={filtered ? "No rows match" : "This table is empty"}>
            {filtered
              ? "Try another search or clear the filters."
              : "Add a row to start it off."}
          </Empty>
        ) : (
          <>
            <div className="max-h-[70dvh] overflow-auto rounded-[22px] border border-line bg-surface">
              <table className="w-max min-w-full text-left text-[13.5px]">
                <thead className="sticky top-0 z-10 border-b border-line bg-surface text-[12.5px] text-muted">
                  <tr>
                    <th className="w-10 px-4 py-3">
                      <SelectAll />
                    </th>
                    <th className="px-3 py-3 font-normal">Row</th>
                    {t.columns.map((c) => (
                      <th
                        key={c.name}
                        className="px-3 py-3 font-normal whitespace-nowrap"
                        title={typeLabel(c)}
                      >
                        {c.secret ? (
                          <span className="font-mono">{c.name}</span>
                        ) : (
                          <Link
                            href={sortHref(c.name)}
                            className={cx(
                              "font-mono hover:text-brand",
                              data.sort === c.name && "font-medium text-ink",
                            )}
                          >
                            {c.name}
                            {data.sort === c.name
                              ? data.dir === "asc"
                                ? " ↑"
                                : " ↓"
                              : ""}
                          </Link>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.rows.map((r) => (
                    <tr
                      key={encodeRowKey(r.key)}
                      className="hover:bg-canvas/60"
                    >
                      <td className="px-4 py-2.5 align-top">
                        <input
                          type="checkbox"
                          name="key"
                          value={encodeRowKey(r.key)}
                          aria-label={`Select row ${r.key.join(" · ")}`}
                          className="size-4 accent-brand"
                        />
                      </td>
                      <td className="px-3 py-2.5 align-top whitespace-nowrap">
                        <Link
                          href={dataRowHref(t.name, r.key)}
                          className="font-medium text-brand hover:underline"
                        >
                          Open
                        </Link>
                      </td>
                      {t.columns.map((c) => (
                        <td
                          key={c.name}
                          className="max-w-[340px] px-3 py-2.5 align-top whitespace-nowrap"
                        >
                          <DataCell
                            column={c}
                            value={r.values[c.name]}
                            linkLabel={
                              data.linkLabels[c.name]?.[r.values[c.name] ?? ""]
                            }
                            institute={
                              c.name === "university_id"
                                ? data.institutes[r.values[c.name] ?? ""]
                                : undefined
                            }
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted">
              <span>
                Rows {formatCount(first)} to{" "}
                {formatCount(first + data.rows.length - 1)} of{" "}
                {formatCount(data.total)}
              </span>
              <span className="flex gap-2">
                {data.page > 1 && (
                  <Link
                    href={href({ page: String(data.page - 1) })}
                    className={buttonClass("secondary", "sm")}
                  >
                    Previous page
                  </Link>
                )}
                {data.page < data.pages && (
                  <Link
                    href={href({ page: String(data.page + 1) })}
                    className={buttonClass("secondary", "sm")}
                  >
                    Next page
                  </Link>
                )}
              </span>
            </div>

            <div className="mt-5 grid grid-cols-1 items-end gap-3 rounded-[22px] border border-line bg-surface p-4 sm:grid-cols-[minmax(0,320px)_auto]">
              <Field
                label={`Type ${DELETE_WORD} to delete the rows you ticked`}
                hint="Rows that other rows point to can't be deleted until those are gone."
              >
                <Input
                  name="confirm"
                  autoComplete="off"
                  placeholder={DELETE_WORD}
                />
              </Field>
              <div className="sm:pb-5">
                <SubmitButton variant="danger" pendingText="Deleting…">
                  Delete selected rows
                </SubmitButton>
              </div>
            </div>
          </>
        )}
      </ActionForm>
    </>
  );
}
