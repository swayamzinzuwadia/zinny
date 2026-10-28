import Link from "next/link";
import { Card, CardTitle, Empty, PageHeader, Stat } from "@/components/ui";
import { SwitchRequests } from "@/components/switch-requests";
import { WeekView } from "@/components/week-view";
import { hasRole } from "@/server/authz/engine";
import { spaceContext } from "@/server/context";
import { dashboardStats } from "@/server/services/dashboard";
import { listSwitchRequests } from "@/server/services/enrolment";
import { myNotifications } from "@/server/services/notifications";
import { facultyTimetable } from "@/server/services/timetable";

export const metadata = { title: "Dashboard" };

export default async function Dashboard({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  const stats = await dashboardStats(actor);
  const isFaculty = hasRole(actor, ["permanent_faculty", "visiting_faculty"]);
  const [requests, notes, week] = await Promise.all([
    stats.canDecideSwitches ? listSwitchRequests(actor) : Promise.resolve([]),
    myNotifications(actor, 8),
    isFaculty ? facultyTimetable(actor) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader title={`Good to see you, ${actor.name.split(" ")[0]}`} subtitle={university.name} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Courses" value={stats.courses} hint={`${stats.published} published`} />
        <Stat label="Open batches" value={stats.openBatches} />
        <Stat label="Active students" value={stats.activeStudents} />
        {stats.canDecideSwitches ? (
          <Stat label="Waiting for you" value={requests.length} hint="Batch switch requests" />
        ) : (
          <Stat label="Unread updates" value={notes.filter((n) => !n.readAt).length} />
        )}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          {stats.canDecideSwitches && <SwitchRequests uni={uni} requests={requests} />}
          {week && (
            <Card>
              <CardTitle hint={<Link href={`/${uni}/admin/products/courses`} className="text-brand">Your batches</Link>}>Your classes this week</CardTitle>
              <WeekView from={week.from} today={week.today} sessions={week.sessions} compact />
            </Card>
          )}
          {!stats.canDecideSwitches && !week && (
            <Card>
              <CardTitle>Quick links</CardTitle>
              <div className="flex flex-wrap gap-3 text-sm">
                {stats.canSeeFinance && <Link className="text-brand" href={`/${uni}/admin/finance/sales`}>Sales</Link>}
                <Link className="text-brand" href={`/${uni}/admin/products/courses`}>Courses</Link>
              </div>
            </Card>
          )}
        </div>
        <Card>
          <CardTitle>Updates</CardTitle>
          {notes.length === 0 ? (
            <Empty title="You're all caught up" />
          ) : (
            <ul className="space-y-3">
              {notes.map((n) => (
                <li key={n.id} className="text-sm">
                  <div className="font-medium">{n.title}</div>
                  {n.body && <div className="text-muted">{n.body}</div>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
