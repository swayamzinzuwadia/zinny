import { Empty } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { browseCatalog, myLearning } from "@/server/services/enrolment";
import { formatINR } from "@/server/services/finance";
import { CourseCatalog, type CatalogCourse } from "./catalog";

export const metadata = { title: "Courses" };

export default async function Catalog({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  const [courses, learning] = await Promise.all([browseCatalog(actor), myLearning(actor)]);
  const mine = new Map(learning.filter((l) => l.status === "active").map((l) => [l.course.id, l.enrolmentId]));
  const departments = new Set(courses.map((c) => c.departmentName)).size;

  const items: CatalogCourse[] = courses.map((c) => ({
    id: c.id,
    href: mine.has(c.id) ? `/${uni}/learn/my/${mine.get(c.id)}` : `/${uni}/learn/courses/${c.id}`,
    title: c.title,
    description: c.description,
    department: c.departmentName,
    price: c.pricePaise ? formatINR(c.pricePaise) : "Free",
    openBatches: c.openBatches,
    seatsLeft: c.seatsLeft,
    enrolled: mine.has(c.id),
  }));

  return (
    <>
      <div className="mb-7">
        <h1 className="text-[30px] leading-tight font-semibold tracking-tight sm:text-[36px]">Find your next course</h1>
        <p className="mt-1.5 text-[15px] text-muted">
          {courses.length} course{courses.length === 1 ? "" : "s"} open across {departments} department{departments === 1 ? "" : "s"}. Pick one, then the
          batch that fits your week.
        </p>
      </div>
      {courses.length === 0 ? <Empty title="No courses open right now" /> : <CourseCatalog courses={items} />}
    </>
  );
}
