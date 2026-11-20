/**
 * Global search in the Zinny team panel: page and keyword lookup, ranking, and what each
 * role gets. Pages are pure; the grouped search runs against a real database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import type { Actor } from "@/server/authz/engine";
import { ForbiddenError } from "@/server/errors";
import { rankInstitutes } from "@/modules/zinny-team-panel/components/institute-rank";
import { pagesFor, searchPages, suggestedPages } from "@/modules/zinny-team-panel/lib/search-index";
import { createInvoice } from "@/modules/zinny-team-panel/services/billing";
import { globalSearch } from "@/modules/zinny-team-panel/services/search";
import { person, setupCourse } from "../fixtures";
import { team } from "./helpers";

afterAll(closeDb);

let sa: Actor, qa: Actor, fin: Actor, am: Actor, student: Actor;
let uniName: string;
let courseTitle: string;

const kinds = (g: { kind: string }[]) => g.map((x) => x.kind);

beforeAll(async () => {
  [sa, qa, fin, am] = await Promise.all([team("Srch Super", "super_admin"), team("Srch QA", "content_qa"), team("Srch Finance", "finance_admin"), team("Srch Manager", "account_manager")]);
  const c = await setupCourse({ name: "Zebra Lakeside Academy" });
  uniName = c.uni.name;
  courseTitle = c.course.title;
  student = await (await person("Srch Student", "student", { universityId: c.uni.id })).actor();
  await createInvoice(fin, {
    universityId: c.uni.id,
    periodStart: "2026-04-01",
    periodEnd: "2027-03-31",
    description: "Annual licence",
    basePaise: 100000,
    gstRateBp: 1800,
    issueDate: "2026-04-01",
    dueDate: "2026-04-15",
  });
});

describe("keyword lookup", () => {
  const pages = () => pagesFor(sa);
  const top = (q: string) => searchPages(pages(), q).map((p) => p.href);

  it("finds Billing settings for gst and seat packs", () => {
    expect(top("gst")).toContain("/platform/billing/settings");
    expect(top("seat")).toContain("/platform/billing/settings");
    expect(top("pack")).toContain("/platform/billing/settings");
  });
  it("finds Sign-ups for kyc, pan and trial", () => {
    expect(top("kyc")[0]).toBe("/platform/signups");
    expect(top("pan")).toContain("/platform/signups");
    expect(top("trial")).toContain("/platform/signups");
  });
  it("finds the right page for dpdp, consent, breach, role and refund", () => {
    expect(top("breach")[0]).toBe("/platform/privacy/breaches");
    expect(top("consent")).toContain("/platform/privacy");
    expect(top("dpdp")).toEqual(expect.arrayContaining(["/platform/privacy", "/platform/privacy/breaches"]));
    expect(top("permission")).toContain("/platform/roles");
    expect(top("refund")).toContain("/platform/billing");
    expect(top("suspend")).toContain("/platform/institutes");
  });
  it("puts a label that starts with the word first", () => {
    expect(searchPages(pages(), "inv")[0].label).toBe("Invoices");
  });
  it("returns nothing for an empty query or nonsense", () => {
    expect(searchPages(pages(), "  ")).toEqual([]);
    expect(searchPages(pages(), "qqzzxx")).toEqual([]);
  });
});

describe("ranking", () => {
  it("puts prefix matches before word and substring matches", () => {
    const rows = [
      { name: "Blake Institute", slug: "x3" },
      { name: "Old Lake College", slug: "x2" },
      { name: "Lakeside Arts", slug: "x1" },
    ];
    expect(rankInstitutes(rows, "lake").map((r) => r.name)).toEqual(["Lakeside Arts", "Old Lake College", "Blake Institute"]);
  });
});

describe("what each role is offered", () => {
  it("gives content QA content review but no invoices, people or institutes", () => {
    const labels = pagesFor(qa).map((p) => p.label);
    expect(labels).toContain("Content review");
    expect(labels).not.toContain("Invoices");
    expect(labels).not.toContain("Users");
    expect(labels).not.toContain("Institutes");
    expect(searchPages(pagesFor(qa), "gst").map((p) => p.href)).not.toContain("/platform/billing");
  });
  it("gives finance invoices and billing settings", () => {
    const labels = pagesFor(fin).map((p) => p.label);
    expect(labels).toEqual(expect.arrayContaining(["Invoices", "Billing settings", "New invoice"]));
    expect(labels).not.toContain("Users");
  });
  it("suggests only pages the person can open", () => {
    const hrefs = suggestedPages(pagesFor(qa)).map((p) => p.href);
    expect(hrefs).toContain("/platform/content");
    expect(hrefs).not.toContain("/platform/billing");
  });
});

describe("grouped search", () => {
  it("content QA finds courses but never invoices, people, plans or institutes", async () => {
    expect(kinds(await globalSearch(qa, courseTitle.slice(0, 6)))).toContain("course");
    const all = await globalSearch(qa, "Zebra");
    for (const k of ["person", "invoice", "institute", "plan"]) expect(kinds(all)).not.toContain(k);
  });
  it("finance finds invoices by institute name, but not people or courses", async () => {
    const g = await globalSearch(fin, "Zebra Lakeside");
    expect(kinds(g)).toContain("invoice");
    expect(kinds(g)).not.toContain("person");
    expect(kinds(g)).not.toContain("course");
  });
  it("a Super Admin finds institutes, people and plans, each group capped", async () => {
    const inst = await globalSearch(sa, uniName.slice(0, 8));
    expect(inst.find((x) => x.kind === "institute")?.hits[0].href).toMatch(/^\/platform\/institutes\//);
    const ppl = await globalSearch(sa, "Srch Student");
    const hit = ppl.find((x) => x.kind === "person")?.hits[0];
    expect(hit?.href).toMatch(/^\/platform\/people\//);
    expect(hit?.tag).toMatch(/Student/);
    const plans = await globalSearch(sa, "standard");
    expect(plans.find((x) => x.kind === "plan")?.hits.length).toBeGreaterThan(0);
    for (const group of await globalSearch(sa, "a")) expect(group.hits.length).toBeLessThanOrEqual(6);
  });
  it("an account manager finds institutes but not invoices", async () => {
    const g = await globalSearch(am, "Zebra");
    expect(kinds(g)).toContain("institute");
    expect(kinds(g)).not.toContain("invoice");
  });
  it("with nothing typed, offers suggested pages", async () => {
    const g = await globalSearch(sa, "");
    expect(g[0].label).toBe("Suggested pages");
    expect(g[0].hits.length).toBeGreaterThan(0);
  });
  it("refuses someone who is not on the Zinny team", async () => {
    await expect(globalSearch(student, "zebra")).rejects.toBeInstanceOf(ForbiddenError);
  });
});
