import { RoleSwitches, type NewRoleKind } from "@/components/role-switches";
import { Empty, PageHeader } from "@/components/ui";
import { abilityOptions } from "@/server/authz/capabilities";
import { can } from "@/server/authz/engine";
import { spaceContext } from "@/server/context";
import { listRoles } from "@/server/services/roles";
import { deleteRoleAction, resetRoleAction, saveRoleAction } from "../../actions";

export const metadata = { title: "Roles & permissions" };

const NOTES = [
  { title: "Holding several roles", body: "One person can head one department and teach in another. They get the strongest access any of their roles gives." },
  { title: "Who can change roles", body: "Institute Admins, and Zinny's Super Admins. Only a Super Admin can change Institute Admin itself, so your institute always has someone who can put things right." },
  { title: "Students and parents", body: "Students, alumni and parents use the learner app, so they never see the admin panel." },
];

const KINDS: NewRoleKind[] = [
  { kind: "custom_institute", label: "Whole institute", hint: "Works across every department.", reach: "institute" },
  { kind: "custom_department", label: "One department", hint: "Works only in the department you give it for.", reach: "department" },
];

export default async function RolesPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  const subtitle = "Pick a role, then switch things on or off and save. Zinny checks these rules on the server for every action.";
  if (!can(actor, "role.manage", { universityId: university.id })) {
    return (
      <>
        <PageHeader title="Roles & permissions" subtitle={subtitle} />
        <Empty title="Only Institute Admins can see this page">Ask yours if you need different access.</Empty>
      </>
    );
  }
  const roles = await listRoles(actor, university.id);
  return (
    <>
      <PageHeader title="Roles & permissions" subtitle={subtitle} />
      <RoleSwitches
        roles={roles}
        options={abilityOptions(false)}
        kinds={KINDS}
        actions={{ save: saveRoleAction, reset: resetRoleAction, remove: deleteRoleAction }}
        hidden={{ uni }}
        where={university.name}
        peopleHref={`/${uni}/admin/users`}
      />
      <div className="mt-8 grid gap-6 md:grid-cols-3">
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
