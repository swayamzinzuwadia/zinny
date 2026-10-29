/**
 * The admin sidebar's green column runs the full height of the page: the aside stretches
 * with the content (no fixed height), and only an inner wrapper is sticky and one screen tall.
 * A real layout check (aside height = document height on a long page) is in the phase B click-through.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layout = readFileSync(new URL("../../src/app/[uni]/admin/layout.tsx", import.meta.url), "utf8");

describe("admin layout sidebar", () => {
  it("the aside is the full-height column, without sticky or a fixed height", () => {
    const aside = layout.match(/<aside className="([^"]+)"/)?.[1] ?? "";
    expect(aside.split(" ").sort()).toEqual(["bg-brand-deep", "hidden", "md:block", "shrink-0", "w-[264px]"]);
  });
  it("an inner wrapper holds the sticky, one-screen part", () => {
    expect(layout).toMatch(/<aside[^>]*>\s*<div className="sticky top-0 h-dvh px-3 py-6">\{sidebar\}<\/div>\s*<\/aside>/);
  });
});
