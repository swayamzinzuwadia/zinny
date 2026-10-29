import type { Difficulty, QuestionType, ShowAnswers, SubmitReason, TestKind } from "../schema";

export const KIND_LABEL: Record<TestKind, string> = { quiz: "Quiz", mock_test: "Mock test", series: "Test series" };
export const KIND_PLURAL: Record<TestKind, string> = { quiz: "Quizzes", mock_test: "Mock tests", series: "Test series" };

export const TYPE_LABEL: Record<QuestionType, string> = {
  single: "Single choice",
  multiple: "Multiple choice",
  true_false: "True or false",
  numeric: "Numeric",
  short: "Short answer",
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

export const SHOW_ANSWERS_LABEL: Record<ShowAnswers, string> = {
  never: "Never",
  after_submit: "Right after the student submits",
  after_close: "After the test window closes",
};

export const SUBMIT_REASON_LABEL: Record<SubmitReason, string> = {
  student: "Submitted",
  time_up: "Time ran out",
  tab_limit: "Left the test too often",
};

export const QUESTION_TYPES = ["single", "multiple", "true_false", "numeric", "short"] as const satisfies readonly QuestionType[];
export const DIFFICULTIES = ["easy", "medium", "hard"] as const satisfies readonly Difficulty[];
export const TEST_KINDS = ["quiz", "mock_test", "series"] as const satisfies readonly TestKind[];
export const SHOW_ANSWERS = ["never", "after_submit", "after_close"] as const satisfies readonly ShowAnswers[];

/** "2.5" not "2.50"; "1" not "1.00". */
export function fmtMarks(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return String(Math.round(n * 100) / 100);
}

export function fmtPercent(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return `${Math.round(n)}%`;
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
