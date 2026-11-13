/**
 * Data console: a Super Admin's direct view of every table in Zinny's database, with
 * create, read, update and delete on any row (/platform/data).
 *
 * ── Documented exception to CLAUDE.md rules 2, 3 and 6 ──────────────────────────────────
 * This file reads and writes every table, of every module and every university, on the
 * system (owner) connection, `systemDb()`, which bypasses row-level security. That is the
 * point of the console: the Super Admin asked for full rights over everything in the
 * database. It is the only place outside a module that touches other modules' tables.
 * What keeps it safe:
 *   - Every exported function calls `assertSuperAdmin(actor)` before anything else. No
 *     other platform role and no institute user gets in.
 *   - Table and column names never come from the request as SQL. They are looked up in
 *     the live catalogue (pg_catalog), and only the catalogue's own spelling is quoted
 *     into the query with `sql.identifier`. Anything not found is refused.
 *   - Every value is a bound parameter, cast to the column's catalogue type.
 *   - Every insert, update and delete runs in one transaction with a platform audit entry
 *     (`plat.data.*`): who, which table, which row, and the values before and after.
 *   - Password hashes, tokens and secrets are never shown, written or logged here.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */
import { sql, type SQL } from "drizzle-orm";
import { systemDb, type Conn, type Tx } from "@/db/client";
import type { Actor } from "@/server/core";
import { NotFoundError, ValidationError } from "@/server/errors";
import { assertSuperAdmin } from "./lib/access";
import { formatINR } from "./lib/format";
import { decodeRowKey } from "./lib/data-links";
import { isUuid, logAction } from "./services/shared";

const db = () => systemDb();

/* ─────────────────────────── Catalogue ─────────────────────────── */

export type ColumnKind =
  | "text"
  | "integer"
  | "bigint"
  | "decimal"
  | "boolean"
  | "enum"
  | "date"
  | "time"
  | "timestamptz"
  | "timestamp"
  | "json"
  | "uuid"
  | "array"
  | "other";

export type ForeignKey = { constraint: string; table: string; columns: string[]; refTable: string; refColumns: string[]; onDelete: string };

export type ColumnMeta = {
  name: string;
  /** The catalogue's spelling of the type, like `character varying(200)` or `role_name`. */
  type: string;
  kind: ColumnKind;
  /** For arrays: the kind of each element. */
  elementKind: ColumnKind | null;
  nullable: boolean;
  defaultExpr: string | null;
  generated: boolean;
  identity: boolean;
  enumValues: string[] | null;
  /** Password hashes, tokens and secrets: masked, never edited or logged here. */
  secret: boolean;
  /** An amount in paise. */
  money: boolean;
  primaryKey: boolean;
  /** A single-column foreign key from this column, if any. */
  references: { table: string; column: string } | null;
};

export type TableMeta = {
  name: string;
  label: string;
  group: string;
  groupLabel: string;
  columns: ColumnMeta[];
  /** Primary key columns. Empty for the few tables without one: their rows are found by `ctid`. */
  primaryKey: string[];
  hasUniversity: boolean;
  /** Foreign keys from other tables (and this one) that point at this table. */
  incoming: ForeignKey[];
  outgoing: ForeignKey[];
};

/** Module table prefixes and what the console calls each group. Anything else is core. */
const GROUPS: Record<string, string> = {
  asgn: "Assignments",
  assess: "Tests",
  cert: "Certificates",
  content: "Course content",
  gam: "Gamification",
  idn: "Identity and sign-in",
  live: "Live classes",
  mkt: "Marketplace",
  notif: "Notifications",
  pay: "Payments",
  plat: "Zinny team panel",
  poll: "Polls",
  rpt: "Reports",
  site: "Website builder",
};

export const CORE_GROUP = "core";

function groupOf(table: string): { group: string; groupLabel: string; rest: string } {
  const i = table.indexOf("_");
  const prefix = i > 0 ? table.slice(0, i) : "";
  if (prefix && GROUPS[prefix]) return { group: prefix, groupLabel: GROUPS[prefix], rest: table.slice(i + 1) };
  return { group: CORE_GROUP, groupLabel: "Core", rest: table };
}

