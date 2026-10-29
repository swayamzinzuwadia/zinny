import type { ZinnyModule } from "@/contracts/module";
import { coreReports } from "./reports";

/**
 * reports-board: the Reports page that runs every module's reports, the two reports that
 * come from core data (enrolments, transactions) and Insights for Board / Owner, admins and
 * Heads of Department. Brief: .claude/agents/reports-board.md
 *
 * Pages: /[uni]/admin/finance/reports and /[uni]/admin/insights. No tables, events or slots.
 */
const reportsBoard: ZinnyModule = {
  id: "reports-board",
  reports: coreReports,
};

export default reportsBoard;
