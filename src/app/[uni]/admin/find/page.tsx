import Link from "next/link";
import { redirect } from "next/navigation";
import { Empty, Input, PageHeader, buttonClass } from "@/components/ui";
import { menuFor } from "@/server/authz/menu";
import { spaceContext } from "@/server/context";
import { listAllBatches } from "@/server/services/batches";
import { listCourses } from "@/server/services/courses";
import { listPeople } from "@/server/services/users";
import { findMatches } from "./match";

export const metadata = { title: "Find" };

type Hit = { kind: "Student" | "Staff" | "Course" | "Batch"; title: string; detail: string; href: string };
const LIMIT = 8;

/**
 * One box, from the sidebar, for a student, a member of staff, a course or a batch. Each list
 * comes from the same service as its own page, so nobody finds what they couldn't open there.
 * With exactly one match the search goes straight to it.
 */
export default async function FindPage({ params, searchParams }: { params: Promise<{ uni: string }>; searchParams: Promise<{ q?: string }> }) {
  const { uni } = await params;
  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  const { actor, university } = await spaceContext(uni);
  const base = `/${uni}/admin`;
  const open = new Set(menuFor(actor, university.id).flatMap((s) => s.items.map((i) => i.href)));

  let groups: { label: string; hits: Hit[]; more: number }[] = [];
  if (q) {
    const [students, teaching, administration, courses, batches] = await Promise.all([
      open.has("/users/students") ? listPeople(actor, "students") : Promise.resolve([]),
      open.has("/users/teaching") ? listPeople(actor, "teaching") : Promise.resolve([]),
      open.has("/users/administration") ? listPeople(actor, "administration") : Promise.resolve([]),
      open.has("/products/courses") ? listCourses(actor) : Promise.resolve([]),
      open.has("/products/courses") ? listAllBatches(actor) : Promise.resolve([]),
    ]);
    const staff = [...new Map([...teaching, ...administration].map((p) => [p.id, p])).values()];
    const person = (p: (typeof students)[number]) => [p.name, p.email, p.phone ?? ""];
    const found = {
      students: findMatches(q, students, person, (p) => p.name).map((p): Hit => ({ kind: "Student", title: p.name, detail: `${p.email} · ${[...new Set(p.roles.map((r) => r.label))].join(", ")}`, href: `${base}/users/students?q=${encodeURIComponent(p.email)}` })),
      staff: findMatches(q, staff, person, (p) => p.name).map((p): Hit => ({ kind: "Staff", title: p.name, detail: `${p.email} · ${[...new Set(p.roles.map((r) => r.label))].join(", ")}`, href: `${base}/users/staff?q=${encodeURIComponent(p.email)}` })),
      courses: findMatches(q, courses, (c) => [c.title, c.departmentName], (c) => c.title).map((c): Hit => ({ kind: "Course", title: c.title, detail: `${c.departmentName} · ${c.batchCount} ${c.batchCount === 1 ? "batch" : "batches"}`, href: `${base}/products/courses/${c.id}` })),
      batches: findMatches(q, batches, (b) => [b.batchName, b.courseTitle], (b) => `${b.courseTitle} ${b.batchName}`).map((b): Hit => ({ kind: "Batch", title: `${b.courseTitle}: ${b.batchName}`, detail: b.timings || "No timings yet", href: `${base}/products/batches/${b.batchId}` })),
    };
    const all = [...found.students, ...found.staff, ...found.courses, ...found.batches];
    // One match: go straight there, like typing a name into a phone's contacts.
    if (all.length === 1) redirect(all[0].href);
    groups = [
      { label: "Students", hits: found.students },
      { label: "Staff", hits: found.staff },
      { label: "Courses", hits: found.courses },
      { label: "Batches", hits: found.batches },
    ]
      .filter((g) => g.hits.length > 0)
      .map((g) => ({ label: g.label, hits: g.hits.slice(0, LIMIT), more: Math.max(0, g.hits.length - LIMIT) }));
  }
  const moreHref: Record<string, string> = {
    Students: `${base}/users/students?q=${encodeURIComponent(q)}`,
    Staff: `${base}/users/staff?q=${encodeURIComponent(q)}`,
    Courses: `${base}/products/courses`,
    Batches: `${base}/products/batches`,
  };

  return (
    <>
      <PageHeader title="Find" subtitle="A student, a member of staff, a course or a batch, by name, email or phone." />
      <form method="get" role="search" className="mb-6 flex max-w-xl gap-2">
        <Input type="search" name="q" defaultValue={q} placeholder="Name, email, phone, course or batch" aria-label="Find" autoFocus className="min-w-0 flex-1" />
        <button type="submit" className={buttonClass("primary")}>
          Find
        </button>
      </form>
      {q && groups.length === 0 && <Empty title={`Nothing matches “${q}”`}>Check the spelling, or try part of a name or an email.</Empty>}
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.label} aria-label={g.label}>
            <h2 className="mb-2 text-[15px] font-medium">{g.label}</h2>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {g.hits.map((h) => (
                <li key={h.href}>
                  <Link href={h.href} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-canvas/60">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{h.title}</span>
                      <span className="block truncate text-[13px] text-muted">{h.detail}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {g.more > 0 && (
              <Link href={moreHref[g.label]} className="mt-2 inline-block text-[13px] text-brand underline underline-offset-2">
                {g.more} more {g.label.toLowerCase()}
              </Link>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
