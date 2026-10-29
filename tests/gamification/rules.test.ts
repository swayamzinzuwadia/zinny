import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { createRule, listRules, setRuleActive, updateRule } from "@/modules/gamification/rules";
import { world, type World } from "./world";

let w: World;
beforeAll(async () => {
  w = await world("Rules University");
});
afterAll(closeDb);

describe("XP rules: who may create and change them", () => {
  it("an institute admin can create a university-wide rule", async () => {
    const r = await createRule(w.admin, { name: "Lesson finished", trigger: "lesson", points: 10, dailyCap: 10 });
    expect(r).toMatchObject({ departmentId: null, eventType: "lesson.completed", condition: "none", points: 10, dailyCap: 10, active: true });
  });

  it("a HOD can't create a university-wide rule", async () => {
    await expect(createRule(w.hod, { name: "Everyone", trigger: "lesson", points: 10 })).rejects.toThrow(/Only an institute admin/);
    await expect(createRule(w.hod, { name: "Everyone", trigger: "lesson", points: 10, departmentId: "" })).rejects.toThrow(/Only an institute admin/);
  });

  it("a HOD can create a rule for their own department, but not another one", async () => {
    const r = await createRule(w.hod, { name: "CS test", trigger: "test-score", minScore: 85, points: 25, departmentId: w.dept.id });
    expect(r).toMatchObject({ departmentId: w.dept.id, condition: "min_score", minScore: 85 });
    await expect(createRule(w.hod, { name: "MKT test", trigger: "lesson", points: 5, departmentId: w.mkt.id })).rejects.toThrow(/access/);
  });

  it("faculty and students can't create rules", async () => {
    await expect(createRule(w.faculty, { name: "Mine", trigger: "lesson", points: 5, departmentId: w.dept.id })).rejects.toThrow(/access/);
    const s = await w.student("Rule Student");
    await expect(createRule(s, { name: "Mine", trigger: "lesson", points: 5 })).rejects.toThrow();
  });

  it("only the right people can edit or turn off a rule", async () => {
    const all = await createRule(w.admin, { name: "Passed", trigger: "test-passed", points: 50 });
    const cs = await createRule(w.hod, { name: "CS lesson", trigger: "lesson", points: 5, departmentId: w.dept.id });
    await expect(updateRule(w.hod, all.id, { name: "Passed", points: 500 })).rejects.toThrow(/Only an institute admin/);
    await expect(setRuleActive(w.hod, all.id, false)).rejects.toThrow(/Only an institute admin/);
    await expect(updateRule(w.hodMkt, cs.id, { name: "Hacked", points: 1 })).rejects.toThrow(/access/);
    await expect(updateRule(w.hod, cs.id, { name: "CS lesson", points: 8, dailyCap: 4 })).resolves.toMatchObject({ points: 8, dailyCap: 4 });
    await expect(setRuleActive(w.hod, cs.id, false)).resolves.toMatchObject({ active: false });
    await expect(updateRule(w.admin, all.id, { name: "Passed a test", points: 60 })).resolves.toMatchObject({ name: "Passed a test", points: 60 });
  });

  it("explains what is wrong with a rule", async () => {
    await expect(createRule(w.admin, { name: "x", trigger: "lesson", points: 5 })).rejects.toThrow(/name between 2 and 80/);
    await expect(createRule(w.admin, { name: "Zero", trigger: "lesson", points: 0 })).rejects.toThrow(/1 to 1000/);
    await expect(createRule(w.admin, { name: "Fraction", trigger: "lesson", points: 2.5 })).rejects.toThrow(/whole number/);
    await expect(createRule(w.admin, { name: "Cap", trigger: "lesson", points: 5, dailyCap: 0 })).rejects.toThrow(/daily cap/);
    await expect(createRule(w.admin, { name: "No score", trigger: "test-score", points: 5 })).rejects.toThrow(/minimum score/);
    await expect(createRule(w.admin, { name: "Score", trigger: "assignment-score", minScore: 101, points: 5 })).rejects.toThrow(/minimum score/);
    await expect(createRule(w.admin, { name: "Unknown", trigger: "logged-in", points: 5 })).rejects.toThrow(/what earns XP/);
    // A score on a trigger that doesn't use one is ignored.
    await expect(createRule(w.admin, { name: "Lesson", trigger: "lesson", minScore: 50, points: 5 })).resolves.toMatchObject({ minScore: null });
  });
});

describe("XP rules: who sees them", () => {
  it("a HOD sees university-wide rules and their own department's, and can manage only their own", async () => {
    const mktRule = await createRule(w.hodMkt, { name: "MKT only", trigger: "lesson", points: 3, departmentId: w.mkt.id });
    const { rules, scopes } = await listRules(w.hod);
    expect(rules.some((r) => r.id === mktRule.id)).toBe(false);
    expect(rules.filter((r) => r.departmentId === null).every((r) => !r.canManage)).toBe(true);
    expect(rules.filter((r) => r.departmentId === w.dept.id).every((r) => r.canManage)).toBe(true);
    expect(scopes.universityWide).toBe(false);
    expect(scopes.departments.map((d) => d.id)).toEqual([w.dept.id]);
  });

  it("an admin sees and manages every rule", async () => {
    const { rules, scopes } = await listRules(w.admin);
    expect(rules.some((r) => r.departmentId === w.mkt.id)).toBe(true);
    expect(rules.every((r) => r.canManage)).toBe(true);
    expect(scopes.universityWide).toBe(true);
  });

  it("faculty see the rules that apply to their batches, read only", async () => {
    const { rules, scopes } = await listRules(w.faculty);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((r) => r.departmentId === null || r.departmentId === w.dept.id)).toBe(true);
    expect(rules.every((r) => !r.canManage)).toBe(true);
    expect(scopes).toEqual({ universityWide: false, departments: [] });
  });

  it("students can't open the staff rules list", async () => {
    await expect(listRules(await w.student("Peeking Student"))).rejects.toThrow(/access/);
  });
});
