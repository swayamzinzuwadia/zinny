"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { ActionForm, SubmitButton, type ActionState, type FormAction } from "@/components/forms";
import { GridLegend, PermissionGrid } from "@/components/permission-grid";
import { ButtonLink, Field, Input, Select, buttonClass, cx } from "@/components/ui";
import type { Reach } from "@/server/authz/abilities";
import type { AbilityOption, RoleSummary, SectionSummary } from "@/server/authz/capabilities";
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

const REACH_ORDER: Record<Reach, number> = { institute: 0, department: 1, batch: 2 };

export type NewRoleKind = { kind: string; label: string; hint: string; reach: Reach };

type Actions = { save: FormAction; reset: FormAction; remove: FormAction };

type Props = {
  roles: RoleSummary[];
  options: AbilityOption[];
  kinds: NewRoleKind[];
  peopleHref: Record<RoleSummary["people"], string>;
  actions: Actions;
  hidden?: Record<string, string>;
};

function Hidden({ fields }: { fields?: Record<string, string> }) {
  return (
    <>
      {Object.entries(fields ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );
}

/** Pick a role to see or change what it does, make a new one, or compare them in the table below. */
export function RolesExplorer({ roles, options, kinds, peopleHref, actions, hidden }: Props) {
  const [picked, setPicked] = useState(roles[0].key);
  const [mode, setMode] = useState<"view" | "edit" | "new">("view");
  const [justMade, setJustMade] = useState<string | null>(null);
  const detail = useRef<HTMLDivElement>(null);
  const role = roles.find((r) => r.key === picked) ?? roles[0];
  const groups = useMemo(() => [...new Set(roles.map((r) => r.group))], [roles]);
  const titles = useMemo(() => Object.fromEntries(roles[0].sections.map((s) => [s.key, s.label])), [roles]);

  // A new role has no key until the page reloads its list, so it is found by name.
  useEffect(() => {
    const made = justMade && roles.find((r) => r.label === justMade);
    if (made) {
      setPicked(made.key);
      setJustMade(null);
    }
  }, [roles, justMade]);

  function pick(key: string) {
    setPicked(key);
    setMode("view");
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1 basis-56 xl:hidden">
          <Field label="Role">
            <Select value={role.key} onChange={(e) => pick(e.target.value)}>
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
        <button type="button" onClick={() => setMode("new")} className={cx(buttonClass("primary"), "ml-auto")}>
          New role
        </button>
      </div>

      <div className="grid items-start gap-6 grid-cols-1 xl:grid-cols-[248px_minmax(0,1fr)]">
        <nav aria-label="Roles" className="sticky top-6 hidden rounded-[22px] border border-line bg-surface p-2 xl:block">
          {groups.map((g) => (
            <div key={g}>
              <p className="px-3 pt-3 pb-1.5 text-[12px] text-muted">{g}</p>
              {roles
                .filter((r) => r.group === g)
                .map((r) => {
                  const on = r.key === role.key && mode !== "new";
                  return (
                    <button
                      key={r.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => pick(r.key)}
                      className={cx(
                        "block w-full rounded-2xl px-3 py-2.5 text-left [transition-property:background-color] duration-150",
                        on ? "bg-brand text-canvas" : "hover:bg-canvas",
                      )}
                    >
                      <span className="block text-[14px] leading-snug font-medium">{r.label}</span>
                      <span className={cx("block text-[12.5px] leading-snug", on ? "text-canvas/70" : "text-muted")}>
                        {r.reach}
                        {r.edited && " · changed"}
                      </span>
                    </button>
                  );
                })}
            </div>
          ))}
        </nav>

        <div ref={detail} className="min-w-0 scroll-mt-6">
          {mode === "view" ? (
            <RoleDetail key={role.key} role={role} peopleHref={peopleHref} actions={actions} hidden={hidden} onEdit={() => setMode("edit")} />
          ) : (
            <RoleEditor
              key={mode === "new" ? "new" : role.key}
              role={mode === "new" ? null : role}
              options={options}
              kinds={kinds}
              titles={titles}
              save={actions.save}
              hidden={hidden}
              onCancel={() => setMode("view")}
              onDone={(name) => {
                if (mode === "new") setJustMade(name);
                setMode("view");
              }}
            />
          )}
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
                        pick(r.key);
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

function RoleDetail({ role, peopleHref, actions, hidden, onEdit }: Pick<Props, "peopleHref" | "actions" | "hidden"> & { role: RoleSummary; onEdit: () => void }) {
  const open = role.sections.filter((s) => s.access);
  const closed = role.sections.filter((s) => !s.access);
  const locked = open.some((s) => s.abilities.some((a) => a.locked && a.can));
  const facts = [
    { term: "Reach", value: role.reach },
    { term: "Sections", value: `${open.length} of ${role.sections.length}` },
    { term: "Can edit", value: role.readOnly ? "No, read only" : "Yes" },
    { term: "People", value: String(role.holders) },
  ];
  return (
    <section aria-label={role.label} className="pop-in @container rounded-[22px] border border-line bg-surface">
      <header className="border-b border-line p-6">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1 basis-64">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[22px] leading-tight font-semibold">{role.label}</h2>
              {role.edited && <span className="rounded-full px-2.5 py-0.5 text-[12px] text-muted ring-1 ring-inset ring-line">Changed from default</span>}
            </div>
            <p className="mt-1.5 text-[15px] text-muted">{role.purpose}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {role.editable && (
              <button type="button" onClick={onEdit} className={buttonClass("primary", "sm")}>
                Edit permissions
              </button>
            )}
            <ButtonLink href={peopleHref[role.people]} variant="secondary" size="sm">
              See people
            </ButtonLink>
          </div>
        </div>
        <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-3">
          {facts.map((f) => (
            <div key={f.term}>
              <dt className="text-[12.5px] text-muted">{f.term}</dt>
              <dd className="mt-0.5 text-[14px] font-medium">{f.value}</dd>
            </div>
          ))}
        </dl>
        {!role.editable && <p className="mt-4 text-[14px] text-muted">This role can&apos;t be changed, so there is always someone who can fix anything else.</p>}
      </header>
      {open.length > 0 && <GridLegend locked={locked} className="border-b border-line px-6 py-4" />}
      <div className="divide-y divide-line">
        {open.map((s) => (
          <SectionGrid key={s.key} section={s} />
        ))}
      </div>
      {closed.length > 0 && <p className="border-t border-line px-6 py-4 text-[14px] text-muted">No access to {list(closed.map((s) => s.label))}.</p>}
      {(role.edited || role.custom) && (
        <div className="border-t border-line px-6 py-4">
          {role.edited ? (
            <ActionForm action={actions.reset} confirm={`Put ${role.label} back to the Zinny default? Everyone with this role goes back to the default on their next page.`}>
              <Hidden fields={hidden} />
              <input type="hidden" name="role" value={role.kind} />
              <SubmitButton variant="secondary" size="sm" pendingText="Resetting…">
                Reset to Zinny default
              </SubmitButton>
            </ActionForm>
          ) : (
            <ActionForm action={actions.remove} confirm={`Delete ${role.label}?`}>
              <Hidden fields={hidden} />
              <input type="hidden" name="id" value={role.key} />
              <SubmitButton variant="danger" size="sm" pendingText="Deleting…">
                Delete role
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      )}
    </section>
  );
}

/** One section of a role, as a read-only grid. A locked ability shows only where the role has it. */
function SectionGrid({ section }: { section: SectionSummary }) {
  const items = section.abilities.filter((a) => !a.locked || a.can);
  const on = new Set(items.filter((a) => a.can).map((a) => a.key));
  return (
    <div className="px-6 py-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-medium">{section.label}</h3>
        {section.access && <Level access={section.access} long />}
      </div>
      <PermissionGrid items={items} on={on} label={section.label} />
    </div>
  );
}

export function RoleEditor({
  role,
  options,
  kinds,
  titles,
  save,
  hidden,
  onCancel,
  onDone,
}: {
  role: RoleSummary | null;
  options: AbilityOption[];
  kinds: NewRoleKind[];
  titles: Record<string, string>;
  save: FormAction;
  hidden?: Record<string, string>;
  onCancel: () => void;
  onDone: (name: string) => void;
}) {
  const named = !role || role.custom;
  const [kind, setKind] = useState(kinds[0]?.kind ?? "");
  const [on, setOn] = useState(() => new Set(role?.on ?? []));
  const [name, setName] = useState(role?.custom ? role.label : "");
  const [state, formAction] = useActionState<ActionState, FormData>(save, null);
  const reach = role?.reachKey ?? kinds.find((k) => k.kind === kind)?.reach ?? "institute";
  // Only what works at this reach is offered; anything else shows as a dash.
  const shown = options.filter((o) => REACH_ORDER[o.reach] >= REACH_ORDER[reach]);
  // Locked abilities are never ticked or saved here; they show, with a lock, only where the role has them.
  const locked = (role?.sections ?? []).flatMap((s) => s.abilities.filter((a) => a.locked && a.can).map((a) => ({ ...a, section: s.key })));
  const sections = [...new Set([...shown.map((o) => o.section), ...locked.map((l) => l.section)])];

  useEffect(() => {
    if (state?.ok) onDone(name.trim());
    // Only when a save finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // What an ability needs comes on with it, and what depends on it goes off with it.
  function turnOn(set: Set<string>, key: string) {
    set.add(key);
    shown.find((o) => o.key === key)?.needs?.forEach((n) => turnOn(set, n));
  }
  function turnOff(set: Set<string>, key: string) {
    set.delete(key);
    shown.filter((o) => o.needs?.includes(key) && set.has(o.key)).forEach((o) => turnOff(set, o.key));
  }
  function change(keys: string[], value: boolean) {
    setOn((now) => {
      const next = new Set(now);
      keys.forEach((k) => (value ? turnOn(next, k) : turnOff(next, k)));
      return next;
    });
  }

  return (
    <form action={formAction} className="pop-in @container rounded-[22px] border border-line bg-surface">
      <Hidden fields={hidden} />
      {role && !role.custom && <input type="hidden" name="role" value={role.kind} />}
      {role?.custom && <input type="hidden" name="id" value={role.key} />}
      {!role && <input type="hidden" name="kind" value={kind} />}

      <header className="border-b border-line p-6">
        <h2 className="text-[22px] leading-tight font-semibold">{role ? `Edit ${role.label}` : "New role"}</h2>
        <p className="mt-1.5 text-[15px] text-muted">{role ? `${role.reach}. Changes apply on each person's next page.` : "Name it, choose how far it reaches, then tick what it can do."}</p>
        {named && (
          <div className="mt-5 grid gap-4 @xl:grid-cols-2">
            <Field label="Name">
              <Input name="name" required minLength={2} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="For example, Admissions officer" />
            </Field>
            <Field label="What it's for" hint="Optional.">
              <Input name="description" maxLength={200} defaultValue={role?.custom && role.purpose !== "A custom role." ? role.purpose : ""} />
            </Field>
          </div>
        )}
        {!role && kinds.length > 1 && (
          <fieldset className="mt-4">
            <legend className="mb-1.5 text-[13px] font-medium">How far it reaches</legend>
            <div className="grid gap-2 @xl:grid-cols-2">
              {kinds.map((k) => (
                <label key={k.kind} className="cursor-pointer">
                  <input type="radio" name="reach" checked={kind === k.kind} onChange={() => setKind(k.kind)} className="peer sr-only" />
                  <span className="block rounded-2xl border border-line p-3 peer-checked:border-brand peer-checked:bg-brand-soft/50 peer-focus-visible:ring-2 peer-focus-visible:ring-gold">
                    <span className="block text-[14px] font-medium">{k.label}</span>
                    <span className="block text-[13px] text-muted">{k.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <p className="mt-5 text-[13px] text-muted">Ticking Add / Edit or Delete ticks View too. Clearing View clears what depends on it.</p>
        <GridLegend locked={locked.length > 0} className="mt-2" />
      </header>

      <div className="divide-y divide-line">
        {sections.map((s) => {
          const items = shown.filter((o) => o.section === s);
          const all = items.every((o) => on.has(o.key));
          const title = titles[s] ?? s;
          return (
            <fieldset key={s} className="min-w-0 px-6 py-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <legend className="float-left text-[15px] font-medium">{title}</legend>
                {items.length > 0 && (
                  <button type="button" onClick={() => change(items.map((o) => o.key), !all)} className="rounded-full px-2 py-0.5 text-[13px] text-brand hover:bg-brand-soft">
                    {all ? "Clear" : "Tick all"}
                  </button>
                )}
              </div>
              <div className="clear-both">
                <PermissionGrid items={[...items, ...locked.filter((l) => l.section === s)]} on={on} onChange={(key, value) => change([key], value)} label={title} />
              </div>
            </fieldset>
          );
        })}
      </div>

      <footer className="border-t border-line p-6">
        {state?.error && <p className="mb-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
        <div className="flex flex-wrap gap-2">
          <SubmitButton>{role ? "Save changes" : "Create role"}</SubmitButton>
          <button type="button" onClick={onCancel} className={buttonClass("ghost")}>
            Cancel
          </button>
        </div>
      </footer>
    </form>
  );
}
