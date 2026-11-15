import { redirect } from "next/navigation";

/** Roles moved to one page for the Zinny team, the Zinny-wide defaults and every institute. */
export default function TeamRolesPage() {
  redirect("/platform/roles");
}
