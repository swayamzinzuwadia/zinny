import Link from "next/link";
import { RoleSwitches, type NewRoleKind } from "@/components/role-switches";
import { PageHeader, Select, cx } from "@/components/ui";
import { abilityOptions } from "@/server/authz/capabilities";
import { platformContext } from "@/server/context";
import { ZINNY_DEFAULTS, listRoles } from "@/server/services/roles";
import { deleteTeamRoleAction, resetTeamRoleAction, saveTeamRoleAction } from "@/modules/zinny-team-panel/actions";
import { NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { isSuperAdmin } from "@/modules/zinny-team-panel/lib/access";
import { universityOptions } from "@/modules/zinny-team-panel/services/universities";

export const metadata = { title: "Roles & permissions" };

const TEAM_KINDS: NewRoleKind[] = [{ kind: "custom_platform", label: "All of Zinny", hint: "Works across the Zinny team panel.", reach: "institute" }];
const INSTITUTE_KINDS: NewRoleKind[] = [
  { kind: "custom_institute", label: "Whole institute", hint: "Works across every department.", reach: "institute" },
  { kind: "custom_department", label: "One department", hint: "Works only in the department it is given for.", reach: "department" },
];

type Search = { for?: string };

/**
 * Every role on Zinny in one place, for Super Admins: the Zinny team's roles, the defaults
 * every institute starts from, and any one institute's roles (built-in and custom).
 */
export default async function RolesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await platformContext();
  if (!isSuperAdmin(actor)) return <NoAccess section="Roles & permissions" who="Only Super Admins" />;
  const sp = await searchParams;
  const institutes = await universityOptions(actor);
  const picked = institutes.find((u) => u.id === sp.for);
  const scope = sp.for === "defaults" ? "defaults" : picked ? "institute" : "team";

  const roles =
    scope === "team"
      ? // Partnerships went with the Partners pages; it only shows while someone still holds it.
        (await listRoles(actor, null)).filter((r) => r.kind !== "partnerships" || r.holders > 0)
      : await listRoles(actor, scope === "defaults" ? ZINNY_DEFAULTS : picked!.id);

  const tabs = [
    { key: "team", label: "Zinny team", href: "/platform/roles" },
    { key: "defaults", label: "Every institute", href: "/platform/roles?for=defaults" },
  ];
  const explain = {
    team: "What each Zinny team role can open in this panel. Super Admin is fixed.",
    defaults:
      "The starting point for every institute. Change a role here and it changes at every institute that hasn't changed that role itself. To change just one institute, choose it on the right.",
    institute: `${picked?.name ?? ""}'s own roles. A change here applies only to this institute and wins over the Zinny-wide defaults. Custom roles made here belong to this institute.`,
  }[scope];

  return (
    <>
      <PageHeader title="Roles & permissions" subtitle="Choose whose roles to change, pick a role, then switch things on or off and save. Every change is kept in the activity log." />

      <div className="mb-6 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <nav aria-label="Whose roles" className="flex flex-wrap gap-1 rounded-full border border-line bg-canvas p-1">
            {tabs.map((t) => (
              <Link
                key={t.key}
                href={t.href}
                aria-current={scope === t.key ? "page" : undefined}
                className={cx("rounded-full px-4 py-1.5 text-[14px]", scope === t.key ? "bg-brand font-medium text-canvas" : "text-muted hover:text-ink")}
              >
                {t.label}
              </Link>
            ))}
            {picked && (
              <span aria-current="page" className="rounded-full bg-brand px-4 py-1.5 text-[14px] font-medium text-canvas">
                {picked.name}
              </span>
            )}
          </nav>
          <form className="flex flex-wrap items-end gap-2" action="/platform/roles">
            <label className="block text-[13px] text-muted">
              One institute
              <Select name="for" defaultValue={picked?.id ?? ""} className="mt-1 h-10 w-64 rounded-full">
                <option value="" disabled>
                  Choose an institute
                </option>
                {institutes.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </label>
            <button className="h-10 rounded-full bg-brand px-5 text-[14px] font-medium text-canvas hover:bg-brand-strong">Open its roles</button>
          </form>
        </div>
        <p className="mt-3 text-[14px] text-muted">{explain}</p>
      </div>

      <RoleSwitches
        key={scope === "institute" ? picked!.id : scope}
        roles={roles}
        options={abilityOptions(scope === "team")}
        kinds={scope === "team" ? TEAM_KINDS : scope === "institute" ? INSTITUTE_KINDS : []}
        actions={{ save: saveTeamRoleAction, reset: resetTeamRoleAction, remove: deleteTeamRoleAction }}
        hidden={{ scope: scope === "team" ? "team" : scope === "defaults" ? ZINNY_DEFAULTS : picked!.id }}
        where={scope === "team" ? "Zinny team" : scope === "defaults" ? "Every institute" : picked!.name}
        resetTo={scope === "defaults" ? "Zinny's original permissions" : scope === "institute" ? "the Zinny-wide default" : "the Zinny default"}
        peopleHref={scope === "team" ? "/platform/team" : scope === "institute" ? `/platform/people?university=${picked!.id}` : "/platform/people"}
      />
    </>
  );
}
