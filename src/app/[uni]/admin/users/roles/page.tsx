import { PageHeader } from "@/components/ui";
import { roleSummaries } from "@/server/authz/capabilities";
import { RolesExplorer } from "./roles-explorer";

export const metadata = { title: "Roles & permissions" };

const NOTES = [
  { title: "Holding several roles", body: "One person can head one department and teach in another. They get the strongest access any of their roles gives." },
  { title: "Changing what someone can do", body: "Give or remove a role under Administration or Teaching. What each role allows is the same at every institute." },
  { title: "Students and parents", body: "Students, alumni and parents use the learner app, so they never see the admin panel." },
];

/** The PRD page 3 matrix, rendered from the same tables the server enforces. */
export default async function RolesPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  return (
    <>
      <PageHeader title="Roles & permissions" subtitle="What each role can do, and how far it reaches. Zinny checks these rules on the server for every action." />
      <RolesExplorer base={`/${uni}/admin`} roles={roleSummaries()} />
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
