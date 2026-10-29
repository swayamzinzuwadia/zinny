import { Empty, PageHeader } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { InsightsView } from "@/modules/reports-board/components/insights-view";
import { canOpenInsights, loadInsights, NO_INSIGHTS_ACCESS } from "@/modules/reports-board/insights";
import { canOpenReports } from "@/modules/reports-board/service";

export const metadata = { title: "Insights" };

export default async function InsightsPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);

  if (!canOpenInsights(actor)) {
    return (
      <>
        <PageHeader title="Insights" />
        <Empty title="You don't have access to Insights">{NO_INSIGHTS_ACCESS} Ask your Institute Admin if you need it.</Empty>
      </>
    );
  }

  const data = await loadInsights(actor);
  return <InsightsView data={data} reportsHref={canOpenReports(actor) ? `/${uni}/admin/finance/reports` : null} />;
}
