import { Empty } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { SeriesCard, TestCard } from "@/modules/assessments/components/learner-cards";
import { myTests } from "@/modules/assessments/learner";

export const metadata = { title: "Tests" };

/** The learner's tests: available, upcoming and completed, for their own batches only. */
export default async function LearnerTests({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  const { tests, series, timezone } = await myTests(actor);
  const sections = [
    { key: "available", title: "Available now", empty: "Nothing to take right now." },
    { key: "upcoming", title: "Coming up", empty: null },
    { key: "completed", title: "Completed", empty: null },
  ] as const;
  const total = tests.length + series.length;

  return (
    <>
      <h1 className="mb-5 text-[26px] font-semibold tracking-tight">Tests</h1>
      {total === 0 ? (
        <Empty title="No tests yet">Tests and quizzes for your batches will show up here.</Empty>
      ) : (
        <div className="space-y-8">
          {sections.map((sec) => {
            const ts = tests.filter((t) => t.bucket === sec.key);
            const ss = series.filter((s) => s.bucket === sec.key);
            if (ts.length + ss.length === 0 && !sec.empty) return null;
            return (
              <section key={sec.key}>
                <h2 className="mb-3 text-[17px] font-medium">
                  {sec.title} {ts.length + ss.length > 0 && <span className="text-muted">{ts.length + ss.length}</span>}
                </h2>
                {ts.length + ss.length === 0 ? (
                  <p className="rounded-[22px] border border-dashed border-line px-4 py-6 text-center text-[14px] text-muted">{sec.empty}</p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {ss.map((s) => (
                      <SeriesCard key={s.id} s={s} uni={uni} timezone={timezone} />
                    ))}
                    {ts.map((t) => (
                      <TestCard key={t.id} t={t} uni={uni} timezone={timezone} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
