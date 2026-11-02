import { redirect } from "next/navigation";

/** The marketplace moved from Products to its own section in the sidebar. */
export default async function OldListing({ params }: { params: Promise<{ uni: string; id: string }> }) {
  const { uni, id } = await params;
  redirect(`/${uni}/admin/marketplace/${id}`);
}
