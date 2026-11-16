"use client";

/**
 * Roles & permissions, the plain way: pick a role on the left, flip switches on the right,
 * save. One switch per thing a role can do, grouped by area, in the words people use.
 * Replaces the View / Add-Edit / Delete grid, which was hard to read.
 */
import { useActionState, useEffect, useMemo, useState } from "react";
import { ActionForm, SubmitButton, type ActionState, type FormAction } from "@/components/forms";
import { Field, Input, Select, buttonClass, cx, ActionAnchor } from "@/components/ui";
import type { Reach } from "@/server/authz/abilities";
import type { AbilityOption, RoleSummary } from "@/server/authz/capabilities";

const REACH_ORDER: Record<Reach, number> = { institute: 0, department: 1, batch: 2 };

export type NewRoleKind = { kind: string; label: string; hint: string; reach: Reach };

type Actions = { save: FormAction; reset: FormAction; remove: FormAction };

type Props = {
  roles: RoleSummary[];
  options: AbilityOption[];
  /** Kinds a new custom role can be. Empty: no "New role" button (the Zinny-wide defaults). */
  kinds: NewRoleKind[];
  actions: Actions;
  /** Sent with every form, such as which institute these roles belong to. */
  hidden?: Record<string, string>;
  /** Where these roles apply, for the header ("Demo Institute", "Every institute"). */
  where: string;
  /** What "Reset" goes back to, in words. */
  resetTo?: string;
  /** Where the people holding a role are listed. */
  peopleHref?: string;
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

/** What state a role is in, in one short phrase. */
function status(r: RoleSummary): { text: string; tone: string } {
  if (!r.editable) return { text: "Fixed", tone: "text-muted ring-1 ring-inset ring-line" };
  if (r.custom) return { text: "Custom role", tone: "bg-brand-soft text-brand-strong" };
  if (r.edited) return { text: "Changed here", tone: "bg-gold-soft text-gold-strong" };
  if (r.zinnyDefault) return { text: "Zinny-wide change", tone: "bg-brand-soft text-brand-strong" };
  return { text: "Zinny default", tone: "text-muted ring-1 ring-inset ring-line" };
}

function Pill({ r }: { r: RoleSummary }) {
  const s = status(r);
  return <span className={cx("inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap", s.tone)}>{s.text}</span>;
}

/** An on/off switch. */
function Switch({ on, disabled, label, onChange }: { on: boolean; disabled?: boolean; label: string; onChange?: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!on)}
      className={cx(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none",
        on ? "bg-brand" : "bg-line",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
      )}
    >
      <span className={cx("inline-block size-5 rounded-full bg-surface shadow transition-transform", on ? "translate-x-[22px]" : "translate-x-0.5")} />
    </button>
  );
}

