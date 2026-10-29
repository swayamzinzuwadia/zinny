/**
 * Demo data for the Demo University (contracts.md section 6), made through the real
 * services as the real people: two assignments per running batch with a mix of graded,
 * handed-in and missing work (some late, some with files), a closed poll with results
 * and an open one. Files are small PDFs generated here, never downloaded.
 */
import type { SeedContext } from "@/contracts/module";
import type { Actor } from "@/server/core";
import { addDaysTo, zonedToInstant } from "./lib/time";
import { createAssignment, gradeSubmission, submitAssignment, type AssignmentInput } from "./service/assignments";
import { finishUpload, putPart, startUpload, type StartUpload } from "./service/files";
import { announceOpenedPolls, createPoll, myPolls, vote } from "./service/polls";

const TZ = "Asia/Kolkata";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A one-page PDF with a title and a few lines of text. */
export function makePdf(title: string, lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, "-");
  const text = [
    "BT /F1 18 Tf 56 770 Td",
    `(${esc(title)}) Tj`,
    "/F1 11 Tf 0 -30 Td 16 TL",
    ...lines.map((l) => `(${esc(l)}) '`),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}

async function uploadPdf(actor: Actor, target: Omit<StartUpload, "fileName" | "size"> & Record<string, string>, fileName: string, title: string, lines: string[]) {
  const body = makePdf(title, lines);
  const started = await startUpload(actor, { ...target, fileName, size: body.length } as StartUpload);
  for (let i = 0; i < started.parts; i++) await putPart(actor, started.fileId, i, body.subarray(i * started.partBytes, (i + 1) * started.partBytes));
  await finishUpload(actor, started.fileId);
  return started.fileId;
}

type Work =
  | { who: string; kind: "graded"; marks: number; feedback: string; at: number; text?: string; file?: string; late?: boolean; returnFile?: boolean }
  | { who: string; kind: "submitted"; at: number; text?: string; file?: string; late?: boolean }
  | { who: string; kind: "zero"; feedback: string };

type Plan = {
  batch: string;
  by: string;
  title: string;
  html: string;
  /** Days from today; negative is past. */
  dueIn: number;
  dueTime: string;
  points: number;
  allowLate?: number;
  type: AssignmentInput["submissionType"];
  maxFiles?: number;
  attachment?: { name: string; title: string; lines: string[] };
  work: Work[];
};

