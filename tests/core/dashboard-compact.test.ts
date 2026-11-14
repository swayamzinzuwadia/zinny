import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { todayFor, universityLite, withTenant, systemActorFor } from "@/server/core";
import assessments from "@/modules/assessments";
import assignmentsPolls from "@/modules/assignments-polls";
import certificates from "@/modules/certificates";
import marketplace from "@/modules/marketplace";
import payments from "@/modules/payments";
import websiteBuilder from "@/modules/website-builder";
import gamification from "@/modules/gamification";
import { makeDepartment, makeUniversity, person } from "../fixtures";

afterAll(closeDb);

/** The admin dashboard folds module cards into "Needs you" and "This month" (contracts.md section 3). */
describe("dashboard: compact slot forms", () => {
  it("modules that used to fill a whole card now offer a compact form", () => {
    const has = (m: { dashboardCards?: { key: string; needsYou?: unknown; thisMonth?: unknown }[] }, key: string) => {
      const e = m.dashboardCards?.find((c) => c.key === key);
      return [!!e?.needsYou, !!e?.thisMonth];
    };
    expect(has(assignmentsPolls, "to-grade-assignments")).toEqual([true, false]);
    expect(has(assessments, "to-grade-tests")).toEqual([true, false]);
    expect(has(websiteBuilder, "website")).toEqual([true, false]);
    expect(has(payments, "refunds-due")).toEqual([true, false]);
    expect(has(certificates, "certificates-issued")).toEqual([true, true]);
    expect(has(marketplace, "marketplace-sales")).toEqual([false, true]);
    // Top learners keeps its own small card.
    expect(has(gamification, "top-learners")).toEqual([false, false]);
  });

  it("website rows: shown to people who manage the site, empty for faculty; nothing waiting means no rows", async () => {
    const u = await makeUniversity("Compact Dashboard University");
    const dept = await makeDepartment(u.id, "CS", "Computer Science");
    const admin = await (await person("Ada Admin", "institute_admin", { universityId: u.id })).actor();
    const faculty = await (await person("Fay Faculty", "permanent_faculty", { departmentId: dept.id, universityId: u.id })).actor();
    const sys = await systemActorFor(u.id);
    const [university, today] = await withTenant(sys, async (tx) => [await universityLite(tx), await todayFor(tx)] as const);
    const rows = websiteBuilder.dashboardCards!.find((c) => c.key === "website")!.needsYou!;
    const forAdmin = await rows({ uni: u.slug, actor: admin, university, today });
    // A new institute's website isn't published yet: one row, one link, nothing else.
    expect(forAdmin.map((r) => [r.key, r.link])).toEqual([["page", "Open builder"]]);
    expect(await rows({ uni: u.slug, actor: faculty, university, today })).toEqual([]);
  });
});
