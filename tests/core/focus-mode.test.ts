/** Wave 1 integration (assessments request): learner focus mode hides the learner chrome. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("learner focus mode", () => {
  it("globals.css hides anything marked data-learn-chrome while a data-learner-focus element is on the page", () => {
    expect(read("src/app/globals.css")).toMatch(/body:has\(\[data-learner-focus\]\) \[data-learn-chrome\] \{\s*display: none;/);
  });
  it("the learner header and tab bar are marked as chrome", () => {
    expect(read("src/app/[uni]/learn/layout.tsx")).toContain("<header data-learn-chrome");
    expect(read("src/app/[uni]/learn/nav.tsx")).toContain("<nav data-learn-chrome");
  });
  it("the test player turns focus mode on", () => {
    expect(read("src/modules/assessments/components/test-player.tsx")).toContain("data-learner-focus");
  });
});
