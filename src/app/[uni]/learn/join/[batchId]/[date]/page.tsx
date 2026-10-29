import { notFound, redirect } from "next/navigation";
import { hasRole } from "@/server/core";
import { spaceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { JoinStatePage, NotAStudentPage } from "@/modules/live-classes/components/join-page";
import { joinClass } from "@/modules/live-classes/join";

export const metadata = { title: "Join class" };
export const dynamic = "force-dynamic";

/**
 * The Join button's target (contracts: core Join buttons link here with a plain <a>).
 * Inside the window it records the join and redirects to the meeting; otherwise it says
 * when the class is and what to do. `?start=HH:MM` picks a class when a batch has two in a day.
 */
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ uni: string; batchId: string; date: string }>;
  searchParams: Promise<{ start?: string | string[] }>;
}) {
  const { uni, batchId, date } = await params;
  const { start } = await searchParams;
  const { actor } = await spaceContext(uni);
  if (!hasRole(actor, ["student"])) return <NotAStudentPage uni={uni} />;

  const now = new Date();
  const out = await joinClass(actor, batchId, date, typeof start === "string" && /^\d{2}:\d{2}$/.test(start) ? start : null, now).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (out.kind === "go") redirect(out.url);
  return <JoinStatePage uni={uni} out={out} batchId={batchId} now={now} />;
}
