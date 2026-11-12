import Link from "next/link";
import { Badge, ButtonLink, Empty, PageHeader, Table, Td } from "@/components/ui";
import { can } from "@/server/authz/engine";
import { spaceContext } from "@/server/context";
import { listCourses } from "@/server/services/courses";
import { listDepartments } from "@/server/services/departments";
import { formatINR } from "@/server/services/finance";
import { marketplaceOnlyCourseIds } from "@/modules/marketplace/listings";

export const metadata = { title: "Courses" };

const STATUS_TONE = { published: "brand", draft: "neutral", archived: "warn" } as const;

export default async function CoursesPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  const [all, depts, forSale] = await Promise.all([listCourses(actor), listDepartments(actor), marketplaceOnlyCourseIds(actor)]);
  const courses = all.filter((c) => !forSale.has(c.id));
  // Someone who can make a department can always start a course: the New course page makes both.
  const canCreate =
    can(actor, "department.manage", { universityId: university.id }) ||
    depts.some((d) => can(actor, "course.create", { universityId: university.id, departmentIds: [d.id] }));
  const newHref = `/${uni}/admin/products/courses/new`;

  return (
    <>
      <PageHeader
        title="Courses"
        subtitle="Each course lives in one department. Batches inside it set the days, timings and seats."
        actions={canCreate ? <ButtonLink href={newHref}>New course</ButtonLink> : null}
      />
      {courses.length === 0 ? (
        canCreate ? (
          <Empty title="No courses yet">
            <p>Create your first course on one page: its department, first batch, timings and teacher. Only the title is needed.</p>
            <div className="mt-4">
              <ButtonLink href={newHref}>Create your first course</ButtonLink>
            </div>
          </Empty>
        ) : (
          <Empty title="No courses for you yet">
            Courses you teach show here once you&apos;re added to a batch. Institute admins and heads of department create courses and choose who teaches them.
          </Empty>
        )
      ) : (
        <Table head={["Course", "Department", "Batches", "Students", "Price", "Status"]}>
          {courses.map((c) => (
            <tr key={c.id} className="hover:bg-canvas/60">
              <Td>
                <Link href={`/${uni}/admin/products/courses/${c.id}`} className="font-medium text-ink hover:text-brand">
                  {c.title}
                </Link>
              </Td>
              <Td className="text-muted">{c.departmentName}</Td>
              <Td className="tabular-nums">
                {c.batchCount === 0 ? (
                  <Link href={`/${uni}/admin/products/courses/${c.id}?tab=batches`} className="font-medium text-brand hover:underline">
                    Add a batch
                  </Link>
                ) : (
                  c.batchCount
                )}
              </Td>
              <Td className="tabular-nums">{c.studentCount}</Td>
              <Td className="tabular-nums">{c.pricePaise ? formatINR(c.pricePaise) : "Free"}</Td>
              <Td>
                <Badge tone={STATUS_TONE[c.status]}>{c.status[0].toUpperCase() + c.status.slice(1)}</Badge>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
