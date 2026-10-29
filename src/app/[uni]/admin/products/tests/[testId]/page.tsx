import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice, PageHeader, Tabs } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { KindBadge, StatusBadge } from "@/modules/assessments/components/bits";
import { QuestionsTab } from "@/modules/assessments/components/questions-tab";
import { ProctoringTab, ResultsTab, SeriesTab, SettingsTab } from "@/modules/assessments/components/test-tabs";
import { formatMinutes } from "@/modules/assessments/lib/time";
import { describeWindow, getTest, testCourseChoices } from "@/modules/assessments/manage";

export const metadata = { title: "Test" };

type Search = Record<string, string | string[] | undefined>;

export default async function TestPage({ params, searchParams }: { params: Promise<{ uni: string; testId: string }>; searchParams: Promise<Search> }) {
  const { uni, testId } = await params;
  const search = await searchParams;
  const { actor } = await spaceContext(uni);
  const info = await getTest(actor, testId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const t = info.test;
  const isSeries = t.kind === "series";
  const tabs = isSeries
    ? [
        { key: "tests", label: "Tests" },
        { key: "settings", label: "Settings" },
      ]
    : [
        { key: "questions", label: "Questions" },
        { key: "proctoring", label: "Proctoring" },
        { key: "settings", label: "Settings" },
        { key: "results", label: "Results" },
      ];
  const requested = typeof search.tab === "string" ? search.tab : tabs[0].key;
  const tab = tabs.some((x) => x.key === requested) ? requested : tabs[0].key;
  const base = `/${uni}/admin/products/tests/${testId}`;
  const choices = tab === "settings" && info.canManage ? await testCourseChoices(actor) : [];
  const course = choices.find((c) => c.courseId === t.courseId);

  const facts = [
    info.course.title,
    t.allBatches ? "every batch" : info.courseBatches.filter((b) => info.batchIds.includes(b.id)).map((b) => b.name).join(", "),
    !isSeries && (t.timeLimitMinutes ? formatMinutes(t.timeLimitMinutes) : "No time limit"),
    !isSeries && describeWindow(t, info.timezone),
  ].filter(Boolean);

  return (
    <>
      <div className="mb-2 text-sm text-muted">
        <Link href={`/${uni}/admin/products/tests`} className="hover:text-ink">
          Tests
        </Link>
        {info.series && (
          <>
            {" "}
            /{" "}
            <Link href={`/${uni}/admin/products/tests/${info.series.id}`} className="hover:text-ink">
              {info.series.title}
            </Link>
          </>
        )}
      </div>
      <PageHeader
        title={t.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <KindBadge kind={t.kind} />
            <StatusBadge status={t.status} />
            <span>{facts.join(" · ")}</span>
          </span>
        }
      />
      {!info.canManage && <div className="mb-6"><Notice tone="neutral">You can see this test and its results for your batches. Only staff who teach every batch it is for can change it.</Notice></div>}
      <Tabs active={tab} tabs={tabs.map((x) => ({ ...x, href: `${base}?tab=${x.key}` }))} />

      {tab === "questions" && <QuestionsTab uni={uni} actor={actor} testId={testId} search={search} base={base} />}
      {tab === "tests" && <SeriesTab uni={uni} actor={actor} seriesId={testId} />}
      {tab === "proctoring" && <ProctoringTab uni={uni} info={info} />}
      {tab === "settings" && <SettingsTab uni={uni} info={info} wholeCourse={course?.wholeCourse ?? false} pickable={course?.batches ?? []} />}
      {tab === "results" && <ResultsTab uni={uni} actor={actor} testId={testId} batchId={typeof search.batch === "string" && search.batch ? search.batch : undefined} base={base} />}
    </>
  );
}
