import { notFound, redirect } from "next/navigation";
import { spaceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { paperFor } from "@/modules/assessments/attempts";
import { TestPlayer } from "@/modules/assessments/components/test-player";

export const metadata = { title: "Taking a test" };
export const dynamic = "force-dynamic";

/** The attempt in progress. A finished (or timed-out) attempt goes to its result. */
export default async function AttemptPage({ params }: { params: Promise<{ uni: string; attemptId: string }> }) {
  const { uni, attemptId } = await params;
  const { actor } = await spaceContext(uni);
  const res = await paperFor(actor, attemptId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (res.state === "submitted") redirect(`/${uni}/learn/tests/attempt/${attemptId}/result`);
  return <TestPlayer uni={uni} paper={res.paper} />;
}
