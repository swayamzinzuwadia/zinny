/**
 * The fixed vocabulary of the XP system: what can earn XP, what badges and challenges
 * can measure, and the built-in badge icons. Pure data, safe to import anywhere.
 */
import type { Condition, Metric, TriggerEvent } from "./schema";

/* ───────────────────────────── XP rule triggers ───────────────────────────── */

export type Trigger = {
  key: string;
  event: TriggerEvent;
  condition: Condition;
  /** Shown in the "What earns XP" list. `N` is replaced by the minimum score. */
  label: string;
  needsScore: boolean;
};

/** Every event + condition an admin can pick. One list, so the form needs a single select. */
export const TRIGGERS: readonly Trigger[] = [
  { key: "lesson", event: "lesson.completed", condition: "none", label: "Finishing a lesson", needsScore: false },
  { key: "test-passed", event: "test.submitted", condition: "passed", label: "Passing a test", needsScore: false },
  { key: "test-score", event: "test.submitted", condition: "min_score", label: "Scoring at least N% on a test", needsScore: true },
  { key: "test-any", event: "test.submitted", condition: "none", label: "Submitting a test", needsScore: false },
  { key: "class-present", event: "attendance.marked", condition: "present", label: "Attending a live class, marked present", needsScore: false },
  { key: "class-attended", event: "attendance.marked", condition: "present_or_late", label: "Attending a live class, present or late", needsScore: false },
  { key: "assignment-on-time", event: "assignment.submitted", condition: "on_time", label: "Submitting an assignment on time", needsScore: false },
  { key: "assignment-any", event: "assignment.submitted", condition: "none", label: "Submitting an assignment", needsScore: false },
  { key: "assignment-score", event: "assignment.graded", condition: "min_score", label: "Scoring at least N% on an assignment", needsScore: true },
  { key: "course-completed", event: "enrolment.completed", condition: "none", label: "Completing a course", needsScore: false },
];

export function triggerByKey(key: string): Trigger | undefined {
  return TRIGGERS.find((t) => t.key === key);
}

export function triggerFor(event: TriggerEvent, condition: Condition): Trigger | undefined {
  return TRIGGERS.find((t) => t.event === event && t.condition === condition);
}

/** "Scoring at least 90% on a test", "Finishing a lesson". */
export function describeTrigger(rule: { eventType: TriggerEvent; condition: Condition; minScore: number | null }): string {
  const t = triggerFor(rule.eventType, rule.condition);
  if (!t) return rule.eventType;
  return t.needsScore ? t.label.replace("N%", `${rule.minScore ?? 0}%`) : t.label;
}

/* ───────────────────────────── Metrics ───────────────────────────── */

type MetricInfo = {
  label: string;
  /** Badge criterion: "Pass 3 tests". */
  badge: (n: number) => string;
  /** Challenge goal: "Finish 8 lessons". */
  goal: (n: number) => string;
  /** Progress: "6 of 8 lessons". */
  unit: (n: number) => string;
  forChallenges: boolean;
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const METRICS: Record<Metric, MetricInfo> = {
  xp: {
    label: "XP earned",
    badge: (n) => `Reach ${n} XP`,
    goal: (n) => `Earn ${n} XP`,
    unit: () => "XP",
    forChallenges: true,
  },
  lessons_completed: {
    label: "Lessons finished",
    badge: (n) => (n === 1 ? "Finish a first lesson" : `Finish ${n} lessons`),
    goal: (n) => `Finish ${n} ${plural(n, "lesson", "lessons")}`,
    unit: (n) => plural(n, "lesson", "lessons"),
    forChallenges: true,
  },
  tests_passed: {
    label: "Tests passed",
    badge: (n) => (n === 1 ? "Pass a first test" : `Pass ${n} tests`),
    goal: (n) => `Pass ${n} ${plural(n, "test", "tests")}`,
    unit: (n) => plural(n, "test", "tests"),
    forChallenges: true,
  },
  classes_attended: {
    label: "Live classes attended",
    badge: (n) => `Attend ${n} live ${plural(n, "class", "classes")}`,
    goal: (n) => `Attend ${n} live ${plural(n, "class", "classes")}`,
    unit: (n) => plural(n, "class", "classes"),
    forChallenges: true,
  },
  attendance_streak_weeks: {
    label: "Attendance streak (weeks)",
    badge: (n) => `Attend every class for ${n} ${plural(n, "week", "weeks")} in a row`,
    goal: (n) => `Attend every class for ${n} ${plural(n, "week", "weeks")} in a row`,
    unit: (n) => plural(n, "week", "weeks"),
    forChallenges: false,
  },
  assignments_on_time: {
    label: "Assignments on time",
    badge: (n) => `Submit ${n} ${plural(n, "assignment", "assignments")} on time`,
    goal: (n) => `Submit ${n} ${plural(n, "assignment", "assignments")} on time`,
    unit: (n) => plural(n, "assignment", "assignments"),
    forChallenges: true,
  },
  courses_completed: {
    label: "Courses completed",
    badge: (n) => (n === 1 ? "Complete a first course" : `Complete ${n} courses`),
    goal: (n) => `Complete ${n} ${plural(n, "course", "courses")}`,
    unit: (n) => plural(n, "course", "courses"),
    forChallenges: false,
  },
};

export const METRIC_KEYS = Object.keys(METRICS) as Metric[];
export const CHALLENGE_METRICS = METRIC_KEYS.filter((m) => METRICS[m].forChallenges);

export function isMetric(v: string): v is Metric {
  return (METRIC_KEYS as string[]).includes(v);
}

/* ───────────────────────────── Badge icons ───────────────────────────── */

/** Built-in icons, drawn in badge-icon.tsx. Badges store the key. */
export const BADGE_ICONS = ["star", "flame", "book", "trophy", "medal", "target", "rocket", "bolt", "crown", "check", "calendar", "leaf"] as const;
export type BadgeIconKey = (typeof BADGE_ICONS)[number];

export const BADGE_ICON_LABELS: Record<BadgeIconKey, string> = {
  star: "Star",
  flame: "Flame",
  book: "Book",
  trophy: "Trophy",
  medal: "Medal",
  target: "Target",
  rocket: "Rocket",
  bolt: "Bolt",
  crown: "Crown",
  check: "Check",
  calendar: "Calendar",
  leaf: "Leaf",
};

export function isBadgeIcon(v: string): v is BadgeIconKey {
  return (BADGE_ICONS as readonly string[]).includes(v);
}

/* ───────────────────────────── Periods ───────────────────────────── */

export const PERIODS = [
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" },
] as const;
export type Period = (typeof PERIODS)[number]["key"];

export function asPeriod(v: unknown, fallback: Period = "week"): Period {
  return PERIODS.some((p) => p.key === v) ? (v as Period) : fallback;
}

/** Source events the award handler listens to. */
export const SOURCE_EVENTS = [
  "lesson.completed",
  "test.submitted",
  "attendance.marked",
  "assignment.submitted",
  "assignment.graded",
  "enrolment.completed",
] as const satisfies readonly TriggerEvent[];
