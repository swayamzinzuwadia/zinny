/**
 * The question pool (brief item 1 and 2). Every department has a pool, and admins also
 * see a university-wide pool. Who can write is in access.ts.
 */
import Papa from "papaparse";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { audit, type Actor, withTenant } from "@/server/core";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { assertPoolAccess, canEditQuestion, poolsFor, poolTarget, runsPoolOrWrote, uni, type Pool } from "./access";
import { DIFFICULTIES, QUESTION_TYPES } from "./lib/labels";
import { buildQuestion, type QuestionData, type QuestionDraft } from "./lib/marking";
import { assessQuestions, type Difficulty, type QuestionType } from "./schema";

export type QuestionRow = typeof assessQuestions.$inferSelect;

export type PoolFilter = {
  /** Department id, "university", or "all" (every pool the actor can use). */
  pool?: string;
  q?: string;
  type?: string;
  difficulty?: string;
  tag?: string;
  page?: number;
};

export const PAGE_SIZE = 25;

/** Pools the actor can use, for pickers and the pool switcher. */
export async function listPools(actor: Actor): Promise<Pool[]> {
  return withTenant(actor, (tx) => poolsFor(tx, actor));
}

function poolCondition(pools: Pool[], pool: string | undefined): SQL {
  const wanted = !pool || pool === "all" ? pools : pools.filter((p) => p.key === pool);
  if (wanted.length === 0) return sql`false`;
  const depts = wanted.flatMap((p) => (p.departmentId ? [p.departmentId] : []));
  const includeUni = wanted.some((p) => p.departmentId === null);
  return or(depts.length ? inArray(assessQuestions.departmentId, depts) : undefined, includeUni ? isNull(assessQuestions.departmentId) : undefined) ?? sql`false`;
}

