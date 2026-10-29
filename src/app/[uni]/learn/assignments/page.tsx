import Link from "next/link";
import { Empty } from "@/components/ui";
import { can } from "@/server/core";
import { spaceContext } from "@/server/context";
import { AssignmentRow, groupAssignments } from "@/modules/assignments-polls/components/learner-bits";
import { pollsBase } from "@/modules/assignments-polls/links";
import { myAssignments } from "@/modules/assignments-polls/service/assignments";
import { myPolls } from "@/modules/assignments-polls/service/polls";

export const metadata = { title: "Assignments" };

/** Every assignment across the student's courses: to do, handed in, graded, missed. */
export default async function MyAssignmentsPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  const own = { universityId: university.id, ownerUserId: actor.userId };
  if (!can(actor, "self.submit_assignment", own)) {
    return <Empty title="Assignments are for current students">Your children&apos;s assignments aren&apos;t shown here.</Empty>;
  }
  const [list, polls] = await Promise.all([myAssignments(actor), can(actor, "self.vote", own) ? myPolls(actor) : Promise.resolve([])]);
  const groups = groupAssignments(list);
  const toVote = polls.filter((p) => p.canVote).length;

  return (
    <>
      <Link href={`/${uni}/learn/my`} className="text-sm text-muted">
        My learning
      </Link>
      <div className="mb-5 mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-[26px] font-semibold tracking-tight">Assignments</h1>
        <Link href={pollsBase(uni)} className="text-[14px] font-medium text-brand">
          Polls{toVote ? ` (${toVote} to vote in)` : ""}
        </Link>
      </div>
      {groups.length === 0 ? (
        <Empty title="No assignments yet">When your teachers set work, it shows up here with its due date.</Empty>
      ) : (
        <div className="space-y-7">
          {groups.map((g) => (
            <section key={g.key}>
              <h2 className="mb-2.5 text-[17px] font-medium">
                {g.title} <span className="text-[14px] font-normal text-faint">{g.items.length}</span>
              </h2>
              <div className="space-y-2.5">
                {g.items.map((a) => (
                  <AssignmentRow key={a.id} uni={uni} a={a} tz={university.timezone} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
