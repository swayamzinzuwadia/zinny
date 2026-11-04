import { notFound } from "next/navigation";

/** Any address under /platform that isn't a page shows the panel's own "not here" page, with the menu. */
export default function MissingPlatformPage() {
  notFound();
}
