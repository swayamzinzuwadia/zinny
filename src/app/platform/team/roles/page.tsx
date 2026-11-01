import { RolesExplorer, type NewRoleKind } from "@/components/roles-explorer";
import { PageHeader } from "@/components/ui";
import { abilityOptions } from "@/server/authz/capabilities";
import { platformContext } from "@/server/context";
import { listRoles } from "@/server/services/roles";
import { deleteTeamRoleAction, resetTeamRoleAction, saveTeamRoleAction } from "@/modules/zinny-team-panel/actions";
import { NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { isSuperAdmin } from "@/modules/zinny-team-panel/lib/access";

export const metadata = { title: "Roles & permissions" };

const KINDS: NewRoleKind[] = [{ kind: "custom_platform", label: "All of Zinny", hint: "Works across the Zinny team panel.", reach: "institute" }];

const NOTES = [
  { title: "Super Admin", body: "This role is fixed, so Zinny always has someone who can put things right." },
  { title: "Institutes' own roles", body: "Each institute's Institute Admins manage those. To help one, open it from Support mode and use its Roles & permissions page." },
];

export default async function TeamRolesPage() {
  const actor = await platformContext();
  if (!isSuperAdmin(actor)) return <NoAccess section="Roles & permissions" who="Only Super Admins" />;
  const roles = await listRoles(actor, null);
  return (
    <>
      <PageHeader title="Roles & permissions" subtitle="What each Zinny team role can open. Changes apply on each person's next page." />
      <RolesExplorer
        roles={roles}
        options={abilityOptions(true)}
        kinds={KINDS}
        peopleHref={{ administration: "/platform/team", teaching: "/platform/team", team: "/platform/team" }}
        actions={{ save: saveTeamRoleAction, reset: resetTeamRoleAction, remove: deleteTeamRoleAction }}
      />
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        {NOTES.map((n) => (
          <div key={n.title}>
            <h2 className="text-[14px] font-medium">{n.title}</h2>
            <p className="mt-1 text-[14px] text-muted">{n.body}</p>
          </div>
        ))}
      </div>
    </>
  );
}
