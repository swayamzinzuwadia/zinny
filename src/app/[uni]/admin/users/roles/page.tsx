import { PageHeader, Table, Td } from "@/components/ui";
import { ACCESS_LABEL, MENU, SECTION_ACCESS } from "@/server/authz/menu";
import { ROLE_LABELS } from "@/server/authz/roles";
import type { RoleName } from "@/db/schema";

export const metadata = { title: "Roles & permissions" };

const ROWS: RoleName[] = ["institute_admin", "board_owner", "accounts_fees", "hod", "permanent_faculty", "visiting_faculty"];

/** The PRD page 3 matrix, rendered from the same table the server enforces. */
export default function RolesPage() {
  const cols = MENU.filter((m) => m.key !== "dashboard");
  return (
    <>
      <PageHeader
        title="Roles & permissions"
        subtitle="Who sees what in the admin panel. Every action is also checked on the server against the person's role and scope."
      />
      <Table head={["Role", ...cols.map((c) => c.label)]}>
        {ROWS.map((r) => (
          <tr key={r}>
            <Td className="font-medium">{ROLE_LABELS[r]}</Td>
            {cols.map((c) => {
              const a = SECTION_ACCESS[r]?.[c.key];
              return (
                <Td key={c.key} className={a === "full" ? "text-brand" : a ? "text-ink" : "text-faint"}>
                  {a ? ACCESS_LABEL[a] : "–"}
                </Td>
              );
            })}
          </tr>
        ))}
      </Table>
      <p className="mt-4 text-sm text-muted">
        Students, alumni and parents use the learner app, not the admin panel. One person can hold several roles, for example head one department and teach in another.
      </p>
    </>
  );
}
