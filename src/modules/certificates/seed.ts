/**
 * Demo data for certificates (contracts.md section 6), all through the module's services
 * and the core API:
 *   - the three starter templates, signed by the Director and the HODs (placeholder
 *     signatures generated locally),
 *   - a rule for every seeded course,
 *   - one completion through core markEnrolmentCompleted (Diya, Python Basics), so the
 *     automatic flow runs on this branch; the runner then delivers enrolment.completed and
 *     the handler issues her certificate. Students content-progress completes get theirs
 *     the same way.
 *   - one certificate issued by hand and then revoked, so the revoked state can be seen.
 */
import type { SeedContext } from "@/contracts/module";
import { markEnrolmentCompleted } from "@/server/core";
import { signaturePng } from "./render/signature";
import { issueCertificate, listTemplates, revokeCertificate, saveCourseRule, setSignatureImage, updateTemplate } from "./service";

const SIGNERS = {
  director: { name: "Asha Admin", title: "Director" },
  cs: { name: "Hema Head", title: "Head of Department, Computer Science" },
  mkt: { name: "Mehul Head", title: "Head of Department, Marketing" },
};

const RULES: { course: string; hod: string; design: "classic" | "modern" | "minimal"; validityMonths: number | null; reminderDays: number | null }[] = [
  { course: "Data Analytics", hod: "hema@demo.edu", design: "classic", validityMonths: null, reminderDays: null },
  { course: "Python Basics", hod: "hema@demo.edu", design: "modern", validityMonths: 24, reminderDays: 30 },
  { course: "Machine Learning Foundations", hod: "hema@demo.edu", design: "classic", validityMonths: 36, reminderDays: 60 },
  { course: "Digital Marketing", hod: "mehul@demo.edu", design: "minimal", validityMonths: 12, reminderDays: 30 },
];

export async function seed(ctx: SeedContext) {
  const admin = await ctx.actorFor("asha@demo.edu");
  const templates = await listTemplates(admin);
  const byDesign = Object.fromEntries(templates.map((t) => [t.design, t]));

  const signers = { classic: [SIGNERS.director, SIGNERS.cs], modern: [SIGNERS.director], minimal: [SIGNERS.mkt, SIGNERS.director] } as const;
  for (const t of templates) {
    const list = signers[t.design];
    await updateTemplate(admin, t.id, { name: t.name, design: t.design, heading: t.heading, intro: t.intro, body: t.body, signatories: [...list] });
    for (const [i, s] of list.entries()) {
      const png = signaturePng(s.name);
      await setSignatureImage(admin, t.id, i, { bytes: png, size: png.length });
    }
  }

  for (const r of RULES) {
    const courseId = ctx.ids.courses[r.course];
    if (!courseId) continue;
    await saveCourseRule(await ctx.actorFor(r.hod), courseId, {
      templateId: byDesign[r.design].id,
      autoIssue: true,
      validityMonths: r.validityMonths,
      reminderDays: r.reminderDays,
    });
  }

  // Diya finished Python Basics: core marks it complete and emits enrolment.completed.
  const diya = ctx.ids.enrolments["diya@demo.edu / Python Basics"];
  if (diya) await markEnrolmentCompleted(ctx.systemActor, diya);

  // A certificate issued too early and then revoked, so the revoked state shows on the verify page.
  const kabir = ctx.ids.enrolments["kabir@demo.edu / Python Basics"];
  if (kabir) {
    const hema = await ctx.actorFor("hema@demo.edu");
    const c = await issueCertificate(hema, { enrolmentId: kabir, reason: "Completed the weekend bootcamp version of the course" });
    await revokeCertificate(hema, c.id, "Issued before the final project was graded. It will be issued again once it passes.");
  }
}
