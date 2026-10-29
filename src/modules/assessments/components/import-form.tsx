"use client";

import { useActionState } from "react";
import { Badge, buttonClass, Textarea } from "@/components/ui";
import type { ImportState } from "../actions";

/** CSV import of questions: check every row first, then import (same pattern as the core people import). */
export function ImportQuestionsForm({
  uni,
  pool,
  sample,
  action,
}: {
  uni: string;
  pool: string;
  sample: string;
  action: (prev: ImportState, data: FormData) => Promise<ImportState>;
}) {
  const [state, formAction, pending] = useActionState<ImportState, FormData>(action, null);
  const rows = state?.result?.rows ?? [];
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="uni" value={uni} />
      <input type="hidden" name="pool" value={pool} />
      <input
        type="file"
        name="file"
        accept=".csv,text/csv"
        className="block text-sm file:mr-3 file:rounded-full file:border-0 file:bg-brand-soft file:px-4 file:py-2 file:text-brand-strong"
      />
      <Textarea name="csv" rows={8} defaultValue={state?.csv ?? sample} aria-label="CSV rows" className="font-mono text-[12px]" />
      <div className="flex flex-wrap gap-2">
        <button name="mode" value="check" disabled={pending} className={buttonClass("secondary")}>
          Check file
        </button>
        <button name="mode" value="commit" disabled={pending} className={buttonClass("primary")}>
          {pending ? "Working…" : "Import questions"}
        </button>
      </div>
      {state?.error && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
      {state?.ok && <p className="rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand-strong">{state.ok}</p>}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-[13px] text-muted">
              <tr>
                <th className="px-3 py-2 font-normal">Line</th>
                <th className="px-3 py-2 font-normal">Type</th>
                <th className="px-3 py-2 font-normal">Question</th>
                <th className="px-3 py-2 font-normal">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.line}>
                  <td className="px-3 py-2 text-faint">{r.line}</td>
                  <td className="px-3 py-2">{r.type}</td>
                  <td className="max-w-[320px] truncate px-3 py-2">{r.prompt}</td>
                  <td className="px-3 py-2">
                    {r.ok && !r.error ? <Badge tone="brand">OK</Badge> : r.ok ? <span className="text-muted">{r.error}</span> : <span className="text-danger">{r.error}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </form>
  );
}
