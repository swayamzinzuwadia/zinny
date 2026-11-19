/** The sidebar's Find box and the pages of long lists. */
import { describe, expect, it } from "vitest";
import { findMatches } from "@/app/[uni]/admin/find/match";
import { pageOf } from "@/components/pager";

const people = [
  { name: "Riya Sharma", email: "riya@demo.edu" },
  { name: "Arjun Singh", email: "arjun@demo.edu" },
  { name: "Ríya Kapoor", email: "rk@demo.edu" },
  { name: "Sneha Patil", email: "sneha.riya@demo.edu" },
];
const find = (q: string) => findMatches(q, people, (p) => [p.name, p.email], (p) => p.name).map((p) => p.name);

describe("finding by what someone types", () => {
  it("matches any part of the name or email, ignoring case and accents", () => {
    expect(find("riya")).toEqual(["Ríya Kapoor", "Riya Sharma", "Sneha Patil"]);
    expect(find("ARJUN@")).toEqual(["Arjun Singh"]);
  });
  it("puts names that start with what was typed first", () => {
    // Sneha's email has "riya" in it, but her name doesn't start with it.
    expect(find("riya").at(-1)).toBe("Sneha Patil");
    expect(find("sneha")).toEqual(["Sneha Patil"]);
  });
  it("needs every word to match, in any order", () => {
    expect(find("sharma riya")).toEqual(["Riya Sharma"]);
    expect(find("riya singh")).toEqual([]);
  });
  it("finds nothing for an empty box", () => {
    expect(find("   ")).toEqual([]);
  });
});

describe("pages of a long list", () => {
  const items = Array.from({ length: 62 }, (_, i) => i + 1);
  it("cuts the list into pages and says where it is", () => {
    expect(pageOf(items, undefined, 30)).toMatchObject({ page: 1, pages: 3, from: 1, to: 30, total: 62 });
    expect(pageOf(items, "3", 30)).toMatchObject({ rows: [61, 62], page: 3, from: 61, to: 62 });
  });
  it("keeps a bad or out-of-range page number on a real page", () => {
    expect(pageOf(items, "99", 30).page).toBe(3);
    expect(pageOf(items, "0", 30).page).toBe(1);
    expect(pageOf(items, "two", 30).page).toBe(1);
  });
  it("an empty list is one empty page", () => {
    expect(pageOf([], "2", 30)).toMatchObject({ rows: [], page: 1, pages: 1, total: 0 });
  });
});
