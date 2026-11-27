/**
 * The admin sidebar's green column runs the full height of the page: the aside stretches
 * with the content (no fixed height), and only an inner wrapper is sticky and one screen tall.
 * The aside lives in the collapsible sidebar, which the admin layout renders.
 * A real layout check (aside height = document height on a long page) is in the phase B click-through.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layout = readFileSync(new URL("../../src/app/[uni]/admin/layout.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("../../src/components/collapsible-sidebar.tsx", import.meta.url), "utf8");

describe("admin layout sidebar", () => {
  it("the admin layout renders the collapsible sidebar", () => {
    expect(layout).toMatch(/<CollapsibleAside/);
  });
  it("the aside is the full-height column, without sticky or a fixed height", () => {
    const aside = sidebar.match(/<aside[\s\S]*?className="([^"]+)"/)?.[1] ?? "";
    expect(aside.split(" ")).toEqual(expect.arrayContaining(["bg-brand-deep", "hidden", "md:block", "shrink-0"]));
    expect(aside).not.toMatch(/sticky|h-dvh|h-screen/);
  });
  it("an inner wrapper holds the sticky, one-screen part", () => {
    expect(sidebar).toMatch(/<div className="sticky top-0 h-dvh px-3 py-6">\{children\}<\/div>/);
  });
});
