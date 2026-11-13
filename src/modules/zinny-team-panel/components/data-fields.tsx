/** Form fields and cells for the data console, built from a column's catalogue entry. Server components. */
import Link from "next/link";
import { Badge, Field, Input, Select, Textarea, cx, inputClass } from "@/components/ui";
import { emptyMeans, rupeesHint, type ColumnMeta } from "../data-console";
import { dataRowHref, dataTableHref } from "../lib/data-links";

const LONG_NAME = /description|body|notes?$|content|html|message|text|bio|summary|reason|about|details|comment|instructions|answer|explanation|prompt/i;

/** What kind of value a column holds, in a few words. */
export function typeLabel(c: ColumnMeta): string {
  if (c.kind === "enum") return "choice";
  if (c.kind === "array") return `list of ${c.elementKind === "enum" ? "choices" : (c.type.replace(/\[\]$/, "") || "values")}`;
  return c.type;
}

function prettyJson(v: string | null) {
  if (v === null) return "";
  try {
    return JSON.stringify(JSON.parse(v), null, 2);
  } catch {
    return v;
  }
}

function arrayLines(v: string | null) {
  if (v === null) return "";
  try {
    const a = JSON.parse(v) as unknown[];
    // One per line, unless a value would be lost that way (empty strings, nulls, line breaks).
    if (a.every((x) => typeof x === "number" || (typeof x === "string" && x !== "" && !x.includes("\n") && x.trim() === x))) return a.join("\n");
    return JSON.stringify(a);
  } catch {
    return v;
  }
}

/**
 * One column's field. `value` is the current value as text (null is null); on a new row it
 * is null and the hint says what an empty field means.
 */
