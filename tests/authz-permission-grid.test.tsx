import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GridLegend, PermissionGrid, layoutGrid, togetherHint, type GridItem } from "@/components/permission-grid";
import { RoleEditor, RolesExplorer } from "@/components/roles-explorer";
import type { FormAction } from "@/components/forms";
import { GRID_COLUMNS, INSTITUTE_ABILITIES, PLATFORM_ABILITIES, abilitiesFor, gridPlace, type Ability } from "@/server/authz/abilities";
import { abilityOptions, platformRoleSummaries, roleSummaries, type AbilityOption } from "@/server/authz/capabilities";

const CATALOGUES = { institute: INSTITUTE_ABILITIES, platform: PLATFORM_ABILITIES };
const asItem = (a: Ability): GridItem => ({ key: a.key, label: a.label, ...gridPlace(a), locked: a.locked });
const bySection = (list: readonly Ability[]) => [...new Set(list.map((a) => a.section))].map((s) => [s, list.filter((a) => a.section === s)] as const);

/** Which ability fills each cell of a section's grid: "Courses/view" → "courses.view". */
function cells(list: readonly Ability[]) {
  const out = new Map<string, string>();
  for (const a of list) {
    const { rows, cols } = gridPlace(a);
    for (const r of rows) for (const c of cols) out.set(`${r}/${c}`, a.key);
  }
  return out;
}

const inputs = (html: string) => [...html.matchAll(/<input[^>]*>/g)].map((m) => m[0]).filter((tag) => tag.includes('name="ability"'));
const valueOf = (tag: string) => /value="([^"]+)"/.exec(tag)![1];
/** The ability keys the markup would post if everything were ticked, in order. */
const posted = (html: string) => inputs(html).map(valueOf);
/** The ability keys ticked in the markup. */
const ticked = (html: string) => inputs(html).filter((tag) => tag.includes('checked=""')).map(valueOf);

const noop: FormAction = async () => null;
const html = (node: ReactNode) => renderToStaticMarkup(<>{node}</>);

describe("where each ability sits in the grid", () => {
  it.each(Object.entries(CATALOGUES))("gives every %s ability a row and at least one column", (_, list) => {
    for (const a of list) {
      const { rows, cols } = gridPlace(a);
      expect(rows.length, a.key).toBeGreaterThan(0);
      expect(rows.every((r) => r.trim().length > 0), a.key).toBe(true);
      expect(cols.length, a.key).toBeGreaterThan(0);
      expect(cols.every((c) => GRID_COLUMNS.includes(c)), a.key).toBe(true);
      expect(a.row, `${a.key} should name its row`).toBeTruthy();
      expect(a.cols?.length, `${a.key} should name its columns`).toBeGreaterThan(0);
    }
  });

  it.each(Object.entries(CATALOGUES))("never puts two %s abilities in the same cell", (_, list) => {
    for (const [section, abilities] of bySection(list)) {
      const seen = new Map<string, string>();
      for (const a of abilities) {
        const { rows, cols } = gridPlace(a);
        for (const r of rows)
          for (const c of cols) {
            const other = seen.get(`${r}/${c}`);
            expect(other === undefined || other === a.key, `${section}: ${r} / ${c} is claimed by ${other} and ${a.key}`).toBe(true);
            seen.set(`${r}/${c}`, a.key);
          }
      }
      // Laid out, every row is a real row: nothing had to be moved to a row of its own.
      const names = new Set(abilities.flatMap((a) => gridPlace(a).rows));
      expect(layoutGrid(abilities.map(asItem)).map((r) => r.name).sort()).toEqual([...names].sort());
    }
  });

  it("puts courses, batches and their deleting where people look for them", () => {
    const grid = cells(INSTITUTE_ABILITIES);
    expect(grid.get("Courses/view")).toBe("courses.view");
    expect(grid.get("Batches/view")).toBe("courses.view");
    expect(grid.get("Courses/edit")).toBe("courses.edit");
    expect(grid.get("Courses/delete")).toBe("courses.delete");
    expect(grid.get("Batches/edit")).toBe("batches.edit");
    expect(grid.get("Batches/delete")).toBe("batches.delete");
    expect(grid.get("Tests/view")).toBe("tests.results");
    expect(grid.get("Tests/edit")).toBe("tests.manage");
    expect(grid.get("Tests/delete")).toBe("tests.manage");
    expect(grid.get("People/edit")).toBe("people.roles");
    expect(grid.get("Refunds/edit")).toBe("finance.refund");
    expect(cells(PLATFORM_ABILITIES).get("Support mode/edit")).toBe("platform.support");
  });

  it("puts read-only abilities in View and nowhere else", () => {
    for (const a of [...INSTITUTE_ABILITIES, ...PLATFORM_ABILITIES]) {
      const { cols } = gridPlace(a);
      if (a.readOnly) expect(cols, a.key).toEqual(["view"]);
      else expect(cols, a.key).not.toContain("view");
    }
  });

  it("joins every ability that adds, edits and deletes in one switch", () => {
    for (const key of ["tests.manage", "assignments.manage", "content.manage", "website.manage", "programs.manage", "certificates.manage", "finance.manage", "community.manage", "leaderboard.manage", "departments.manage"]) {
      expect(gridPlace(INSTITUTE_ABILITIES.find((a) => a.key === key)!).cols, key).toEqual(["edit", "delete"]);
    }
  });

  it("still shows an ability that says nothing about the grid, in a row of its own", () => {
    expect(gridPlace({ label: "Accept students" })).toEqual({ rows: ["Accept students"], cols: ["edit"] });
    expect(gridPlace({ label: "See join requests", readOnly: true })).toEqual({ rows: ["See join requests"], cols: ["view"] });
    expect(gridPlace({ label: "Approve enrolments", row: "Enrolments", cols: [] })).toEqual({ rows: ["Enrolments"], cols: ["edit"] });
  });
});

