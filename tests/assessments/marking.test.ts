import { describe, expect, it } from "vitest";
import { buildQuestion, cleanResponse, markItem, normaliseTags, percentOf } from "@/modules/assessments/lib/marking";
import { draftFromCsvRow } from "@/modules/assessments/pool";
import { utcToZonedInput, zonedToUtc } from "@/modules/assessments/lib/time";

describe("assessments: building questions", () => {
  it("single choice keeps one correct option and gives options random ids", () => {
    const q = buildQuestion({ type: "single", prompt: "Pick B", options: ["A", "B", "C"], correct: [1], marks: 2, negativeMarks: 0.5 });
    expect(q.options.map((o) => o.text)).toEqual(["A", "B", "C"]);
    expect(new Set(q.options.map((o) => o.id)).size).toBe(3);
    expect(q.answer).toEqual({ option: q.options[1].id });
    expect(q.options.map((o) => o.id)).not.toEqual(["a", "b", "c"]);
  });

  it("refuses broken questions with a message that says what to fix", () => {
    expect(() => buildQuestion({ type: "single", prompt: "x", options: ["A", "B"], correct: [0] })).toThrow(/Write the question/);
    expect(() => buildQuestion({ type: "single", prompt: "Pick", options: ["A"], correct: [0] })).toThrow(/at least two options/);
    expect(() => buildQuestion({ type: "single", prompt: "Pick", options: ["A", "B"], correct: [0, 1] })).toThrow(/exactly one/);
    expect(() => buildQuestion({ type: "multiple", prompt: "Pick", options: ["A", "B"], correct: [] })).toThrow(/at least one/);
    expect(() => buildQuestion({ type: "single", prompt: "Pick", options: ["A", "a"], correct: [0] })).toThrow(/same text/);
    expect(() => buildQuestion({ type: "numeric", prompt: "How many?" })).toThrow(/numeric answer/);
    expect(() => buildQuestion({ type: "true_false", prompt: "Is it?" })).toThrow(/true or false/);
    expect(() => buildQuestion({ type: "short", prompt: "Explain", marks: 2, negativeMarks: 3 })).toThrow(/Negative marks/);
    expect(() => buildQuestion({ type: "essay", prompt: "Explain" })).toThrow(/question type/);
    expect(() => buildQuestion({ type: "short", prompt: "Explain", difficulty: "brutal" })).toThrow(/easy, medium or hard/);
  });

  it("keeps option ids when an edit leaves the option text unchanged", () => {
    const first = buildQuestion({ type: "single", prompt: "Pick", options: ["A", "B", "C"], correct: [0] });
    const edited = buildQuestion({ type: "single", prompt: "Pick one", options: ["A", "B", "D"], correct: [1] }, first.options);
    expect(edited.options[0].id).toBe(first.options[0].id);
    expect(edited.options[1].id).toBe(first.options[1].id);
    expect(edited.options[2].id).not.toBe(first.options[2].id);
  });

  it("normalises tags: trimmed, split on commas or semicolons, deduplicated ignoring case", () => {
    expect(normaliseTags(["sql; Joins", " SQL ", "joins,Window functions"])).toEqual(["sql", "Joins", "Window functions"]);
  });
});

