import { describe, expect, it } from "vitest";
import { fill, unknownVariables } from "@/modules/notifications-delivery/render";

describe("template variable names", () => {
  it("fills {{institute}}", () => {
    expect(fill("{{institute}}: {{title}}", { institute: "Alpha Institute", title: "Class moved" })).toBe("Alpha Institute: Class moved");
  });

  it("still fills {{university}} in templates saved before the rename", () => {
    expect(fill("{{university}}: {{title}}", { institute: "Alpha Institute", title: "Class moved" })).toBe("Alpha Institute: Class moved");
  });

  it("accepts both names and still catches typos", () => {
    expect(unknownVariables("{{institute}} {{university}}")).toEqual([]);
    expect(unknownVariables("{{institue}}")).toEqual(["institue"]);
  });
});
