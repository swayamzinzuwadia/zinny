/**
 * Pure rules for questions and marking. No database, no permissions: the services
 * call these, and the unit tests check them directly.
 */
import { ValidationError } from "@/server/errors";
import type { Difficulty, QuestionAnswer, QuestionOption, QuestionResponse, QuestionType } from "../schema";
import { DIFFICULTIES, QUESTION_TYPES } from "./labels";
import { optionId } from "./random";

export const MAX_OPTIONS = 8;
export const MAX_PROMPT = 4000;
export const MAX_SHORT_ANSWER = 5000;

/** What staff type in the question form or a CSV row, before it is checked. */
export type QuestionDraft = {
  type: string;
  prompt: string;
  /** Option texts, for single and multiple choice. */
  options?: string[];
  /** 0-based indexes of the correct options (single: exactly one; multiple: one or more). */
  correct?: number[];
  /** For true or false. */
  isTrue?: boolean | null;
  /** For numeric. */
  value?: number | null;
  tolerance?: number | null;
  /** For short answer: a model answer or rubric for whoever grades it. */
  guide?: string;
  marks?: number | null;
  negativeMarks?: number | null;
  difficulty?: string;
  tags?: string[];
  explanation?: string;
};

/** A checked question, ready to store. */
export type QuestionData = {
  type: QuestionType;
  prompt: string;
  options: QuestionOption[];
  answer: QuestionAnswer;
  marks: number;
  negativeMarks: number;
  difficulty: Difficulty;
  tags: string[];
  explanation: string;
};

export const TRUE_FALSE_OPTIONS: QuestionOption[] = [
  { id: "t", text: "True" },
  { id: "f", text: "False" },
];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** "sql, Joins ;  SQL" → ["SQL", "Joins"]: trimmed, deduplicated case-insensitively, first spelling wins. */
export function normaliseTags(tags: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const raw of tags.flatMap((t) => t.split(/[;,|]/))) {
    const t = raw.trim().replace(/\s+/g, " ");
    if (!t) continue;
    if (t.length > 40) throw new ValidationError(`The tag "${t.slice(0, 20)}…" is too long. Keep tags under 40 characters.`);
    if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  if (seen.size > 12) throw new ValidationError("Use at most 12 tags on a question.");
  return [...seen.values()];
}

function checkMarks(marks: number | null | undefined, negative: number | null | undefined) {
  const m = marks ?? 1;
  const n = negative ?? 0;
  if (!Number.isFinite(m) || m <= 0 || m > 1000) throw new ValidationError("Marks must be more than 0 and at most 1000.");
  if (!Number.isFinite(n) || n < 0 || n > m) throw new ValidationError("Negative marks must be between 0 and the question's marks.");
  if (round2(m) !== m || round2(n) !== n) throw new ValidationError("Marks can have at most two decimal places.");
  return { marks: m, negativeMarks: n };
}

/** Checks a draft and turns it into what is stored. Throws a ValidationError that says what to fix. */
export function buildQuestion(d: QuestionDraft, existingOptions?: QuestionOption[]): QuestionData {
  const type = d.type as QuestionType;
  if (!QUESTION_TYPES.includes(type)) throw new ValidationError("Pick a question type: single choice, multiple choice, true or false, numeric or short answer.");
  const prompt = (d.prompt ?? "").trim();
  if (prompt.length < 3) throw new ValidationError("Write the question.");
  if (prompt.length > MAX_PROMPT) throw new ValidationError(`Keep the question under ${MAX_PROMPT} characters.`);
  const difficulty = (d.difficulty || "medium") as Difficulty;
  if (!DIFFICULTIES.includes(difficulty)) throw new ValidationError("Difficulty must be easy, medium or hard.");
  const { marks, negativeMarks } = checkMarks(d.marks, d.negativeMarks);
  const base = { type, prompt, marks, negativeMarks, difficulty, tags: normaliseTags(d.tags ?? []), explanation: (d.explanation ?? "").trim() };

  switch (type) {
    case "single":
    case "multiple": {
      const texts = (d.options ?? []).map((o) => o.trim()).filter(Boolean);
      if (texts.length < 2) throw new ValidationError("Give at least two options.");
      if (texts.length > MAX_OPTIONS) throw new ValidationError(`Use at most ${MAX_OPTIONS} options.`);
      if (new Set(texts.map((t) => t.toLowerCase())).size !== texts.length) throw new ValidationError("Two options have the same text. Make each option different.");
      const correct = [...new Set(d.correct ?? [])].filter((i) => Number.isInteger(i) && i >= 0 && i < texts.length);
      if (type === "single" && correct.length !== 1) throw new ValidationError("Mark exactly one option as correct.");
      if (type === "multiple" && correct.length < 1) throw new ValidationError("Mark at least one option as correct.");
      // Keep an option's id when its text is unchanged, so editing a typo elsewhere doesn't reshuffle ids.
      const reuse = new Map((existingOptions ?? []).map((o) => [o.text, o.id]));
      const used = new Set<string>();
      const options = texts.map((text) => {
        let id = reuse.get(text);
        if (!id || used.has(id)) id = optionId();
        while (used.has(id)) id = optionId();
        used.add(id);
        return { id, text };
      });
      const answer: QuestionAnswer = type === "single" ? { option: options[correct[0]].id } : { options: correct.sort((a, b) => a - b).map((i) => options[i].id) };
      return { ...base, options, answer };
    }
    case "true_false": {
      if (d.isTrue === null || d.isTrue === undefined) throw new ValidationError("Say whether the statement is true or false.");
      return { ...base, options: TRUE_FALSE_OPTIONS, answer: { option: d.isTrue ? "t" : "f" } };
    }
    case "numeric": {
      const value = d.value;
      if (value === null || value === undefined || !Number.isFinite(value)) throw new ValidationError("Give the correct numeric answer.");
      const tolerance = d.tolerance ?? 0;
      if (!Number.isFinite(tolerance) || tolerance < 0) throw new ValidationError("Tolerance must be zero or more.");
      return { ...base, options: [], answer: { value, tolerance } };
    }
    case "short":
      return { ...base, options: [], answer: { guide: (d.guide ?? "").trim() } };
  }
}