describe("assessments: marking", () => {
  const single = buildQuestion({ type: "single", prompt: "Pick B", options: ["A", "B", "C"], correct: [1], marks: 2, negativeMarks: 0.5 });
  const multi = buildQuestion({ type: "multiple", prompt: "Pick A and C", options: ["A", "B", "C"], correct: [0, 2], marks: 3, negativeMarks: 1 });
  const num = buildQuestion({ type: "numeric", prompt: "Pi?", value: 3.14, tolerance: 0.01, marks: 1 });
  const short = buildQuestion({ type: "short", prompt: "Explain joins", guide: "Rows from both", marks: 4 });
  const [a, b, c] = single.options.map((o) => o.id);
  const [ma, mb, mc] = multi.options.map((o) => o.id);

  it("single choice: full marks when right, negative marks when wrong, zero when blank", () => {
    expect(markItem(single, { option: b })).toEqual({ autoScore: 2, correct: true, needsGrading: false });
    expect(markItem(single, { option: a })).toEqual({ autoScore: -0.5, correct: false, needsGrading: false });
    expect(markItem(single, null)).toEqual({ autoScore: 0, correct: null, needsGrading: false });
    void c;
  });

  it("multiple choice is all or nothing", () => {
    expect(markItem(multi, { options: [ma, mc] }).autoScore).toBe(3);
    expect(markItem(multi, { options: [ma] }).autoScore).toBe(-1);
    expect(markItem(multi, { options: [ma, mb, mc] }).autoScore).toBe(-1);
  });

  it("numeric answers count within the tolerance", () => {
    expect(markItem(num, { value: 3.15 }).correct).toBe(true);
    expect(markItem(num, { value: 3.13 }).correct).toBe(true);
    expect(markItem(num, { value: 3.2 }).correct).toBe(false);
  });

  it("a written short answer waits for a grader; a blank one scores zero", () => {
    expect(markItem(short, { text: "Inner keeps matches" })).toEqual({ autoScore: null, correct: null, needsGrading: true });
    expect(markItem(short, null)).toEqual({ autoScore: 0, correct: null, needsGrading: false });
  });

  it("checks the shape of what the student sends", () => {
    expect(cleanResponse("single", single.options, { option: b })).toEqual({ option: b });
    expect(() => cleanResponse("single", single.options, { option: "nope" })).toThrow(/isn't part of this question/);
    expect(cleanResponse("multiple", multi.options, { options: [mc, ma, ma] })).toEqual({ options: [ma, mc] });
    expect(cleanResponse("multiple", multi.options, { options: [] })).toBeNull();
    expect(cleanResponse("numeric", [], { value: "1,250.5" })).toEqual({ value: 1250.5 });
    expect(() => cleanResponse("numeric", [], { value: "abc" })).toThrow(/Type a number/);
    expect(cleanResponse("short", [], { text: "   " })).toBeNull();
    expect(() => cleanResponse("short", [], { text: "x".repeat(5001) })).toThrow(/under 5000/);
  });

  it("percent never goes below 0 or above 100", () => {
    expect(percentOf(-2, 10)).toBe(0);
    expect(percentOf(7, 8)).toBe(87.5);
    expect(percentOf(3, 0)).toBe(0);
  });
});

describe("assessments: CSV rows", () => {
  it("reads every question type", () => {
    const s = buildQuestion(draftFromCsvRow({ type: "single", question: "Which?", option_a: "x", option_b: "y", answer: "B", marks: "2" }));
    expect(s.answer).toEqual({ option: s.options[1].id });
    const m = buildQuestion(draftFromCsvRow({ type: "Multiple choice", question: "Which?", option_a: "x", option_b: "y", option_c: "z", answer: "A;C" }));
    expect(m.answer).toEqual({ options: [m.options[0].id, m.options[2].id] });
    expect(buildQuestion(draftFromCsvRow({ type: "tf", question: "Sky is blue", answer: "true" })).answer).toEqual({ option: "t" });
    expect(buildQuestion(draftFromCsvRow({ type: "numeric", question: "2+2?", answer: "4", tolerance: "0.5" })).answer).toEqual({ value: 4, tolerance: 0.5 });
    expect(buildQuestion(draftFromCsvRow({ type: "short", question: "Explain", answer: "Model answer" })).answer).toEqual({ guide: "Model answer" });
  });

  it("explains what's wrong with a row", () => {
    expect(() => draftFromCsvRow({ type: "essay", question: "Q" })).toThrow(/Unknown type "essay"/);
    expect(() => draftFromCsvRow({ type: "single", question: "Q", option_a: "x", option_b: "y", answer: "E" })).toThrow(/doesn't match a filled option/);
    expect(() => draftFromCsvRow({ type: "single", question: "Q", option_a: "x", option_c: "y", answer: "A" })).toThrow(/no gaps/);
    expect(() => draftFromCsvRow({ type: "true_false", question: "Q", answer: "maybe" })).toThrow(/true or false/);
    expect(() => draftFromCsvRow({ type: "numeric", question: "Q", answer: "" })).toThrow(/correct number/);
    expect(() => draftFromCsvRow({ type: "single", question: "Q", option_a: "x", option_b: "y", answer: "A", marks: "two" })).toThrow(/marks must be a number/);
  });
});

describe("assessments: time zones", () => {
  it("turns local India time into the right instant and back", () => {
    const d = zonedToUtc("2026-11-03T10:00", "Asia/Kolkata")!;
    expect(d.toISOString()).toBe("2026-11-03T04:30:00.000Z");
    expect(utcToZonedInput(d, "Asia/Kolkata")).toBe("2026-11-03T10:00");
    expect(zonedToUtc("2026-13-03T10:00", "Asia/Kolkata")).toBeNull();
    expect(zonedToUtc("soon", "Asia/Kolkata")).toBeNull();
  });

  it("handles a zone with daylight saving", () => {
    expect(zonedToUtc("2026-07-01T09:00", "Europe/London")!.toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(zonedToUtc("2026-12-01T09:00", "Europe/London")!.toISOString()).toBe("2026-12-01T09:00:00.000Z");
  });
});
