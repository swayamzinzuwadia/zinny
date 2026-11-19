import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui";
import { display } from "./fonts";

/**
 * The frame of the public onboarding pages (/signup, /signup/institute, /book-a-demo,
 * /frozen): the logo, a way to sign in, and the page. Nothing else: no marketing sections,
 * so people stay on the task.
 */
export function OnboardingShell({ children, signIn = true, wide = false }: { children: ReactNode; signIn?: boolean; wide?: boolean }) {
  return (
    <div className={`display-headings flex min-h-dvh flex-col bg-canvas text-ink ${display.variable}`}>
      <header className="mx-auto flex w-full max-w-[1100px] items-center justify-between gap-4 px-4 pt-5 sm:px-8 sm:pt-7">
        <Link href="/" aria-label="Zinny home" className="inline-flex rounded-lg">
          <Logo height={30} />
        </Link>
        {signIn && (
          <p className="text-[14px] text-muted">
            Have an account?{" "}
            <Link href="/login" className="font-medium text-brand hover:underline">
              Sign in
            </Link>
          </p>
        )}
      </header>
      <main className={`mx-auto w-full flex-1 px-4 pt-8 pb-16 sm:px-8 sm:pt-12 ${wide ? "max-w-[1100px]" : "max-w-[760px]"}`}>{children}</main>
    </div>
  );
}