const sentence = (v: string) => {
  const s = v.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Columns that hold credentials. Matched on the name, so new ones are caught too. */
export const isSecretColumn = (name: string) => /hash|secret|token|password/i.test(name);

function kindOf(typname: string, typtype: string, category: string): ColumnKind {
  if (category === "A") return "array";
  if (typtype === "e") return "enum";
  switch (typname) {
    case "text":
    case "varchar":
    case "bpchar":
    case "citext":
    case "name":
      return "text";
    case "int2":
    case "int4":
      return "integer";
    case "int8":
      return "bigint";
    case "numeric":
    case "float4":
    case "float8":
      return "decimal";
    case "bool":
      return "boolean";
    case "date":
      return "date";
    case "time":
      return "time";
    case "timestamptz":
      return "timestamptz";
    case "timestamp":
      return "timestamp";
    case "json":
    case "jsonb":
      return "json";
    case "uuid":
      return "uuid";
    default:
      return "other";
  }
}

type ColumnRow = {
  table_name: string;
  column_name: string;
  data_type: string;
  typname: string;
  typtype: string;
  typcategory: string;
  elem_typname: string | null;
  elem_typtype: string | null;
  nullable: boolean;
  default_expr: string | null;
  generated: boolean;
  identity: boolean;
  enum_values: string[] | null;
};

type ConstraintRow = { conname: string; contype: "p" | "f"; table_name: string; columns: string[]; ref_table: string | null; ref_columns: string[] | null; on_delete: string };

export type Catalogue = Map<string, TableMeta>;

let cached: { at: number; value: Catalogue } | null = null;
const CACHE_MS = 5_000;

/**
 * Every table in the public schema, read from pg_catalog, so a new module's tables appear
 * without any change here. Only drizzle's own migration bookkeeping is left out.
 */
async function catalogue(conn: Conn = db()): Promise<Catalogue> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const columns = (await conn.execute(sql`
    select c.relname as table_name, a.attname as column_name,
           format_type(a.atttypid, a.atttypmod) as data_type,
           t.typname, t.typtype, t.typcategory,
           et.typname as elem_typname, et.typtype as elem_typtype,
           not a.attnotnull as nullable,
           pg_get_expr(d.adbin, d.adrelid) as default_expr,
           a.attgenerated <> '' as generated,
           a.attidentity <> '' as identity,
           case when t.typtype = 'e' then (select json_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid)
                when et.typtype = 'e' then (select json_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = et.oid)
           end as enum_values
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_type t on t.oid = a.atttypid
      left join pg_type et on et.oid = t.typelem and t.typcategory = 'A'
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
       and c.relname not like '\\_\\_drizzle%'
     order by c.relname, a.attnum`)) as unknown as ColumnRow[];

  const constraints = (await conn.execute(sql`
    select k.conname, k.contype, c.relname as table_name,
           (select json_agg(a.attname order by x.i) from unnest(k.conkey) with ordinality x(n, i)
              join pg_attribute a on a.attrelid = k.conrelid and a.attnum = x.n) as columns,
           rc.relname as ref_table,
           (select json_agg(a.attname order by x.i) from unnest(k.confkey) with ordinality x(n, i)
              join pg_attribute a on a.attrelid = k.confrelid and a.attnum = x.n) as ref_columns,
           k.confdeltype as on_delete
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_class rc on rc.oid = k.confrelid
     where n.nspname = 'public' and k.contype in ('p', 'f')`)) as unknown as ConstraintRow[];

  const pks = new Map<string, string[]>();
  const fks: ForeignKey[] = [];
  for (const k of constraints) {
    if (k.contype === "p") pks.set(k.table_name, k.columns);
    else if (k.ref_table && k.ref_columns)
      fks.push({ constraint: k.conname, table: k.table_name, columns: k.columns, refTable: k.ref_table, refColumns: k.ref_columns, onDelete: k.on_delete });
  }

  const tables: Catalogue = new Map();
  for (const r of columns) {
    let t = tables.get(r.table_name);
    if (!t) {
      const g = groupOf(r.table_name);
      t = {
        name: r.table_name,
        label: sentence(g.rest),
        group: g.group,
        groupLabel: g.groupLabel,
        columns: [],
        primaryKey: pks.get(r.table_name) ?? [],
        hasUniversity: false,
        incoming: fks.filter((f) => f.refTable === r.table_name),
        outgoing: fks.filter((f) => f.table === r.table_name),
      };
      tables.set(r.table_name, t);
    }
    const fk = t.outgoing.find((f) => f.columns.length === 1 && f.columns[0] === r.column_name);
    const kind = kindOf(r.typname, r.typtype, r.typcategory);
    t.columns.push({
      name: r.column_name,
      type: r.data_type,
      kind,
      elementKind: kind === "array" && r.elem_typname ? kindOf(r.elem_typname, r.elem_typtype ?? "b", "") : null,
      nullable: r.nullable,
      defaultExpr: r.default_expr,
      generated: r.generated,
      identity: r.identity,
      enumValues: r.enum_values,
      secret: isSecretColumn(r.column_name),
      money: /_paise$/.test(r.column_name),
      primaryKey: t.primaryKey.includes(r.column_name),
      references: fk ? { table: fk.refTable, column: fk.refColumns[0] } : null,
    });
    if (r.column_name === "university_id") t.hasUniversity = true;
  }
  cached = { at: Date.now(), value: tables };
  return tables;
}

/** Forget the cached catalogue (tests that create tables, and after a schema push). */
export function resetCatalogueCache() {
  cached = null;
}

