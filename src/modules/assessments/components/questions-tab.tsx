import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardTitle, Empty, Field, Input, Notice, Select, buttonClass, cx } from "@/components/ui";
import type { Actor } from "@/server/core";
import { addDrawRuleAction, addQuestionsAction, moveQuestionAction, removeDrawRuleAction, removeQuestionAction } from "../actions";
import { DIFFICULTIES, DIFFICULTY_LABEL, QUESTION_TYPES, TYPE_LABEL, fmtMarks, plural } from "../lib/labels";
import { describeRule, testQuestions } from "../manage";
import { searchQuestions } from "../pool";
import { InlineAction, QuestionPreview } from "./bits";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

/** Inside a test: Questions. Picked questions in order, draw rules, and the pool to pick from. */
export async function QuestionsTab({ uni, actor, testId, search, base }: { uni: string; actor: Actor; testId: string; search: Search; base: string }) {
  const data = await testQuestions(actor, testId);
  const pickedIds = new Set(data.picked.map((q) => q.id));
  const f = { pool: one(search.pool) || "all", q: one(search.q), type: one(search.type), difficulty: one(search.difficulty), tag: one(search.tag), page: Number(one(search.page)) || 1 };
  const pool = data.canManage ? await searchQuestions(actor, f) : null;
  const poolName = (dept: string | null) => pool?.pools.find((p) => p.departmentId === dept)?.name ?? (dept ? "department pool" : "university-wide pool");
  const fields = { uni, testId };
  const qs = (patch: Record<string, string | number>) => {
    const p = new URLSearchParams({ tab: "questions" });
    for (const [k, v] of Object.entries({ ...f, page: 1, ...patch })) if (v && !(k === "page" && v === 1) && !(k === "pool" && v === "all")) p.set(k, String(v));
    return `${base}?${p.toString()}`;
  };

  return (
    <div className="grid gap-6 2xl:grid-cols-[1fr_1fr]">
      <div className="space-y-6">
        <Card>
          <CardTitle hint={`${plural(data.questionCount, "question")}, ${data.marksAreExact ? "" : "about "}${fmtMarks(data.totalMarks)} marks`}>In this test</CardTitle>
          {data.picked.length === 0 && data.rules.length === 0 ? (
            <Empty title="No questions yet">{data.canManage ? "Pick questions from the pool, or add a draw rule." : "The test's owner hasn't added questions yet."}</Empty>
          ) : (
            <ol className="space-y-3">
              {data.picked.map((q, i) => (
                <li key={q.id} className="flex gap-3 rounded-2xl border border-line p-4">
                  <span className="tabular w-6 shrink-0 pt-0.5 text-[13px] text-muted">{i + 1}.</span>
                  <div className="min-w-0 flex-1">
                    <QuestionPreview q={q} />
                  </div>
                  {data.canManage && (
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {i > 0 && (
                        <InlineAction action={moveQuestionAction} fields={{ ...fields, questionId: q.id, direction: "up" }}>
                          Move up
                        </InlineAction>
                      )}
                      {i < data.picked.length - 1 && (
                        <InlineAction action={moveQuestionAction} fields={{ ...fields, questionId: q.id, direction: "down" }}>
                          Move down
                        </InlineAction>
                      )}
                      <InlineAction action={removeQuestionAction} fields={{ ...fields, questionId: q.id }} variant="danger">
                        Remove
                      </InlineAction>
                    </div>
                  )}
                </li>
              ))}
              {data.rules.map((r) => (
                <li key={r.id} className="flex items-start gap-3 rounded-2xl border border-dashed border-brand/40 bg-brand-soft/40 p-4">
                  <span className="pt-0.5 text-[13px] text-brand-strong">Draw</span>
                  <div className="min-w-0 flex-1 text-[14px]">
                    <div className="font-medium">{describeRule(r, poolName(r.poolDepartmentId))}</div>
                    <div className={cx("text-[13px]", r.available < r.count ? "text-danger" : "text-muted")}>
                      {r.available} in the pool match. Each student gets a different random set.
                    </div>
                  </div>
                  {data.canManage && (
                    <InlineAction action={removeDrawRuleAction} fields={{ ...fields, ruleId: r.id }} variant="danger">
                      Remove
                    </InlineAction>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Card>

        {data.canManage && pool && (
          <Card>
            <CardTitle>Add a draw rule</CardTitle>
            <p className="mb-4 text-[13px] text-muted">For example, 8 random medium questions tagged SQL. Questions you picked above are never drawn twice.</p>
            <ActionForm action={addDrawRuleAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <input type="hidden" name="uni" value={uni} />
              <input type="hidden" name="testId" value={testId} />
              <Field label="How many">
                <Input name="count" type="number" min={1} max={200} defaultValue={5} required />
              </Field>
              <Field label="Difficulty">
                <Select name="difficulty" defaultValue="">
                  <option value="">Any</option>
                  {DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>
                      {DIFFICULTY_LABEL[d]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Type">
                <Select name="type" defaultValue="">
                  <option value="">Any</option>
                  {QUESTION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Tagged">
                <Input name="tag" list="pool-tags" placeholder="Any tag" />
                <datalist id="pool-tags">
                  {pool.tags.map((t) => (
                    <option key={t.tag} value={t.tag} />
                  ))}
                </datalist>
              </Field>
              <Field label="From">
                <Select name="pool" defaultValue={pool.pools.find((p) => p.departmentId === data.test.departmentId)?.key ?? pool.pools[0]?.key}>
                  {pool.pools.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex items-end">
                <SubmitButton variant="secondary">Add draw rule</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        )}
      </div>

      {data.canManage && pool && (
        <Card className="h-fit">
          <CardTitle hint={<Link href={`${base.replace(/\/[^/]+$/, "")}/pool`}>Open the pool</Link>}>Pick from the pool</CardTitle>
          <form className="mb-3 flex flex-wrap gap-2" action={base}>
            <input type="hidden" name="tab" value="questions" />
            <Select name="pool" defaultValue={f.pool} className="w-48!" aria-label="Pool">
              {pool.pools.length > 1 && <option value="all">All pools</option>}
              {pool.pools.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Input name="q" defaultValue={f.q} placeholder="Search" className="min-w-0 flex-1" aria-label="Search the pool" />
            <Input name="tag" defaultValue={f.tag} placeholder="Tag" className="w-28!" list="pool-tags-2" aria-label="Tag" />
            <datalist id="pool-tags-2">
              {pool.tags.map((t) => (
                <option key={t.tag} value={t.tag} />
              ))}
            </datalist>
            <Select name="difficulty" defaultValue={f.difficulty} className="w-32!" aria-label="Difficulty">
              <option value="">Any difficulty</option>
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {DIFFICULTY_LABEL[d]}
                </option>
              ))}
            </Select>
            <Select name="type" defaultValue={f.type} className="w-36!" aria-label="Type">
              <option value="">Any type</option>
              {QUESTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
            <button className={buttonClass("secondary")}>Filter</button>
          </form>
          {pool.rows.length === 0 ? (
            <Notice tone="neutral">
              No questions match.{" "}
              <Link href={`${base.replace(/\/[^/]+$/, "")}/pool?panel=add`} className="underline">
                Add one to the pool
              </Link>
              .
            </Notice>
          ) : (
            <ActionForm action={addQuestionsAction} resetOnSuccess>
              <input type="hidden" name="uni" value={uni} />
              <input type="hidden" name="testId" value={testId} />
              <ul className="max-h-[640px] space-y-2 overflow-y-auto pr-1">
                {pool.rows.map((q) => (
                  <li key={q.id}>
                    <label className={cx("flex cursor-pointer gap-3 rounded-2xl border p-3", pickedIds.has(q.id) ? "border-line bg-canvas opacity-60" : "border-line hover:border-brand/40")}>
                      <input type="checkbox" name="questionId" value={q.id} disabled={pickedIds.has(q.id)} className="mt-1 accent-brand" />
                      <div className="min-w-0 flex-1">
                        <QuestionPreview q={q} compact />
                        {pickedIds.has(q.id) && <span className="text-[12px] text-muted">Already in this test</span>}
                      </div>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <SubmitButton>Add ticked questions</SubmitButton>
                {pool.pages > 1 && (
                  <span className="flex items-center gap-3 text-[13px] text-muted">
                    {pool.page > 1 && <Link href={qs({ page: pool.page - 1 })}>Previous</Link>}
                    Page {pool.page} of {pool.pages}
                    {pool.page < pool.pages && <Link href={qs({ page: pool.page + 1 })}>Next</Link>}
                  </span>
                )}
              </div>
            </ActionForm>
          )}
        </Card>
      )}
    </div>
  );
}