export async function seed(ctx: SeedContext) {
  const today = ctx.today;
  const actors = new Map<string, Actor>();
  const as = async (who: string) => {
    if (!actors.has(who)) actors.set(who, await ctx.actorFor(`${who}@demo.edu`));
    return actors.get(who)!;
  };
  const due = (p: Plan) => zonedToInstant(addDaysTo(today, p.dueIn), p.dueTime, TZ);

  const plans: Plan[] = [
    {
      batch: "Python Basics / Weekend",
      by: "farah",
      title: "Loops and conditionals worksheet",
      html: "<p>Solve the eight problems in the attached worksheet.</p><ul><li>Use a <strong>for</strong> loop for problems 1 to 4.</li><li>Use <strong>while</strong> and <strong>if</strong> for problems 5 to 8.</li></ul><p>Paste your code as text, or upload a .py file.</p>",
      dueIn: -6,
      dueTime: "21:00",
      points: 20,
      type: "both",
      attachment: { name: "loops-worksheet.pdf", title: "Loops and conditionals", lines: ["1. Print the numbers 1 to 10.", "2. Sum the even numbers below 100.", "3. Print a multiplication table for 7.", "4. Count the vowels in a word.", "5. Guess a number with while.", "6. FizzBuzz to 50.", "7. Find the largest of three numbers.", "8. Check if a year is a leap year."] },
      work: [
        { who: "riya", kind: "graded", marks: 18, feedback: "Clean loops and good names. In problem 7, max() would save you three lines.", at: -7, text: "for i in range(1, 11):\n    print(i)\n\ntotal = sum(n for n in range(0, 100, 2))\nprint(total)", returnFile: true },
        { who: "tara", kind: "graded", marks: 15, feedback: "Problems 5 and 6 work. Problem 8 misses the 400-year rule.", at: -6.2, file: "tara-loops.pdf" },
        { who: "neil", kind: "submitted", at: -6.4, text: "Answers below.\n\n1. for i in range(1, 11): print(i)\n2. print(sum(range(0, 100, 2)))" },
        { who: "diya", kind: "graded", marks: 19, feedback: "Excellent. Your FizzBuzz is the neatest in the batch.", at: -8, file: "diya-worksheet.pdf" },
      ],
    },
    {
      batch: "Python Basics / Weekend",
      by: "farah",
      title: "Mini project: number guessing game",
      html: "<h3>Build it</h3><p>Write a game where the computer picks a number from 1 to 100 and the player guesses until they get it. Show <em>too high</em> or <em>too low</em> after each guess, and the number of tries at the end.</p><h3>Hand in</h3><p>Your <strong>.py</strong> file and a screenshot of one game.</p>",
      dueIn: 1,
      dueTime: "23:59",
      points: 30,
      allowLate: 10,
      type: "files",
      maxFiles: 2,
      work: [{ who: "diya", kind: "submitted", at: -0.5, file: "guessing-game.pdf" }],
    },
    {
      batch: "Python Basics / Weekday evening",
      by: "farah",
      title: "Functions practice set",
      html: "<p>Write the five functions described below. Each needs a docstring and one example call.</p><ol><li>is_prime(n)</li><li>average(numbers)</li><li>reverse_words(sentence)</li><li>count_words(text)</li><li>celsius_to_fahrenheit(c)</li></ol>",
      dueIn: -4,
      dueTime: "21:00",
      points: 25,
      allowLate: 10,
      type: "both",
      work: [
        { who: "kabir", kind: "graded", marks: 20, feedback: "All five work. Handed in a day late, so 10% came off.", at: -3, late: true, text: "def is_prime(n):\n    \"\"\"True when n is prime.\"\"\"\n    return n > 1 and all(n % d for d in range(2, int(n ** 0.5) + 1))" },
        { who: "aditi", kind: "submitted", at: -4.3, file: "aditi-functions.pdf" },
      ],
    },
    {
      batch: "Python Basics / Weekday evening",
      by: "farah",
      title: "Lists and dictionaries write-up",
      html: "<p>In 300 to 500 words, explain when you would use a list and when a dictionary. Give one example of each from a real program.</p>",
      dueIn: 3,
      dueTime: "21:00",
      points: 10,
      type: "text",
      work: [{ who: "rohan", kind: "submitted", at: -0.2, text: "A list keeps things in order, like the songs in a playlist. A dictionary looks things up by a key, like a phone book where you find a number by the name." }],
    },
    {
      batch: "Machine Learning Foundations / Morning",
      by: "farah",
      title: "Linear regression notebook",
      html: "<p>Fit a linear regression to the attached house-prices data. Report the coefficients, R² on the test set, and one chart of predicted against actual prices.</p><p>Hand in the notebook exported as PDF.</p>",
      dueIn: -3,
      dueTime: "18:00",
      points: 50,
      allowLate: 20,
      type: "files",
      maxFiles: 2,
      attachment: { name: "house-prices-brief.pdf", title: "House prices data", lines: ["Columns: area_sqft, bedrooms, age_years, distance_km, price_lakh.", "Use an 80/20 split with random_state=42.", "Report R2 and mean absolute error."] },
      work: [
        { who: "ishaan", kind: "graded", marks: 44, feedback: "Good model and a clear chart. Explain why you dropped age_years.", at: -3.5, file: "ishaan-regression.pdf" },
        { who: "meera", kind: "graded", marks: 38, feedback: "Solid work. Handed in late, so 20% came off.", at: -2.4, late: true, file: "meera-notebook.pdf" },
        { who: "rohan", kind: "submitted", at: -3.2, file: "rohan-linear-regression.pdf" },
        { who: "sneha", kind: "submitted", at: -3.9, file: "sneha-regression.pdf" },
        { who: "arjun", kind: "zero", feedback: "Nothing was handed in. Talk to me if you need more time." },
        { who: "tara", kind: "submitted", at: -2.8, late: true, file: "tara-ml.pdf" },
      ],
    },
    {
      batch: "Machine Learning Foundations / Morning",
      by: "farah",
      title: "Model evaluation essay",
      html: "<p>Explain precision, recall and F1 in your own words, with one example where accuracy misleads. 400 words at most.</p>",
      dueIn: 6,
      dueTime: "23:59",
      points: 20,
      type: "text",
      work: [{ who: "zoya", kind: "submitted", at: -0.3, text: "Accuracy can look great when one class is rare. If 1 in 100 emails is spam, a model that says 'not spam' every time is 99% accurate and useless." }],
    },
    {
      batch: "Digital Marketing / Evening",
      by: "neel",
      title: "Competitor ad teardown",
      html: "<p>Pick one brand and three of its competitors. For each, find one recent ad and note the audience, the offer and the call to action.</p><p>Hand in a one-page PDF or write it below.</p>",
      dueIn: -5,
      dueTime: "20:00",
      points: 15,
      type: "both",
      work: [
        { who: "riya", kind: "submitted", at: -5.2, text: "Brand: Blue Tokai. Competitors: Third Wave, Sleepy Owl, Starbucks India.", file: "riya-ad-teardown.pdf" },
        { who: "aditi", kind: "graded", marks: 13, feedback: "Sharp notes on the offers. Say more about who each ad is for.", at: -6, file: "aditi-teardown.pdf" },
        { who: "meera", kind: "submitted", at: -5.6, text: "Brand: Nykaa. Competitors: Purplle, Tira, Sugar." },
      ],
    },
    {
      batch: "Digital Marketing / Evening",
      by: "neel",
      title: "Campaign brief",
      html: "<p>Write a one-page brief for a two-week Instagram campaign for a local business: goal, audience, message, budget and how you will measure it.</p>",
      dueIn: 2,
      dueTime: "20:00",
      points: 20,
      allowLate: 15,
      type: "both",
      work: [{ who: "tara", kind: "submitted", at: -0.4, file: "tara-campaign-brief.pdf" }],
    },
  ];

  for (const p of plans) {
    const batchId = ctx.ids.batches[p.batch];
    const courseId = ctx.ids.courses[p.batch.split(" / ")[0]];
    if (!batchId || !courseId) throw new Error(`assignments-polls seed: missing ${p.batch}`);
    const teacher = await as(p.by);
    const dueAt = due(p);
    const createdAt = new Date(Math.min(dueAt.getTime(), Date.now()) - 9 * DAY);
    const attachmentIds = p.attachment
      ? [await uploadPdf(teacher, { purpose: "attachment", courseId }, p.attachment.name, p.attachment.title, p.attachment.lines)]
      : [];
    const a = await createAssignment(
      teacher,
      {
        courseId,
        title: p.title,
        instructionsHtml: p.html,
        dueDate: addDaysTo(today, p.dueIn),
        dueTime: p.dueTime,
        points: p.points,
        allowLate: p.allowLate !== undefined,
        latePenaltyPct: p.allowLate ?? 0,
        submissionType: p.type,
        maxFiles: p.maxFiles ?? 3,
        maxFileMb: 10,
        batchIds: [batchId],
        attachmentIds,
      },
      { now: createdAt },
    );
    for (const w of p.work) {
      const student = await as(w.who);
      if (w.kind !== "zero") {
        const at = w.late ? new Date(dueAt.getTime() + Math.abs(w.at - p.dueIn) * DAY) : new Date(Math.min(dueAt.getTime() - HOUR, Date.now() + w.at * DAY));
        const fileIds = w.file
          ? [await uploadPdf(student, { purpose: "submission", assignmentId: a.id }, w.file, p.title, [`Handed in by ${student.name}.`, "Demo file made by the seed."])]
          : [];
        await submitAssignment(student, { assignmentId: a.id, text: p.type === "files" ? "" : (w.text ?? ""), fileIds }, { now: at });
      }
      if (w.kind === "graded" || w.kind === "zero") {
        const returned =
          w.kind === "graded" && w.returnFile
            ? [await uploadPdf(teacher, { purpose: "returned", assignmentId: a.id, batchId }, `${w.who}-marked.pdf`, `${p.title}: notes`, [w.feedback])]
            : [];
        await gradeSubmission(teacher, {
          assignmentId: a.id,
          studentId: student.userId,
          marks: w.kind === "zero" ? 0 : w.marks,
          feedback: w.feedback,
          returnedFileIds: returned,
        });
      }
    }
  }

  // One closed poll with results (course-wide, Python Basics) and one open poll (Digital Marketing).
  const python = ctx.ids.courses["Python Basics"];
  const opened = zonedToInstant(addDaysTo(today, -6), "10:00", TZ);
  const closed = await createPoll(
    await as("farah"),
    {
      courseId: python,
      batchId: null,
      question: "Which project should we build in week 6?",
      options: ["A to-do list app", "A weather dashboard", "A quiz game"],
      anonymous: false,
      resultsToStudents: true,
      opensDate: addDaysTo(today, -6),
      opensTime: "10:00",
      closesDate: addDaysTo(today, -2),
      closesTime: "18:00",
    },
    { now: new Date(opened.getTime() - HOUR) },
  );
  const ballots: [string, number][] = [["riya", 2], ["tara", 2], ["neil", 0], ["diya", 2], ["ishaan", 1], ["kabir", 2], ["aditi", 0]];
  for (const [who, choice] of ballots) {
    const s = await as(who);
    const when = new Date(opened.getTime() + 2 * HOUR);
    const poll = (await myPolls(s, { now: when })).find((x) => x.id === closed.id);
    if (poll) await vote(s, closed.id, poll.options[choice].id, { now: when });
  }

  const dm = ctx.ids.courses["Digital Marketing"];
  const open = await createPoll(await as("neel"), {
    courseId: dm,
    batchId: ctx.ids.batches["Digital Marketing / Evening"],
    question: "Which brand should we study in next week's class?",
    options: ["Zomato", "boAt", "Mamaearth", "Tanishq"],
    anonymous: true,
    resultsToStudents: true,
    opensDate: addDaysTo(today, -1),
    opensTime: "09:00",
    closesDate: addDaysTo(today, 2),
    closesTime: "20:00",
  }, { now: zonedToInstant(addDaysTo(today, -1), "08:00", TZ) });
  for (const [who, choice] of [["aditi", 1], ["meera", 3]] as [string, number][]) {
    const s = await as(who);
    const poll = (await myPolls(s)).find((x) => x.id === open.id);
    if (poll?.canVote) await vote(s, open.id, poll.options[choice].id);
  }
  // What the hourly job would have done when the poll opened.
  await announceOpenedPolls(ctx.systemActor);
}
