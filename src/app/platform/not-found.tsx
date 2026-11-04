import Link from "next/link";
import { buttonClass } from "@/components/ui";

/** An institute, invoice, course or person that doesn't exist (or a mistyped address), inside the panel. */
export default function PlatformNotFound() {
  return (
    <div className="mx-auto mt-10 max-w-md rounded-[22px] border border-line bg-surface p-8 text-center">
      <p className="font-medium">This page isn&apos;t here</p>
      <p className="mt-1 text-[14px] text-muted">The link may be old, or what it pointed to was removed. Check the address, or start again from the menu.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link href="/platform" className={buttonClass("primary")}>
          Go to the Zinny team home
        </Link>
      </div>
    </div>
  );
}