describe("laying out the grid", () => {
  const item = (key: string, rows: string[], cols: GridItem["cols"], extra: Partial<GridItem> = {}): GridItem => ({ key, label: key, rows, cols, ...extra });

  it("orders rows as they first appear and joins one ability's neighbouring columns", () => {
    const rows = layoutGrid([item("v", ["Tests"], ["view"]), item("m", ["Tests"], ["edit", "delete"]), item("g", ["Test grading"], ["edit"])]);
    expect(rows.map((r) => r.name)).toEqual(["Tests", "Test grading"]);
    expect(rows[0].cells.map((c) => [c.cols, c.item?.key ?? null])).toEqual([
      [["view"], "v"],
      [["edit", "delete"], "m"],
    ]);
    expect(rows[1].cells.map((c) => [c.cols, c.item?.key ?? null])).toEqual([
      [["view"], null],
      [["edit"], "g"],
      [["delete"], null],
    ]);
    expect(rows[1].hint).toBe("g");
    expect(rows[0].hint).toBeUndefined();
  });

  it("moves an ability that would land on another's tick to a row of its own, instead of hiding it", () => {
    const rows = layoutGrid([item("a", ["People"], ["edit"]), item("Accept students", ["People"], ["edit"])]);
    expect(rows.map((r) => r.name)).toEqual(["People", "Accept students"]);
    expect(rows[1].cells.find((c) => c.item)?.item?.key).toBe("Accept students");
  });

  it("says when ticks go together", () => {
    expect(togetherHint(["edit", "delete"])).toBe("Add, edit and delete go together.");
    expect(togetherHint(["view", "edit"])).toBe("View, add and edit go together.");
  });

  it("notes a locked ability on its row", () => {
    const rows = layoutGrid([item("people.view", ["People"], ["view"]), item("people.roles", ["People"], ["edit"], { label: "Add teachers in their department", locked: true })]);
    expect(rows[0].hint).toBe("Always part of this role: add teachers in their department.");
  });
});

