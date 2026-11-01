"use client";

import { useRef, useState } from "react";
import { ButtonLink, Field, Select, cx } from "@/components/ui";
import type { RoleSummary, SectionSummary } from "@/server/authz/capabilities";
import type { Access } from "@/server/authz/menu";

const LEVEL: Record<Access, { short: string; long: string; tone: string }> = {
  full: { short: "Full", long: "Full access", tone: "bg-brand text-canvas" },
  dept: { short: "Department", long: "Own department", tone: "bg-brand-soft text-brand-strong" },
  batches: { short: "Batches", long: "Own batches", tone: "bg-brand-soft text-brand-strong" },
  students: { short: "Students", long: "Own students", tone: "bg-brand-soft text-brand-strong" },
  view: { short: "View", long: "View only", tone: "text-muted ring-1 ring-inset ring-line" },
};

function Level({ access, long }: { access: Access; long?: boolean }) {
  const l = LEVEL[access];
  return <span className={cx("inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap", l.tone)}>{long ? l.long : l.short}</span>;
}

const list = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/** Pick a role to see what it does, or compare them all in the table below. */
export function RolesExplorer({ base, roles }: { base: string; roles: RoleSummary[] }) {
  const [picked, setPicked] = useState(roles[0].key);
  const detail = useRef<HTMLDivElement>(null);
  const role = roles.find((r) => r.key === picked) ?? roles[0];
  const groups = ["Administration", "Teaching"] as const;

  return (
    <>
      <div className="mb-4 xl:hidden">
        <Field label="Role">
          <Select value={picked} onChange={(e) => setPicked(e.target.value as RoleSummary["key"])}>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {roles
                  .filter((r) => r.group === g)
                  .map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[248px_minmax(0,1fr)]">
        <nav aria-label="Roles" className="sticky top-6 hidden rounded-[22px] border border-line bg-surface p-2 xl:block">
          {groups.map((g) => (
            <div key={g}>
              <p className="px-3 pt-3 pb-1.5 text-[12px] text-muted">{g}</p>
              {roles
                .filter((r) => r.group === g)
                .map((r) => {
                  const on = r.key === role.key;
                  return (
                    <button
                      key={r.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setPicked(r.key)}
                      className={cx(
                        "block w-full rounded-2xl px-3 py-2.5 text-left [transition-property:background-color] duration-150",
                        on ? "bg-brand text-canvas" : "hover:bg-canvas",
                      )}
                    >
                      <span className="block text-[14px] leading-snug font-medium">{r.label}</span>
                      <span className={cx("block text-[12.5px] leading-snug", on ? "text-canvas/70" : "text-muted")}>{r.reach}</span>
                    </button>
                  );
                })}
            </div>
          ))}
        </nav>

        <div ref={detail} className="min-w-0 scroll-mt-6">
          <RoleDetail key={role.key} role={role} base={base} />
        </div>
      </div>

      <section aria-labelledby="compare-roles" className="mt-10">
        <h2 id="compare-roles" className="text-[20px] font-semibold">
          Compare roles
        </h2>
        <p className="mt-1 text-[14px] text-muted">Dark green is full access, light green is limited to their own area, and an outline means they can only look.</p>
        <div className="relative mt-4 overflow-x-auto rounded-[22px] border border-line bg-surface">
          <table className="w-full min-w-[660px] border-collapse text-left text-[14px]">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="sticky left-0 z-10 bg-surface px-5 py-3 text-[13px] font-normal text-muted">
                  Section
                </th>
                {roles.map((r) => (
                  <th key={r.key} scope="col" className={cx("px-2 py-2 align-bottom font-normal", r.key === role.key && "bg-brand-soft/50")}>
                    <button
                      type="button"
                      aria-pressed={r.key === role.key}
                      onClick={() => {
                        setPicked(r.key);
                        detail.current?.scrollIntoView({ block: "start" });
                      }}
                      className={cx("rounded-lg px-1 py-1 text-left text-[12.5px] leading-snug hover:text-brand", r.key === role.key ? "font-medium text-ink" : "text-muted")}
                    >
                      {r.label}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {roles[0].sections.map((s, i) => (
                <tr key={s.key}>
                  <th scope="row" className="sticky left-0 z-10 bg-surface px-5 py-3 font-medium whitespace-nowrap">
                    {s.label}
                  </th>
                  {roles.map((r) => {
                    const access = r.sections[i].access;
                    return (
                      <td key={r.key} className={cx("px-2.5 py-3", r.key === role.key && "bg-brand-soft/50")}>
                        {access ? <Level access={access} /> : <NoAccess />}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function NoAccess() {
  return (
    <>
      <span aria-hidden className="ml-1 inline-block size-1 rounded-full bg-faint align-middle" />
      <span className="sr-only">No access</span>
    </>
  );
}

function RoleDetail({ role, base }: { role: RoleSummary; base: string }) {
  const open = role.sections.filter((s) => s.access);
  const closed = role.sections.filter((s) => !s.access);
  const facts = [
    { term: "Reach", value: role.reach },
    { term: "Sections", value: `${open.length} of ${role.sections.length}` },
    { term: "Can edit", value: role.readOnly ? "No, read only" : "Yes" },
  ];
  return (
    <section aria-label={role.label} className="pop-in @container rounded-[22px] border border-line bg-surface">
      <header className="border-b border-line p-6">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1 basis-64">
            <h2 className="text-[22px] leading-tight font-semibold">{role.label}</h2>
            <p className="mt-1.5 text-[15px] text-muted">{role.purpose}</p>
          </div>
          <ButtonLink href={`${base}/users/${role.group.toLowerCase()}`} variant="secondary" size="sm">
            See {role.group.toLowerCase()} people
          </ButtonLink>
        </div>
        <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-3">
          {facts.map((f) => (
            <div key={f.term}>
              <dt className="text-[12.5px] text-muted">{f.term}</dt>
              <dd className="mt-0.5 text-[14px] font-medium">{f.value}</dd>
            </div>
          ))}
        </dl>
      </header>
      <div className="divide-y divide-line">
        {open.map((s) => (
          <SectionAbilities key={s.key} section={s} />
        ))}
      </div>
      {closed.length > 0 && <p className="border-t border-line px-6 py-4 text-[14px] text-muted">No access to {list(closed.map((s) => s.label))}.</p>}
    </section>
  );
}

function SectionAbilities({ section }: { section: SectionSummary }) {
  return (
    <div className="px-6 py-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-medium">{section.label}</h3>
        {section.access && <Level access={section.access} long />}
      </div>
      <ul className="mt-3 grid gap-x-8 gap-y-1.5 @xl:grid-cols-2">
        {section.abilities.map((a) => (
          <li key={a.label} className={cx("flex items-start gap-2.5 text-[14px] leading-snug", !a.can && "text-muted")}>
            {a.can ? (
              <svg aria-hidden viewBox="0 0 16 16" className="mt-0.5 size-3.5 shrink-0 text-brand" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
              </svg>
            ) : (
              <span aria-hidden className="mt-[9px] h-px w-3.5 shrink-0 bg-faint" />
            )}
            <span>
              {!a.can && <span className="sr-only">Not allowed: </span>}
              {a.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
