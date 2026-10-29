import Link from "next/link";
import { Badge, Empty, PageHeader, Select, Table, Tabs, Td, buttonClass } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { canSeeContentFlags } from "@/modules/zinny-team-panel/lib/access";
import { formatCount, formatINR, timeAgo } from "@/modules/zinny-team-panel/lib/format";
import { QUEUE_TABS, reviewQueue, reviewUniversityOptions, type QueueTab } from "@/modules/zinny-team-panel/services/content";

export const metadata = { title: "Content review" };

const TAB_LABELS: Record<QueueTab, string> = { "to-review": "To review", flagged: "Flagged", cleared: "Reviewed" };

export default async function ContentReviewPage({ searchParams }: { searchParams: Promise<{ tab?: string; university?: string }> }) {
  const actor = await platformContext();
  if (!canSeeContentFlags(actor)) return <NoAccess section="content review" who="Super Admins, Content QA and Account Managers" />;
  const sp = await searchParams;
  const canReview = canPlatform(actor, "platform.content_review");
  const fallback: QueueTab = canReview ? "to-review" : "flagged";
  const tab = (QUEUE_TABS as string[]).includes(sp.tab ?? "") ? (sp.tab as QueueTab) : fallback;
  const uni = sp.university;
  const [{ rows, counts }, unis] = await Promise.all([
    reviewQueue(actor, tab, { universityId: uni }),
    reviewUniversityOptions(actor),
  ]);
  const href = (t: QueueTab) => `/platform/content?tab=${t}${uni ? `&university=${uni}` : ""}`;

  return (
    <>
      <PageHeader
        title="Content review"
        subtitle={
          canReview
            ? "Newly published courses across universities, newest first. Preview each one, then mark it reviewed or flag an issue for the university's Account Manager. Nobody on the Zinny team edits a university's content."
            : "Issues Content QA found in university courses. Follow up with the university; Content QA resolves the flag once it's fixed."
        }
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Tabs tabs={QUEUE_TABS.map((t) => ({ key: t, label: TAB_LABELS[t], href: href(t), count: counts[t] }))} active={tab} />
        <form className="flex gap-2">
          <input type="hidden" name="tab" value={tab} />
          <Select name="university" defaultValue={uni ?? ""} aria-label="University" className="w-56">
            <option value="">Every university</option>
            {unis.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
          <button className={buttonClass("secondary")}>Show</button>
        </form>
      </div>

      {rows.length === 0 ? (
        <Empty title={tab === "to-review" ? "Nothing waits for review" : tab === "flagged" ? "No open flags" : "Nothing reviewed yet"}>
          {tab === "to-review" ? "New courses appear here as soon as a university publishes them." : undefined}
        </Empty>
      ) : (
        <Table head={["Course", "University", "Batches", "Students", "Price", tab === "cleared" ? "Reviewed" : "Created", ""]}>
          {rows.map((r) => (
            <tr key={r.courseId} className="hover:bg-canvas/60">
              <Td>
                <Link href={`/platform/content/${r.courseId}`} className="font-medium text-ink hover:text-brand">
                  {r.title}
                </Link>
                <div className="text-[12.5px] text-muted">{r.departmentName}</div>
              </Td>
              <Td>{r.universityName}</Td>
              <Td className="tabular">{formatCount(r.batches)}</Td>
              <Td className="tabular">{formatCount(r.students)}</Td>
              <Td className="tabular whitespace-nowrap">{r.pricePaise ? formatINR(r.pricePaise) : "Free"}</Td>
              <Td className="whitespace-nowrap text-muted">
                {tab === "cleared" && r.reviewedAt ? (
                  <>
                    {timeAgo(r.reviewedAt)}
                    {r.reviewedByName && <div className="text-[12.5px]">by {r.reviewedByName}</div>}
                  </>
                ) : (
                  timeAgo(r.createdAt)
                )}
              </Td>
              <Td className="whitespace-nowrap text-right">
                {r.openFlags > 0 && (
                  <span className="mr-3">
                    <Badge tone="gold">
                      {r.openFlags} open flag{r.openFlags === 1 ? "" : "s"}
                    </Badge>
                  </span>
                )}
                {r.status !== "published" && (
                  <span className="mr-3">
                    <Badge>{r.status === "archived" ? "Archived" : "Draft"}</Badge>
                  </span>
                )}
                <Link href={`/platform/content/${r.courseId}`} className="text-[13px] font-medium text-brand hover:underline">
                  {canReview && tab === "to-review" ? "Review" : "Open"}
                </Link>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