describe("the grid's markup", () => {
  const options = abilityOptions(false);
  const products = options.filter((o) => o.section === "products");

  it("posts each ticked box as an ability, with joined ticks as one box", () => {
    const out = html(<PermissionGrid items={products} on={new Set(["tests.manage"])} onChange={() => {}} label="Products" />);
    const keys = posted(out);
    // courses.view shows on both Courses and Batches; everything else once.
    expect(keys.filter((k) => k === "courses.view")).toHaveLength(2);
    expect(new Set(keys)).toEqual(new Set(products.map((o) => o.key)));
    expect(keys.length).toBe(products.length + 1);
    expect(ticked(out)).toEqual(["tests.manage"]);
    expect(out).toContain("Create tests. Add, edit and delete go together.");
    for (const head of ["View", "Add / Edit", "Delete"]) expect(out).toContain(`>${head}</th>`);
  });

  it("shows a dash where there is nothing to set", () => {
    const out = html(<PermissionGrid items={products.filter((o) => o.key === "teach")} on={new Set()} onChange={() => {}} label="Products" />);
    expect(out.match(/>—</g)).toHaveLength(2);
    expect(out).toContain("Teach batches");
  });

  it("has no boxes to tick when read only", () => {
    const out = html(<PermissionGrid items={products} on={new Set(["courses.view"])} label="Products" />);
    expect(out).not.toContain("<input");
    expect(out).toContain("View courses and batches: yes");
    expect(out).toContain("Delete courses: no");
  });

  it("explains its marks", () => {
    expect(html(<GridLegend />)).toContain("One switch for both");
    expect(html(<GridLegend locked />)).toContain("Always part of this role");
  });
});

describe("the role editor", () => {
  const editor = (role: Parameters<typeof RoleEditor>[0]["role"], options: AbilityOption[], kinds: Parameters<typeof RoleEditor>[0]["kinds"] = []) =>
    html(<RoleEditor role={role} options={options} kinds={kinds} titles={{}} save={noop} onCancel={() => {}} onDone={() => {}} />);

  it("offers a department role only what works in a department", () => {
    const hod = roleSummaries().find((r) => r.key === "hod")!;
    const keys = new Set(posted(editor(hod, abilityOptions(false))));
    expect(keys).toEqual(new Set(abilitiesFor("hod").map((a) => a.key)));
    for (const k of ["finance.view", "website.manage", "people.import", "settings.manage"]) expect(keys.has(k), k).toBe(false);
  });

  it("shows a Head of Department's locked right with a lock, never as a box to tick", () => {
    const hod = roleSummaries().find((r) => r.key === "hod")!;
    const out = editor(hod, abilityOptions(false));
    expect(posted(out)).not.toContain("people.roles");
    expect(out).toContain("Add teachers in their department. Always part of this role.");
    expect(out).toContain("Always part of this role: add teachers in their department.");
  });

  it("ticks what the role already has", () => {
    const faculty = roleSummaries().find((r) => r.key === "visiting_faculty")!;
    const out = editor(faculty, abilityOptions(false));
    expect(new Set(ticked(out))).toEqual(new Set(faculty.on));
    expect(posted(out)).not.toContain("courses.edit");
  });

  it("names a new role and asks how far it reaches", () => {
    const out = editor(null, abilityOptions(false), [
      { kind: "custom_institute", label: "Whole institute", hint: "Works across every department.", reach: "institute" },
      { kind: "custom_department", label: "One department", hint: "Works only in the department you give it for.", reach: "department" },
    ]);
    expect(out).toContain('name="name"');
    expect(out).toContain("How far it reaches");
    expect(out).toContain("Create role");
    expect(new Set(posted(out))).toEqual(new Set(abilitiesFor("custom_institute").map((a) => a.key)));
  });

  it("lays out the Zinny team's abilities too, without the ones that aren't offered", () => {
    const finance = platformRoleSummaries().find((r) => r.key === "finance_admin")!;
    const out = editor(finance, abilityOptions(true));
    expect(new Set(posted(out))).toEqual(new Set(PLATFORM_ABILITIES.filter((a) => !a.hidden).map((a) => a.key)));
    expect(out).toContain("Manage licences");
    // Partners left the team panel.
    expect(out).not.toContain("Manage sponsors and partners");
  });
});

describe("the roles page", () => {
  it("shows the first role as a read-only grid, and the comparison", () => {
    const out = html(
      <RolesExplorer
        roles={roleSummaries()}
        options={abilityOptions(false)}
        kinds={[]}
        peopleHref={{ administration: "/a", teaching: "/t", team: "/" }}
        actions={{ save: noop, reset: noop, remove: noop }}
      />,
    );
    expect(posted(out)).toEqual([]);
    expect(out).toContain("Institute Admin");
    expect(out).toContain(">Courses</span>");
    expect(out).toContain("Compare roles");
  });
});
