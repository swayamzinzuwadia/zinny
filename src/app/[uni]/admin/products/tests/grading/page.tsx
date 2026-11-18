import { redirect } from "next/navigation";

/** Test answers are graded from the one Grading queue, with handed-in assignments. This address still leads there. */
export default async function TestGradingPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  redirect(`/${uni}/admin/products/grading`);
}
