import { randomUUID } from "node:crypto";
import { afterAll, describe, it } from "vitest";
import { closeDb, systemDb } from "@/db/client";
import { courses } from "@/db/schema";
import { newCode } from "@/modules/certificates/lib";
import { certCertificates, certRules, certTemplates } from "@/modules/certificates/schema";
import { expectTenantIsolated } from "../helpers/isolation";
import { makeDepartment, uniqueCode } from "../fixtures";

afterAll(closeDb);

async function template(universityId: string) {
  const [t] = await systemDb().insert(certTemplates).values({ universityId, name: "Classic", design: "classic" }).returning();
  return t;
}

describe("certificates tables are isolated per university", () => {
  it("cert_templates", () => expectTenantIsolated(certTemplates, (uni) => ({ universityId: uni.id, name: "Classic", design: "classic" as const })));

  it("cert_rules", () =>
    expectTenantIsolated(certRules, async (uni) => {
      const dept = await makeDepartment(uni.id, uniqueCode(), "Computer Science");
      const [course] = await systemDb().insert(courses).values({ universityId: uni.id, departmentId: dept.id, title: "Python Basics" }).returning();
      return { universityId: uni.id, courseId: course.id, templateId: (await template(uni.id)).id, autoIssue: true };
    }));

  it("cert_certificates", () =>
    expectTenantIsolated(certCertificates, async (uni) => {
      const t = await template(uni.id);
      const code = newCode();
      return {
        universityId: uni.id,
        code,
        userId: randomUUID(),
        enrolmentId: randomUUID(),
        courseId: randomUUID(),
        batchId: randomUUID(),
        departmentId: randomUUID(),
        templateId: t.id,
        source: "automatic" as const,
        studentName: "Riya Sharma",
        courseTitle: "Python Basics",
        universityName: uni.name,
        template: { design: "classic" as const, heading: "Certificate of completion", intro: "This is to certify that", body: "has completed", signatories: [], accentColor: "#0b5e4c" },
        completedOn: "2026-10-01",
        issuedOn: "2026-10-01",
        pdfKey: `${uni.id}/certificates/issued/x/certificate-${code}.pdf`,
        pdfSha256: "0".repeat(64),
        pdfBytes: 1,
      };
    }));
});
