/*
 * A course's tabs, grouped. Core and the modules register nine tabs between them; shown in
 * one row they read as nine unrelated places. They are grouped under five by what a person
 * is doing: writing the course, running its batches, setting its coursework, selling it,
 * and setting it up. A group with several pages shows them in a quieter second row.
 */

export type CourseTab = { key: string; label: string; order: number };
export type CourseTabGroup = { key: string; label: string; tabs: CourseTab[] };

/**
 * `solo` is the name a group takes when only one of its pages is left for this person and
 * the group's own name would promise more than is there: "member" uses that page's name.
 */
const GROUPS: { key: string; label: string; members: string[]; solo: "group" | "member" }[] = [
  { key: "curriculum", label: "Curriculum", members: ["curriculum"], solo: "group" },
  { key: "batches", label: "Batches", members: ["batches", "live"], solo: "group" },
  { key: "coursework", label: "Coursework", members: ["tests", "assignments", "polls"], solo: "member" },
  { key: "selling", label: "Selling", members: ["marketplace"], solo: "group" },
  { key: "settings", label: "Settings", members: ["settings", "certificates"], solo: "member" },
];

/** Names used in the second row, where the registered label needs its group to make sense. */
const MEMBER_LABEL: Record<string, string> = { settings: "Course settings" };

export function groupCourseTabs(tabs: CourseTab[]): CourseTabGroup[] {
  const known = new Set(GROUPS.flatMap((g) => g.members));
  const groups: CourseTabGroup[] = [];
  for (const g of GROUPS) {
    const members = g.members.flatMap((k) => tabs.filter((t) => t.key === k)).map((t) => ({ ...t, label: MEMBER_LABEL[t.key] ?? t.label }));
    if (members.length === 0) continue;
    const alone = members.length === 1 && g.solo === "member" && members[0].key !== g.key;
    groups.push({ key: g.key, label: alone ? members[0].label : g.label, tabs: members });
  }
  // A tab no group knows (a new module's) keeps a place of its own, before Settings, so it is never lost.
  const extra = tabs
    .filter((t) => !known.has(t.key))
    .sort((a, b) => a.order - b.order)
    .map((t) => ({ key: t.key, label: t.label, tabs: [t] }));
  const at = groups.findIndex((g) => g.key === "settings");
  groups.splice(at === -1 ? groups.length : at, 0, ...extra);
  return groups;
}

/** The group a tab sits in. */
export function groupOf(groups: CourseTabGroup[], tab: string): CourseTabGroup | undefined {
  return groups.find((g) => g.tabs.some((t) => t.key === tab));
}