/** The table as the catalogue knows it. Anything else, injection attempts included, is not found. */
async function tableOrThrow(name: string): Promise<TableMeta> {
  const t = typeof name === "string" ? (await catalogue()).get(name) : undefined;
  if (!t) throw new NotFoundError("Table");
  return t;
}

function columnOrThrow(t: TableMeta, name: string): ColumnMeta {
  const c = t.columns.find((x) => x.name === name);
  if (!c) throw new ValidationError(`There's no column called "${String(name).slice(0, 60)}" in ${t.name}. Pick one of its columns.`);
  return c;
}

/* ─────────────────────────── SQL pieces ─────────────────────────── */

const ident = (name: string) => sql.identifier(name);
/** The catalogue's own type name. Never from the request. */
const typeOf = (c: ColumnMeta) => sql.raw(c.type);

const ZONE = "Asia/Kolkata";

/** A column as the text this console shows and edits. */
function textOf(c: ColumnMeta, alias?: string): SQL {
  const col = alias ? sql`${ident(alias)}.${ident(c.name)}` : ident(c.name);
  switch (c.kind) {
    case "timestamptz":
      return sql`to_char(${col} at time zone ${sql.raw(`'${ZONE}'`)}, 'YYYY-MM-DD"T"HH24:MI:SS')`;
    case "timestamp":
      return sql`to_char(${col}, 'YYYY-MM-DD"T"HH24:MI:SS')`;
    case "array":
      return sql`array_to_json(${col})::text`;
    default:
      return sql`${col}::text`;
  }
}

/** A value from the form, cast to the column's type. */
function valueSql(c: ColumnMeta, v: string | null): SQL {
  if (v === null) return sql`null::${typeOf(c)}`;
  switch (c.kind) {
    case "timestamptz":
      return sql`(${v}::text::timestamp at time zone ${sql.raw(`'${ZONE}'`)})`;
    case "array":
      return sql`array(select jsonb_array_elements_text(${v}::text::jsonb))::${typeOf(c)}`;
    default:
      return sql`${v}::text::${typeOf(c)}`;
  }
}

/** The columns that find a row: the primary key, or `ctid` for the few tables without one. */
function keyColumns(t: TableMeta): ColumnMeta[] {
  return t.primaryKey.map((k) => t.columns.find((c) => c.name === k)!);
}

function keySelect(t: TableMeta): SQL {
  if (t.primaryKey.length === 0) return sql`json_build_array(ctid::text)::text as "__key"`;
  return sql`json_build_array(${sql.join(
    keyColumns(t).map((c) => textOf(c)),
    sql`, `,
  )})::text as "__key"`;
}

function keyWhere(t: TableMeta, key: string[]): SQL {
  if (t.primaryKey.length === 0) {
    if (key.length !== 1 || !/^\(\d+,\d+\)$/.test(key[0])) throw new NotFoundError("Row");
    return sql`ctid = ${key[0]}::text::tid`;
  }
  const cols = keyColumns(t);
  if (key.length !== cols.length) throw new NotFoundError("Row");
  return sql.join(
    cols.map((c, i) => {
      checkValue(c, key[i], "key");
      return sql`${ident(c.name)} = ${valueSql(c, key[i])}`;
    }),
    sql` and `,
  );
}

function selectList(t: TableMeta, alias?: string): SQL {
  return sql.join(
    t.columns.map((c) => sql`${textOf(c, alias)} as ${ident(c.name)}`),
    sql`, `,
  );
}

const MASK = "••••••";

/** A row's values for the audit log, secrets masked. */
function forLog(t: TableMeta, row: Record<string, string | null> | null, only?: string[]) {
  if (!row) return null;
  const out: Record<string, string | null> = {};
  for (const c of t.columns) {
    if (only && !only.includes(c.name)) continue;
    if (!(c.name in row)) continue;
    out[c.name] = c.secret && row[c.name] !== null ? MASK : row[c.name];
  }
  return out;
}

/* ─────────────────────────── Values ─────────────────────────── */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?$/;

/** Lines or a JSON array, as a JSON array of strings (or nulls). */
export function parseArrayInput(raw: string): (string | null)[] {
  const s = raw.trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    let v: unknown;
    try {
      v = JSON.parse(s);
    } catch {
      throw new ValidationError("That list isn't valid JSON. Put one value per line, or write a JSON array like [\"a\", \"b\"].");
    }
    if (!Array.isArray(v)) throw new ValidationError("That list isn't a JSON array. Put one value per line instead.");
    return v.map((x) => (x === null ? null : typeof x === "string" ? x : JSON.stringify(x)));
  }
  return s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Checks a value against its column's type and returns it in the form the database is sent. */
