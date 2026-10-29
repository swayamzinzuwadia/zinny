/**
 * Shared set-up for the assessments tests: a university with two departments, admin,
 * HODs, two faculty on two batches of one course, and enrolled students.
 */
import { createBatch } from "@/server/services/batches";
import { holdSeat } from "@/server/services/enrolment";
import { loadActor } from "@/server/actor";
import type { Actor } from "@/server/authz/engine";
import { createQuestion } from "@/modules/assessments/pool";
import { addQuestionsToTest, createTest, setPublished, updateProctoring, type ProctoringInput } from "@/modules/assessments/manage";
import type { QuestionDraft } from "@/modules/assessments/lib/marking";
import { makeDepartment, person, setupCourse, slots, WEEKDAYS } from "../fixtures";

export async function world(name = "Assess U") {
  const base = await setupCourse({ name });
  const { uni, dept, hod, admin, course, batch } = base;
  const farah = await loadActor(base.facultyUserId, uni.id);
  // A second faculty member on a second batch of the same course.
  const neilP = await person("Faculty Neil", "permanent_faculty", { universityId: uni.id, departmentId: dept.id });
  const evening = await createBatch(hod, {
    courseId: course.id,
    name: "Weekday evening",
    startDate: "2030-11-04",
    endDate: "2031-01-31",
    seatLimit: 20,
    slots: slots(WEEKDAYS, "18:00", "20:00"),
    faculty: [{ userId: neilP.user.id, role: "permanent_faculty" }],
  });
  const neil = await neilP.actor();
  // Faculty actors must be reloaded after createBatch gives them batch roles.
  const farahNow = await loadActor(farah.userId, uni.id);
  const mkt = await makeDepartment(uni.id, "MKT", "Marketing");
  const mktHod = await (await person("Hod Mehul", "hod", { universityId: uni.id, departmentId: mkt.id })).actor();

  const enrol = async (who: string, batchId: string) => {
    const s = await base.student(who);
    const r = await holdSeat(s, { batchId, acknowledgeClash: true });
    if (r.status !== "enrolled") throw new Error(`Expected a free enrolment, got ${r.status}`);
    return s;
  };
  const riya = await enrol("Riya Student", batch.id);
  const kabir = await enrol("Kabir Student", batch.id);
  const tara = await enrol("Tara Student", evening.id);
  const outsider = await base.student("Omar Outsider"); // a student in the university, not in the course

  return { ...base, admin, hod, farah: farahNow, neil, mkt, mktHod, morning: batch, evening, riya, kabir, tara, outsider };
}

export type World = Awaited<ReturnType<typeof world>>;

export const single = (prompt: string, extra: Partial<QuestionDraft> = {}): QuestionDraft => ({
  type: "single",
  prompt,
  options: ["Alpha", "Bravo", "Charlie", "Delta"],
  correct: [1],
  marks: 2,
  negativeMarks: 0.5,
  difficulty: "medium",
  tags: ["SQL"],
  explanation: "Bravo is right.",
  ...extra,
});

export const PROCTOR: ProctoringInput = {
  timeLimitMinutes: null,
  fullscreenRequired: false,
  tabSwitchLimit: null,
  shuffleQuestions: false,
  shuffleOptions: false,
  onePerPage: false,
  attemptLimit: 1,
  opensAt: "",
  closesAt: "",
};

/** A published quiz for the whole course with the given questions. */
export async function quiz(
  w: World,
  drafts: QuestionDraft[],
  opts: { by?: Actor; proctoring?: Partial<ProctoringInput>; kind?: string; allBatches?: boolean; batchIds?: string[]; title?: string } = {},
) {
  const by = opts.by ?? w.hod;
  const qs = [];
  for (const d of drafts) qs.push(await createQuestion(by, w.dept.id, d));
  const t = await createTest(by, {
    kind: opts.kind ?? "quiz",
    title: opts.title ?? "SQL basics",
    courseId: w.course.id,
    allBatches: opts.allBatches ?? true,
    batchIds: opts.batchIds ?? [],
  });
  await addQuestionsToTest(by, t.id, qs.map((q) => q.id));
  await updateProctoring(by, t.id, { ...PROCTOR, ...opts.proctoring });
  await setPublished(by, t.id, true);
  return { test: t, questions: qs };
}
