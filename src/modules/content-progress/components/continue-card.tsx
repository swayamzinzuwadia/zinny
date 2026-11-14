import Link from "next/link";
import { Card, CardTitle } from "@/components/ui";
import type { HomeCardProps } from "@/contracts/module";
import { continueLearning } from "../learn";
import { formatDate } from "../lib/dates";
import { formatMinutes, KIND_LABEL } from "../lib/kinds";
import { courseHubPath, lessonPath } from "../paths";
import { Icon, ProgressBar } from "./bits";

/** Other courses listed under the main lesson; My learning has every course. */
const OTHERS_SHOWN = 2;

/**
 * Learner home → "Continue learning" (learnerHomeCards.continue-learning): the next unfinished
 * lesson with its course's progress, then up to two more courses as one-line rows.
 */
export async function ContinueLearningCard({ uni, actor }: HomeCardProps) {
  const items = await continueLearning(actor);
  if (items.length === 0) return null;
  const [first, ...rest] = items;

  return (
    <Card className="p-5">
      <CardTitle hint={`${items.length} course${items.length === 1 ? "" : "s"}`}>Continue learning</CardTitle>
      {first.next ? (
        <Link href={lessonPath(uni, first.next.id)} className="group -mx-2 block rounded-xl px-2 py-1.5 hover:bg-canvas">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-canvas">
              <Icon name={first.next.kind} size={17} />
            </span>
            <span className="min-w-0">
              <span className="block text-[16px] font-medium leading-snug group-hover:text-brand">{first.next.title}</span>
              <span className="block text-[13px] text-muted">
                {[first.courseTitle, KIND_LABEL[first.next.kind], formatMinutes(first.next.durationMinutes), first.next.kind === "video" && first.next.percent > 0 ? `${first.next.percent}% watched` : ""]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </div>
        </Link>
      ) : (
        <Link href={courseHubPath(uni, first.enrolmentId)} className="-mx-2 block rounded-xl px-2 py-1.5 hover:bg-canvas">
          <div className="text-[13px] text-muted">{first.courseTitle}</div>
          <div className="text-[15px]">
            {first.nextUnlock ? `You're up to date. The next lesson opens on ${formatDate(first.nextUnlock.unlockOn!, { weekday: true })}.` : "You've finished every lesson that's open."}
          </div>
        </Link>
      )}
      <div className="mt-2 flex items-center gap-3">
        <ProgressBar percent={first.percent} className="flex-1" label={`${first.courseTitle}: ${first.percent}%`} />
        <span className="tabular text-[13px] text-muted">{first.percent}%</span>
      </div>

      {rest.length > 0 && (
        <ul className="-mb-3 mt-4 divide-y divide-line border-t border-line">
          {rest.slice(0, OTHERS_SHOWN).map((c) => (
            <li key={c.enrolmentId}>
              <Link
                href={c.next ? lessonPath(uni, c.next.id) : courseHubPath(uni, c.enrolmentId)}
                title={c.next ? `Next: ${c.next.title}` : undefined}
                className="group flex items-baseline justify-between gap-3 py-3"
              >
                <span className="min-w-0 truncate text-[14px] group-hover:text-brand">{c.courseTitle}</span>
                <span className="tabular shrink-0 text-[13px] text-muted">{c.percent}%</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