function checkValue(c: ColumnMeta, v: string, what: "value" | "key" = "value"): string {
  const bad = (example: string) => {
    if (what === "key") throw new NotFoundError("Row");
    throw new ValidationError(`${c.name} needs ${example}. Change it and try again.`);
  };
  switch (c.kind) {
    case "integer":
    case "bigint":
      if (!/^-?\d{1,19}$/.test(v)) bad("a whole number, like 42");
      return v;
    case "decimal":
      if (!/^-?\d+(\.\d+)?$/.test(v)) bad("a number, like 12.5");
      return v;
    case "uuid":
      if (!isUuid(v)) bad("an id like 3f1c2a9e-0b7d-4c1e-9a55-2d1e8f0c4b6a");
      return v.toLowerCase();
    case "boolean":
      if (v !== "true" && v !== "false") bad("true or false");
      return v;
    case "date":
      if (!DATE_RE.test(v) || Number.isNaN(Date.parse(v))) bad("a date like 2026-11-13");
      return v;
    case "timestamp":
    case "timestamptz":
      if (!STAMP_RE.test(v)) bad("a date and time like 2026-11-13T09:30");
      return v.length === 16 ? `${v}:00` : v;
    case "time":
      if (!TIME_RE.test(v)) bad("a time like 09:30");
      return v.length === 5 ? `${v}:00` : v;
    case "enum":
      if (!c.enumValues?.includes(v)) bad(`one of: ${(c.enumValues ?? []).join(", ")}`);
      return v;
    case "json":
      try {
        JSON.parse(v);
      } catch (e) {
        if (what === "key") throw new NotFoundError("Row");
        throw new ValidationError(`${c.name} isn't valid JSON (${(e as Error).message}). Fix it and save again.`);
      }
      return v;
    case "array":
      return JSON.stringify(parseArrayInput(v));
    default:
      return v;
  }
}

/** Two values of a column are the same, as far as the console can tell. */
function sameValue(c: ColumnMeta, a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  switch (c.kind) {
    case "json":
      try {
        return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
      } catch {
        return a === b;
      }
    case "array": {
      const norm = (s: string) => JSON.stringify((JSON.parse(s) as unknown[]).map((x) => (x === null ? null : typeof x === "string" ? x : JSON.stringify(x))));
      try {
        return norm(a) === norm(b);
      } catch {
        return a === b;
      }
    }
    case "timestamp":
    case "timestamptz":
    case "time":
      return a.replace(/\.\d+$/, "") === b.replace(/\.\d+$/, "");
    case "uuid":
      return a.toLowerCase() === b.toLowerCase();
    default:
      return a === b;
  }
}

const TEXTUAL: ColumnKind[] = ["text", "other"];

/**
 * The new value of a column from what was typed. `null` is null. An empty string stays an
 * empty string for text; for anything else it means null.
 */
function incoming(c: ColumnMeta, raw: string | null): string | null {
  if (raw === null) return null;
  if (raw === "" && !TEXTUAL.includes(c.kind)) return null;
  if (raw === "" && TEXTUAL.includes(c.kind)) return "";
  return checkValue(c, c.kind === "json" || c.kind === "array" || c.kind === "text" || c.kind === "other" ? raw : raw.trim());
}

/* ─────────────────────────── Errors ─────────────────────────── */

type PgError = { code?: string; constraint_name?: string; column_name?: string; table_name?: string; message?: string; detail?: string };

