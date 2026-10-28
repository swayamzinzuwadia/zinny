import Link from "next/link";
import { Card, Empty } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { browseCatalog } from "@/server/services/enrolment";
import { formatINR } from "@/server/services/finance";

export const metadata = { title: "Courses" };

export default async function Catalog({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  const courses = await browseCatalog(actor);
  return (
    <>
      <h1 className="mb-5 text-[26px] font-semibold tracking-tight">Courses</h1>
      {courses.length === 0 && <Empty title="No courses open right now" />}
      <div className="grid gap-3 sm:grid-cols-2">
        {courses.map((c) => (
          <Link key={c.id} href={`/${uni}/learn/courses/${c.id}`}>
            <Card className="h-full hover:border-brand">
              <div className="text-xs font-medium uppercase tracking-wide text-faint">{c.departmentName}</div>
              <div className="mt-1 text-[17px] font-semibold">{c.title}</div>
              {c.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{c.description}</p>}
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="font-medium">{c.pricePaise ? formatINR(c.pricePaise) : "Free"}</span>
                <span className={c.seatsLeft ? "text-brand" : "text-muted"}>
                  {c.openBatches} batch{c.openBatches === 1 ? "" : "es"} · {c.seatsLeft ? `${c.seatsLeft} seats left` : "Full"}
                </span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
