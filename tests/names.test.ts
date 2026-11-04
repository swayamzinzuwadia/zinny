import { describe, expect, it } from "vitest";
import { firstName } from "@/server/lib/names";

describe("firstName", () => {
  it("greets people by their name, not their title", () => {
    expect(firstName("Riya Sharma")).toBe("Riya");
    expect(firstName("Dr. Meera Iyer")).toBe("Meera");
    expect(firstName("Prof Arvind Rao")).toBe("Arvind");
    expect(firstName("  Smt. Lakshmi  Devi ")).toBe("Lakshmi");
    expect(firstName("Neha")).toBe("Neha");
  });

  it("keeps a lone title rather than greeting nobody", () => {
    expect(firstName("Dr.")).toBe("Dr.");
  });
});
