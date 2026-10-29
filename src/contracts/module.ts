/**
 * The module contract (contracts.md sections 1 and 3 to 7). Frozen for the wave.
 *
 * Every module lives in `src/modules/<module>/` and default-exports one `ZinnyModule`
 * from `index.ts`. `npm run gen` collects them into `src/generated/registry.ts`; core
 * reads them through `@/server/registry`. Nobody edits a shared list by hand.
 */
import type { ReactNode } from "react";
import type { Actor, Target } from "@/server/authz/engine";
import type { Action } from "@/server/authz/roles";
import type { BatchLite, CourseLite, StudentEnrolment, UniversityLite } from "./core";
import type { EventHandler } from "./events";
import type { MailTransport } from "./mail";
import type { PaymentGateway } from "./payments";
import type { SmsTransport } from "./sms";

/** The twelve module ids. Each is also the folder name under `src/modules/`. */
export const MODULE_IDS = [
  "assessments",
  "assignments-polls",
  "certificates",
  "content-progress",
  "gamification",
  "identity",
  "live-classes",
  "notifications-delivery",
  "payments",
  "reports-board",
  "website-builder",
  "zinny-team-panel",
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];

/* ───────────────────────────── Slots (section 3) ───────────────────────────── */

/** A server component. It may be async and may call the module's own services. */
export type SlotComponent<P> = (props: P) => ReactNode | Promise<ReactNode>;

type SlotBase<P> = {
  /** Reserved per module in contracts.md section 3, e.g. "curriculum". Unique within the slot. */
  key: string;
  /** Lower comes first. Reserved per module in contracts.md section 3. */
  order: number;
  /** Shown only to people who pass this action against the page's target. */
  action: Action;
  component: SlotComponent<P>;
};

/** Every slot component gets these. */
export type SlotContext = {
  /** The university slug from the URL, for building links: `/${uni}/learn/...`. */
  uni: string;
  actor: Actor;
  university: UniversityLite;
};

export type SearchParams = Record<string, string | string[] | undefined>;

/** Admin course page tab: `/[uni]/admin/products/courses/[id]?tab=<key>`. Target: the course (its department and every batch). */
export type CourseTabProps = SlotContext & { course: CourseLite; target: Target; searchParams: SearchParams };
export type CourseTab = SlotBase<CourseTabProps> & { label: string };

/** Admin batch page, under the timetable. Target: the batch. */
export type BatchSectionProps = SlotContext & { batch: BatchLite; course: CourseLite; target: Target };
export type BatchSection = SlotBase<BatchSectionProps>;

/** Learner course hub tab: `/[uni]/learn/my/[enrolmentId]?tab=<key>`. Target: the batch, owned by the viewer. */
export type LearnerCourseTabProps = SlotContext & {
  enrolment: StudentEnrolment;
  course: CourseLite;
  batch: BatchLite;
  target: Target;
  searchParams: SearchParams;
};
export type LearnerCourseTab = SlotBase<LearnerCourseTabProps> & { label: string };

/** `/[uni]/learn/my`, below the course list. Target: the viewer's own records. */
export type HubSectionProps = SlotContext & { enrolments: StudentEnrolment[] };
export type HubSection = SlotBase<HubSectionProps>;

/** Learner home, below "Today". Target: the viewer's own records. */
export type HomeCardProps = SlotContext & { today: string };
export type HomeCard = SlotBase<HomeCardProps>;

/**
 * Admin dashboard, below "Seats by batch". Target: the university. People with a
 * department or batch scope see the card when they hold the action anywhere in it;
 * the card itself must narrow what it shows with `reach`.
 */
export type DashboardCardProps = SlotContext & { today: string };
export type DashboardCard = SlotBase<DashboardCardProps>;

export type SlotMap = {
  adminCourseTabs: CourseTab;
  adminBatchSections: BatchSection;
  learnerCourseTabs: LearnerCourseTab;
  learnerHubSections: HubSection;
  learnerHomeCards: HomeCard;
  dashboardCards: DashboardCard;
};
export type SlotName = keyof SlotMap;
export const SLOT_NAMES = [
  "adminCourseTabs",
  "adminBatchSections",
  "learnerCourseTabs",
  "learnerHubSections",
  "learnerHomeCards",
  "dashboardCards",
] as const satisfies readonly SlotName[];

/* ───────────────────────────── Reports (section 4) ───────────────────────────── */

export type ReportFilter = "dateRange" | "department" | "course" | "batch";

/** Only the filters the report declares are passed. Dates are "YYYY-MM-DD", inclusive. */
export type ReportParams = {
  from?: string;
  to?: string;
  departmentId?: string;
  courseId?: string;
  batchId?: string;
};

export type ReportColumn = { key: string; label: string; type: "text" | "number" | "money" | "date" | "percent" };

export type ReportResult = { columns: ReportColumn[]; rows: Record<string, unknown>[] };

export type ReportDefinition = {
  /** "<module>.<name>", e.g. "assessments.test-scores". */
  id: string;
  label: string;
  description: string;
  /** Permission needed, checked with reach() so scoped viewers see their scope only. */
  action: Action;
  filters: ReportFilter[];
  /** Money columns are integer paise; percent columns are 0–100; date columns "YYYY-MM-DD". */
  run(actor: Actor, params: ReportParams): Promise<ReportResult>;
};

/* ───────────────────────────── Jobs (section 5) ───────────────────────────── */

export type Job = {
  /** "<module>.<name>", unique. */
  id: string;
  every: "minute" | "hour" | "day";
  /** Called once per university with that university's system actor. Use withTenant(actor, …). */
  run(actor: Actor): Promise<void>;
};

/* ───────────────────────────── Seeds (section 6) ───────────────────────────── */

/** The core seed's records, by name. */
export type SeedIds = {
  /** By department code: "CS", "MKT". */
  departments: Record<string, string>;
  /** By course title: "Data Analytics", "Python Basics", "Machine Learning Foundations", "Digital Marketing". */
  courses: Record<string, string>;
  /** By "Course title / Batch name": "Data Analytics / Weekday morning". */
  batches: Record<string, string>;
  /** By email: "riya@demo.edu". */
  users: Record<string, string>;
  /** Active enrolments by "email / Course title": "riya@demo.edu / Python Basics". */
  enrolments: Record<string, string>;
};

export type SeedContext = {
  /** The Demo University. */
  universityId: string;
  universitySlug: string;
  /** Today in the university's time zone, "YYYY-MM-DD". */
  today: string;
  /** The actor of a seeded person inside the Demo University, e.g. actorFor("hema@demo.edu"). */
  actorFor(email: string): Promise<Actor>;
  /** The Demo University's system actor (for writes no person would make). */
  systemActor: Actor;
  ids: SeedIds;
};

/* ───────────────────────────── The module (section 1) ───────────────────────────── */

export type ZinnyModule = {
  id: ModuleId;
  eventHandlers?: EventHandler[];
  adminCourseTabs?: CourseTab[];
  adminBatchSections?: BatchSection[];
  learnerCourseTabs?: LearnerCourseTab[];
  learnerHubSections?: HubSection[];
  learnerHomeCards?: HomeCard[];
  dashboardCards?: DashboardCard[];
  reports?: ReportDefinition[];
  jobs?: Job[];
  seed?: (ctx: SeedContext) => Promise<void>;
  /** notifications-delivery only. */
  mailTransport?: MailTransport;
  /** notifications-delivery only. */
  smsTransport?: SmsTransport;
  /** payments only. */
  paymentGateway?: PaymentGateway;
};
