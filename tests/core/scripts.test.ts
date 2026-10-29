import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { allowedPrefixes, isAllowed, violations, type Ownership } from "../../scripts/check-ownership";
import { dbNamesFor, renderEnvLocal } from "../../scripts/agent-setup";
import { renderRegistry } from "../../scripts/gen-registry";
import { MODULE_IDS } from "@/contracts/module";

const ownership = JSON.parse(readFileSync("docs/plan/ownership.json", "utf8")) as Ownership;

describe("check:ownership", () => {
  it("knows every module agent, and ModuleId matches ownership.json", () => {
    expect(Object.values(ownership.agents).map((a) => a.module).sort()).toEqual([...MODULE_IDS].sort());
  });

  it("allows the agent's own prefixes, shared files, its tests and its handoff, matching brackets literally", () => {
    const p = allowedPrefixes(ownership, "live-classes");
    const ok = [
      "src/modules/live-classes/service.ts",
      "src/app/[uni]/learn/join/[batchId]/[date]/page.tsx",
      "src/app/[uni]/admin/products/batches/[id]/attendance/page.tsx",
      "package.json",
      "package-lock.json",
      "tests/live-classes/join.test.ts",
      "docs/handoff/live-classes.md",
      "docs/handoff/live-classes/home.png",
    ];
    for (const path of ok) expect([path, isAllowed(path, p)]).toEqual([path, true]);
  });

  it("refuses everything else, including look-alike paths", () => {
    const p = allowedPrefixes(ownership, "live-classes");
    const bad = [
      "src/server/registry.ts",
      "src/db/schema.ts",
      "src/modules/assessments/index.ts",
      "src/modules/live-classes-extra/index.ts",
      "src/app/[uni]/admin/products/batches/[id]/page.tsx",
      "src/app/[uni]/learn/joined/page.tsx",
      "package.json.bak",
      "tests/core/events.test.ts",
      "tests/live-classes.test.ts",
      "docs/handoff/live-classes.md.orig",
      "docs/handoff/assessments.md",
      "CLAUDE.md",
    ];
    expect(violations(bad, p)).toEqual([...bad].sort());
  });

  it("a glob-like prefix is never treated as a pattern", () => {
    expect(isAllowed("src/app/u/learn/join/x", ["src/app/[uni]/learn/join/"])).toBe(false);
  });

  it("rejects unknown agents", () => {
    expect(() => allowedPrefixes(ownership, "nobody")).toThrow(/Unknown agent/);
  });
});

describe("agent:setup", () => {
  it("names databases after the agent", () => {
    expect(dbNamesFor("assignments-polls")).toEqual({ dev: "zinny_assignments_polls", test: "zinny_assignments_polls_test" });
  });

  it("writes AGENT, PORT and the four database URLs", () => {
    const env = renderEnvLocal({
      agent: "assessments",
      port: 3101,
      admin: new URL("postgres://admin:pw@db.local:5433/postgres"),
      dev: "zinny_assessments",
      test: "zinny_assessments_test",
    });
    expect(env).toContain("AGENT=assessments\n");
    expect(env).toContain("PORT=3101\n");
    expect(env).toContain("DATABASE_URL_OWNER=postgres://zinny_owner:zinny@db.local:5433/zinny_assessments\n");
    expect(env).toContain("DATABASE_URL=postgres://zinny_app:zinny_app@db.local:5433/zinny_assessments\n");
    expect(env).toContain("TEST_DATABASE_URL_OWNER=postgres://zinny_owner:zinny@db.local:5433/zinny_assessments_test\n");
    expect(env).toContain("TEST_DATABASE_URL=postgres://zinny_app:zinny_app@db.local:5433/zinny_assessments_test\n");
  });
});

describe("npm run gen", () => {
  it("writes one default import per module", () => {
    const out = renderRegistry(["assessments", "live-classes"]);
    expect(out).toContain('import m_assessments from "@/modules/assessments";');
    expect(out).toContain('import m_live_classes from "@/modules/live-classes";');
    expect(out).toContain('"live-classes": m_live_classes,');
  });
});
