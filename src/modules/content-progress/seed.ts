/**
 * Demo data for the Demo University (contracts section 6): a full curriculum for every
 * seeded course (sections, a mix of video, PDF, text, link and live lessons, drip rules,
 * optional lessons) and realistic progress for the enrolled students.
 *
 *   - Curricula are written through this module's services by the people who would write
 *     them: Hema (HOD, CS) for Data Analytics and Python Basics, Farah (faculty) for
 *     Machine Learning Foundations, Neel (faculty) for Digital Marketing.
 *   - Files go through the real upload path into storage(): a short MP4 (seed-assets/) and
 *     PDFs generated here.
 *   - Progress goes through the progress engine, so events and course completion behave as
 *     in the app. Neil finishes every required lesson of Python Basics, so his enrolment
 *     completes through core (enrolment.completed). Hema marks Rohan's Python Basics
 *     complete offline from the progress view.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { SeedContext } from "@/contracts/module";
import { batchLite, enrolmentById, withTenant, type Actor } from "@/server/core";
import { completeLessonTx, finishCompletions, lockCourseProgress, lockLessonProgress } from "./engine";
import { addDays } from "./lib/dates";
import { makePdf, type PdfBlock } from "./lib/pdf";
import { isLocked, readContent, unlockDate, type LessonKind } from "./lib/kinds";
import { contentCourseProgress, contentLessonProgress } from "./schema";
import { addLesson, addSection, getCurriculum, setLinkContent, setTextContent, setVideoLink, updateLesson, type DripInput } from "./service";
import { markStudentComplete } from "./staff";
import { finishUpload, startUpload, uploadPart } from "./uploads";

/* ───────────────────────────── Curriculum specs ───────────────────────────── */

type LessonSpec = {
  title: string;
  kind: LessonKind;
  minutes: number;
  optional?: boolean;
  /** text: HTML; link: URL; video: YouTube/Vimeo URL or "upload:<asset>"; pdf: blocks. */
  text?: string;
  url?: string;
  upload?: string;
  pdf?: { title: string; blocks: PdfBlock[] };
  drip?: DripInput;
};
type SectionSpec = { title: string; drip?: DripInput; lessons: LessonSpec[] };

