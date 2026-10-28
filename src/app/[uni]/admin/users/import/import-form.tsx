"use client";

import { useActionState } from "react";
import { Badge, buttonClass, Textarea } from "@/components/ui";
import { importAction, type ImportState } from "../../actions";

const SAMPLE = `name,email,phone,role,department,access_ends
Ravi Kumar,ravi@example.edu,9800000001,student,,
Neha Shah,neha@example.edu,,permanent_faculty,CS,
Dev Rao,dev@example.edu,,visiting_faculty,CS,2027-03-31`;

export function ImportForm({ uni }: { uni: string }) {
  const [state, action] = useActionState<ImportState, FormData>(importAction, null);
  const rows = state?.result?.rows ?? [];
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="uni" value={uni} />
      <input type="file" name="file" accept=".csv,text/csv" className="block text-sm file:mr-3 file:rounded-full file:border-0 file:bg-brand-soft file:px-4 file:py-2 file:text-brand-strong" />
      <Textarea name="csv" rows={8} defaultValue={state?.csv ?? SAMPLE} />
      <div className="flex gap-2">
        <button name="mode" value="check" className={buttonClass("secondary")}>
          Check file
        </button>
        <button name="mode" value="commit" className={buttonClass("primary")}>
          Import
        </button>
      </div>
      {state?.error && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
      {state?.ok && <p className="rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand-strong">{state.ok}</p>}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Line</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.line}>
                  <td className="px-3 py-2 text-faint">{r.line}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-muted">{r.email}</td>
                  <td className="px-3 py-2">{r.role}</td>
                  <td className="px-3 py-2">{r.ok ? <Badge tone="brand">OK</Badge> : <span className="text-danger">{r.error}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </form>
  );
}