/** The correct option ids of a choice question (empty for numeric and short answer). */
export function correctOptionIds(answer: QuestionAnswer): string[] {
  if ("option" in answer) return [answer.option];
  if ("options" in answer) return answer.options;
  return [];
}

/**
 * Checks what a student sent against the question's shape. Returns the response to
 * store, or null when the student cleared their answer. Throws when it can't be right.
 */
export function cleanResponse(type: QuestionType, options: QuestionOption[], raw: unknown): QuestionResponse | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") throw new ValidationError("That answer isn't in the right shape. Refresh the page and try again.");
  const r = raw as Record<string, unknown>;
  const ids = new Set(options.map((o) => o.id));
  switch (type) {
    case "single":
    case "true_false": {
      if (r.option === null || r.option === undefined || r.option === "") return null;
      if (typeof r.option !== "string" || !ids.has(r.option)) throw new ValidationError("That option isn't part of this question.");
      return { option: r.option };
    }
    case "multiple": {
      if (!Array.isArray(r.options)) throw new ValidationError("That answer isn't in the right shape. Refresh the page and try again.");
      const picked = [...new Set(r.options)];
      if (picked.some((o) => typeof o !== "string" || !ids.has(o))) throw new ValidationError("That option isn't part of this question.");
      if (picked.length === 0) return null;
      // Store in the question's own order, so the same choice is always stored the same way.
      return { options: options.map((o) => o.id).filter((id) => picked.includes(id)) };
    }
    case "numeric": {
      if (r.value === null || r.value === undefined || r.value === "") return null;
      const v = typeof r.value === "string" ? Number(r.value.trim().replace(/,/g, "")) : r.value;
      if (typeof v !== "number" || !Number.isFinite(v)) throw new ValidationError("Type a number, like 42 or 3.5.");
      return { value: v };
    }
    case "short": {
      if (r.text === null || r.text === undefined) return null;
      if (typeof r.text !== "string") throw new ValidationError("That answer isn't in the right shape. Refresh the page and try again.");
      if (r.text.length > MAX_SHORT_ANSWER) throw new ValidationError(`Keep your answer under ${MAX_SHORT_ANSWER} characters.`);
      return r.text.trim() === "" ? null : { text: r.text };
    }
  }
}

export type Marked = {
  /** Marks for this item; null while a short answer waits for a grader. */
  autoScore: number | null;
  /** Null for short answers until graded, and for unanswered questions. */
  correct: boolean | null;
  needsGrading: boolean;
};

/**
 * Marks one item. Unanswered = 0 (never negative). A wrong answer loses the negative marks.
 * Multiple choice is all or nothing. A short answer that was written goes to a grader.
 */
export function markItem(item: { type: QuestionType; answer: QuestionAnswer; marks: number; negativeMarks: number }, response: QuestionResponse | null): Marked {
  if (!response) return { autoScore: 0, correct: null, needsGrading: false };
  const right = (ok: boolean): Marked => ({ autoScore: ok ? item.marks : -item.negativeMarks, correct: ok, needsGrading: false });
  switch (item.type) {
    case "single":
    case "true_false":
      return right("option" in response && "option" in item.answer && response.option === item.answer.option);
    case "multiple": {
      if (!("options" in response) || !("options" in item.answer)) return right(false);
      const want = new Set(item.answer.options);
      return right(response.options.length === want.size && response.options.every((o) => want.has(o)));
    }
    case "numeric": {
      if (!("value" in response) || !("value" in item.answer)) return right(false);
      // A tiny epsilon so 0.1 + 0.2 style rounding never costs a student a mark.
      return right(Math.abs(response.value - item.answer.value) <= item.answer.tolerance + 1e-9);
    }
    case "short":
      return { autoScore: null, correct: null, needsGrading: true };
  }
}

/** Score as 0–100 (never below 0, even with negative marking), to two decimals. */
export function percentOf(score: number, maxScore: number): number {
  if (maxScore <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((score / maxScore) * 10_000) / 100));
}

export function roundMarks(n: number): number {
  return round2(n);
}
