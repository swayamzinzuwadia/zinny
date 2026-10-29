import type { ZinnyModule } from "@/contracts/module";
import { closeExpiredAttempts } from "./attempts";
import { BatchTestsSection, CourseTestsTab, LearnerCourseTestsTab, TestResultsHub, ToGradeCard, UpcomingTestsCard } from "./components/slots";
import { reports } from "./reports";
import { seed } from "./seed";

/** assessments: tests, quizzes, test series and the question pool. Brief: .claude/agents/assessments.md */
const assessments: ZinnyModule = {
  id: "assessments",
  adminCourseTabs: [{ key: "tests", label: "Tests", order: 400, action: "assess.view_results", component: CourseTestsTab }],
  adminBatchSections: [{ key: "tests", order: 400, action: "assess.view_results", component: BatchTestsSection }],
  learnerCourseTabs: [{ key: "tests", label: "Tests", order: 400, action: "self.take_test", component: LearnerCourseTestsTab }],
  learnerHubSections: [{ key: "test-results", order: 400, action: "self.take_test", component: TestResultsHub }],
  learnerHomeCards: [{ key: "upcoming-tests", order: 400, action: "self.take_test", component: UpcomingTestsCard }],
  dashboardCards: [{ key: "to-grade-tests", order: 400, action: "assess.grade", component: ToGradeCard }],
  reports,
  jobs: [
    {
      // Submits attempts whose time ran out while the student was away, so results and
      // test.submitted never wait for the student to come back.
      id: "assessments.close-expired-attempts",
      every: "minute",
      run: async (actor) => void (await closeExpiredAttempts(actor)),
    },
  ],
  seed,
};

export default assessments;