const p = (...parts: string[]) => parts.map((t) => `<p>${t}</p>`).join("");
const ul = (...items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
const ol = (...items: string[]) => `<ol>${items.map((i) => `<li>${i}</li>`).join("")}</ol>`;
const h2 = (t: string) => `<h2>${t}</h2>`;
const code = (t: string) => `<pre><code>${t.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</code></pre>`;

function handbook(course: string, weeks: string[]): LessonSpec["pdf"] {
  return {
    title: `${course}: course handbook`,
    blocks: [
      { heading: "Welcome", text: `This handbook explains how ${course} runs at Demo University: the weekly rhythm, what counts toward completion and where to get help.` },
      { heading: "How the course runs", text: "Each week opens a new section of lessons. Watch the videos, read the notes, and come to the live class with your questions. Lessons marked optional are there if you want to go further; they don't count toward your progress." },
      { heading: "Completing the course", text: "Your progress is the share of required lessons you have completed. When you reach 100% the course is marked complete and, where the course has one, your certificate is issued." },
      { heading: "Weekly plan", text: weeks.map((w, i) => `Week ${i + 1}: ${w}`).join("\n") },
      { heading: "Getting help", text: "Ask in the live class, or write to your faculty through the institute. Office hours are listed on the course page." },
    ],
  };
}

function worksheet(title: string, items: string[]): LessonSpec["pdf"] {
  return {
    title,
    blocks: [
      { heading: "How to use this worksheet", text: "Work through the exercises in order. Each one builds on the last. Bring your answers to the next live class." },
      ...items.map((t, i) => ({ heading: `Exercise ${i + 1}`, text: t })),
    ],
  };
}

const PYTHON: SectionSpec[] = [
  {
    title: "Week 1: Getting started",
    lessons: [
      { title: "Python in an hour: the big picture", kind: "video", minutes: 60, url: "https://www.youtube.com/watch?v=kqtD5dpn9C8" },
      {
        title: "Setting up Python and VS Code",
        kind: "text",
        minutes: 15,
        text:
          p("Before the first live class, set up Python on your own computer so you can follow along.") +
          h2("Install Python") +
          ol("Go to python.org and download the latest Python 3 for your system.", "On Windows, tick <strong>Add Python to PATH</strong> in the installer.", "Open a terminal and run <code>python --version</code>. You should see 3.12 or later.") +
          h2("Install VS Code") +
          p("Install Visual Studio Code, then add the <em>Python</em> extension from the Extensions panel.") +
          code('print("Hello, Zinny")') +
          p("Save this as <code>hello.py</code> and run it. If you see the greeting, you're ready."),
      },
      { title: "Course handbook", kind: "pdf", minutes: 10, pdf: handbook("Python Basics", ["Getting started", "Variables and types", "Decisions and loops", "Functions and a small project"]) },
      { title: "Live class: Your first program", kind: "live", minutes: 180 },
    ],
  },
  {
    title: "Week 2: Variables and types",
    drip: { mode: "after_start", days: 7 },
    lessons: [
      {
        title: "Variables, numbers and strings",
        kind: "text",
        minutes: 20,
        text:
          p("A variable is a name for a value. Python works out the type from the value you give it.") +
          code('name = "Riya"\nage = 21\nheight = 1.62\nprint(f"{name} is {age}")') +
          h2("The types you'll use most") +
          ul("<strong>int</strong>: whole numbers like 21", "<strong>float</strong>: decimals like 1.62", "<strong>str</strong>: text in quotes", "<strong>bool</strong>: True or False") +
          p("Use <code>type(x)</code> to check what something is."),
      },
      { title: "Practice in Python Tutor", kind: "link", minutes: 15, optional: true, url: "https://pythontutor.com/" },
      {
        title: "Week 2 worksheet",
        kind: "pdf",
        minutes: 20,
        pdf: worksheet("Python Basics: week 2 worksheet", [
          "Store your name, city and age in three variables and print one sentence that uses all three.",
          "Convert 37.5 degrees Celsius to Fahrenheit and print the result rounded to one decimal place.",
          "Ask the user for two numbers with input() and print their sum. What goes wrong if you forget int()?",
        ]),
      },
    ],
  },
  {
    title: "Week 3: Decisions and loops",
    drip: { mode: "after_start", days: 14 },
    lessons: [
      {
        title: "if, elif and else",
        kind: "text",
        minutes: 20,
        text:
          p("Programs make decisions with <code>if</code>. Python uses indentation to show which lines belong to each branch.") +
          code('marks = 72\nif marks >= 75:\n    print("Distinction")\nelif marks >= 40:\n    print("Pass")\nelse:\n    print("Try again")') +
          p("Conditions can be combined with <code>and</code>, <code>or</code> and <code>not</code>."),
      },
      {
        title: "Loops with for and while",
        kind: "text",
        minutes: 25,
        text:
          p("A <code>for</code> loop repeats once for each item; a <code>while</code> loop repeats until its condition is false.") +
          code("for day in [\"Sat\", \"Sun\"]:\n    print(day)\n\ncount = 3\nwhile count > 0:\n    print(count)\n    count -= 1") +
          p("Use <code>range(n)</code> to loop a set number of times."),
      },
      { title: "Live class: Number guessing game", kind: "live", minutes: 180 },
    ],
  },
  {
    title: "Week 4: Functions and a small project",
    drip: { mode: "after_start", days: 21 },
    lessons: [
      {
        title: "Writing your own functions",
        kind: "text",
        minutes: 25,
        text:
          p("Functions give a name to a piece of work so you can reuse it.") +
          code('def greet(name, greeting="Hello"):\n    return f"{greeting}, {name}"\n\nprint(greet("Neil"))') +
          p("Keep each function small and give it a name that says what it does."),
      },
      {
        title: "Project brief: expense tracker",
        kind: "pdf",
        minutes: 15,
        pdf: worksheet("Python Basics: project brief", [
          "Write a program that asks for expenses (a name and an amount) until the user types done.",
          "Print the total, the largest expense and the average.",
          "Stretch goal: save the expenses to a CSV file and load them the next time the program runs.",
        ]),
      },
      { title: "Bonus: projects to try next", kind: "link", minutes: 30, optional: true, url: "https://docs.python.org/3/tutorial/", drip: { mode: "on_date", date: "+14" } },
    ],
  },
];

const DATA_ANALYTICS: SectionSpec[] = [
  {
    title: "Before you start",
    lessons: [
      { title: "Welcome to Data Analytics", kind: "video", minutes: 1, upload: "welcome.mp4" },
      {
        title: "How this course works",
        kind: "text",
        minutes: 10,
        text:
          p("Data Analytics takes you from spreadsheets to SQL to dashboards over twelve weeks, using real business data.") +
          h2("Every week") +
          ul("Lessons open on the day your batch starts that week.", "Two live classes with your faculty.", "A short exercise you finish before the next week.") +
          p("Required lessons count toward your progress. Optional ones are extra practice."),
      },
      { title: "Course handbook", kind: "pdf", minutes: 10, pdf: handbook("Data Analytics", ["Spreadsheets for analysis", "SQL foundations", "Dashboards"]) },
    ],
  },
  {
    title: "Week 1: Spreadsheets for analysis",
    drip: { mode: "after_start", days: 0 },
    lessons: [
      {
        title: "Cleaning data in Excel",
        kind: "text",
        minutes: 25,
        text:
          p("Most analysis time goes into cleaning. Start every dataset with the same checks.") +
          ol("Remove blank rows and duplicated records.", "Make each column one type: dates as dates, numbers as numbers.", "Trim stray spaces with <code>TRIM()</code> and fix capitals with <code>PROPER()</code>.", "Keep the raw data on its own sheet; clean a copy."),
      },
      {
        title: "Lookup functions",
        kind: "pdf",
        minutes: 20,
        pdf: worksheet("Data Analytics: lookup functions", [
          "Use XLOOKUP to bring each order's customer city from the Customers sheet.",
          "Explain in one line why XLOOKUP is safer than VLOOKUP when columns move.",
          "Use IFERROR to show 'Unknown' for orders with no matching customer.",
        ]),
      },
      { title: "Live class: Pivot tables", kind: "live", minutes: 120 },
    ],
  },
  {
    title: "Week 2: SQL foundations",
    drip: { mode: "after_start", days: 7 },
    lessons: [
      {
        title: "SELECT, WHERE and ORDER BY",
        kind: "text",
        minutes: 30,
        text: p("SQL asks a database a question. Every query starts with the columns you want and the table they come from.") + code("SELECT city, SUM(amount) AS revenue\nFROM orders\nWHERE order_date >= '2026-01-01'\nGROUP BY city\nORDER BY revenue DESC;"),
      },
      { title: "Practice on SQLBolt", kind: "link", minutes: 30, optional: true, url: "https://sqlbolt.com/" },
      { title: "Joins explained", kind: "pdf", minutes: 20, pdf: worksheet("Data Analytics: joins", ["Write an INNER JOIN between orders and customers.", "When would you use a LEFT JOIN instead? Give a business example.", "Find customers who have never ordered."]) },
    ],
  },
  {
    title: "Week 3: Dashboards",
    drip: { mode: "after_start", days: 14 },
    lessons: [
      {
        title: "Choosing the right chart",
        kind: "text",
        minutes: 20,
        text: p("Pick the chart from the question, not the data.") + ul("Change over time: a line chart.", "Comparing categories: a bar chart, sorted.", "Parts of a whole with few parts: a stacked bar.", "Relationship between two measures: a scatter plot."),
      },
      { title: "Live class: Build a dashboard", kind: "live", minutes: 120 },
    ],
  },
];

const ML: SectionSpec[] = [
  {
    title: "Week 1: What machine learning is",
    lessons: [
      { title: "But what is a neural network?", kind: "video", minutes: 19, url: "https://www.youtube.com/watch?v=aircAruvnKk" },
      {
        title: "NumPy and pandas refresher",
        kind: "text",
        minutes: 30,
        text: p("Every model in this course starts from a pandas DataFrame.") + code('import pandas as pd\ndf = pd.read_csv("houses.csv")\ndf.describe()\ndf["price_per_sqft"] = df.price / df.area'),
      },
      { title: "Try Jupyter in your browser", kind: "link", minutes: 15, optional: true, url: "https://jupyter.org/try" },
    ],
  },
  {
    title: "Week 2: Regression",
    drip: { mode: "after_start", days: 7 },
    lessons: [
      { title: "Linear regression", kind: "text", minutes: 30, text: p("Linear regression fits a straight line that predicts a number from one or more inputs.") + code("from sklearn.linear_model import LinearRegression\nmodel = LinearRegression().fit(X_train, y_train)\nmodel.score(X_test, y_test)") },
      { title: "Gradient descent, how models learn", kind: "video", minutes: 21, url: "https://www.youtube.com/watch?v=IHZwWFHWa-w" },
      { title: "Regression worksheet", kind: "pdf", minutes: 20, pdf: worksheet("Machine Learning Foundations: regression", ["Fit a linear regression to the housing data and report R squared on the test set.", "Add one feature and explain whether it helped.", "Plot residuals and describe any pattern you see."]) },
    ],
  },
  {
    title: "Week 3: Classification",
    drip: { mode: "after_start", days: 14 },
    lessons: [
      { title: "Logistic regression", kind: "text", minutes: 25, text: p("Logistic regression predicts the probability of a class, like spam or not spam.") + ul("Outputs are between 0 and 1.", "Pick a threshold to turn probabilities into decisions.", "Watch for imbalanced classes.") },
      { title: "Live class: Classifying emails", kind: "live", minutes: 120 },
    ],
  },
  {
    title: "Week 4: Model evaluation",
    drip: { mode: "after_start", days: 21 },
    lessons: [
      { title: "Train, validate, test", kind: "text", minutes: 20, text: p("Never judge a model on the data it learned from. Split your data three ways and touch the test set once, at the end.") },
      { title: "Metrics cheat sheet", kind: "pdf", minutes: 10, pdf: { title: "Metrics cheat sheet", blocks: [{ heading: "Regression", text: "MAE, RMSE, R squared." }, { heading: "Classification", text: "Accuracy, precision, recall, F1, ROC AUC. Use precision and recall when classes are imbalanced." }] } },
    ],
  },
  {
    title: "Week 5: Trees and ensembles",
    drip: { mode: "after_start", days: 28 },
    lessons: [
      { title: "Decision trees", kind: "text", minutes: 25, text: p("A decision tree splits the data with yes or no questions until each group is mostly one class.") },
      { title: "Random forests", kind: "text", minutes: 25, text: p("A random forest averages many trees, each trained on a random sample, to reduce overfitting.") },
    ],
  },
  {
    title: "Week 6: Project",
    drip: { mode: "after_start", days: 35 },
    lessons: [
      { title: "Capstone brief", kind: "pdf", minutes: 15, pdf: worksheet("Machine Learning Foundations: capstone", ["Pick a dataset with at least 1,000 rows.", "Frame a prediction question and choose a metric.", "Compare two models and present your results in ten minutes."]) },
      { title: "Live class: Project demos", kind: "live", minutes: 120 },
    ],
  },
];

const DIGITAL_MARKETING: SectionSpec[] = [
  {
    title: "Module 1: Foundations",
    lessons: [
      { title: "The marketing funnel", kind: "text", minutes: 20, text: p("Customers move from awareness to consideration to purchase to loyalty. Each stage needs different messages and different measures.") + ul("Awareness: reach and impressions.", "Consideration: clicks and time on site.", "Purchase: conversion rate and cost per acquisition.", "Loyalty: repeat purchase and referrals.") },
      { title: "Brand storytelling", kind: "video", minutes: 5, url: "https://vimeo.com/76979871" },
      { title: "Course handbook", kind: "pdf", minutes: 10, pdf: handbook("Digital Marketing", ["Foundations", "Performance marketing", "Analytics", "Capstone"]) },
    ],
  },
  {
    title: "Module 2: Performance marketing",
    drip: { mode: "after_start", days: 7 },
    lessons: [
      { title: "Search ads basics", kind: "text", minutes: 25, text: p("Search ads show when people are already looking. Match keywords to intent and send each ad to a page that answers the search.") },
      { title: "Google Skillshop", kind: "link", minutes: 60, optional: true, url: "https://skillshop.withgoogle.com/" },
      { title: "Live class: Building a campaign", kind: "live", minutes: 120 },
    ],
  },
  {
    title: "Module 3: Analytics",
    drip: { mode: "after_start", days: 21 },
    lessons: [
      { title: "UTM links and attribution", kind: "text", minutes: 20, text: p("Tag every link you share with UTM parameters so your analytics can tell which campaign brought each visitor.") + code("https://example.com/sale?utm_source=instagram&utm_medium=social&utm_campaign=diwali") },
      { title: "Reading a campaign report", kind: "pdf", minutes: 15, pdf: worksheet("Digital Marketing: reading a campaign report", ["Find the campaign with the lowest cost per acquisition.", "Which channel has the best conversion rate, and why might that be misleading?"]) },
    ],
  },
  {
    title: "Module 4: Capstone",
    drip: { mode: "on_date", date: "+10" },
    lessons: [
      { title: "Capstone brief", kind: "pdf", minutes: 15, pdf: worksheet("Digital Marketing: capstone", ["Plan a four-week campaign for a local brand with a budget of Rs 50,000.", "Set targets for each funnel stage and say how you will measure them."]) },
      { title: "Live class: Campaign reviews", kind: "live", minutes: 120 },
    ],
  },
];

/* ───────────────────────────── Writing the curricula ───────────────────────────── */

const ASSETS = join(process.cwd(), "src", "modules", "content-progress", "seed-assets");

/** "+14" means 14 days from today. */
function resolveDrip(d: DripInput | undefined, today: string): DripInput | undefined {
  if (d?.mode === "on_date" && d.date?.startsWith("+")) return { mode: "on_date", date: addDays(today, Number(d.date.slice(1))) };
  return d;
}

async function uploadFile(author: Actor, lessonId: string, fileName: string, body: Buffer, durationSeconds?: number) {
  const u = await startUpload(author, { lessonId, fileName, size: body.length, durationSeconds });
  for (let n = 0; n < u.partCount; n++) await uploadPart(author, u.uploadId, n, body.subarray(n * u.partSize, (n + 1) * u.partSize));
  await finishUpload(author, u.uploadId);
}

async function writeCurriculum(author: Actor, courseId: string, sections: SectionSpec[], today: string, courseTitle: string) {
  for (const s of sections) {
    const section = await addSection(author, courseId, s.title);
    for (const l of s.lessons) {
      const lesson = await addLesson(author, courseId, section.id, { title: l.title, kind: l.kind, required: !l.optional });
      if (l.kind === "text" && l.text) await setTextContent(author, lesson.id, l.text);
      if (l.kind === "link" && l.url) await setLinkContent(author, lesson.id, l.url);
      if (l.kind === "video" && l.url) await setVideoLink(author, lesson.id, l.url);
      if (l.kind === "video" && l.upload) {
        const body = await readFile(join(ASSETS, l.upload)).catch(() => null);
        if (body) await uploadFile(author, lesson.id, l.upload, body, 36);
        else await setVideoLink(author, lesson.id, "https://www.youtube.com/watch?v=kqtD5dpn9C8");
      }
      if (l.kind === "pdf" && l.pdf) {
        const name = `${l.pdf.title.replace(/[^A-Za-z0-9 ]+/g, "").replace(/\s+/g, " ").trim()}.pdf`;
        await uploadFile(author, lesson.id, name, makePdf(l.pdf.title, l.pdf.blocks, `${courseTitle} · Demo University`));
      }
      const drip = resolveDrip(l.drip ?? s.drip, today);
      await updateLesson(author, lesson.id, { durationMinutes: l.minutes, ...(drip && { drip }) });
    }
  }
}

/* ───────────────────────────── Progress ───────────────────────────── */

/** A moment `daysAgo` days before today at hh:mm in India time, never in the future. */
function momentAgo(today: string, daysAgo: number, hh: number, mm: number) {
  const at = new Date(`${addDays(today, -Math.max(0, Math.round(daysAgo)))}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+05:30`);
  const now = Date.now() - 60_000;
  return at.getTime() > now ? new Date(now) : at;
}

type Pace = {
  /** Share of the open required lessons completed, in curriculum order (1 = all). */
  share: number;
  /** Also complete open optional lessons up to that point. */
  optional?: boolean;
  /** Share watched of the next video, if the next lesson is a video. */
  partialVideo?: number;
  /** Days since the last activity. */
  lastSeen: number;
};

async function seedProgress(ctx: SeedContext, email: string, courseTitle: string, pace: Pace) {
  const enrolmentId = ctx.ids.enrolments[`${email} / ${courseTitle}`];
  if (!enrolmentId) return null;
  const student = await ctx.actorFor(email);
  const universityId = ctx.universityId;
  const result = await withTenant(student, async (tx) => {
    const e = await enrolmentById(tx, enrolmentId);
    if (e.status !== "active") return null;
    const batch = await batchLite(tx, e.batchId);
    return { e, batch };
  });
  if (!result) return null;
  const { e, batch } = result;

  // The student's view of the course: what is open today, in order.
  const curriculum = (await getCurriculum(ctx.systemActor, e.courseId)).flatMap((s) => s.lessons).filter((l) => l.ready);
  const open = curriculum.filter((l) => !isLocked(unlockDate(l, batch.startDate), ctx.today));
  const requiredOpen = open.filter((l) => l.required);
  const target = Math.round(requiredOpen.length * pace.share);
  const toDo: typeof open = [];
  let req = 0;
  for (const l of open) {
    if (req >= target) break;
    if (l.required) {
      toDo.push(l);
      req++;
    } else if (pace.optional) toDo.push(l);
  }
  const nextLesson = open[open.indexOf(toDo[toDo.length - 1]) + 1] ?? (toDo.length === 0 ? open[0] : undefined);

  // Spread completions from the batch start (or a few days before the last visit, for
  // batches that haven't started) up to the last activity.
  const sinceStart = -daysFrom(ctx.today, batch.startDate);
  const from = Math.min(Math.max(sinceStart, pace.lastSeen + 3), 24);
  const span = Math.max(0, from - pace.lastSeen);
  let reached100 = false;
  await withTenant(student, async (tx) => {
    for (const [i, l] of toDo.entries()) {
      const daysAgo = from - (toDo.length === 1 ? span : (span * i) / (toDo.length - 1));
      const at = momentAgo(ctx.today, daysAgo, 18 + (i % 4), (i * 17) % 60);
      const r = await completeLessonTx(tx, student, { universityId, enrolment: e, lessonId: l.id, via: l.kind === "video" ? "video" : "manual", at });
      reached100 = r.reached100;
    }
    if (nextLesson?.kind === "video" && pace.partialVideo) {
      const at = momentAgo(ctx.today, pace.lastSeen, 20, 40);
      const course = await lockCourseProgress(tx, universityId, e);
      const { row } = await lockLessonProgress(tx, universityId, e.userId, e.courseId, nextLesson.id);
      const c = readContent("video", nextLesson.content);
      const length = (c.kind === "video" && c.video?.source === "upload" ? c.video.durationSeconds : undefined) ?? nextLesson.durationMinutes * 60;
      const watched = Math.round(length * pace.partialVideo);
      await tx
        .update(contentLessonProgress)
        .set({ watchedRanges: [[0, watched]], percent: Math.floor(pace.partialVideo * 100), mediaSeconds: length, positionSeconds: watched, updatedAt: at })
        .where(eq(contentLessonProgress.id, row.id));
      await tx.update(contentCourseProgress).set({ lastLessonId: nextLesson.id, lastActivityAt: at }).where(eq(contentCourseProgress.id, course.id));
    }
  });
  if (reached100) await finishCompletions(universityId, [e.enrolmentId]);
  return e;
}

function daysFrom(today: string, date: string) {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/* ───────────────────────────── Seed ───────────────────────────── */

export async function seed(ctx: SeedContext) {
  const course = (title: string) => ctx.ids.courses[title];
  const hema = await ctx.actorFor("hema@demo.edu");
  const farah = await ctx.actorFor("farah@demo.edu");
  const neel = await ctx.actorFor("neel@demo.edu");

  if (course("Data Analytics")) await writeCurriculum(hema, course("Data Analytics"), DATA_ANALYTICS, ctx.today, "Data Analytics");
  if (course("Python Basics")) await writeCurriculum(hema, course("Python Basics"), PYTHON, ctx.today, "Python Basics");
  if (course("Machine Learning Foundations")) await writeCurriculum(farah, course("Machine Learning Foundations"), ML, ctx.today, "Machine Learning Foundations");
  if (course("Digital Marketing")) await writeCurriculum(neel, course("Digital Marketing"), DIGITAL_MARKETING, ctx.today, "Digital Marketing");

  const plan: [string, string, Pace][] = [
    // Python Basics: running for about four weeks. Neil finishes it (completion flow).
    ["neil@demo.edu", "Python Basics", { share: 1, optional: true, lastSeen: 1 }],
    ["diya@demo.edu", "Python Basics", { share: 0.8, lastSeen: 2 }],
    ["riya@demo.edu", "Python Basics", { share: 0.6, lastSeen: 1 }],
    ["tara@demo.edu", "Python Basics", { share: 0.45, lastSeen: 4 }],
    ["ishaan@demo.edu", "Python Basics", { share: 0.2, lastSeen: 9 }],
    ["aditi@demo.edu", "Python Basics", { share: 0.7, optional: true, lastSeen: 0 }],
    ["kabir@demo.edu", "Python Basics", { share: 0.5, lastSeen: 3 }],
    ["rohan@demo.edu", "Python Basics", { share: 0.8, lastSeen: 6 }],
    // Machine Learning Foundations: weeks 5 and 6 are still locked.
    ["sneha@demo.edu", "Machine Learning Foundations", { share: 1, optional: true, lastSeen: 0 }],
    ["meera@demo.edu", "Machine Learning Foundations", { share: 0.75, partialVideo: 0.5, lastSeen: 1 }],
    ["tara@demo.edu", "Machine Learning Foundations", { share: 0.6, partialVideo: 0.35, lastSeen: 2 }],
    ["ishaan@demo.edu", "Machine Learning Foundations", { share: 0.5, lastSeen: 3 }],
    ["diya@demo.edu", "Machine Learning Foundations", { share: 0.4, lastSeen: 5 }],
    ["rohan@demo.edu", "Machine Learning Foundations", { share: 0.3, lastSeen: 7 }],
    ["arjun@demo.edu", "Machine Learning Foundations", { share: 0.1, partialVideo: 0.2, lastSeen: 11 }],
    // Digital Marketing: the capstone opens on a fixed date.
    ["meera@demo.edu", "Digital Marketing", { share: 0.8, optional: true, lastSeen: 1 }],
    ["riya@demo.edu", "Digital Marketing", { share: 0.55, lastSeen: 2 }],
    ["aditi@demo.edu", "Digital Marketing", { share: 0.3, lastSeen: 6 }],
    // Data Analytics starts next week: a few students have done the welcome lessons.
    ["aditi@demo.edu", "Data Analytics", { share: 1, lastSeen: 1 }],
    ["riya@demo.edu", "Data Analytics", { share: 0.67, lastSeen: 0 }],
    ["sneha@demo.edu", "Data Analytics", { share: 0.67, lastSeen: 2 }],
    ["kabir@demo.edu", "Data Analytics", { share: 0.34, lastSeen: 3 }],
    ["ishaan@demo.edu", "Data Analytics", { share: 0.34, partialVideo: 0.5, lastSeen: 5 }],
    ["zoya@demo.edu", "Data Analytics", { share: 0, partialVideo: 0.5, lastSeen: 1 }],
  ];
  for (const [email, title, pace] of plan) await seedProgress(ctx, email, title, pace);

  // Rohan finished Python Basics in the institute's offline lab: Hema marks it complete.
  const rohan = ctx.ids.enrolments["rohan@demo.edu / Python Basics"];
  const pyEvening = ctx.ids.batches["Python Basics / Weekday evening"];
  if (rohan && pyEvening) await markStudentComplete(hema, pyEvening, rohan);
}
