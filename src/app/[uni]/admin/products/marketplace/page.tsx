import { redirect } from "next/navigation";

/** The marketplace moved from Products to its own section in the sidebar. */
export default async function OldMarketplace({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  redirect(`/${uni}/admin/marketplace`);
}
