/** The Staff page shows teaching and administration as one list: nobody twice, nobody lost. */
import { describe, expect, it } from "vitest";
import { mergePeople } from "@/app/[uni]/admin/users/[group]/merge-people";

const p = (id: string, name: string, ...roles: string[]) => ({ id, name, roles });

describe("one staff list from the teaching and administration lists", () => {
  const teaching = [p("h", "Hema Head", "hod"), p("f", "Farah Faculty", "permanent_faculty"), p("a", "Asha Admin", "hod")];
  const administration = [p("a", "Asha Admin", "institute_admin"), p("b", "Bharat Board", "board_owner")];
  const all = mergePeople([
    ["teaching", teaching],
    ["administration", administration],
  ] as const);

  it("lists everyone once, by name", () => {
    expect(all.map((x) => x.name)).toEqual(["Asha Admin", "Bharat Board", "Farah Faculty", "Hema Head"]);
  });
  it("someone on both lists keeps both roles and counts under both filters", () => {
    const asha = all.find((x) => x.id === "a")!;
    expect(asha.roles).toEqual(["hod", "institute_admin"]);
    expect([...asha.kinds].sort()).toEqual(["administration", "teaching"]);
    expect(all.filter((x) => x.kinds.has("teaching")).map((x) => x.id).sort()).toEqual(["a", "f", "h"]);
    expect(all.filter((x) => x.kinds.has("administration")).map((x) => x.id).sort()).toEqual(["a", "b"]);
  });
  it("doesn't change the lists it was given", () => {
    expect(teaching.find((x) => x.id === "a")!.roles).toEqual(["hod"]);
  });
  it("one list in, the same people out (a HOD sees only teaching)", () => {
    expect(mergePeople([["teaching", teaching]] as const).map((x) => x.id)).toEqual(["a", "f", "h"]);
    expect(mergePeople([])).toEqual([]);
  });
});
