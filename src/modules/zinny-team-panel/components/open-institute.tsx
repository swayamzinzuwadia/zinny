import Link from "next/link";
import { buttonClass, cx } from "@/components/ui";

/**
 * The way into an institute's admin panel from the Zinny team panel. It goes through the
 * Support mode page with the institute picked, where a reason is required, so every visit
 * is a logged, time-boxed support session. Already inside, it leads back to the dashboard.
 */
export function OpenInstitute({
  universityId,
  slug,
  inside,
  size = "md",
  asLink = false,
}: {
  universityId: string;
  slug: string;
  inside: boolean;
  size?: "md" | "sm";
  /** A text link, for table rows. */
  asLink?: boolean;
}) {
  const className = asLink ? "text-[13px] font-medium text-brand hover:underline" : cx(buttonClass("secondary", size), "whitespace-nowrap");
  if (inside) {
    return (
      <a href={`/${slug}/admin`} className={className}>
        Go to its dashboard
      </a>
    );
  }
  return (
    <Link href={`/platform/support?university=${universityId}`} className={className}>
      Enter support mode
    </Link>
  );
}
