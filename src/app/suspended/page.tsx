import Link from "next/link";
import { Logo } from "@/components/ui";

export const metadata = { title: "Space paused" };

/** Where spaceContext sends people of a suspended university. */
export default function Suspended() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <Logo height={30} />
      <h1 className="mt-8 text-[26px] font-semibold tracking-tight">This space is paused</h1>
      <p className="mt-3 text-muted">
        Your institute&apos;s Zinny space is suspended, so nobody can sign in to it for now. Your work is kept. Ask your institute&apos;s administrator, or Zinny support, when it will be back.
      </p>
      <Link href="/login" className="mt-6 text-brand underline underline-offset-4">
        Sign in to another institute
      </Link>
    </main>
  );
}
