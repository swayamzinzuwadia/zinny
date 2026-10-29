import { Badge, Card, Empty, PageHeader, Tabs } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { canManageSite } from "@/modules/website-builder/access";
import { deleteReviewAction, moderateReviewAction } from "@/modules/website-builder/actions";
import { ActionButton } from "@/modules/website-builder/components/action-button";
import { NoAccess, SectionTabs, Stars } from "@/modules/website-builder/components/admin";
import { formatMoment } from "@/modules/website-builder/format";
import { attentionCounts } from "@/modules/website-builder/overview";
import { listReviews, type ReviewStatus } from "@/modules/website-builder/reviews";

export const metadata = { title: "Reviews" };

const FILTERS: { key: ReviewStatus; label: string }[] = [
  { key: "pending", label: "Waiting" },
  { key: "approved", label: "Approved" },
  { key: "hidden", label: "Hidden" },
];

export default async function ReviewsPage({ params, searchParams }: { params: Promise<{ uni: string }>; searchParams: Promise<{ show?: string }> }) {
  const { uni } = await params;
  const { show } = await searchParams;
  const { actor, university } = await spaceContext(uni);
  if (!canManageSite(actor)) {
    return (
      <>
        <PageHeader title="Reviews" />
        <NoAccess uni={uni} />
      </>
    );
  }
  const status = (FILTERS.some((f) => f.key === show) ? show : "pending") as ReviewStatus;
  const [{ rows, counts }, attention] = await Promise.all([listReviews(actor, status), attentionCounts(actor)]);
  const base = `/${uni}/admin/website/sections/reviews`;

  return (
    <>
      <PageHeader
        title="Reviews"
        subtitle="Visitors write reviews on your website. Nothing appears until you approve it; hide anything that is abusive, off-topic or not genuine."
      />
      <SectionTabs uni={uni} active="reviews" counts={attention} />
      <Tabs active={status} tabs={FILTERS.map((f) => ({ key: f.key, label: f.label, href: `${base}?show=${f.key}`, count: counts[f.key] ?? 0 }))} />

      {rows.length === 0 ? (
        <Empty title={status === "pending" ? "No reviews waiting" : status === "approved" ? "No approved reviews yet" : "No hidden reviews"}>
          {status === "pending" ? "New reviews from your website show up here for you to check." : null}
        </Empty>
      ) : (
        <ul className="space-y-3">
          {rows.map(({ review: r, courseTitle }) => (
            <li key={r.id}>
              <Card className={status === "pending" ? "border-gold/50" : undefined}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <Stars rating={r.rating} />
                      <span className="font-medium">{r.authorName}</span>
                      {courseTitle && <Badge>{courseTitle}</Badge>}
                    </div>
                    <div className="mt-0.5 text-[13px] text-muted">
                      {r.authorEmail}, {formatMoment(r.createdAt, university.timezone)}
                    </div>
                    <p className="mt-3 max-w-3xl whitespace-pre-line text-[14px] text-ink/90">{r.body}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {r.status !== "approved" && (
                      <ActionButton action={moderateReviewAction} fields={{ uni, id: r.id, decision: "approve" }} variant="primary">
                        Approve
                      </ActionButton>
                    )}
                    {r.status !== "hidden" && (
                      <ActionButton action={moderateReviewAction} fields={{ uni, id: r.id, decision: "hide" }}>
                        Hide
                      </ActionButton>
                    )}
                    {r.status === "hidden" && (
                      <ActionButton action={deleteReviewAction} fields={{ uni, id: r.id }} variant="danger" confirm="Delete this review for good?">
                        Delete
                      </ActionButton>
                    )}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