export function RoleSwitches({ roles, options, kinds, actions, hidden, where, resetTo = "the Zinny default", peopleHref }: Props) {
  const [picked, setPicked] = useState(roles[0]?.key ?? "");
  const [making, setMaking] = useState(false);
  const [justMade, setJustMade] = useState<string | null>(null);
  const role = roles.find((r) => r.key === picked) ?? roles[0];
  const groups = useMemo(() => [...new Set(roles.map((r) => r.group))], [roles]);

  // A new role has no key until the page reloads its list, so it is found by name.
  useEffect(() => {
    const made = justMade && roles.find((r) => r.label === justMade);
    if (made) {
      setPicked(made.key);
      setJustMade(null);
    }
  }, [roles, justMade]);

  if (!role) return null;

  function pick(key: string) {
    setPicked(key);
    setMaking(false);
  }

  return (
    <div className="grid items-start gap-6 grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)]">
      <div className="xl:sticky xl:top-6">
        <div className="xl:hidden">
          <Field label="Role">
            <Select value={making ? "" : role.key} onChange={(e) => pick(e.target.value)}>
              {making && <option value="">New role</option>}
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
        <nav aria-label="Roles" className="hidden rounded-2xl border border-line bg-surface p-2 xl:block">
          {groups.map((g) => (
            <div key={g}>
              <p className="px-3 pt-3 pb-1.5 text-[12px] text-muted">{g}</p>
              {roles
                .filter((r) => r.group === g)
                .map((r) => {
                  const on = r.key === role.key && !making;
                  return (
                    <button
                      key={r.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => pick(r.key)}
                      className={cx("block w-full rounded-2xl px-3 py-2.5 text-left transition-colors", on ? "bg-brand text-canvas" : "hover:bg-canvas")}
                    >
                      <span className="block text-[14px] leading-snug font-medium">{r.label}</span>
                      <span className={cx("block text-[12.5px] leading-snug", on ? "text-canvas/75" : "text-muted")}>
                        {r.holders} {r.holders === 1 ? "person" : "people"} · {status(r).text}
                      </span>
                    </button>
                  );
                })}
            </div>
          ))}
        </nav>
        {kinds.length > 0 && (
          <button type="button" onClick={() => setMaking(true)} className={cx(buttonClass(making ? "primary" : "secondary"), "mt-3 w-full")}>
            New role
          </button>
        )}
      </div>

      {making ? (
        <RoleForm
          key="new"
          role={null}
          roles={roles}
          options={options}
          kinds={kinds}
          actions={actions}
          hidden={hidden}
          where={where}
          resetTo={resetTo}
          onCancel={() => setMaking(false)}
          onCreated={(name) => {
            setJustMade(name);
            setMaking(false);
          }}
        />
      ) : (
        <RoleForm key={role.key} role={role} roles={roles} options={options} kinds={kinds} actions={actions} hidden={hidden} where={where} resetTo={resetTo} peopleHref={peopleHref} />
      )}
    </div>
  );
}

