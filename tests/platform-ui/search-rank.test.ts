import { describe, expect, it } from "vitest";
import { highlightParts, rankInstitutes } from "@/modules/zinny-team-panel/components/institute-rank";

const rows = [
  { name: "Northern Arts College", slug: "northern-arts" },
  { name: "Arts and Science Institute", slug: "asi" },
  { name: "Heart of Learning", slug: "hol" },
  { name: "Bright Minds", slug: "arts-bright" },
  { name: "Unrelated School", slug: "unrelated" },
];

describe("institute search ranking", () => {
  it("puts prefix matches first, then word starts, then contains", () => {
    const out = rankInstitutes(rows, "art").map((r) => r.name);
    expect(out).toEqual(["Arts and Science Institute", "Northern Arts College", "Bright Minds", "Heart of Learning"]);
    expect(out).not.toContain("Unrelated School");
  });
  it("ignores case and returns nothing for an empty query", () => {
    expect(rankInstitutes(rows, "BRIGHT")[0].name).toBe("Bright Minds");
    expect(rankInstitutes(rows, "  ")).toEqual([]);
  });
  it("respects the limit", () => expect(rankInstitutes(rows, "a", 2)).toHaveLength(2));
  it("highlights the matched part", () => {
    expect(highlightParts("Heart of Learning", "art")).toEqual([
      { text: "He", hit: false },
      { text: "art", hit: true },
      { text: " of Learning", hit: false },
    ]);
  });
});
