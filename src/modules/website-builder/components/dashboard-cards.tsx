import Link from "next/link";
import type { DashboardCardProps } from "@/contracts/module";
import { ButtonLink, Card, CardTitle, cx } from "@/components/ui";
import { canManageSite, isTeachingStaff } from "../access";
import { getMyProfile, PROFILE_STATUS_LABEL } from "../faculty";
import { plural } from "../format";
import { siteOverview } from "../overview";

/** Admin dashboard: what on the website needs attention (enquiries, reviews, profiles, an unpublished draft). */
export async function WebsiteCard({ uni, actor }: DashboardCardProps) {
  if (!canManageSite(actor)) return null;
  const o = await siteOverview(actor);
  const base = `/${uni}/admin/website`;
  const items = [
    { n: o.enquiries.new, text: plural(o.enquiries.new, "new enquiry", "new enquiries"), href: `${base}/sections/enquiries` },
    { n: o.reviews.pending, text: `${plural(o.reviews.pending, "review")} to approve or hide`, href: `${base}/sections/reviews` },
    { n: o.profilesPending, text: `${plural(o.profilesPending, "faculty profile")} waiting for approval`, href: `${base}/profile/faculty` },
    { n: o.page.hasChanges ? 1 : 0, text: o.page.live ? "Home page changes not published yet" : "Website not published yet", href: `${base}/profile/builder` },
  ].filter((i) => i.n > 0);

  return (
    <Card>
      <CardTitle
        hint={
          <a href={`/site/${uni}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">
            View website
          </a>
        }
      >
        Website
      </CardTitle>
      {items.length === 0 ? (
        <p className="text-[14px] text-muted">
          Nothing needs you right now. {plural(o.enquiries.contacted, "enquiry", "enquiries")} in progress.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((i) => (
            <li key={i.href}>
              <Link href={i.href} className="flex items-center gap-3 py-2.5 text-[14px] hover:text-brand">
                <span className={cx("h-2 w-2 shrink-0 rounded-full bg-gold")} aria-hidden />
                {i.text}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Teaching staff: their public profile page, and a way in (they don't see the Website menu). */
export async function MyProfileCard({ uni, actor }: DashboardCardProps) {
  if (!isTeachingStaff(actor)) return null;
  const mine = await getMyProfile(actor);
  if (!mine.eligible) return null;
  const p = mine.profile;
  const line = !p
    ? "Students and visitors can read about you on the university website. Add a photo and a short bio."
    : p.status === "changes_requested"
      ? `An admin asked for changes: ${p.reviewNote}`
      : p.status === "approved"
        ? p.visible
          ? "Your profile is live on the university website."
          : "Your profile is approved but hidden from the website for now."
        : p.status === "pending"
          ? "Waiting for an admin to approve it."
          : "Your draft isn't sent yet.";
  return (
    <Card className={cx(p?.status === "changes_requested" && "border-gold/60")}>
      <CardTitle hint={p ? PROFILE_STATUS_LABEL[p.status] : "Not started"}>Your public profile</CardTitle>
      <p className="mb-4 text-[14px] text-muted">{line}</p>
      <ButtonLink href={`/${uni}/admin/website/profile/me`} variant={p ? "secondary" : "primary"} size="sm">
        {p ? "Edit my profile page" : "Write my profile page"}
      </ButtonLink>
    </Card>
  );
}
