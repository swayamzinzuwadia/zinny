import Link from "next/link";
import { Notice } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { batchOptions } from "@/server/services/enrolment";
import { formatINR, gstFor } from "@/server/services/finance";
import { BatchPicker } from "../../batch-picker";

export default async function CoursePage({ params }: { params: Promise<{ uni: string; id: string }> }) {
  const { uni, id } = await params;
  const { actor } = await spaceContext(uni);
  const { course, options, myEnrolment } = await batchOptions(actor, id);
  const total = course.pricePaise + gstFor(course.pricePaise, course.gstRateBp);

  return (
    <>
      <Link href={`/${uni}/learn/courses`} className="text-sm text-muted">
        ← Courses
      </Link>
      <h1 className="mt-2 text-[26px] font-semibold tracking-tight">{course.title}</h1>
      {course.description && <p className="mt-1 max-w-2xl text-muted">{course.description}</p>}
      <p className="mt-2 text-sm">
        {course.pricePaise ? (
          <>
            <b>{formatINR(course.pricePaise)}</b> <span className="text-muted">+ {course.gstRateBp / 100}% GST = {formatINR(total)}</span>
          </>
        ) : (
          <b>Free</b>
        )}
      </p>

      <h2 className="mb-3 mt-8 text-[17px] font-semibold">Pick your batch</h2>
      {myEnrolment?.status === "active" ? (
        <Notice>
          You&apos;re enrolled in {options.find((o) => o.mine)?.name ?? "this course"}.{" "}
          <Link href={`/${uni}/learn/my`} className="font-medium underline">
            Switch batch
          </Link>
        </Notice>
      ) : (
        <BatchPicker uni={uni} options={options} mode="enrol" priceLabel={course.pricePaise ? formatINR(total) : undefined} />
      )}
    </>
  );
}
