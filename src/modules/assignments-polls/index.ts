import type { ZinnyModule } from "@/contracts/module";
import { BatchAssignmentsSection, CourseAssignmentsTab, ToGradeCard } from "./components/admin-slots";
import { AssignmentGradesSection, DueSoonCard, LearnerAssignmentsTab } from "./components/learner-slots";
import { CoursePollsTab } from "./components/polls-tab";
import { handlers } from "./events";
import { jobs } from "./jobs";
import { seed } from "./seed";

/** assignments-polls: assignments with files, grading, and course polls. Brief: .claude/agents/assignments-polls.md */
const assignmentsPolls: ZinnyModule = {
  id: "assignments-polls",
  adminCourseTabs: [
    { key: "assignments", label: "Assignments", order: 300, action: "assignment.view", component: CourseAssignmentsTab },
    { key: "polls", label: "Polls", order: 310, action: "poll.manage", component: CoursePollsTab },
  ],
  adminBatchSections: [{ key: "assignments", order: 300, action: "assignment.view", component: BatchAssignmentsSection }],
  learnerCourseTabs: [{ key: "assignments", label: "Assignments", order: 300, action: "self.submit_assignment", component: LearnerAssignmentsTab }],
  learnerHubSections: [{ key: "assignment-grades", order: 300, action: "self.submit_assignment", component: AssignmentGradesSection }],
  learnerHomeCards: [{ key: "due-soon", order: 300, action: "self.submit_assignment", component: DueSoonCard }],
  dashboardCards: [{ key: "to-grade-assignments", order: 300, action: "assignment.grade", component: ToGradeCard }],
  eventHandlers: handlers,
  jobs,
  seed,
};

export default assignmentsPolls;
