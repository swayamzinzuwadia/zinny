import { notFound } from "next/navigation";

/** Any admin address that isn't a page: the panel's own "not found", with the sidebar and a way back. */
export default function UnknownAdminPage() {
  notFound();
}