function pgError(e: unknown): PgError | null {
  const err = e as PgError & { cause?: PgError };
  if (err?.cause?.code) return err.cause;
  if (err?.code && /^[0-9A-Z]{5}$/.test(err.code)) return err;
  return null;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

/**
 * What to say when a delete is refused because other rows point at the ones being deleted:
 * "Can't delete: 12 rows in enrolments point to this. Delete those first."
 */
async function blockersMessage(t: TableMeta, before: Record<string, string | null>[], err: PgError): Promise<string> {
  const cat = await catalogue();
  const counts: { table: string; n: number }[] = [];
  // Rows that point straight at these rows and stop the delete (no action / restrict).
  for (const fk of t.incoming.filter((f) => f.onDelete === "a" || f.onDelete === "r")) {
    const child = cat.get(fk.table);
    if (!child) continue;
    const tuples = before.map((row) => fk.refColumns.map((rc) => row[rc] ?? null));
    if (tuples.some((tp) => tp.some((v) => v === null))) continue;
    const match = sql.join(
      tuples.map(
        (tp) =>
          sql`(${sql.join(
            fk.columns.map((col, i) => sql`${ident(col)}::text = ${tp[i]}`),
            sql` and `,
          )})`,
      ),
      sql` or `,
    );
    const [{ n }] = (await db().execute(sql`select count(*)::int as n from ${ident(fk.table)} where ${match}`)) as unknown as { n: number }[];
    if (n > 0) counts.push({ table: fk.table, n });
  }
  const these = before.length === 1 ? "this" : "these rows";
  if (counts.length) {
    const list = counts.map((c) => `${plural(c.n, "row", "rows")} in ${c.table}`);
    const joined = list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
    const total = counts.reduce((s, c) => s + c.n, 0);
    return `Can't delete: ${joined} ${total === 1 ? "points" : "point"} to ${these}. Delete those first.`;
  }
  // Deeper down: a cascade reached a row something else still needs.
  const where = err.table_name ? ` in ${err.table_name}` : "";
  return `Can't delete: other rows${where} still point to ${these} or to rows that would be deleted with ${before.length === 1 ? "it" : "them"}. Delete those first.`;
}

/** Turns a refusal from Postgres into a sentence that says what went wrong and how to fix it. */
function writeErrorMessage(t: TableMeta, err: PgError): string {
  const fk = err.constraint_name ? t.outgoing.find((f) => f.constraint === err.constraint_name) : undefined;
  switch (err.code) {
    case "23503":
      if (fk) return `The value in ${fk.columns.join(", ")} doesn't match any row in ${fk.refTable}. Use the id of a row that exists there.`;
      return "This change points to a row that doesn't exist. Check the linked ids and try again.";
    case "23505": {
      const m = /Key \((.+?)\)=/.exec(err.detail ?? "");
      return `Another row in ${t.name} already has this ${m ? m[1] : "value"}. Use a different value.`;
    }
    case "23502":
      return `${err.column_name ?? "A required column"} can't be empty in ${t.name}. Enter a value for it.`;
    case "23514":
      return `This breaks a rule on ${t.name} (${err.constraint_name ?? "a check"}). Change the values so they fit it.`;
    case "22P02":
    case "22007":
    case "22008":
    case "22003":
    case "22001":
      return `The database couldn't take one of the values: ${err.message}. Fix it and try again.`;
    case "23P01":
      return `This overlaps another row in ${t.name}. Change the values so they don't clash.`;
    default:
      return `The database refused the change: ${err.message ?? "unknown error"}.`;
  }
}

/* ─────────────────────────── Reads ─────────────────────────── */

export type TableSummary = { name: string; label: string; group: string; groupLabel: string; rows: number; columns: number; hasUniversity: boolean };
export type TableGroup = { group: string; label: string; tables: TableSummary[] };

/** Every table, grouped (core first, then each module), with its row count. */
export async function listTables(actor: Actor, opts: { q?: string } = {}): Promise<TableGroup[]> {
  assertSuperAdmin(actor);
  const cat = await catalogue();
  const q = (opts.q ?? "").trim().toLowerCase();
  const tables = [...cat.values()].filter((t) => !q || t.name.toLowerCase().includes(q) || t.label.toLowerCase().includes(q) || t.groupLabel.toLowerCase().includes(q));
  const counts = new Map<string, number>();
  if (tables.length) {
    const rows = (await db().execute(
      sql.join(
        tables.map((t) => sql`select ${t.name}::text as t, count(*)::int as n from ${ident(t.name)}`),
        sql` union all `,
      ),
    )) as unknown as { t: string; n: number }[];
    for (const r of rows) counts.set(r.t, r.n);
  }
  const groups = new Map<string, TableGroup>();
  for (const t of tables) {
    const g = groups.get(t.group) ?? { group: t.group, label: t.groupLabel, tables: [] };
    g.tables.push({ name: t.name, label: t.label, group: t.group, groupLabel: t.groupLabel, rows: counts.get(t.name) ?? 0, columns: t.columns.length, hasUniversity: t.hasUniversity });
    groups.set(t.group, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, tables: g.tables.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => (a.group === CORE_GROUP ? -1 : b.group === CORE_GROUP ? 1 : a.label.localeCompare(b.label)));
}

/** The table's columns, keys and links, for building pages and forms. */
export async function describeTable(actor: Actor, table: string): Promise<TableMeta> {
  assertSuperAdmin(actor);
  return tableOrThrow(table);
}

export type Row = { key: string[]; values: Record<string, string | null> };

export type RowQuery = {
  page?: number;
  sort?: string;
  dir?: "asc" | "desc";
  q?: string;
  /** Only rows of this institute (tables with university_id). */
  universityId?: string;
  /** Only rows where this column's value is `value`. */
  filter?: string;
  value?: string;
};

export const PAGE_SIZE = 50;

export type RowPage = {
  table: TableMeta;
  rows: Row[];
  total: number;
  page: number;
  pages: number;
  sort: string | null;
  dir: "asc" | "desc";
  /** Names of the institutes the rows belong to, by id. */
  institutes: Record<string, string>;
  /** Names for linked rows, by column then id ("Asha Rao" for a user_id). */
  linkLabels: Record<string, Record<string, string>>;
};

const SEARCHABLE: ColumnKind[] = ["text", "enum", "uuid", "other"];

/** A page of rows: sorted, searched and filtered. Every name is checked against the catalogue. */
export async function listRows(actor: Actor, table: string, query: RowQuery = {}): Promise<RowPage> {
  assertSuperAdmin(actor);
  const t = await tableOrThrow(table);

  const conds: SQL[] = [];
  const q = (query.q ?? "").trim().slice(0, 200);
  if (q) {
    const searchable = t.columns.filter((c) => SEARCHABLE.includes(c.kind) && !c.secret);
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    conds.push(searchable.length ? sql`(${sql.join(searchable.map((c) => sql`${ident(c.name)}::text ilike ${like}`), sql` or `)})` : sql`false`);
  }
  if (query.universityId) {
    if (!t.hasUniversity) throw new ValidationError(`${t.name} isn't kept per institute, so it can't be filtered by one.`);
    if (!isUuid(query.universityId)) throw new ValidationError("That institute id isn't valid. Pick an institute from the list.");
    conds.push(sql`${ident("university_id")} = ${query.universityId}::uuid`);
  }
  if (query.filter) {
    const c = columnOrThrow(t, query.filter);
    if (c.secret) throw new ValidationError(`${c.name} is hidden, so rows can't be filtered by it.`);
    conds.push(query.value === undefined || query.value === "" ? sql`${ident(c.name)} is null` : sql`${textOf(c)} = ${String(query.value)}`);
  }
  const where = conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``;

  let sortCol: ColumnMeta | null = null;
  if (query.sort) {
    sortCol = columnOrThrow(t, query.sort);
    if (sortCol.secret) throw new ValidationError(`${sortCol.name} is hidden, so rows can't be sorted by it.`);
  } else {
    sortCol = t.columns.find((c) => c.name === "created_at") ?? null;
  }
  const dir = query.dir === "asc" || query.dir === "desc" ? query.dir : sortCol && !query.sort && sortCol.name === "created_at" ? "desc" : "asc";
  const tieBreak = t.primaryKey.length ? t.primaryKey.map((k) => sql`${ident(k)} asc`) : [sql`ctid asc`];
  const order = sql.join([...(sortCol ? [sql`${ident(sortCol.name)} ${sql.raw(dir)} nulls last`] : []), ...tieBreak], sql`, `);

  const [{ n: total }] = (await db().execute(sql`select count(*)::int as n from ${ident(t.name)} ${where}`)) as unknown as { n: number }[];
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Number.isInteger(query.page) && query.page! > 0 ? Math.min(query.page!, pages) : 1;
  const raw = (await db().execute(
    sql`select ${keySelect(t)}, ${selectList(t)} from ${ident(t.name)} ${where} order by ${order} limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`,
  )) as unknown as Record<string, string | null>[];
  const rows = raw.map((r) => toRow(t, r));

  const institutes = t.hasUniversity ? await instituteNames(rows.map((r) => r.values.university_id)) : {};
  const linkLabels = await labelsFor(t, rows);
  return { table: t, rows, total, page, pages, sort: sortCol?.name ?? null, dir, institutes, linkLabels };
}

function toRow(t: TableMeta, r: Record<string, string | null>): Row {
  const key = JSON.parse(String(r.__key)) as (string | null)[];
  const values: Record<string, string | null> = {};
  for (const c of t.columns) values[c.name] = c.secret && r[c.name] !== null ? MASK : r[c.name];
  return { key: key.map((k) => String(k)), values };
}

async function instituteNames(ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => !!v && isUuid(v)))];
  if (!unique.length) return {};
  const rows = (await db().execute(
    sql`select id::text as id, name from universities where id in (${sql.join(
      unique.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})`,
  )) as unknown as { id: string; name: string }[];
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

