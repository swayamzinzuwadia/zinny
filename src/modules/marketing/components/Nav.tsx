import Image from "next/image";
import Link from "next/link";
import css from "../landing.module.css";

/** Glass all the way down, so it reads over the desk, the chalkboard, the gold and the shelf. */
export function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5">
      <nav aria-label="Main" className={`mx-auto flex h-14 max-w-[1360px] items-center justify-between rounded-full pr-2 pl-5 ${css.glass}`}>
        <Link href="/" aria-label="Zinny home" className="flex shrink-0 items-center rounded-full">
          <Image src="/brand/zinny-wordmark.png" alt="Zinny" width={407} height={183} priority className="h-7 w-auto" />
        </Link>
        <div className="flex items-center gap-0.5 text-[14px] sm:gap-1">
          <a href="#features" className="hidden rounded-full px-2 py-2 whitespace-nowrap text-ink [transition-property:color] duration-150 hover:text-brand sm:block sm:px-3">
            For institutes
          </a>
          <Link href="/marketplace" className="rounded-full px-2 py-2 whitespace-nowrap text-ink [transition-property:color] duration-150 hover:text-brand sm:px-3">
            Marketplace
          </Link>
          {/* The narrowest phones have no room for this one; the page below still has a way to sign in. */}
          <Link href="/login" className="hidden rounded-full px-2 py-2 whitespace-nowrap text-ink [transition-property:color] duration-150 hover:text-brand min-[360px]:block sm:px-3">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="ml-1 rounded-full bg-brand px-4 py-2 font-medium whitespace-nowrap text-canvas [transition-property:background-color,transform] duration-150 hover:bg-brand-strong active:scale-[0.96]"
          >
            Sign up
          </Link>
        </div>
      </nav>
    </header>
  );
}
