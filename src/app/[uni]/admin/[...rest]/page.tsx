import { notFound } from "next/navigation";
import { Empty, PageHeader } from "@/components/ui";

/** Sections that aren't part of this build yet, with where they land in the plan (PRD page 10). */
const PLANNED: Record<string, [string, string]> = {
  "products/categories": ["Categories & utilities", "Carried over from today's panel unchanged."],
  "products/more": ["More products", "Carried over from today's panel unchanged."],
  "website/profile": ["Manage profile", "Institute profile and the website builder. Phase 2."],
  "website/sections": ["Website sections", "Testimonials, reviews, enquiries, gallery, videos, blogs, team. Phase 2."],
  marketing: ["Marketing", "Stays as it is today. Contacts move here."],
  community: ["Community", "Stays as it is today."],
  settings: ["Settings", "Stays as it is today. Legal documents move here."],
};

export default async function Planned({ params }: { params: Promise<{ rest: string[] }> }) {
  const { rest } = await params;
  const entry = PLANNED[rest.join("/")];
  if (!entry) notFound();
  return (
    <>
      <PageHeader title={entry[0]} />
      <Empty title="Not in this build yet">{entry[1]}</Empty>
    </>
  );
}
