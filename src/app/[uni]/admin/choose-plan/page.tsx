import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ActionLink, Badge, ButtonLink, Card, Notice, PageHeader, cx } from "@/components/ui";
import { can } from "@/server/core";
import { spaceContext } from "@/server/context";
import { formatDate } from "@/server/lib/dates";
import { formatINR } from "@/server/services/finance";
import { trialLine } from "@/modules/onboarding/components/trial-banner";
import { choosePlanView } from "@/modules/onboarding/services/plans";
import { payPlanAction } from "./actions";

export const metadata = { title: "Choose a plan" };

const months = (n: number) => (n === 12 ? "a year" : n === 1 ? "a month" : `${n} months`);
const count = (n: number) => new Intl.NumberFormat("en-IN").format(n);

/**
 * Choosing and paying for a plan: during the free trial, or after the trial ended and the
 * institute was frozen (then it is the only page its admins can open, with documents).
 */
export default async function ChoosePlanPage({ params, searchParams }: { params: Promise<{ uni: string }>; searchParams: Promise<{ paid?: string }> }) {
  const { uni } = await params;
  const { paid } = await searchParams;
  const { actor, university } = await spaceContext(uni);
  if (!can(actor, "settings.manage", { universityId: university.id })) redirect(`/${uni}/admin`);
  const view = await choosePlanView(actor);
  const { trial } = view;
  const frozen = trial.status === "frozen";
  const pan = view.documents.find((d) => d.kind === "pan");

  const subtitle = frozen
    ? "Your free trial has ended, so your institute is paused for students and staff. Everything is kept. Choose a plan to open it again straight away."
    : trial.hasPlan
      ? "Your institute has a plan. To change it, write to the Zinny team."
      : trial.inTrial && trial.daysLeft !== null && trial.trialEndsAt
        ? `${trialLine(trial.daysLeft, trial.trialEndsAt)} Choose a plan to keep going without a break.`
        : "Pick the plan that fits your institute.";

  return (
    <>
      <PageHeader title="Choose a plan" subtitle={subtitle} actions={<ActionLink href={`/${uni}/admin/choose-plan/documents`} icon="upload">Your documents</ActionLink>} />

      {paid && view.lastPaid && (
        <div className="mb-6">
          <Notice>
            Payment received. You&apos;re on the {view.lastPaid.planName} plan and your institute is open.
            {view.lastPaid.invoiceNumber ? ` Zinny's invoice number is ${view.lastPaid.invoiceNumber}.` : ""}
          </Notice>
          <div className="mt-3">
            <ButtonLink href={`/${uni}/admin`} icon="forward">
              Go to your admin
            </ButtonLink>
          </div>
        </div>
      )}

      {frozen && (
        <div className="mb-6">
          <Notice tone="gold">Your institute is paused. Students and staff see a &quot;temporarily unavailable&quot; page until you choose a plan.</Notice>
        </div>
      )}

      {!view.panOnFile && (
        <div className="mb-6">
          <Notice tone="gold">
            {pan?.status === "rejected" ? "The Zinny team couldn't accept your PAN card. " : "We need your institute's PAN card before you choose a plan. "}
            Upload it on the <a href={`/${uni}/admin/choose-plan/documents`} className="font-medium underline underline-offset-4">documents page</a>.
          </Notice>
        </div>
      )}

      {view.payment === "test" && !trial.hasPlan && (
        <p className="mb-4 text-[13px] text-muted">Test mode: payments here go through the test gateway and no money moves.</p>
      )}

      {view.plans.length === 0 ? (
        <Card className="p-6 text-[14px] text-muted">There are no plans on sale right now. Write to the Zinny team and we&apos;ll set one up for you.</Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {view.plans.map((p) => {
            const current = trial.hasPlan && view.lastPaid?.planKey === p.key;
            return (
              <li key={p.key}>
                <Card className={cx("flex h-full flex-col p-6", current && "ring-2 ring-brand")}>
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-[20px] font-semibold">{p.name}</h2>
                    {current && <Badge tone="brand">Your plan</Badge>}
                  </div>
                  {p.description && <p className="mt-1.5 text-[14px] text-muted">{p.description}</p>}
                  <div className="mt-5">
                    <span className="tabular text-[30px] font-semibold">{formatINR(p.basePaise)}</span>
                    <span className="text-[14px] text-muted"> for {months(p.billingMonths)}</span>
                  </div>
                  <p className="tabular mt-1 text-[13px] text-muted">
                    {formatINR(p.totalPaise)} with {p.gstRateBp / 100}% GST ({formatINR(p.gstPaise)})
                  </p>
                  <ul className="mt-5 flex-1 space-y-1.5 text-[14px]">
                    <li>Up to {count(p.studentCap)} students</li>
                    <li>Up to {count(p.staffCap)} staff</li>
                    <li>{p.modules.length} feature packs included</li>
                  </ul>
                  {!trial.hasPlan && (
                    <ActionForm action={payPlanAction} className="mt-6">
                      <input type="hidden" name="uni" value={uni} />
                      <input type="hidden" name="plan" value={p.key} />
                      {view.panOnFile && view.payment === "test" ? (
                        <SubmitButton icon="money" pendingText="Paying…">{`Pay ${formatINR(p.totalPaise)} and start`}</SubmitButton>
                      ) : (
                        <button type="button" disabled className="inline-flex h-10 items-center rounded-full bg-brand px-5 text-[14px] font-medium text-canvas opacity-50">
                          {view.panOnFile ? "Online payment isn't on yet" : "Upload your PAN card first"}
                        </button>
                      )}
                    </ActionForm>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {view.payment === "unavailable" && !trial.hasPlan && (
        <p className="mt-6 text-[14px] text-muted">Online payment for plans isn&apos;t switched on yet. Write to the Zinny team and we&apos;ll send you a payment link.</p>
      )}
      {trial.trialEndsAt && !trial.hasPlan && !frozen && (
        <p className="mt-6 text-[13px] text-muted">Your trial ends on {formatDate(trial.trialEndsAt)}. If you don&apos;t choose a plan by then, your institute pauses; nothing is deleted.</p>
      )}
    </>
  );
}
