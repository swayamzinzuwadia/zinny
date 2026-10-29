import Link from "next/link";
import type { ReactNode } from "react";
import { Empty, Tabs, cx } from "@/components/ui";
import type { Actor } from "@/server/core";
import { canManageSite, isTeachingStaff } from "../access";

/** Tabs under Website › Manage profile. People who only teach see just their own profile page. */
export function ProfileTabs({ uni, actor, active, pendingProfiles }: { uni: string; actor: Actor; active: string; pendingProfiles?: number }) {
  const base = `/${uni}/admin/website/profile`;
  const manage = canManageSite(actor);
  const tabs = [
    ...(manage
      ? [
          { key: "institute", label: "Institute profile", href: base },
          { key: "builder", label: "Website builder", href: `${base}/builder` },
          { key: "faculty", label: "Faculty profiles", href: `${base}/faculty`, count: pendingProfiles || undefined },
        ]
      : []),
    ...(isTeachingStaff(actor) ? [{ key: "me", label: "My profile page", href: `${base}/me` }] : []),
  ];
  return tabs.length > 1 ? <Tabs tabs={tabs} active={active} /> : null;
}

export const SECTION_PAGES = [
  { key: "testimonials", label: "Testimonials" },
  { key: "reviews", label: "Reviews" },
  { key: "enquiries", label: "Enquiries" },
  { key: "gallery", label: "Gallery" },
  { key: "videos", label: "Videos" },
  { key: "blog", label: "Blog" },
  { key: "team", label: "Team" },
] as const;

/** Tabs under Website › Website sections. Counts show what needs attention. */
export function SectionTabs({ uni, active, counts = {} }: { uni: string; active: string; counts?: Partial<Record<string, number>> }) {
  const base = `/${uni}/admin/website/sections`;
  return (
    <Tabs
      active={active}
      tabs={[
        { key: "overview", label: "Overview", href: base },
        ...SECTION_PAGES.map((s) => ({ key: s.key, label: s.label, href: `${base}/${s.key}`, count: counts[s.key] || undefined })),
      ]}
    />
  );
}

export function NoAccess({ uni }: { uni: string }) {
  return (
    <Empty title="Only website managers can open this page">
      Ask an Institute Admin if you need to change the website. <Link href={`/${uni}/admin`} className="text-brand underline">Go to the dashboard</Link>
    </Empty>
  );
}

export function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 20 20" aria-hidden>
          <path
            d="M10 1.6l2.5 5.3 5.8.7-4.3 4 1.1 5.8L10 14.6l-5.1 2.8 1.1-5.8-4.3-4 5.8-.7z"
            className={i <= rating ? "fill-ink" : "fill-line"}
          />
        </svg>
      ))}
    </span>
  );
}

/** A small square image, or the person's initials. */
export function Thumb({ src, name, size = 48, round = false }: { src: string | null; name: string; size?: number; round?: boolean }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} className={cx("shrink-0 border border-line object-cover", round ? "rounded-full" : "rounded-xl")} style={{ width: size, height: size }} />
  ) : (
    <span
      aria-hidden
      className={cx("inline-flex shrink-0 items-center justify-center bg-brand-soft font-medium text-brand-strong", round ? "rounded-full" : "rounded-xl")}
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {initials}
    </span>
  );
}

/** Shown / Hidden. */
export function VisibilityBadge({ visible }: { visible: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-[12px]", visible ? "text-brand-strong" : "text-muted")}>
      <span className={cx("h-1.5 w-1.5 rounded-full", visible ? "bg-brand" : "bg-faint")} aria-hidden />
      {visible ? "Shown" : "Hidden"}
    </span>
  );
}

export function Section({ title, hint, children, actions }: { title: string; hint?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-semibold">{title}</h2>
          {hint && <p className="mt-0.5 max-w-2xl text-[14px] text-muted">{hint}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
