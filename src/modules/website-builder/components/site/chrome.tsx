import Link from "next/link";
import type { SiteInfo } from "../../public";
import { container, Monogram, SocialLinks, telHref } from "./bits";

export function SiteHeader({ site }: { site: SiteInfo }) {
  const home = `/site/${site.slug}`;
  const enquire = site.nav.length ? `${home}#enquiry` : null;
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--site-line)] bg-canvas/90 backdrop-blur supports-[backdrop-filter]:bg-canvas/75">
      <div className={`${container} flex h-[68px] items-center justify-between gap-4`}>
        <Link href={home} className="flex min-w-0 items-center gap-3">
          <Monogram site={site} size={40} />
          <span className="min-w-0">
            <span className="block truncate text-[17px] font-semibold leading-tight tracking-[-0.01em]">{site.name}</span>
            {site.city && <span className="block truncate text-[12px] text-muted">{site.city}</span>}
          </span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {site.nav.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-full px-3 py-2 text-[14px] text-ink/80 hover:bg-[var(--site-soft)] hover:text-ink">
              {n.label}
            </Link>
          ))}
          <Link href="/login" prefetch={false} className="rounded-full px-3 py-2 text-[14px] text-ink/80 hover:bg-[var(--site-soft)] hover:text-ink">
              Sign in
            </Link>
          {enquire && (
            <Link href={enquire} className="ml-2 inline-flex h-10 items-center rounded-full bg-[var(--site-primary)] px-5 text-[14px] font-medium text-[var(--site-on-primary)] hover:opacity-90">
              Enquire
            </Link>
          )}
        </nav>

        <details className="group relative lg:hidden">
          <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-full border border-[var(--site-line)] px-4 text-[14px] [&::-webkit-details-marker]:hidden">
            Menu
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="transition-transform group-open:rotate-180">
              <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <div className="absolute right-0 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-[22px] border border-[var(--site-line)] bg-surface p-2 shadow-[0_12px_40px_-12px_rgb(20_38_31/0.25)]">
            {site.nav.map((n) => (
              <Link key={n.href} href={n.href} className="block rounded-2xl px-4 py-3 text-[15px] hover:bg-[var(--site-soft)]">
                {n.label}
              </Link>
            ))}
            <Link href="/login" prefetch={false} className="block rounded-2xl px-4 py-3 text-[15px] hover:bg-[var(--site-soft)]">
              Sign in
            </Link>
            {enquire && (
              <Link href={enquire} className="mt-1 block rounded-2xl bg-[var(--site-primary)] px-4 py-3 text-center text-[15px] font-medium text-[var(--site-on-primary)]">
                Enquire
              </Link>
            )}
          </div>
        </details>
      </div>
    </header>
  );
}

export function SiteFooter({ site }: { site: SiteInfo }) {
  const home = `/site/${site.slug}`;
  const year = new Date().getFullYear();
  return (
    <footer className="mt-12 bg-[var(--site-deep)] text-[var(--site-on-primary)]">
      <div className={`${container} grid gap-10 py-14 md:grid-cols-[1.3fr_1fr_1fr]`}>
        <div>
          <div className="flex items-center gap-3">
            <Monogram site={site} size={40} onDark />
            <span className="text-[19px] font-semibold">{site.name}</span>
          </div>
          {site.tagline && <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-[var(--site-on-primary)]/75">{site.tagline}</p>}
        </div>
        <div className="space-y-2 text-[15px] leading-relaxed text-[var(--site-on-primary)]/85">
          {site.address && <p className="whitespace-pre-line">{site.address}</p>}
          {site.phone && (
            <p>
              <a href={telHref(site.phone)} className="hover:underline">
                {site.phone}
              </a>
            </p>
          )}
          {site.email && (
            <p>
              <a href={`mailto:${site.email}`} className="hover:underline">
                {site.email}
              </a>
            </p>
          )}
        </div>
        <div className="space-y-4">
          <ul className="space-y-2 text-[15px]">
            <li>
              <Link href={home} className="hover:underline">
                Home
              </Link>
            </li>
            {site.nav
              .filter((n) => n.label !== "About" && n.label !== "Contact")
              .map((n) => (
                <li key={n.href}>
                  <Link href={n.href} className="hover:underline">
                    {n.label}
                  </Link>
                </li>
              ))}
            <li>
              <Link href="/login" prefetch={false} className="hover:underline">
              Student sign in
            </Link>
            </li>
          </ul>
          <SocialLinks social={site.social} tone="light" />
        </div>
      </div>
      <div className="border-t border-[var(--site-on-primary)]/15">
        <div className={`${container} flex flex-wrap justify-between gap-2 py-5 text-[13px] text-[var(--site-on-primary)]/60`}>
          <span>
            © {year} {site.name}
          </span>
          <span>Runs on Zinny</span>
        </div>
      </div>
    </footer>
  );
}
