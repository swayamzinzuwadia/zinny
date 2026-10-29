/** adminCourseTabs.polls: the course's polls with results, and the add-a-poll form. */
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Empty } from "@/components/ui";
import type { CourseTabProps } from "@/contracts/module";
import { closePollAction, createPollAction, deletePollAction } from "../actions";
import { addDaysTo, formatWhen, instantToZoned } from "../lib/time";
import { listCoursePolls, pollFormOptions, type PollResult } from "../service/polls";
import { ResultBars } from "./bits";
import { PollForm } from "./poll-form";

function StateBadge({ p }: { p: PollResult }) {
  if (p.state === "open") return <Badge tone="gold">Open</Badge>;
  if (p.state === "upcoming") return <Badge>Opens later</Badge>;
  return <Badge tone="brand">Closed</Badge>;
}

export async function CoursePollsTab({ uni, actor, course, university }: CourseTabProps) {
  const [polls, form] = await Promise.all([listCoursePolls(actor, course.id), pollFormOptions(actor, course.id)]);
  const tz = university.timezone;
  const now = new Date();
  const nowLocal = instantToZoned(now, tz);
  const today = nowLocal.date;
  const canAdd = form.canAll || form.batches.length > 0;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        {polls.length === 0 && <Empty title="No polls yet">Ask students a quick question, like which day suits an extra class.</Empty>}
        {polls.map((p) => (
          <Card key={p.id}>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[16px] font-medium">{p.question}</h3>
                <div className="mt-0.5 text-[13px] text-muted">
                  {p.batchName ? `${p.batchName} only` : "Every batch"}
                  {" · "}
                  {p.state === "upcoming" ? `Opens ${formatWhen(p.opensAt, tz, now)}` : p.state === "open" ? `Closes ${formatWhen(p.closesAt, tz, now)}` : `Closed ${formatWhen(p.closesAt, tz, now)}`}
                  {p.anonymous && " · Anonymous"}
                  {!p.resultsToStudents && " · Results kept from students"}
                </div>
              </div>
              <StateBadge p={p} />
            </div>
            <ResultBars options={p.options} total={p.totalVotes} />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-[13px] text-muted">
              <span className="tabular">
                {p.totalVotes} of {p.eligible} student{p.eligible === 1 ? "" : "s"} voted
              </span>
              {p.canManage && (
                <div className="flex gap-2">
                  {p.state !== "closed" && (
                    <ActionForm action={closePollAction} confirm={p.state === "open" ? "Close this poll now? Students can't vote after this." : "Cancel this poll before it opens?"}>
                      <input type="hidden" name="uni" value={uni} />
                      <input type="hidden" name="courseId" value={course.id} />
                      <input type="hidden" name="pollId" value={p.id} />
                      <SubmitButton size="sm" variant="secondary">
                        {p.state === "open" ? "Close now" : "Cancel poll"}
                      </SubmitButton>
                    </ActionForm>
                  )}
                  <ActionForm action={deletePollAction} confirm="Delete this poll and its votes? This can't be undone.">
                    <input type="hidden" name="uni" value={uni} />
                    <input type="hidden" name="courseId" value={course.id} />
                    <input type="hidden" name="pollId" value={p.id} />
                    <SubmitButton size="sm" variant="danger">
                      Delete
                    </SubmitButton>
                  </ActionForm>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
      {canAdd && (
        <Card className="h-fit">
          <CardTitle>Add a poll</CardTitle>
          <PollForm
            action={createPollAction}
            uni={uni}
            courseId={course.id}
            batches={form.batches}
            canAll={form.canAll}
            defaults={{ opensDate: today, opensTime: nowLocal.time, closesDate: addDaysTo(today, 3), closesTime: "18:00" }}
            timezoneNote={`Times are in ${tz.replace("_", " ")}.`}
          />
        </Card>
      )}
    </div>
  );
}
