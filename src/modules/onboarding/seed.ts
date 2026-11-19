/**
 * onboarding demo data:
 *  - Sunrise Academy (/sunrise-academy): signed itself up yesterday, in its free trial, PAN
 *    card waiting for the Zinny team. Admin: anita@sunrise-academy.in
 *  - Lakeview Coaching (/lakeview-coaching): its trial ended without a plan, so it is frozen.
 *    Admin: farhan@lakeview-coaching.in (lands on Choose a plan)
 *  - Demo University: Riya has completed her KYC; the other students see "Complete your KYC".
 * Every account uses the password "zinny123". Safe to run again: existing institutes are
 * reset to the same state rather than made twice.
 */
import type { SeedContext } from "@/contracts/module";
import { audit, loadActor, systemActorFor, withTenant } from "@/server/core";
import { hashPassword } from "@/server/auth/passwords";
import { universityBySlug } from "@/server/context";
import { addDays } from "@/server/lib/dates";
import { createSelfServeUniversity, setTrialState } from "@/server/services/core-api";
import { onbSignups } from "./schema";
import { finishDocumentUpload, listDocuments, putDocumentPart, startDocumentUpload } from "./services/documents";
import { kycStatus, saveKyc } from "./services/kyc";
import { freezeIfTrialOver } from "./services/trial";

/** A one-page PDF that says what it stands in for. */
function demoPdf(title: string) {
  const text = `Demo document: ${title}`.replace(/[()\\]/g, "");
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

type DemoInstitute = {
  name: string;
  slug: string;
  legalName: string;
  address: string;
  stateCode: string;
  gstin: string | null;
  admin: { name: string; email: string };
  signup: { instituteType: string; city: string; phone: string; source: string };
  documents: { kind: "pan" | "gst_certificate" | "registration"; fileName: string }[];
};

async function ensureInstitute(d: DemoInstitute, today: string): Promise<{ id: string; adminId: string } | null> {
  const existing = await universityBySlug(d.slug);
  if (existing) {
    const [row] = await withTenant(systemActorFor(existing.id), (tx) => tx.select({ createdBy: onbSignups.createdBy }).from(onbSignups));
    return row?.createdBy ? { id: existing.id, adminId: row.createdBy } : null;
  }
  try {
    const created = await createSelfServeUniversity({
      name: d.name,
      slug: d.slug,
      legalName: d.legalName,
      address: d.address,
      stateCode: d.stateCode,
      gstEnabled: !!d.gstin,
      gstin: d.gstin,
      admin: { name: d.admin.name, email: d.admin.email, passwordHash: await hashPassword("zinny123") },
      trialDays: 3,
    });
    const admin = await loadActor(created.userId, created.universityId, { session: null });
    await withTenant(admin, async (tx) => {
      const [row] = await tx
        .insert(onbSignups)
        .values({
          universityId: created.universityId,
          instituteType: d.signup.instituteType,
          contactName: d.admin.name,
          contactEmail: d.admin.email,
          contactPhone: d.signup.phone,
          city: d.signup.city,
          source: d.signup.source,
          createdBy: created.userId,
          createdAt: new Date(`${addDays(today, -1)}T10:30:00+05:30`),
        })
        .returning();
      await audit(tx, admin, "onboarding.signup", "onb_signup", row.id, { instituteType: d.signup.instituteType, city: d.signup.city, seeded: true });
    });
    return { id: created.universityId, adminId: created.userId };
  } catch (e) {
    console.warn(`  Skipped ${d.name}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

async function ensureDocuments(universityId: string, adminId: string, d: DemoInstitute) {
  const admin = await loadActor(adminId, universityId, { session: null });
  const have = await listDocuments(admin);
  for (const doc of d.documents) {
    if (have.some((h) => h.kind === doc.kind)) continue;
    const body = demoPdf(`${d.name} ${doc.fileName}`);
    const started = await startDocumentUpload(admin, { kind: doc.kind, fileName: doc.fileName, size: body.byteLength, contentType: "application/pdf" });
    await putDocumentPart(admin, started.documentId, 0, body);
    await finishDocumentUpload(admin, started.documentId);
  }
}

export async function seed(ctx: SeedContext) {
  const today = ctx.today;

  const sunrise: DemoInstitute = {
    name: "Sunrise Academy",
    slug: "sunrise-academy",
    legalName: "Sunrise Education Services LLP",
    address: "2nd floor, Kothrud Business Centre, Paud Road, Pune 411038",
    stateCode: "27",
    gstin: "27AAPFS1234K1Z3",
    admin: { name: "Anita Kulkarni", email: "anita@sunrise-academy.in" },
    signup: { instituteType: "coaching", city: "Pune", phone: "+919820011001", source: "book-a-demo" },
    documents: [
      { kind: "pan", fileName: "Sunrise PAN card.pdf" },
      { kind: "gst_certificate", fileName: "GST registration certificate.pdf" },
    ],
  };
  const lakeview: DemoInstitute = {
    name: "Lakeview Coaching",
    slug: "lakeview-coaching",
    legalName: "Lakeview Coaching Classes",
    address: "14 Lake Road, near Ulsoor Lake, Bengaluru 560008",
    stateCode: "29",
    gstin: null,
    admin: { name: "Farhan Sheikh", email: "farhan@lakeview-coaching.in" },
    signup: { instituteType: "coaching", city: "Bengaluru", phone: "+919845012345", source: "signup" },
    documents: [{ kind: "pan", fileName: "PAN - Farhan Sheikh.pdf" }],
  };

  const s = await ensureInstitute(sunrise, today);
  if (s) {
    await ensureDocuments(s.id, s.adminId, sunrise);
    await setTrialState(systemActorFor(s.id), s.id, { status: "active", trialEndsAt: addDays(today, 2) });
  }

  const l = await ensureInstitute(lakeview, today);
  if (l) {
    await ensureDocuments(l.id, l.adminId, lakeview);
    const system = systemActorFor(l.id);
    await setTrialState(system, l.id, { status: "active", trialEndsAt: addDays(today, -1) });
    await freezeIfTrialOver(system);
  }

  // Riya has done her KYC at the Demo University; everyone else is asked to.
  const riya = await ctx.actorFor("riya@demo.edu").catch(() => null);
  if (riya && !(await kycStatus(riya)).done) await saveKyc(riya, { pan: "BXRPS4821K", aadhaarLast4: "4821", consent: true });

  console.log(`  ${[s && "Sunrise Academy (in trial)", l && "Lakeview Coaching (frozen)"].filter(Boolean).join(", ") || "no institutes"}; KYC for riya@demo.edu`);
}
