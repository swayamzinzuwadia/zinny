"use client";

import { usePathname } from "next/navigation";
import { ButtonLink, PageHeader } from "@/components/ui";

/** A page or record that isn't there: shown inside the admin panel, so the sidebar stays and there's a way back. */
export default function AdminNotFound() {
  const uni = usePathname()?.split("/")[1] ?? "";
  return (
    <>
      <PageHeader
        title="This page isn't here"
        subtitle="The link may be old, or what it pointed to was deleted or moved. Use the menu, or start again from the dashboard."
      />
      <ButtonLink href={`/${uni}/admin`}>Go to the dashboard</ButtonLink>
    </>
  );
}
