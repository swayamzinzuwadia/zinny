/**
 * Demo data for assessments (brief item 10), made through the real services as the real
 * people: Hema (HOD) and Farah (faculty) fill the Data Analytics pool with 40 questions,
 * then set a quiz, a mock test and a short practice series. Students on the Data Analytics
 * batches take them, so there are graded attempts, one waiting for a grader, and one in
 * progress. Only this module's tables are written.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { SeedContext } from "@/contracts/module";
import { withTenant, type Actor } from "@/server/core";
import { gradeItem, paperFor, saveAnswer, startAttempt, submitAttempt } from "./attempts";
import { addDrawRule, addQuestionsToTest, addToSeries, createTest, setPublished, updateProctoring, updateSettings } from "./manage";
import { createQuestion } from "./pool";
import { utcToZonedInput } from "./lib/time";
import { assessAttemptItems, assessAttempts, assessQuestions, type QuestionAnswer } from "./schema";
import { FACULTY_QUESTIONS, HOD_QUESTIONS } from "./seed-data";

const TZ = "Asia/Kolkata";
const local = (d: Date) => utcToZonedInput(d, TZ);
const days = (n: number) => new Date(Date.now() + n * 86_400_000);

/** Answers a paper: each question right with probability `skill` (deterministic per student and question). */
async function sit(actor: Actor, attemptId: string, skill: number, seedKey: string) {
  const res = await paperFor(actor, attemptId);
  if (res.state !== "in_progress") return;
  const answers = await withTenant(actor, (tx) =>
    tx.select({ id: assessAttemptItems.id, answer: assessAttemptItems.answer }).from(assessAttemptItems).where(eq(assessAttemptItems.attemptId, attemptId)),
  );
  const key = new Map(answers.map((a) => [a.id, a.answer as QuestionAnswer]));
  for (const item of res.paper.items) {
    const roll = [...`${seedKey}:${item.prompt}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 100;
    const right = roll < skill * 100;
    if (roll % 13 === 0 && item.type !== "short") continue; // leaves the odd question blank
    const ans = key.get(item.id)!;
    let response: unknown;
    if (item.type === "numeric") response = { value: "value" in ans ? (right ? ans.value : ans.value + 5) : 0 };
    else if (item.type === "short") response = { text: right ? "A LEFT JOIN keeps every row from the left table and fills the right side with NULL when nothing matches; an INNER JOIN keeps only matching rows. Use LEFT to find customers with no orders." : "They both join tables together." };
    else if (item.type === "multiple") response = { options: "options" in ans ? (right ? ans.options : ans.options.slice(0, 1)) : [] };
    else {
      const correct = "option" in ans ? ans.option : "";
      response = { option: right ? correct : (item.options.find((o) => o.id !== correct)?.id ?? correct) };
    }
    await saveAnswer(actor, attemptId, item.id, response);
  }
}

/** Moves a finished attempt back in time, so the demo has a history (this module's own rows only). */
async function backdate(sys: Actor, attemptId: string, daysAgo: number, minutes: number) {
  const started = new Date(Date.now() - daysAgo * 86_400_000 - minutes * 60_000);
  const submitted = new Date(started.getTime() + minutes * 60_000);
  await withTenant(sys, (tx) =>
    tx.update(assessAttempts).set({ startedAt: started, submittedAt: submitted, gradedAt: submitted }).where(eq(assessAttempts.id, attemptId)),
  );
}

export async function seed(ctx: SeedContext) {
  const hema = await ctx.actorFor("hema@demo.edu");
  const farah = await ctx.actorFor("farah@demo.edu");
  const cs = ctx.ids.departments.CS;
  const da = ctx.ids.courses["Data Analytics"];
  const morning = ctx.ids.batches["Data Analytics / Weekday morning"];
  const sys = ctx.systemActor;

  // The pool: 40 Data Analytics questions in the Computer Science pool.
  const made: string[] = [];
  for (const q of HOD_QUESTIONS) made.push((await createQuestion(hema, cs, q)).id);
  for (const q of FACULTY_QUESTIONS) made.push((await createQuestion(farah, cs, q)).id);
  const pool = await withTenant(sys, (tx) => tx.select().from(assessQuestions).where(inArray(assessQuestions.id, made)));
  const byPrompt = (start: string) => pool.find((q) => q.prompt.startsWith(start))!.id;

  // A quiz on SQL basics for the whole course: picked questions, answers shown after submit, 3 tries.
  const quiz = await createTest(hema, { kind: "quiz", title: "SQL basics quiz", courseId: da, allBatches: true, batchIds: [] });
  await addQuestionsToTest(
    hema,
    quiz.id,
    [
      "Which SQL clause filters groups",
      "Which join keeps every row",
      "Which of these are aggregate functions",
      "A primary key column can hold NULL",
      "What does SELECT COUNT(*)",
      "Which keyword removes duplicate",
      "Which SQL statement changes existing rows",
      "ORDER BY runs before WHERE",
    ].map(byPrompt),
  );
  await updateSettings(hema, quiz.id, {
    title: "SQL basics quiz",
    kind: "quiz",
    instructions: "Eight quick questions on the SQL we covered in weeks 1 and 2. You have three tries; your best score counts.",
    passPercent: 50,
    showAnswers: "after_submit",
    allBatches: true,
    batchIds: [],
  });
  await updateProctoring(hema, quiz.id, {
    timeLimitMinutes: 15,
    fullscreenRequired: false,
    tabSwitchLimit: null,
    shuffleQuestions: true,
    shuffleOptions: true,
    onePerPage: false,
    attemptLimit: 3,
    opensAt: "",
    closesAt: local(days(10)),
  });
  await setPublished(hema, quiz.id, true);

  // A proctored mock test: draw rules, one question per page, full screen, answers after the window closes.
  const mock = await createTest(hema, { kind: "mock_test", title: "Mid-term mock test", courseId: da, allBatches: true, batchIds: [] });
  await addQuestionsToTest(hema, mock.id, [byPrompt("Explain the difference between a LEFT JOIN")]);
  await addDrawRule(hema, mock.id, { count: 6, pool: cs, difficulty: "medium" });
  await addDrawRule(hema, mock.id, { count: 4, pool: cs, difficulty: "easy", tag: "Excel" });
  await addDrawRule(hema, mock.id, { count: 3, pool: cs, difficulty: "hard" });
  // "After the window closes" needs a close time, so proctoring comes first.
  await updateProctoring(hema, mock.id, {
    timeLimitMinutes: 45,
    fullscreenRequired: true,
    tabSwitchLimit: 3,
    shuffleQuestions: true,
    shuffleOptions: true,
    onePerPage: true,
    attemptLimit: 1,
    opensAt: "",
    closesAt: local(days(5)),
  });
  await updateSettings(hema, mock.id, {
    title: "Mid-term mock test",
    kind: "mock_test",
    instructions: "A full-length practice for the mid-term. Questions are drawn at random from the pool, so everyone's paper is different. Work alone and stay in full screen.",
    passPercent: 40,
    showAnswers: "after_close",
    allBatches: true,
    batchIds: [],
  });
  await setPublished(hema, mock.id, true);

  // A weekly practice series: two short quizzes now, a third next week.
  const series = await createTest(hema, { kind: "series", title: "Weekly practice", courseId: da, allBatches: true, batchIds: [] });
  const weekTests: { id: string }[] = [];
  const weeks = [
    { title: "Week 1: Excel essentials", draw: { count: 5, pool: cs, tag: "Excel" }, opens: "" },
    { title: "Week 2: Statistics warm-up", draw: { count: 5, pool: cs, tag: "Statistics" }, opens: "" },
    { title: "Week 3: Dashboards", draw: { count: 5, pool: cs, tag: "Dashboards" }, opens: local(days(4)) },
  ];
  for (const w of weeks) {
    const t = await createTest(hema, { kind: "quiz", title: w.title, courseId: da, allBatches: true, batchIds: [] });
    await addDrawRule(hema, t.id, w.draw);
    await updateProctoring(hema, t.id, {
      timeLimitMinutes: 10,
      fullscreenRequired: false,
      tabSwitchLimit: null,
      shuffleQuestions: true,
      shuffleOptions: false,
      onePerPage: false,
      attemptLimit: 2,
      opensAt: w.opens,
      closesAt: "",
    });
    await setPublished(hema, t.id, true);
    await addToSeries(hema, series.id, t.id);
    weekTests.push(t);
  }
  await setPublished(hema, series.id, true);

  // Farah's own quiz for her morning batch only.
  const farahQuiz = await createTest(farah, { kind: "quiz", title: "Joins check-in (morning batch)", courseId: da, allBatches: false, batchIds: [morning] });
  await addQuestionsToTest(farah, farahQuiz.id, [byPrompt("Explain the difference between a LEFT JOIN"), byPrompt("Which join keeps every row"), byPrompt("A customers table has 50 rows")]);
  await updateProctoring(farah, farahQuiz.id, {
    timeLimitMinutes: 20,
    fullscreenRequired: false,
    tabSwitchLimit: null,
    shuffleQuestions: false,
    shuffleOptions: false,
    onePerPage: false,
    attemptLimit: 1,
    opensAt: "",
    closesAt: local(days(3)),
  });
  await setPublished(farah, farahQuiz.id, true);

  // Students take them. Skill decides roughly how many they get right.
  // Kabir and Aditi are in the morning batch; Ishaan, Meera and Rohan in the evening one.
  const takers = [
    { email: "kabir@demo.edu", skill: 0.85 },
    { email: "aditi@demo.edu", skill: 0.6 },
    { email: "ishaan@demo.edu", skill: 0.9 },
    { email: "meera@demo.edu", skill: 0.35 },
    { email: "rohan@demo.edu", skill: 0.7 },
  ];
  let ago = 6;
  for (const s of takers) {
    const a = await ctx.actorFor(s.email);
    const { attemptId } = await startAttempt(a, quiz.id);
    await sit(a, attemptId, s.skill, s.email);
    await submitAttempt(a, attemptId);
    await backdate(sys, attemptId, ago--, 11);
  }
  // Week 1 of the series for a few.
  const week1 = weekTests[0];
  for (const s of takers.slice(0, 4)) {
    const a = await ctx.actorFor(s.email);
    const { attemptId } = await startAttempt(a, week1.id);
    await sit(a, attemptId, s.skill, `${s.email}:w1`);
    await submitAttempt(a, attemptId);
    await backdate(sys, attemptId, 3, 8);
  }

  // The morning batch's joins check-in: short answers for Farah to grade.
  for (const email of ["kabir@demo.edu", "aditi@demo.edu"]) {
    const a = await ctx.actorFor(email);
    const { attemptId } = await startAttempt(a, farahQuiz.id);
    await sit(a, attemptId, email.startsWith("kabir") ? 0.9 : 0.5, `${email}:joins`);
    await submitAttempt(a, attemptId);
    await backdate(sys, attemptId, 1, 14);
  }
  // Farah has graded Kabir's; Aditi's waits in the queue (the dashboard's "Tests to grade").
  const kabir = await ctx.actorFor("kabir@demo.edu");
  const [kabirAttempt] = await withTenant(sys, (tx) =>
    tx.select().from(assessAttempts).where(and(eq(assessAttempts.testId, farahQuiz.id), eq(assessAttempts.userId, kabir.userId))),
  );
  const kabirShort = await withTenant(sys, (tx) =>
    tx.select().from(assessAttemptItems).where(and(eq(assessAttemptItems.attemptId, kabirAttempt.id), eq(assessAttemptItems.needsGrading, true))),
  );
  for (const item of kabirShort) await gradeItem(farah, item.id, { score: 3.5, feedback: "Clear and correct. Add an example query next time." });

  // Ishaan is half-way through the mock test right now.
  const ishaan = await ctx.actorFor("ishaan@demo.edu");
  const { attemptId: mockAttempt } = await startAttempt(ishaan, mock.id);
  await sit(ishaan, mockAttempt, 0.8, "ishaan:mock:partial");
}
