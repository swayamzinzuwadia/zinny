import type { ReportDefinition } from "@/contracts/module";
import { testScoresReport } from "./results";

/** PRD page 8: test scores. reach() inside the run narrows HODs and faculty to their scope. */
export const reports: ReportDefinition[] = [
  {
    id: "assessments.test-scores",
    label: "Test scores",
    description: "Every submitted test attempt with its score and result. Faculty see their own batches; HODs their department.",
    action: "assess.view_results",
    filters: ["dateRange", "course", "batch"],
    run: testScoresReport,
  },
];
