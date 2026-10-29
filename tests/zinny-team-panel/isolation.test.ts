/** Tenant isolation for every plat_ table with university_id, and no app access to Zinny's own tables. */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { courses } from "@/db/schema";
import { systemActorFor } from "@/server/actor";
import { withTenant } from "@/server/tenant";
import { platAlerts, platContentFlags, platCourseReviews, platInvoices, platLicences } from "@/modules/zinny-team-panel/schema";
import { expectTenantIsolated } from "../helpers/isolation";
import { makeDepartment, makeUniversity, uniqueCode } from "../fixtures";

afterAll(closeDb);

async function course(universityId: string) {
  const d = await makeDepartment(universityId, uniqueCode(), "Dept");
  const [c] = await systemDb().insert(courses).values({ universityId, departmentId: d.id, title: "Isolated course" }).returning();
  return c.id;
}

describe("plat_ tables are isolated per university", () => {
  it("plat_licences", () =>
    // Postgres checks row-level security before the one-licence-per-university index, so B's insert is refused by RLS.
    expectTenantIsolated(platLicences, (uni) => ({ universityId: uni.id, plan: "pilot" as const, studentCap: 10, staffCap: 5, startDate: "2026-01-01", endDate: "2026-12-31" })));
  it("plat_alerts", () => expectTenantIsolated(platAlerts, (uni) => ({ universityId: uni.id, kind: uniqueCode("k"), level: "warning", title: "Warning" })));
  it("plat_course_reviews", () => expectTenantIsolated(platCourseReviews, async (uni) => ({ universityId: uni.id, courseId: await course(uni.id) })));
  it("plat_content_flags", () =>
    expectTenantIsolated(platContentFlags, async (uni) => ({ universityId: uni.id, courseId: await course(uni.id), category: "quality", note: "Note" })));
  it("plat_invoices", () =>
    expectTenantIsolated(platInvoices, (uni) => ({
      universityId: uni.id,
      number: uniqueCode("Z"),
      financialYear: "26-27",
      periodStart: "2026-04-01",
      periodEnd: "2027-03-31",
      description: "Licence",
      basePaise: 100,
      gstRateBp: 1800,
      igstPaise: 18,
      totalPaise: 118,
      issueDate: "2026-10-01",
      dueDate: "2026-10-16",
      sellerName: "Zinny",
      sellerStateCode: "27",
      buyerName: "U",
      buyerStateCode: "29",
    })));

  it("Zinny's own tables (partners, contacts, notes, invoice counters) are closed to the app role", async () => {
    const U = await makeUniversity("Closed U");
    for (const t of ["plat_partners", "plat_partner_contacts", "plat_partner_notes", "plat_invoice_counters"]) {
      const err = await withTenant(systemActorFor(U.id), (tx) => tx.execute(sql`select 1 from ${sql.identifier(t)} limit 1`)).then(
        () => null,
        (e: Error & { cause?: Error }) => e.cause?.message ?? e.message,
      );
      expect(err, t).toMatch(/permission denied/);
    }
  });
});