export function DataField({ column: c, value, mode, linkLabel }: { column: ColumnMeta; value: string | null; mode: "insert" | "update"; linkLabel?: string }) {
  const name = `v.${c.name}`;
  const isNew = mode === "insert";
  const readOnly = c.generated || (!isNew && c.primaryKey) || (isNew && c.identity);
  const hints: string[] = [typeLabel(c)];
  if (isNew) hints.push(emptyMeans(c));
  if (c.money) {
    const r = rupeesHint(value);
    hints.push(`In paise: 100 paise make ₹1.${r && !isNew ? ` Now ${r}.` : ""}`);
  }
  if (c.kind === "timestamptz") hints.push("India time.");
  if (c.kind === "array") hints.push("One value per line, or a JSON array.");
  if (c.kind === "json") hints.push("Must be valid JSON.");
  const hint = hints.join(" · ");

  if (c.secret) {
    return (
      <Field label={c.name} hint="Hidden. Passwords, tokens and secrets can't be seen or changed here.">
        <div className={cx(inputClass, "flex items-center text-muted")}>{value === null ? "Not set" : "••••••"}</div>
      </Field>
    );
  }

  if (readOnly) {
    return (
      <Field label={c.name} hint={`${typeLabel(c)} · ${c.primaryKey ? "Primary key, can't be changed." : c.generated ? "Worked out by the database." : "Numbered by the database."}`}>
        <div className={cx(inputClass, "flex items-center overflow-hidden bg-canvas font-mono text-[13px] text-muted")}>
          <span className="truncate">{value ?? (isNew ? "Filled in by the database" : "null")}</span>
        </div>
      </Field>
    );
  }

  let control: React.ReactNode;
  switch (c.kind) {
    case "boolean": {
      const checked = isNew ? /^true$/i.test(c.defaultExpr ?? "") : value === "true";
      control = (
        <label className="flex h-10 items-center gap-2 text-[14px]">
          <input type="hidden" name={`bool.${c.name}`} value="1" />
          <input type="checkbox" name={name} defaultChecked={checked} className="size-4 accent-brand" />
          Yes
        </label>
      );
      break;
    }
    case "enum":
      control = (
        <Select name={name} defaultValue={value ?? ""}>
          {(isNew || value === null) && <option value="">{isNew ? "Leave for the database" : "Pick one"}</option>}
          {(c.enumValues ?? []).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
      );
      break;
    case "integer":
    case "bigint":
      control = <Input type="number" step="1" name={name} defaultValue={value ?? ""} inputMode="numeric" />;
      break;
    case "decimal":
      control = <Input type="number" step="any" name={name} defaultValue={value ?? ""} inputMode="decimal" />;
      break;
    case "date":
      control = <Input type="date" name={name} defaultValue={value ?? ""} />;
      break;
    case "timestamp":
    case "timestamptz":
      // The plain browser control: it keeps seconds, which the picker rounds away.
      control = <input type="datetime-local" step="1" name={name} defaultValue={value ?? ""} className={inputClass} />;
      break;
    case "time":
      control = <input type="time" step="1" name={name} defaultValue={value ?? ""} className={inputClass} />;
      break;
    case "json":
      control = <Textarea name={name} defaultValue={prettyJson(value)} rows={Math.min(14, Math.max(4, prettyJson(value).split("\n").length + 1))} className="font-mono" spellCheck={false} />;
      break;
    case "array":
      control = <Textarea name={name} defaultValue={arrayLines(value)} rows={Math.min(10, Math.max(3, arrayLines(value).split("\n").length + 1))} className="font-mono" spellCheck={false} />;
      break;
    case "uuid":
      control = <Input name={name} defaultValue={value ?? ""} className="font-mono text-[13px]" spellCheck={false} autoComplete="off" />;
      break;
    default: {
      const long = LONG_NAME.test(c.name) || (value !== null && (value.length > 100 || value.includes("\n")));
      control = long ? (
        <Textarea name={name} defaultValue={value ?? ""} rows={Math.min(12, Math.max(3, Math.ceil((value?.length ?? 0) / 80) + 1))} />
      ) : (
        <Input name={name} defaultValue={value ?? ""} autoComplete="off" />
      );
    }
  }

  return (
    <div>
      <Field label={c.name} hint={hint}>
        {control}
      </Field>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
        {!isNew && c.nullable && (
          <label className="flex items-center gap-1.5 text-muted">
            <input type="checkbox" name={`null.${c.name}`} defaultChecked={value === null} className="size-3.5 accent-brand" />
            Leave empty (null)
          </label>
        )}
        {c.references && value && (
          <Link href={dataRowHref(c.references.table, [value])} className="font-medium text-brand hover:underline">
            Open {linkLabel ? `${linkLabel} ` : ""}in {c.references.table}
          </Link>
        )}
      </div>
    </div>
  );
}

const CUT = 60;

/** A value in the table view: masked, linked or cut short. */
export function DataCell({
  column: c,
  value,
  linkLabel,
  institute,
}: {
  column: ColumnMeta;
  value: string | null;
  linkLabel?: string;
  institute?: string;
}) {
  if (value === null) return <span className="italic text-faint">null</span>;
  if (c.secret) return <span className="text-muted">••••••</span>;
  if (c.references) {
    const label = institute ?? linkLabel;
    const href = c.references.column === "id" ? dataRowHref(c.references.table, [value]) : dataTableHref(c.references.table, { filter: c.references.column, value });
    return (
      <Link href={href} className="text-brand hover:underline" title={value}>
        {label ? label : <span className="font-mono text-[12.5px]">{value.slice(0, 8)}…</span>}
      </Link>
    );
  }
  if (c.kind === "boolean") return value === "true" ? <Badge tone="brand">true</Badge> : <Badge>false</Badge>;
  if (c.money) return <span className="tabular" title={`${value} paise`}>{rupeesHint(value) ?? value}</span>;
  const text = c.kind === "timestamptz" || c.kind === "timestamp" ? value.replace("T", " ") : value;
  const mono = c.kind === "uuid" || c.kind === "json" || c.kind === "array";
  if (c.kind === "uuid") return <span className="font-mono text-[12.5px]" title={text}>{text.slice(0, 8)}…</span>;
  return (
    <span className={cx(mono && "font-mono text-[12.5px]")} title={text.length > CUT ? text.slice(0, 500) : undefined}>
      {text.length > CUT ? `${text.slice(0, CUT)}…` : text}
    </span>
  );
}
