import { redirect } from "next/navigation";
import { hasRole, type Actor } from "@/server/authz/engine";
import type { LearnView } from "./nav";

const isStudent = (actor: Actor) => actor.assignments.some((a) => a.role === "student" || a.role === "alumni");

/**
 * Which learner app this person gets: a student's (or alumni's), a parent's read-only home,
 * or a buyer's (someone who only bought from this institute on the marketplace).
 */
export function learnView(actor: Actor, isParent: boolean): LearnView {
  if (isStudent(actor)) return "student";
  return isParent ? "parent" : "buyer";
}

/**
 * A parent (with no student role of their own) only has the home page with their child's
 * week. Every other learner page sends them back there instead of failing.
 */
export function sendParentsHome(actor: Actor, uni: string) {
  if (hasRole(actor, ["parent"]) && !hasRole(actor, ["student", "alumni"])) redirect(`/${uni}/learn`);
}
