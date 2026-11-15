import { Card, PageHeader } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { PlanForm } from "@/modules/zinny-team-panel/components/plan-form";
import { isSuperAdmin } from "@/modules/zinny-team-panel/lib/access";

export const metadata = { title: "Add a plan" };

export default async function NewPlanPage() {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.licences") || !isSuperAdmin(actor)) return <NoAccess section="adding plans" who="Super Admins" />;
  return (
    <>
      <PageHeader title="Add a plan" subtitle="Its price is what a new licence on it charges, before GST. Discounts are given on each licence." />
      <Card className="max-w-4xl">
        <PlanForm />
      </Card>
    </>
  );
}
