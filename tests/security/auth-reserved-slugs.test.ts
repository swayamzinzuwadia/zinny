/**
 * AUTH-14: no institute can take a web address that is one of Zinny's own top-level pages
 * (for example /privacy or /frozen), so an institute can never shadow or impersonate them.
 */
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS, checkSlug } from "@/modules/zinny-team-panel/services/universities";

const appDir = new URL("../../src/app/", import.meta.url);
const topLevel = readdirSync(appDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("[") && !d.name.startsWith("(") && !d.name.startsWith("_"))
  .map((d) => d.name);

describe("reserved institute web addresses", () => {
  it("cover every top-level page", () => {
    expect(topLevel.length).toBeGreaterThan(5);
    for (const name of topLevel) expect(RESERVED_SLUGS.has(name), `src/app/${name} is not reserved`).toBe(true);
  });
  it("are refused when an institute picks one", () => {
    for (const name of ["privacy", "frozen", "suspended", "book-a-demo", "platform"]) {
      expect(() => checkSlug(name)).toThrow(/reserved/);
    }
    expect(checkSlug("sunrise-academy")).toBe("sunrise-academy");
  });
});
