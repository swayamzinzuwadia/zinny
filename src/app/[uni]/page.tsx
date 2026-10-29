import { redirect } from "next/navigation";
import { spaceContext } from "@/server/context";

/**
 * A university's bare address (/<slug>). Signed-out people are sent to sign in by
 * spaceContext (with ?next=/<slug>), and come back here to land in their own app.
 */
export default async function SpaceHome({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { isAdminUser, isLearner } = await spaceContext(uni);
  redirect(isAdminUser ? `/${uni}/admin` : isLearner ? `/${uni}/learn` : "/");
}
