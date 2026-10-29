/** Reports this module registers (PRD page 8: "course and batch progress"). */
import type { ReportDefinition } from "@/contracts/module";
import { runProgressReport } from "./staff";

export const reports: ReportDefinition[] = [
  {
    id: "content-progress.course-batch-progress",
    label: "Course and batch progress",
    description:
      "For each course and batch: students, how many haven't started, are in progress or have completed, average progress on required lessons and the completion rate.",
    action: "content.view_progress",
    filters: ["dateRange", "department", "course", "batch"],
    run: runProgressReport,
  },
];
