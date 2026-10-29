/** Marks, late penalties and scores. Pure functions, so the rules are easy to test. */
import { ValidationError } from "@/server/errors";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Parses marks typed by a grader: "7", "7.5", "7,5". Refuses anything outside 0 to `points`. */
export function parseMarks(raw: string | number, points: number): number {
  const s = typeof raw === "number" ? String(raw) : raw.trim().replace(",", ".");
  if (s === "") throw new ValidationError("Enter the marks, or leave the student ungraded.");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new ValidationError("Marks are a number with up to two decimals, like 7 or 7.5.");
  const n = Number(s);
  if (n > points) throw new ValidationError(`Marks can't be more than ${points}, the assignment's points.`);
  return round2(n);
}

/**
 * The grade after the late penalty: late work loses `latePenaltyPct` percent of the marks given.
 * `scorePercent` is the final marks as a percentage of the points (0–100, two decimals).
 */
export function applyPenalty(marks: number, points: number, late: boolean, latePenaltyPct: number) {
  const penaltyPct = late ? Math.min(100, Math.max(0, latePenaltyPct)) : 0;
  const finalMarks = round2((marks * (100 - penaltyPct)) / 100);
  const scorePercent = round2((finalMarks / points) * 100);
  return { penaltyPct, finalMarks, scorePercent };
}

/** "7.5" for 7.5, "8" for 8. */
export function formatMarks(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
}
