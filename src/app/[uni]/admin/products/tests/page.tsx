import Link from "next/link";
import { Card, CardTitle, Empty, Input, PageHeader, Select, Table, Td, buttonClass } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { createTestAction } from "@/modules/assessments/actions";
import { FilterLink, KindBadge, StatusBadge } from "@/modules/assessments/components/bits";
import { NewTestForm } from "@/modules/assessments/components/targets";
import { KIND_PLURAL, plural } from "@/modules/assessments/lib/labels";
import { listTests, testCourseChoices } from "@/modules/assessments/manage";
import { gradingQueue } from "@/modules/assessments/attempts";

export const metadata = { title: "Tests" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function TestsPage({ params, searchParams }: { params: Promise<{ uni: string }>; searchParams: Promise<Search> }) {
  const { uni } = await params;
  const search = await searchParams;
  const { actor } = await spaceContext(uni);
  const kind = one(search.kind);
  const q = one(search.q);
  const courseId = one(search.course);
  const [tests, allTests, choices, queue] = await Promise.all([
    listTests(actor, { kind, q, courseId }),
    listTests(actor, { courseId }),
    testCourseChoices(actor),
    gradingQueue(actor),
  ]);
  const base = `/${uni}/admin/products/tests`;
  const counts = { quiz: 0, mock_test: 0, series: 0 } as Record<string, number>;
  for (const t of allTests) counts[t.kind]++;
  const courses = [...new Map(allTests.map((t) => [t.courseId, t.courseTitle])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const href = (k: string) => {
    const p = new URLSearchParams();
    if (k) p.set("kind", k);
    if (q) p.set("q", q);
    if (courseId) p.set("course", courseId);
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };
  const toGrade = new Set(queue.map((x) => x.attemptId)).size;

  return (
    <>
      <PageHeader
        title="Tests"
        subtitle="Quizzes, mock tests and test series in one list. Every question comes from the question pool."
        actions={
          <>
            {toGrade > 0 && (
              <Link href={`${base}/grading`} className={buttonClass("gold")}>
                Grade {plural(toGrade, "attempt")}
              </Link>
            )}
            <Link href={`${base}/pool`} className={buttonClass("secondary")}>
              Question pool
            </Link>
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <FilterLink href={href("")} active={!kind}>
              All <span className="ml-1 opacity-70">{allTests.length}</span>
            </FilterLink>
            {(["quiz", "mock_test", "series"] as const).map((k) => (
              <FilterLink key={k} href={href(k)} active={kind === k}>
                {KIND_PLURAL[k]} <span className="ml-1 opacity-70">{counts[k]}</span>
              </FilterLink>
            ))}
            <form className="ml-auto flex gap-2" action={base}>
              {kind && <input type="hidden" name="kind" value={kind} />}
              {courses.length > 1 && (
                <Select name="course" defaultValue={courseId} className="w-44!" aria-label="Course">
                  <option value="">All courses</option>
                  {courses.map(([id, title]) => (
                    <option key={id} value={id}>
                      {title}
                    </option>
                  ))}
                </Select>
              )}
              <Input name="q" defaultValue={q} placeholder="Search by title" className="w-48!" aria-label="Search tests" />
              <button className={buttonClass("secondary")}>Search</button>
            </form>
          </div>

          {tests.length === 0 ? (
            <Empty title={allTests.length ? "No tests match" : "No tests yet"}>
              {allTests.length ? "Try another type or search." : choices.length ? "Create the first one on the right." : "Tests for the batches you teach will show here."}
            </Empty>
          ) : (
            <Table head={["Test", "Course and batches", "Questions", "Window", "Attempts", "Status"]}>
              {tests.map((t) => (
                <tr key={t.id} className="hover:bg-canvas/60">
                  <Td>
                    <Link href={`${base}/${t.id}`} className="font-medium text-ink hover:text-brand">
                      {t.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <KindBadge kind={t.kind} />
                      {t.seriesTitle && <span className="text-[12px] text-muted">In {t.seriesTitle}</span>}
                    </div>
                  </Td>
                  <Td>
                    <div>{t.courseTitle}</div>
                    <div className="text-[13px] text-muted">{t.allBatches ? "Every batch" : t.batchNames.join(", ")}</div>
                  </Td>
                  <Td className="tabular-nums">{t.kind === "series" ? plural(t.childCount, "test") : t.questionCount}</Td>
                  <Td className="text-[13px] text-muted">{t.kind === "series" ? "" : t.window}</Td>
                  <Td className="tabular-nums">{t.kind === "series" ? "" : t.attemptCount}</Td>
                  <Td>
                    <StatusBadge status={t.status} />
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </div>

        {choices.length > 0 && (
          <Card className="h-fit">
            <CardTitle>New test</CardTitle>
            <NewTestForm uni={uni} choices={choices} action={createTestAction} defaultCourseId={courseId} defaultKind={kind || undefined} />
          </Card>
        )}
      </div>
    </>
  );
}