const LABEL_COLUMNS = ["name", "title", "email", "label", "code", "number", "slug"];

/** Readable names for linked rows ("Asha Rao" for a user id), one query per linked column. */
async function labelsFor(t: TableMeta, rows: Row[]): Promise<Record<string, Record<string, string>>> {
  const cat = await catalogue();
  const out: Record<string, Record<string, string>> = {};
  for (const c of t.columns) {
    if (!c.references || c.name === "university_id") continue;
    const target = cat.get(c.references.table);
    const labelCol = target?.columns.find((x) => LABEL_COLUMNS.includes(x.name) && x.kind === "text");
    if (!target || !labelCol) continue;
    const refCol = target.columns.find((x) => x.name === c.references!.column);
    if (!refCol) continue;
    const ids = [...new Set(rows.map((r) => r.values[c.name]).filter((v): v is string => !!v))].slice(0, PAGE_SIZE);
    if (!ids.length) continue;
    const found = (await db().execute(
      sql`select ${ident(refCol.name)}::text as id, ${ident(labelCol.name)}::text as label from ${ident(target.name)} where ${ident(refCol.name)}::text in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    )) as unknown as { id: string; label: string | null }[];
    out[c.name] = Object.fromEntries(found.filter((f) => f.label).map((f) => [f.id, f.label!]));
  }
  return out;
}

export type RowDetail = {
  table: TableMeta;
  row: Row;
  institute: string | null;
  linkLabels: Record<string, Record<string, string>>;
  /** Rows elsewhere that point at this one, per foreign key. */
  pointers: { table: string; column: string; value: string; rows: number }[];
};

async function readRow(conn: Conn, t: TableMeta, key: string[], lock = false): Promise<Record<string, string | null> | null> {
  const [r] = (await conn.execute(
    sql`select ${keySelect(t)}, ${selectList(t)} from ${ident(t.name)} where ${keyWhere(t, key)}${lock ? sql` for update` : sql``}`,
  )) as unknown as Record<string, string | null>[];
  return r ?? null;
}

/** One row, with its institute, the names of linked rows and what points at it. */
export async function getRow(actor: Actor, table: string, key: string[] | string): Promise<RowDetail> {
  assertSuperAdmin(actor);
  const t = await tableOrThrow(table);
  const k = typeof key === "string" ? decodeRowKey(key) : key;
  if (!k) throw new NotFoundError("Row");
  const raw = await readRow(db(), t, k);
  if (!raw) throw new NotFoundError("Row");
  const row = toRow(t, raw);
  const uni = t.name === "universities" ? row.values.id : row.values.university_id;
  const institute = uni ? ((await instituteNames([uni]))[uni] ?? null) : null;

  const cat = await catalogue();
  const single = t.incoming.filter((f) => f.columns.length === 1 && cat.has(f.table));
  const pointers: RowDetail["pointers"] = [];
  const parts = single
    .map((f) => ({ f, value: raw[f.refColumns[0]] }))
    .filter((p): p is { f: ForeignKey; value: string } => p.value !== null && p.value !== undefined);
  if (parts.length) {
    const counts = (await db().execute(
      sql.join(
        parts.map(
          ({ f, value }, i) => sql`select ${i}::int as i, count(*)::int as n from ${ident(f.table)} where ${ident(f.columns[0])}::text = ${value}`,
        ),
        sql` union all `,
      ),
    )) as unknown as { i: number; n: number }[];
    for (const c of counts) {
      const p = parts[c.i];
      pointers.push({ table: p.f.table, column: p.f.columns[0], value: p.value, rows: c.n });
    }
  }
  pointers.sort((a, b) => b.rows - a.rows || a.table.localeCompare(b.table));
  return { table: t, row, institute, linkLabels: await labelsFor(t, [row]), pointers };
}

/* ─────────────────────────── Writes ─────────────────────────── */

const universityOf = (t: TableMeta, row: Record<string, string | null> | null) =>
  row ? (t.name === "universities" ? row.id : (row.university_id ?? null)) : null;

/**
 * Adds a row. Columns left out (or empty) get the database's default, or null. Returns the
 * new row's key.
 */
export async function insertRow(actor: Actor, table: string, values: Record<string, string | null>): Promise<string[]> {
  assertSuperAdmin(actor);
  const t = await tableOrThrow(table);
  const cols: ColumnMeta[] = [];
  const vals: SQL[] = [];
  for (const [name, raw] of Object.entries(values)) {
    const c = columnOrThrow(t, name);
    if (c.secret) throw new ValidationError(`${c.name} is hidden and can't be set here.${t.name === "users" ? " Use Set password on the person's page." : ""}`);
    if (c.generated) throw new ValidationError(`${c.name} is worked out by the database and can't be set.`);
    if (raw === "" || raw === undefined) continue;
    const v = incoming(c, raw);
    cols.push(c);
    vals.push(valueSql(c, v));
  }
  try {
    return await db().transaction(async (tx) => {
      const [r] = (await tx.execute(
        cols.length
          ? sql`insert into ${ident(t.name)} (${sql.join(
              cols.map((c) => ident(c.name)),
              sql`, `,
            )}) values (${sql.join(vals, sql`, `)}) returning ${keySelect(t)}, ${selectList(t)}`
          : sql`insert into ${ident(t.name)} default values returning ${keySelect(t)}, ${selectList(t)}`,
      )) as unknown as Record<string, string | null>[];
      const key = (JSON.parse(String(r.__key)) as unknown[]).map(String);
      await logAction(tx, actor, { universityId: universityOf(t, r) }, "plat.data.insert", t.name, key.join(" · "), {
        table: t.name,
        row: key.join(" · "),
        after: forLog(t, r),
      });
      return key;
    });
  } catch (e) {
    const pg = pgError(e);
    if (pg) throw new ValidationError(writeErrorMessage(t, pg));
    throw e;
  }
}

/**
 * Changes a row. Only the columns given are considered, and only the ones whose value
 * actually changed are written. Primary keys, hidden and computed columns can't be changed.
 * Returns the names of the columns that changed.
 */
export async function updateRow(actor: Actor, table: string, key: string[] | string, values: Record<string, string | null>): Promise<string[]> {
  assertSuperAdmin(actor);
  const t = await tableOrThrow(table);
  const k = typeof key === "string" ? decodeRowKey(key) : key;
  if (!k) throw new NotFoundError("Row");
  const next: { c: ColumnMeta; v: string | null }[] = [];
  for (const [name, raw] of Object.entries(values)) {
    const c = columnOrThrow(t, name);
    if (c.primaryKey) throw new ValidationError(`${c.name} is part of the primary key and can't be changed here.`);
    if (c.secret) throw new ValidationError(`${c.name} is hidden and can't be changed here.${t.name === "users" ? " Use Set password on the person's page." : ""}`);
    if (c.generated) throw new ValidationError(`${c.name} is worked out by the database and can't be changed.`);
    const v = incoming(c, raw);
    if (v === null && !c.nullable) throw new ValidationError(`${c.name} can't be empty. Enter a value for it.`);
    next.push({ c, v });
  }
  try {
    return await db().transaction(async (tx) => {
      const before = await readRow(tx, t, k, true);
      if (!before) throw new NotFoundError("Row");
      const changed = next.filter(({ c, v }) => !sameValue(c, before[c.name], v));
      if (!changed.length) return [];
      const [after] = (await tx.execute(
        sql`update ${ident(t.name)} set ${sql.join(
          changed.map(({ c, v }) => sql`${ident(c.name)} = ${valueSql(c, v)}`),
          sql`, `,
        )} where ${keyWhere(t, k)} returning ${keySelect(t)}, ${selectList(t)}`,
      )) as unknown as Record<string, string | null>[];
      const names = changed.map((x) => x.c.name);
      await logAction(tx, actor, { universityId: universityOf(t, after) }, "plat.data.update", t.name, k.join(" · "), {
        table: t.name,
        row: k.join(" · "),
        changed: names,
        before: forLog(t, before),
        after: forLog(t, after),
      });
      return names;
    });
  } catch (e) {
    const pg = pgError(e);
    if (pg) throw new ValidationError(writeErrorMessage(t, pg));
    throw e;
  }
}

/** The word to type before anything is deleted. */
export const DELETE_WORD = "delete";

/**
 * Deletes rows, after the person typed "delete". All or nothing: if other rows still point
 * at any of them, nothing is deleted and the message says which rows to delete first.
 */
export async function deleteRows(actor: Actor, table: string, keys: (string[] | string)[], confirm: string): Promise<number> {
  assertSuperAdmin(actor);
  const t = await tableOrThrow(table);
  if (confirm.trim().toLowerCase() !== DELETE_WORD) throw new ValidationError(`Type ${DELETE_WORD} in the box to confirm, then try again.`);
  const list = keys.map((k) => (typeof k === "string" ? decodeRowKey(k) : k));
  if (!list.length) throw new ValidationError("Select at least one row to delete.");
  if (list.length > 500) throw new ValidationError("Delete at most 500 rows at a time.");
  if (list.some((k) => !k)) throw new NotFoundError("Row");
  const before: Record<string, string | null>[] = [];
  try {
    return await db().transaction(async (tx) => {
      for (const k of list as string[][]) {
        const row = await readRow(tx, t, k, true);
        if (!row) throw new NotFoundError("Row");
        before.push(row);
      }
      for (let i = 0; i < before.length; i++) {
        const k = (list as string[][])[i];
        await tx.execute(sql`delete from ${ident(t.name)} where ${keyWhere(t, k)}`);
        await logAction(tx, actor, { universityId: t.name === "universities" ? null : universityOf(t, before[i]) }, "plat.data.delete", t.name, k.join(" · "), {
          table: t.name,
          row: k.join(" · "),
          before: forLog(t, before[i]),
        });
      }
      return before.length;
    });
  } catch (e) {
    const pg = pgError(e);
    if (pg?.code === "23503") throw new ValidationError(await blockersMessage(t, before, pg));
    if (pg) throw new ValidationError(writeErrorMessage(t, pg));
    throw e;
  }
}

/* ─────────────────────────── For the pages ─────────────────────────── */

/** Institutes to filter by. */
export async function instituteOptions(actor: Actor): Promise<{ id: string; name: string }[]> {
  assertSuperAdmin(actor);
  return (await db().execute(sql`select id::text as id, name from universities order by name`)) as unknown as { id: string; name: string }[];
}

/** "₹1,200" for a paise value, when it is a whole number. */
export function rupeesHint(v: string | null): string | null {
  if (v === null || !/^-?\d+$/.test(v)) return null;
  return formatINR(Number(v));
}

/** How a column is filled when left empty on a new row. */
export function emptyMeans(c: ColumnMeta): string {
  if (c.generated) return "Worked out by the database.";
  if (c.identity) return "Numbered by the database.";
  if (c.defaultExpr) return `Leave empty for the default: ${c.defaultExpr.replace(/::[a-z_ ]+/gi, "").slice(0, 60)}.`;
  if (c.nullable) return "Leave empty for null.";
  return "Required.";
}

export type { Tx };
