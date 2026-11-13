"use client";

import { useActionState } from "react";
import { Badge, Field, Select, buttonClass, Textarea } from "@/components/ui";
import { importAction, type ImportState } from "../../actions";

const SAMPLE = `name,email,phone,role,department,access_ends
Ravi Kumar,ravi@example.edu,9800000001,student,CS,
Neha Shah,neha@example.edu,,permanent_faculty,CS,
Dev Rao,dev@example.edu,,visiting_faculty,CS,2027-03-31`;

/** A file to start from: the header row and one example to replace. */
const TEMPLATE = `name,email,phone,role,department,access_ends
Ravi Kumar,ravi@example.edu,9800000001,student,CS,
`;

export function ImportForm({ uni, batches = [] }: { uni: string; batches?: { id: string; label: string; seatsLeft: number }[] }) {
  const [state, action] = useActionState<ImportState, FormData>(importAction, null);
  const rows = state?.result?.rows ?? [];
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="uni" value={uni} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="block text-sm">
          <span className="mb-1.5 block text-[13px] font-medium">CSV file</span>
          <input type="file" name="file" accept=".csv,text/csv" className="block text-sm file:mr-3 file:rounded-full file:border-0 file:bg-brand-soft file:px-4 file:py-2 file:text-brand-strong" />
        </label>
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="zinny-people-template.csv" className={buttonClass("ghost", "sm")}>
          Download template
        </a>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium">Or paste the rows</span>
        <Textarea name="csv" rows={8} defaultValue={state?.csv ?? ""} placeholder={SAMPLE} />
      </label>
      {batches.length > 0 && (
        <Field label="Put the students in a batch (optional)" hint="Every student in the file gets a seat in it. Staff rows are added as usual.">
          <Select name="batchId" defaultValue="">
            <option value="">No batch</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id} disabled={b.seatsLeft <= 0}>
                {b.label} ({b.seatsLeft <= 0 ? "full" : `${b.seatsLeft} seat${b.seatsLeft === 1 ? "" : "s"} left`})
              </option>
            ))}
          </Select>
        </Field>
      )}
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
            <thead className="border-b border-line text-left text-[13px] text-muted">
              <tr>
                <th className="px-3 py-2 font-normal">Line</th>
                <th className="px-3 py-2 font-normal">Name</th>
                <th className="px-3 py-2 font-normal">Email</th>
                <th className="px-3 py-2 font-normal">Role</th>
                <th className="px-3 py-2 font-normal">Result</th>
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