/** Search and filter the pool by text, tag, type and difficulty. Only pools the actor can use are searched. */
export async function searchQuestions(actor: Actor, f: PoolFilter = {}) {
  return withTenant(actor, async (tx) => {
    const pools = await poolsFor(tx, actor);
    if (pools.length === 0) throw new ForbiddenError("You don't have a question pool. Pools open to staff who teach a batch.");
    const conds: (SQL | undefined)[] = [isNull(assessQuestions.archivedAt), poolCondition(pools, f.pool)];
    if (f.q?.trim()) conds.push(ilike(assessQuestions.prompt, `%${f.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`));
    if (f.type && QUESTION_TYPES.includes(f.type as QuestionType)) conds.push(eq(assessQuestions.type, f.type as QuestionType));
    if (f.difficulty && DIFFICULTIES.includes(f.difficulty as Difficulty)) conds.push(eq(assessQuestions.difficulty, f.difficulty as Difficulty));
    if (f.tag?.trim()) conds.push(sql`exists (select 1 from unnest(${assessQuestions.tags}) t where lower(t) = lower(${f.tag.trim()}))`);
    const where = and(...conds);
    const page = Math.max(1, Math.floor(f.page ?? 1));
    const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(assessQuestions).where(where);
    const rows = await tx
      .select()
      .from(assessQuestions)
      .where(where)
      .orderBy(desc(assessQuestions.createdAt), asc(assessQuestions.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);
    // Tags in the searched pools, for the filter list.
    const tagRows = await tx.execute<{ tag: string; n: number }>(sql`
      select min(t) as tag, count(*)::int as n
      from ${assessQuestions}, unnest(${assessQuestions.tags}) t
      where ${and(isNull(assessQuestions.archivedAt), poolCondition(pools, f.pool))}
      group by lower(t) order by count(*) desc, lower(t) limit 60`);
    return {
      pools,
      // Every row is in a pool the actor can use, so only the edit rule is left to check.
      rows: rows.map((q) => ({ ...q, canEdit: runsPoolOrWrote(actor, q) })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      tags: Array.from(tagRows as unknown as { tag: string; n: number }[]),
    };
  });
}

export async function getQuestion(actor: Actor, questionId: string) {
  return withTenant(actor, async (tx) => {
    const [q] = await tx.select().from(assessQuestions).where(eq(assessQuestions.id, questionId));
    if (!q || q.archivedAt) throw new NotFoundError("Question");
    const target = await poolTarget(tx, actor, q.departmentId).catch(() => null);
    if (!target) throw new NotFoundError("Question");
    try {
      await assertPoolAccess(tx, actor, q.departmentId);
    } catch {
      throw new NotFoundError("Question");
    }
    return { question: q, canEdit: canEditQuestion(actor, q, target) };
  });
}

export async function createQuestion(actor: Actor, departmentId: string | null, draft: QuestionDraft) {
  const data = buildQuestion(draft);
  return withTenant(actor, async (tx) => {
    await assertPoolAccess(tx, actor, departmentId);
    const [q] = await tx
      .insert(assessQuestions)
      .values({ universityId: uni(actor), departmentId, ...data, createdBy: actor.userId || null })
      .returning();
    await audit(tx, actor, "assess.question.create", "assess_question", q.id, { departmentId, type: q.type });
    return q;
  });
}

export async function updateQuestion(actor: Actor, questionId: string, draft: QuestionDraft) {
  return withTenant(actor, async (tx) => {
    const [q] = await tx.select().from(assessQuestions).where(eq(assessQuestions.id, questionId)).for("update");
    if (!q || q.archivedAt) throw new NotFoundError("Question");
    const target = await assertPoolAccess(tx, actor, q.departmentId);
    if (!canEditQuestion(actor, q, target)) throw new ForbiddenError("Only the person who wrote this question, the HOD or an admin can change it.");
    const data = buildQuestion(draft, q.options);
    const [saved] = await tx
      .update(assessQuestions)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(assessQuestions.id, questionId))
      .returning();
    await audit(tx, actor, "assess.question.update", "assess_question", q.id, { type: data.type });
    return saved;
  });
}

/** Takes a question out of the pool. Attempts keep their own copy, and tests stop using it. */
export async function archiveQuestion(actor: Actor, questionId: string) {
  return withTenant(actor, async (tx) => {
    const [q] = await tx.select().from(assessQuestions).where(eq(assessQuestions.id, questionId)).for("update");
    if (!q || q.archivedAt) throw new NotFoundError("Question");
    const target = await assertPoolAccess(tx, actor, q.departmentId);
    if (!canEditQuestion(actor, q, target)) throw new ForbiddenError("Only the person who wrote this question, the HOD or an admin can remove it.");
    await tx.update(assessQuestions).set({ archivedAt: new Date() }).where(eq(assessQuestions.id, questionId));
    await audit(tx, actor, "assess.question.archive", "assess_question", q.id);
  });
}

/* ───────────────────────────── CSV import ───────────────────────────── */

export const CSV_COLUMNS = ["type", "question", "option_a", "option_b", "option_c", "option_d", "option_e", "option_f", "answer", "tolerance", "marks", "negative_marks", "difficulty", "tags", "explanation"] as const;

export const CSV_SAMPLE = `type,question,option_a,option_b,option_c,option_d,answer,tolerance,marks,negative_marks,difficulty,tags,explanation
single,Which SQL clause filters groups after aggregation?,WHERE,HAVING,ORDER BY,LIMIT,B,,2,0.5,medium,SQL;Aggregation,HAVING filters groups; WHERE filters rows.
multiple,Which of these are aggregate functions?,SUM,COUNT,UPPER,AVG,A;B;D,,2,,easy,SQL,"UPPER is a string function, not an aggregate."
true_false,A primary key column can hold NULL values.,,,,,false,,1,,easy,SQL;Keys,Primary keys are always NOT NULL.
numeric,What is the median of 3; 7; 9; 15; 21?,,,,,9,0,1,,easy,Statistics,The middle value of the sorted list.
short,Explain the difference between a LEFT JOIN and an INNER JOIN.,,,,,,,4,,medium,SQL;Joins,Mention unmatched rows from the left table.`;

export type ImportLine = { line: number; type: string; prompt: string; ok: boolean; error?: string };

const TYPE_ALIASES: Record<string, QuestionType> = {
  single: "single",
  single_choice: "single",
  mcq: "single",
  multiple: "multiple",
  multiple_choice: "multiple",
  multi: "multiple",
  msq: "multiple",
  true_false: "true_false",
  truefalse: "true_false",
  tf: "true_false",
  boolean: "true_false",
  numeric: "numeric",
  number: "numeric",
  short: "short",
  short_answer: "short",
  text: "short",
};

const LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h"];

function optionalNumber(v: string | undefined, what: string): number | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new ValidationError(`${what} must be a number.`);
  return n;
}

/** One CSV row → a draft. Throws a ValidationError naming what to fix. */
export function draftFromCsvRow(raw: Record<string, string | undefined>): QuestionDraft {
  const typeKey = (raw.type ?? "").trim().toLowerCase().replace(/[\s/-]+/g, "_");
  const type = TYPE_ALIASES[typeKey];
  if (!type) throw new ValidationError(`Unknown type "${raw.type ?? ""}". Use single, multiple, true_false, numeric or short.`);
  const options = LETTERS.map((l) => (raw[`option_${l}`] ?? "").trim());
  const lastFilled = options.reduce((last, o, i) => (o ? i : last), -1);
  const opts = options.slice(0, lastFilled + 1);
  if (opts.some((o) => !o) && (type === "single" || type === "multiple")) throw new ValidationError("Options must be filled in order, with no gaps (option_a, option_b, …).");
  const answer = (raw.answer ?? "").trim();
  const draft: QuestionDraft = {
    type,
    prompt: raw.question ?? raw.prompt ?? "",
    marks: optionalNumber(raw.marks, "marks"),
    negativeMarks: optionalNumber(raw.negative_marks, "negative_marks"),
    difficulty: (raw.difficulty ?? "").trim().toLowerCase() || "medium",
    tags: (raw.tags ?? "").split(/[;,|]/),
    explanation: raw.explanation ?? "",
  };
  switch (type) {
    case "single":
    case "multiple": {
      const picks = answer.split(/[;,|\s]+/).filter(Boolean);
      if (picks.length === 0) throw new ValidationError("answer is missing. Give the letter of the correct option, like B (or A;C for multiple choice).");
      const idx = picks.map((p) => {
        const i = LETTERS.indexOf(p.toLowerCase());
        if (i < 0 || i >= opts.length) throw new ValidationError(`answer "${p}" doesn't match a filled option.`);
        return i;
      });
      return { ...draft, options: opts, correct: idx };
    }
    case "true_false": {
      const a = answer.toLowerCase();
      if (!["true", "false", "t", "f", "yes", "no"].includes(a)) throw new ValidationError("answer must be true or false.");
      return { ...draft, isTrue: ["true", "t", "yes"].includes(a) };
    }
    case "numeric": {
      const value = optionalNumber(answer, "answer");
      if (value === null) throw new ValidationError("answer is missing. Give the correct number.");
      return { ...draft, value, tolerance: optionalNumber(raw.tolerance, "tolerance") ?? 0 };
    }
    case "short":
      return { ...draft, guide: answer };
  }
}

