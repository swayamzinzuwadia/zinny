import Link from "next/link";
import { Empty } from "@/components/ui";
import { can } from "@/server/core";
import { spaceContext } from "@/server/context";
import { PollCard } from "@/modules/assignments-polls/components/learner-bits";
import { learnBase } from "@/modules/assignments-polls/links";
import { myPolls } from "@/modules/assignments-polls/service/polls";

export const metadata = { title: "Polls" };

/** Polls in the student's courses: vote in open ones, see results of closed ones. */
export default async function PollsPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  if (!can(actor, "self.vote", { universityId: university.id, ownerUserId: actor.userId })) {
    return <Empty title="Polls are for current students" />;
  }
  const polls = await myPolls(actor);
  const sections = [
    { key: "open", title: "Open", items: polls.filter((p) => p.state === "open") },
    { key: "upcoming", title: "Opening soon", items: polls.filter((p) => p.state === "upcoming") },
    { key: "closed", title: "Closed", items: polls.filter((p) => p.state === "closed") },
  ].filter((s) => s.items.length > 0);

  return (
    <>
      <Link href={learnBase(uni)} className="text-sm text-muted">
        Assignments
      </Link>
      <h1 className="mb-5 mt-2 text-[26px] font-semibold tracking-tight">Polls</h1>
      {sections.length === 0 ? (
        <Empty title="No polls yet">When a teacher asks your batch a question, you vote here.</Empty>
      ) : (
        <div className="space-y-7">
          {sections.map((s) => (
            <section key={s.key}>
              <h2 className="mb-2.5 text-[17px] font-medium">
                {s.title} <span className="text-[14px] font-normal text-faint">{s.items.length}</span>
              </h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {s.items.map((p) => (
                  <PollCard key={p.id} uni={uni} p={p} tz={university.timezone} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
