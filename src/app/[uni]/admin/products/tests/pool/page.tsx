import Link from "next/link";
import { Card, CardTitle, Empty, Field, Input, PageHeader, Select, buttonClass, cx } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { archiveQuestionAction, createQuestionAction, importQuestionsAction } from "@/modules/assessments/actions";
import { FilterLink, InlineAction, QuestionPreview } from "@/modules/assessments/components/bits";
import { ImportQuestionsForm } from "@/modules/assessments/components/import-form";
import { QuestionForm } from "@/modules/assessments/components/question-form";
import { DIFFICULTIES, DIFFICULTY_LABEL, QUESTION_TYPES, TYPE_LABEL, plural } from "@/modules/assessments/lib/labels";
import { CSV_SAMPLE, searchQuestions } from "@/modules/assessments/pool";

export const metadata = { title: "Question pool" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function PoolPage({ params, searchParams }: { params: Promise<{ uni: string }>; searchParams: Promise<Search> }) {
  const { uni } = await params;
  const search = await searchParams;
  const { actor } = await spaceContext(uni);
  const f = { pool: one(search.pool) || "all", q: one(search.q), type: one(search.type), difficulty: one(search.difficulty), tag: one(search.tag), page: Number(one(search.page)) || 1 };
  const data = await searchQuestions(actor, f);
  const base = `/${uni}/admin/products/tests/pool`;
  const panel = one(search.panel);
  /** The pool page with these filters. Filters reset the page; `panel` opens the add or import form. */
  const link = (patch: Partial<typeof f> & { panel?: string } = {}) => {
    const p = new URLSearchParams();
    const merged = { ...f, page: "page" in patch ? patch.page : 1, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "page" && v === 1) && !(k === "pool" && v === "all")) p.set(k, String(v));
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };
  const here = link({ page: f.page });
  const writePool = f.pool !== "all" ? f.pool : data.pools[0]?.key;
  const back = new URLSearchParams(Object.entries(f).filter(([, v]) => v && v !== "all" && v !== 1).map(([k, v]) => [k, String(v)])).toString();

  return (
    <>
      <div className="mb-2 text-sm text-muted">
        <Link href={`/${uni}/admin/products/tests`} className="hover:text-ink">
          Tests
        </Link>{" "}
        / Question pool
      </div>
      <PageHeader
        title="Question pool"
        subtitle="Every question lives here and is pulled into tests and quizzes. Each department has its own pool."
        actions={
          <>
            <Link href={link({ page: f.page, panel: "import" })} className={buttonClass("secondary")}>
              Import CSV
            </Link>
            <Link href={link({ page: f.page, panel: "add" })} className={buttonClass("primary")}>
              Add a question
            </Link>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {data.pools.length > 1 && (
          <FilterLink href={link({ pool: "all" })} active={f.pool === "all"}>
            All pools
          </FilterLink>
        )}
        {data.pools.map((p) => (
          <FilterLink key={p.key} href={link({ pool: p.key })} active={f.pool === p.key || (data.pools.length === 1 && f.pool === "all")}>
            {p.name}
          </FilterLink>
        ))}
      </div>

      {(panel === "add" || panel === "import") && writePool && (
        <Card className="mb-6">
          <CardTitle hint={<Link href={here}>Close</Link>}>{panel === "add" ? "Add a question" : "Import questions from a CSV file"}</CardTitle>
          {panel === "add" ? (
            <QuestionForm
              action={createQuestionAction}
              hidden={{ uni, then: "stay" }}
              submitLabel="Add question"
              poolField={
                <Field label="Pool">
                  <Select name="pool" defaultValue={writePool}>
                    {data.pools.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              }
            />
          ) : (
            <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
              <div className="space-y-4">
                <form className="flex items-end gap-2" action={base}>
                  <input type="hidden" name="panel" value="import" />
                  <Field label="Import into">
                    <Select name="pool" defaultValue={writePool}>
                      {data.pools.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <button className={buttonClass("secondary")}>Switch pool</button>
                </form>
                <ImportQuestionsForm key={writePool} uni={uni} pool={writePool} sample={CSV_SAMPLE} action={importQuestionsAction} />
              </div>
              <div className="text-[13px] text-muted">
                <div className="mb-2 font-medium text-ink">Columns</div>
                <ul className="space-y-1.5">
                  <li>
                    <b className="text-ink">type</b>: single, multiple, true_false, numeric or short
                  </li>
                  <li>
                    <b className="text-ink">question</b>: the question text
                  </li>
                  <li>
                    <b className="text-ink">option_a</b> to <b className="text-ink">option_h</b>: for single and multiple choice
                  </li>
                  <li>
                    <b className="text-ink">answer</b>: the letter (B), letters (A;C), true or false, the number, or a marking guide for short answers
                  </li>
                  <li>
                    <b className="text-ink">tolerance</b>, <b className="text-ink">marks</b>, <b className="text-ink">negative_marks</b>, <b className="text-ink">difficulty</b> (easy, medium, hard),{" "}
                    <b className="text-ink">tags</b> (separate with ;), <b className="text-ink">explanation</b>: optional
                  </li>
                </ul>
                <p className="mt-3">Every row is checked first. Nothing is saved unless all rows are valid. Questions already in the pool are skipped.</p>
              </div>
            </div>
          )}
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_260px]">
        <div className="min-w-0 space-y-3">
          <form className="flex flex-wrap gap-2" action={base}>
            {f.pool !== "all" && <input type="hidden" name="pool" value={f.pool} />}
            {f.tag && <input type="hidden" name="tag" value={f.tag} />}
            <Input name="q" defaultValue={f.q} placeholder="Search question text" className="min-w-0 flex-1" aria-label="Search questions" />
            <Select name="type" defaultValue={f.type} className="w-40!" aria-label="Type">
              <option value="">Any type</option>
              {QUESTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
            <Select name="difficulty" defaultValue={f.difficulty} className="w-36!" aria-label="Difficulty">
              <option value="">Any difficulty</option>
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {DIFFICULTY_LABEL[d]}
                </option>
              ))}
            </Select>
            <button className={buttonClass("secondary")}>Filter</button>
          </form>
          <div className="flex items-center justify-between text-[13px] text-muted">
            <span>
              {plural(data.total, "question")}
              {f.tag && (
                <>
                  {" "}
                  tagged <b className="text-ink">{f.tag}</b>{" "}
                  <Link href={link({ tag: "" })} className="text-brand">
                    Clear tag
                  </Link>
                </>
              )}
            </span>
            {data.pages > 1 && (
              <span className="flex items-center gap-3">
                {data.page > 1 && <Link href={link({ page: data.page - 1 })}>Previous</Link>}
                Page {data.page} of {data.pages}
                {data.page < data.pages && <Link href={link({ page: data.page + 1 })}>Next</Link>}
              </span>
            )}
          </div>
          {data.rows.length === 0 ? (
            <Empty title={data.total === 0 && !f.q && !f.tag && !f.type && !f.difficulty ? "This pool is empty" : "No questions match"}>
              Add questions one by one, or import a CSV file.
            </Empty>
          ) : (
            <ul className="space-y-3">
              {data.rows.map((q) => (
                <li key={q.id}>
                  <Card className="p-5">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <QuestionPreview q={q} />
                      </div>
                      {q.canEdit && (
                        <div className="flex shrink-0 gap-1">
                          <Link href={`${base}/${q.id}${back ? `?back=${encodeURIComponent(back)}` : ""}`} className={buttonClass("ghost", "sm")}>
                            Edit
                          </Link>
                          <InlineAction action={archiveQuestionAction} fields={{ uni, questionId: q.id }} variant="danger" confirm="Remove this question from the pool? Tests stop using it; past attempts keep their copy.">
                            Remove
                          </InlineAction>
                        </div>
                      )}
                    </div>
                    {q.explanation && !("guide" in q.answer && q.answer.guide === q.explanation) && <p className="mt-2 text-[13px] text-muted">{q.explanation}</p>}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Card className="h-fit p-5">
          <CardTitle>Tags</CardTitle>
          {data.tags.length === 0 ? (
            <p className="text-[13px] text-muted">No tags yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {data.tags.map((t) => (
                <Link
                  key={t.tag}
                  href={link({ tag: f.tag.toLowerCase() === t.tag.toLowerCase() ? "" : t.tag })}
                  className={cx(
                    "rounded-full px-2.5 py-1 text-[12px]",
                    f.tag.toLowerCase() === t.tag.toLowerCase() ? "bg-brand text-canvas" : "bg-canvas text-muted ring-1 ring-line hover:text-ink",
                  )}
                >
                  {t.tag} <span className="opacity-70">{t.n}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
