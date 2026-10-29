import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Empty, Tabs } from "@/components/ui";
import { SlotOutlet } from "@/components/slots";
import { spaceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { formatDate } from "@/server/lib/dates";
import { visibleSlots } from "@/server/registry";
import { myEnrolment } from "@/server/services/enrolment";
import { SwitchBatch } from "../switch-batch";

export const metadata = { title: "Course" };

type Search = Record<string, string | string[] | undefined>;

/**
 * The learner's course hub: course, batch, timings and faculty, the switch-batch action,
 * then the tabs modules register through learnerCourseTabs (lessons, live classes,
 * assignments, tests, certificate, leaderboard).
 */
export default async function CourseHub({ params, searchParams }: { params: Promise<{ uni: string; enrolmentId: string }>; searchParams: Promise<Search> }) {
  const { uni, enrolmentId } = await params;
  const search = await searchParams;
  const { actor, university } = await spaceContext(uni);
  const e = await myEnrolment(actor, enrolmentId).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const b = e.batchRecord;
  const target = { universityId: university.id, departmentIds: [b.departmentId], batchIds: [b.id], ownerUserId: actor.userId };

  const tabs = visibleSlots("learnerCourseTabs", actor, target);
  const requested = typeof search.tab === "string" ? search.tab : undefined;
  const active = tabs.find((t) => t.key === requested) ?? tabs[0];
  const base = `/${uni}/learn/my/${enrolmentId}`;

  return (
    <>
      <Link href={`/${uni}/learn/my`} className="text-sm text-muted">
        My learning
      </Link>
      <div className="mb-6 mt-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight">{e.course.title}</h1>
          {e.status === "completed" && <Badge tone="brand">Completed</Badge>}
          {e.switchRequest && <Badge tone="warn">Switch requested</Badge>}
        </div>
        <Card className="mt-4 p-5">
          <dl className="grid gap-3 text-[14px] sm:grid-cols-3">
            <div>
              <dt className="text-muted">Batch</dt>
              <dd className="font-medium">{e.batch.name}</dd>
            </div>
            <div>
              <dt className="text-muted">Timings</dt>
              <dd className="font-medium">{e.batch.timings}</dd>
              <dd className="text-muted">
                {formatDate(e.batch.startDate)} to {formatDate(e.batch.endDate)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Faculty</dt>
              <dd className="font-medium">{e.batch.faculty.length ? e.batch.faculty.join(", ") : "To be announced"}</dd>
            </div>
          </dl>
          {e.status === "active" && (
            <SwitchBatch uni={uni} enrolmentId={e.enrolmentId} switchRequest={e.switchRequest} lastDecision={e.lastDecision} options={e.allOptions} />
          )}
        </Card>
      </div>

      {tabs.length === 0 ? (
        <Empty title="Nothing here yet">Lessons, live classes, assignments and tests for this course will show up here.</Empty>
      ) : (
        <>
          <Tabs active={active.key} tabs={tabs.map((t) => ({ key: t.key, label: t.label, href: `${base}?tab=${t.key}` }))} />
          <SlotOutlet
            slot="learnerCourseTabs"
            entry={active}
            props={{
              uni,
              actor,
              university,
              enrolment: { enrolmentId: e.enrolmentId, courseId: e.course.id, batchId: b.id, status: e.status },
              course: {
                id: e.course.id,
                title: e.course.title,
                departmentId: e.course.departmentId,
                programId: e.course.programId,
                status: e.course.status,
                certificateEnabled: e.course.certificateEnabled,
                pricePaise: e.course.pricePaise,
              },
              batch: {
                id: b.id,
                courseId: b.courseId,
                departmentId: b.departmentId,
                name: b.name,
                startDate: b.startDate,
                endDate: b.endDate,
                seatLimit: b.seatLimit,
                status: b.status,
                meetingUrl: b.meetingUrl,
                target: { universityId: university.id, departmentIds: [b.departmentId], batchIds: [b.id] },
              },
              target,
              searchParams: search,
            }}
          />
        </>
      )}
    </>
  );
}