/**
 * Bulk import into one pool. Every row is checked first; nothing is saved unless every row
 * is valid (the same pattern as the core people import). Rows that repeat a question already
 * in the pool (same type and text) are skipped, so importing the same file twice is safe.
 */
export async function importQuestions(actor: Actor, departmentId: string | null, csv: string, opts: { commit: boolean }) {
  const text = csv.replace(/^﻿/, "").trim();
  if (!text) throw new ValidationError("The file is empty. Paste rows or choose a CSV file.");
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
  });
  const fields = parsed.meta.fields ?? [];
  if (!fields.includes("type") || !(fields.includes("question") || fields.includes("prompt"))) {
    throw new ValidationError("The file needs at least these columns: type, question, answer.");
  }
  if (parsed.data.length > 1000) throw new ValidationError("Import at most 1000 questions at a time. Split the file and import each part.");

  return withTenant(actor, async (tx) => {
    await assertPoolAccess(tx, actor, departmentId);
    const existing = await tx
      .select({ type: assessQuestions.type, prompt: assessQuestions.prompt })
      .from(assessQuestions)
      .where(and(departmentId ? eq(assessQuestions.departmentId, departmentId) : isNull(assessQuestions.departmentId), isNull(assessQuestions.archivedAt)));
    const key = (type: string, prompt: string) => `${type}\u0000${prompt.trim().replace(/\s+/g, " ").toLowerCase()}`;
    const inPool = new Set(existing.map((e) => key(e.type, e.prompt)));
    const inFile = new Set<string>();

    type Checked = { line: number; type: string; prompt: string; error?: string; data?: QuestionData; duplicate?: boolean };
    const lines: Checked[] = parsed.data.map((raw, i) => {
      const line = i + 2; // the header is line 1
      const base = { line, type: (raw.type ?? "").trim(), prompt: (raw.question ?? raw.prompt ?? "").trim() };
      try {
        const data = buildQuestion(draftFromCsvRow(raw));
        const k = key(data.type, data.prompt);
        if (inFile.has(k)) return { ...base, error: "This question appears twice in the file." };
        inFile.add(k);
        return { ...base, data, duplicate: inPool.has(k) };
      } catch (e) {
        return { ...base, error: e instanceof ValidationError ? e.message : "This row couldn't be read." };
      }
    });

    const errors = lines.filter((l) => l.error).length;
    const fresh = lines.flatMap((l) => (l.data && !l.duplicate ? [l.data] : []));
    let saved = 0;
    if (opts.commit && errors === 0 && fresh.length > 0) {
      const rows = fresh.map((data) => ({ universityId: uni(actor), departmentId, ...data, createdBy: actor.userId || null }));
      for (let i = 0; i < rows.length; i += 200) await tx.insert(assessQuestions).values(rows.slice(i, i + 200));
      saved = rows.length;
      await audit(tx, actor, "assess.question.import", "assess_question", null, { departmentId, rows: saved });
    }
    const out: ImportLine[] = lines.map((l) => ({
      line: l.line,
      type: l.type,
      prompt: l.prompt,
      ok: !l.error,
      error: l.error ?? (l.duplicate ? "Already in this pool. It will be skipped." : undefined),
    }));
    return { rows: out, total: lines.length, errors, skipped: lines.filter((l) => l.duplicate).length, saved };
  });
}

/** Tags used anywhere in the pools the actor can use (for draw-rule pickers). */
export async function poolTags(actor: Actor, departmentId: string | null) {
  return withTenant(actor, async (tx) => {
    await assertPoolAccess(tx, actor, departmentId);
    const rows = await tx.execute<{ tag: string }>(sql`
      select min(t) as tag from ${assessQuestions}, unnest(${assessQuestions.tags}) t
      where ${and(isNull(assessQuestions.archivedAt), departmentId ? eq(assessQuestions.departmentId, departmentId) : isNull(assessQuestions.departmentId))}
      group by lower(t) order by lower(t)`);
    return Array.from(rows as unknown as { tag: string }[]).map((r) => r.tag);
  });
}
