import type { ZinnyModule } from "@/contracts/module";
import { JoinNextCard, LearnerLiveTab } from "./components/learner";
import { AttendanceTodayCard, BatchAttendanceSection, CourseLiveTab } from "./components/staff";
import { jobs } from "./jobs";
import { reports } from "./reports";
import { seed } from "./seed";

/**
 * live-classes: join links, the attendance register, attendance percentages and alerts.
 * Brief: .claude/agents/live-classes.md. Routes it owns: /[uni]/learn/join/[batchId]/[date]
 * and /[uni]/admin/products/batches/[id]/attendance (plus /[date] and /[date]/start).
 */
const liveClasses: ZinnyModule = {
  id: "live-classes",
  adminCourseTabs: [{ key: "live", label: "Live classes", order: 200, action: "attendance.view", component: CourseLiveTab }],
  adminBatchSections: [{ key: "attendance", order: 200, action: "attendance.view", component: BatchAttendanceSection }],
  learnerCourseTabs: [{ key: "live", label: "Live classes", order: 200, action: "self.join_class", component: LearnerLiveTab }],
  learnerHomeCards: [{ key: "join-next", order: 200, action: "self.join_class", component: JoinNextCard }],
  dashboardCards: [{ key: "attendance-today", order: 200, action: "attendance.view", component: AttendanceTodayCard }],
  reports,
  jobs,
  seed,
};

export default liveClasses;