function RoleForm({
  role,
  roles,
  options,
  kinds,
  actions,
  hidden,
  where,
  resetTo,
  peopleHref,
  onCancel,
  onCreated,
}: Omit<Props, "roles"> & { role: RoleSummary | null; roles: RoleSummary[]; resetTo: string; onCancel?: () => void; onCreated?: (name: string) => void }) {
  const [kind, setKind] = useState(kinds[0]?.kind ?? "");
  const [name, setName] = useState(role?.custom ? role.label : "");
  const [on, setOn] = useState(() => new Set(role?.on ?? []));
  const [find, setFind] = useState("");
  const [state, formAction] = useActionState<ActionState, FormData>(actions.save, null);
  const editable = !role || role.editable;
  const reach = role?.reachKey ?? kinds.find((k) => k.kind === kind)?.reach ?? "institute";

  // Section names, and each ability's wording for this role (a Head of Department's can differ).
  const sample = role ?? roles[0];
  const titles = useMemo(() => Object.fromEntries(sample.sections.map((s) => [s.key, s.label])), [sample]);
  const wording = useMemo(() => Object.fromEntries((role?.sections ?? []).flatMap((s) => s.abilities.map((a) => [a.key, a.label]))), [role]);
  const locked = useMemo(() => (role?.sections ?? []).flatMap((s) => s.abilities.filter((a) => a.locked && a.can).map((a) => ({ key: a.key, label: a.label, section: s.key }))), [role]);

  // Only what works at this role's reach is offered.
  const offered = options.filter((o) => REACH_ORDER[o.reach] >= REACH_ORDER[reach]);
  const term = find.trim().toLowerCase();
  const visible = term ? offered.filter((o) => (wording[o.key] ?? o.label).toLowerCase().includes(term) || (titles[o.section] ?? "").toLowerCase().includes(term)) : offered;
  const sections = [...new Set([...offered.map((o) => o.section), ...locked.map((l) => l.section)])];

  const saved = useMemo(() => new Set(role?.on ?? []), [role]);
  const dirty = !role || on.size !== saved.size || [...on].some((k) => !saved.has(k));

  useEffect(() => {
    if (state?.ok && !role) onCreated?.(name.trim());
    // Only when a save finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // What a switch needs comes on with it; what depends on it goes off with it.
  function turnOn(set: Set<string>, key: string) {
    set.add(key);
    offered.find((o) => o.key === key)?.needs?.forEach((n) => turnOn(set, n));
  }
  function turnOff(set: Set<string>, key: string) {
    set.delete(key);
    offered.filter((o) => o.needs?.includes(key) && set.has(o.key)).forEach((o) => turnOff(set, o.key));
  }
  function change(keys: string[], value: boolean) {
    setOn((now) => {
      const next = new Set(now);
      keys.forEach((k) => (value ? turnOn(next, k) : turnOff(next, k)));
      return next;
    });
  }

  const needsLabel = (o: AbilityOption) =>
    (o.needs ?? [])
      .map((n) => wording[n] ?? offered.find((x) => x.key === n)?.label)
      .filter(Boolean)
      .join(", ");

  return (
    <div className="min-w-0 space-y-4">
      <form action={formAction} className="rounded-2xl border border-line bg-surface">
        <Hidden fields={hidden} />
        {role && !role.custom && <input type="hidden" name="role" value={role.kind} />}
        {role?.custom && <input type="hidden" name="id" value={role.key} />}
        {!role && <input type="hidden" name="kind" value={kind} />}
        {[...on].map((k) => (
          <input key={k} type="hidden" name="ability" value={k} />
        ))}

        <header className="border-b border-line p-6">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[22px] leading-tight font-semibold">{role ? role.label : "New role"}</h2>
            {role && <Pill r={role} />}
          </div>
          <p className="mt-1 text-[14px] text-muted">
            {where}
            {role ? ` · ${role.reach} · ${role.holders} ${role.holders === 1 ? "person has" : "people have"} this role` : ""}
            {role && peopleHref && (
              <>
                {" · "}
                <ActionAnchor href={peopleHref} icon="view">
                  See them
                </ActionAnchor>
              </>
            )}
          </p>
          {role?.purpose && <p className="mt-3 text-[15px]">{role.purpose}</p>}
          {role && !role.editable && (
            <p className="mt-3 rounded-xl bg-canvas px-3 py-2 text-[14px] text-muted">
              {role.kind === "super_admin"
                ? "Super Admin can't be changed, so Zinny always has someone who can put things right."
                : role.kind === "institute_admin"
                  ? "Only a Super Admin can change Institute Admin. This is what it can do."
                  : "This role can't be changed here. This is what it can do."}
            </p>
          )}
          {role?.kind === "institute_admin" && role.editable && (
            <p className="mt-3 rounded-xl bg-gold-soft px-3 py-2 text-[14px] text-gold-strong">
              Adding people, changing their roles and changing roles always stay on, so an institute can never lock itself out.
            </p>
          )}

          {!role && (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Field label="Name">
                <Input name="name" required minLength={2} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="For example, Admissions officer" />
              </Field>
              <Field label="What it's for" hint="Optional.">
                <Input name="description" maxLength={200} />
              </Field>
              {kinds.length > 1 && (
                <fieldset className="md:col-span-2">
                  <legend className="mb-1.5 text-[13px] font-medium">Where it works</legend>
                  <div className="grid gap-2 md:grid-cols-2">
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
            </div>
          )}
          {role?.custom && editable && (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Field label="Name">
                <Input name="name" required minLength={2} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="What it's for" hint="Optional.">
                <Input name="description" maxLength={200} defaultValue={role.purpose !== "A custom role." ? role.purpose : ""} />
              </Field>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Find a permission, like refunds"
              aria-label="Find a permission"
              className="h-10 w-full max-w-sm rounded-full border border-line bg-surface px-4 text-[14px] outline-none focus:border-brand focus:ring-4 focus:ring-gold-soft"
            />
            <span className="text-[13px] text-muted">
              {on.size + locked.length} switched on. Some switches need another one; that one comes on too.
            </span>
          </div>
        </header>

        <div className="divide-y divide-line">
          {sections.map((s) => {
            const items = visible.filter((o) => o.section === s);
            const always = locked.filter((l) => l.section === s && (!term || l.label.toLowerCase().includes(term)));
            if (items.length === 0 && always.length === 0) return null;
            const allOn = items.length > 0 && items.every((o) => on.has(o.key));
            const count = items.filter((o) => on.has(o.key)).length;
            return (
              <section key={s} aria-label={titles[s] ?? s} className="px-6 py-5">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-[16px] font-medium">
                    {titles[s] ?? s} <span className="text-[13px] font-normal text-muted">{count + always.length} of {items.length + always.length} on</span>
                  </h3>
                  {editable && items.length > 1 && (
                    <button type="button" onClick={() => change(items.map((o) => o.key), !allOn)} className="rounded-full px-3 py-1 text-[13px] font-medium text-brand hover:bg-brand-soft">
                      {allOn ? "Turn all off" : "Turn all on"}
                    </button>
                  )}
                </div>
                <ul className="divide-y divide-line/60">
                  {items.map((o) => {
                    const label = wording[o.key] ?? o.label;
                    const needs = needsLabel(o);
                    return (
                      <li key={o.key} className="flex items-center justify-between gap-4 py-2.5">
                        <span className="min-w-0">
                          <span className="block text-[14px]">{label}</span>
                          {needs && <span className="block text-[12.5px] text-muted">Also needs: {needs}</span>}
                        </span>
                        <Switch on={on.has(o.key)} disabled={!editable} label={label} onChange={(v) => change([o.key], v)} />
                      </li>
                    );
                  })}
                  {always.map((l) => (
                    <li key={l.key} className="flex items-center justify-between gap-4 py-2.5">
                      <span className="min-w-0">
                        <span className="block text-[14px]">{l.label}</span>
                        <span className="block text-[12.5px] text-muted">Always on for this role</span>
                      </span>
                      <Switch on disabled label={l.label} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {term && visible.length === 0 && <p className="px-6 py-5 text-[14px] text-muted">Nothing matches &ldquo;{find}&rdquo;. Try another word.</p>}
        </div>

        {editable && (
          <footer className="sticky bottom-0 rounded-b-2xl border-t border-line bg-surface/95 p-4 backdrop-blur">
            {state?.error && <p className="mb-3 rounded-xl bg-danger-soft px-3 py-2 text-[14px] text-danger">{state.error}</p>}
            {state?.ok && !dirty && <p className="mb-3 rounded-xl bg-brand-soft px-3 py-2 text-[14px] text-brand-strong">{state.ok}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <SubmitButton pendingText={role ? "Saving…" : "Creating…"}>{role ? "Save changes" : "Create role"}</SubmitButton>
              {role ? (
                <button type="button" disabled={!dirty} onClick={() => setOn(new Set(role.on))} className={cx(buttonClass("ghost"), !dirty && "opacity-50")}>
                  Undo changes
                </button>
              ) : (
                <button type="button" onClick={onCancel} className={buttonClass("ghost")}>
                  Cancel
                </button>
              )}
              {role && dirty && <span className="text-[13px] text-gold-strong">You have changes that aren&apos;t saved yet.</span>}
            </div>
          </footer>
        )}
      </form>

      {role && editable && (role.edited || role.custom) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-6 py-4">
          {role.edited ? (
            <>
              <p className="text-[14px] text-muted">Put this role back to {resetTo}.</p>
              <ActionForm action={actions.reset} confirm={`Put ${role.label} back to ${resetTo}? Everyone with this role gets that on their next page.`}>
                <Hidden fields={hidden} />
                <input type="hidden" name="role" value={role.kind} />
                <SubmitButton variant="secondary" size="sm" pendingText="Resetting…">
                  Reset to default
                </SubmitButton>
              </ActionForm>
            </>
          ) : (
            <>
              <p className="text-[14px] text-muted">{role.holders > 0 ? "Move everyone to another role before deleting this one." : "Nobody has this role, so it can be deleted."}</p>
              <ActionForm action={actions.remove} confirm={`Delete ${role.label}?`}>
                <Hidden fields={hidden} />
                <input type="hidden" name="id" value={role.key} />
                <SubmitButton variant="danger" size="sm" pendingText="Deleting…">
                  Delete role
                </SubmitButton>
              </ActionForm>
            </>
          )}
        </div>
      )}
    </div>
  );
}
