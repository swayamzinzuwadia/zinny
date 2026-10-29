import Link from "next/link";
import { notFound } from "next/navigation";
import { spaceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { TestCard } from "@/modules/assessments/components/learner-cards";
import { plural } from "@/modules/assessments/lib/labels";
import { mySeries } from "@/modules/assessments/learner";

export const metadata = { title: "Test series" };

export default async function LearnerSeries({ params }: { params: Promise<{ uni: string; seriesId: string }> }) {
  const { uni, seriesId } = await params;
  const { actor } = await spaceContext(uni);
  const { series: s, timezone } = await mySeries(actor, seriesId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  return (
    <>
      <Link href={`/${uni}/learn/tests`} className="text-sm text-muted">
        Tests
      </Link>
      <div className="mb-5 mt-2">
        <div className="text-[13px] text-muted">Test series · {s.courseTitle}</div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight">{s.title}</h1>
        <div className="mt-1 text-[14px] text-muted">
          {s.done} of {plural(s.tests.length, "test")} taken
        </div>
      </div>
      <ol className="space-y-3">
        {s.tests.map((t, i) => (
          <li key={t.id} className="flex gap-3">
            <span className="tabular mt-5 w-5 shrink-0 text-right text-[13px] text-muted">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <TestCard t={t} uni={uni} timezone={timezone} compact />
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
