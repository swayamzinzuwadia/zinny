import Link from "next/link";
import { Badge, Card, Empty } from "@/components/ui";
import { SlotList } from "@/components/slots";
import { spaceContext } from "@/server/context";
import { formatDate } from "@/server/lib/dates";
import { visibleSlots } from "@/server/registry";
import { batchOptions, myLearning } from "@/server/services/enrolment";
import { SwitchBatch } from "./switch-batch";

export const metadata = { title: "My learning" };

export default async function MyLearning({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  const all = await myLearning(actor);
  const learning = all.filter((l) => l.status === "active");
  const completed = all.filter((l) => l.status === "completed");
  const options = await Promise.all(learning.map((l) => batchOptions(actor, l.course.id).catch(() => null)));
  const own = { universityId: university.id, ownerUserId: actor.userId };

  return (
    <>
      <h1 className="mb-5 text-[26px] font-semibold tracking-tight">My learning</h1>
      {learning.length === 0 && completed.length === 0 && <Empty title="You haven't enrolled in anything yet" />}
      <div className="space-y-4">
        {learning.map((l, i) => (
          <Card key={l.enrolmentId}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <Link href={`/${uni}/learn/my/${l.enrolmentId}`} className="group min-w-0">
                <div className="text-[17px] font-semibold group-hover:text-brand">{l.course.title}</div>
                <div className="text-sm text-muted">
                  {l.batch.name} · {l.batch.timings}
                </div>
                <div className="text-sm text-muted">
                  {formatDate(l.batch.startDate)} to {formatDate(l.batch.endDate)}
                  {l.batch.faculty.length > 0 && ` · ${l.batch.faculty.join(", ")}`}
                </div>
              </Link>
              <div className="flex items-center gap-3">
                {l.switchRequest && <Badge tone="warn">Switch requested</Badge>}
                <Link href={`/${uni}/learn/my/${l.enrolmentId}`} className="text-sm font-medium text-brand hover:underline">
                  Open course
                </Link>
              </div>
            </div>
            <SwitchBatch uni={uni} enrolmentId={l.enrolmentId} switchRequest={l.switchRequest} lastDecision={l.lastDecision} options={options[i]?.options ?? null} />
          </Card>
        ))}
        {completed.map((l) => (
          <Link key={l.enrolmentId} href={`/${uni}/learn/my/${l.enrolmentId}`} className="block">
            <Card className="hover:border-brand/40">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-[17px] font-semibold">{l.course.title}</div>
                  <div className="text-sm text-muted">{l.batch.name}</div>
                </div>
                <Badge tone="brand">Completed</Badge>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      <SlotList
        slot="learnerHubSections"
        className="mt-8 space-y-6"
        entries={visibleSlots("learnerHubSections", actor, own)}
        props={{
          uni,
          actor,
          university,
          enrolments: all
            .filter((l) => l.status === "active" || l.status === "completed")
            .map((l) => ({ enrolmentId: l.enrolmentId, courseId: l.course.id, batchId: l.batch.id, status: l.status })),
        }}
      />
    </>
  );
}
