import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { submitEnquiryAction, submitReviewAction } from "../../actions";
import { formatDate } from "../../format";
import type { HomeData, SiteInfo } from "../../public";
import type { PageSection } from "../../sections";
import { container, CourseRow, FacultyCard, Paragraphs, PostCard, SectionHead, SiteImage, SocialLinks, Stars, telHref, whatsappHref } from "./bits";
import { EnquiryForm, ReviewForm } from "./forms";
import { YouTubeLite } from "./youtube";

function Band({ id, children, tone }: { id: string; children: ReactNode; tone?: "soft" }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className={cx("scroll-mt-20 py-16 sm:py-20", tone === "soft" && "bg-[var(--site-soft)]")}>
      <div className={container}>{children}</div>
    </section>
  );
}

/** The chalkboard: the university's colour, its headline, and what is starting next. */
function Hero({ site, s, data, uni }: { site: SiteInfo; s: PageSection; data: HomeData; uni: string }) {
  const visible = new Set(data.sections.map((x) => x.type));
  const next = data.hero.nextBatch;
  return (
    <section id="hero" className={cx(container, "pt-5 sm:pt-8")}>
      <div className="relative overflow-hidden rounded-[28px] bg-[var(--site-deep)] text-[var(--site-on-primary)]">
        <div className="grid lg:grid-cols-[1.15fr_1fr]">
          <div className="relative z-10 flex flex-col justify-center gap-6 px-6 py-11 sm:px-12 sm:py-16 lg:py-24">
            {next && (
              <Link
                href={`/site/${uni}/courses/${next.courseId}`}
                className="inline-flex items-center gap-2.5 self-start rounded-full bg-[var(--site-on-primary)]/10 py-1.5 pl-3 pr-4 text-[13px] leading-tight hover:bg-[var(--site-on-primary)]/15 sm:text-[14px]"
              >
                <span className="now-dot h-2 w-2 shrink-0 rounded-full bg-gold" aria-hidden />
                <span>
                  {next.courseTitle}: next batch starts {formatDate(next.startDate, { weekday: true, year: false })}
                </span>
              </Link>
            )}
            <h1 className="text-balance text-[38px] font-semibold leading-[1.04] tracking-[-0.035em] sm:text-[54px] lg:text-[62px]">{s.heading || site.name}</h1>
            {(s.intro || site.tagline) && <p className="max-w-xl text-[17px] leading-relaxed text-[var(--site-on-primary)]/80 sm:text-[19px]">{s.intro || site.tagline}</p>}
            <div className="flex flex-wrap gap-3 pt-1">
              {visible.has("courses") && data.courses.length > 0 && (
                <a href="#courses" className="inline-flex h-12 items-center rounded-full bg-[var(--site-on-primary)] px-6 text-[15px] font-medium text-[var(--site-deep)] hover:opacity-90">
                  See courses
                </a>
              )}
              {visible.has("enquiry") && (
                <a href="#enquiry" className="inline-flex h-12 items-center rounded-full border border-[var(--site-on-primary)]/35 px-6 text-[15px] font-medium hover:bg-[var(--site-on-primary)]/10">
                  Ask a question
                </a>
              )}
            </div>
          </div>
          <div className="relative min-h-[240px] sm:min-h-[320px] lg:min-h-full">
            {data.hero.image ? (
              <SiteImage image={data.hero.image} alt="" priority sizes="(min-width: 1024px) 540px, 100vw" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <BoardLines />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Faint chalk lines for a hero without a picture. */
function BoardLines() {
  return (
    <svg aria-hidden className="absolute inset-0 h-full w-full text-[var(--site-on-primary)]" preserveAspectRatio="xMidYMid slice" viewBox="0 0 540 420">
      <g fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="1.2">
        {Array.from({ length: 9 }, (_, i) => (
          <circle key={i} cx="430" cy="300" r={40 + i * 42} />
        ))}
      </g>
      <path d="M120 120 L220 175 L120 230 Z" fill="currentColor" fillOpacity="0.1" />
    </svg>
  );
}

function About({ site, s }: { site: SiteInfo; s: PageSection }) {
  const body = s.body || site.about;
  const highlights = [...(s.highlights ?? [])];
  if (!highlights.length && site.foundedYear) highlights.push({ value: String(site.foundedYear), label: "Founded" });
  if (!body && !highlights.length) return null;
  return (
    <Band id="about">
      <div className="grid gap-12 lg:grid-cols-[1fr_300px] lg:gap-20">
        <div>
          <SectionHead id="about" heading={s.heading} intro={s.intro} />
          <div className="max-w-[68ch] space-y-5 text-[17px] leading-[1.75] text-ink/90">
            <Paragraphs text={body} />
          </div>
        </div>
        {highlights.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-8 self-end lg:grid-cols-1">
            {highlights.map((h) => (
              <div key={h.label} className="border-t border-[var(--site-line)] pt-4">
                <dt className="sr-only">{h.label}</dt>
                <dd className="tabular text-[40px] font-semibold leading-none tracking-[-0.03em] text-[var(--site-primary)] sm:text-[46px]">{h.value}</dd>
                <dd className="mt-2 text-[14px] text-muted">{h.label}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </Band>
  );
}

function Courses({ uni, s, data }: { uni: string; s: PageSection; data: HomeData }) {
  if (data.courses.length === 0) return null;
  const more = s.limit && data.courseOptions.length > data.courses.length;
  return (
    <Band id="courses">
      <SectionHead id="courses" heading={s.heading} intro={s.intro} />
      <ul className="divide-y divide-[var(--site-line)] border-y border-[var(--site-line)]">
        {data.courses.map((c) => (
          <CourseRow key={c.id} uni={uni} c={c} />
        ))}
      </ul>
      {more ? (
        <p className="mt-6 text-[15px] text-muted">
          {data.courseOptions.length - data.courses.length} more courses: ask us about them in the enquiry form below.
        </p>
      ) : null}
    </Band>
  );
}

function Faculty({ uni, s, data }: { uni: string; s: PageSection; data: HomeData }) {
  if (data.faculty.length === 0) return null;
  return (
    <Band id="faculty">
      <SectionHead id="faculty" heading={s.heading} intro={s.intro} />
      <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
        {data.faculty.map((f) => (
          <FacultyCard key={f.id} uni={uni} f={f} />
        ))}
      </div>
    </Band>
  );
}

function Person({ name, byline, photo }: { name: string; byline: string; photo: HomeData["testimonials"][number]["photo"] }) {
  return (
    <figcaption className="mt-5 flex items-center gap-3">
      {photo && <SiteImage image={photo} alt="" sizes="48px" className="h-12 w-12 rounded-full object-cover" />}
      <span>
        <span className="block font-semibold">{name}</span>
        {byline && <span className="block text-[14px] text-muted">{byline}</span>}
      </span>
    </figcaption>
  );
}

function Testimonials({ s, data }: { s: PageSection; data: HomeData }) {
  const [first, ...rest] = data.testimonials;
  if (!first) return null;
  return (
    <Band id="testimonials">
      <SectionHead id="testimonials" heading={s.heading} intro={s.intro} />
      <figure className="max-w-4xl">
        <blockquote className="text-[23px] font-medium leading-[1.4] tracking-[-0.015em] sm:text-[30px]">
          <span aria-hidden className="text-[var(--site-primary)]">“</span>
          {first.quote}
          <span aria-hidden className="text-[var(--site-primary)]">”</span>
        </blockquote>
        <Person name={first.name} byline={first.byline} photo={first.photo} />
      </figure>
      {rest.length > 0 && (
        <div className="mt-14 grid gap-10 md:grid-cols-2">
          {rest.map((t) => (
            <figure key={t.id} className="border-l-2 border-[var(--site-primary)] pl-5">
              <blockquote className="text-[17px] leading-relaxed text-ink/90">“{t.quote}”</blockquote>
              <Person name={t.name} byline={t.byline} photo={t.photo} />
            </figure>
          ))}
        </div>
      )}
    </Band>
  );
}

function Reviews({ uni, s, data }: { uni: string; s: PageSection; data: HomeData }) {
  const r = data.reviews;
  if (r.count === 0 && !s.allowSubmissions) return null;
  return (
    <Band id="reviews">
      <SectionHead id="reviews" heading={s.heading} intro={s.intro} />
      <div className="grid gap-12 lg:grid-cols-[280px_1fr] lg:gap-16">
        <div>
          {r.average !== null ? (
            <>
              <div className="tabular text-[56px] font-semibold leading-none tracking-[-0.03em]">{r.average.toFixed(1)}</div>
              <Stars rating={r.average} size={20} className="mt-3 text-[var(--site-primary)]" />
              <div className="mt-2 text-[14px] text-muted">From {r.count === 1 ? "1 review" : `${r.count} reviews`}</div>
              <ul className="mt-6 space-y-2" aria-label="Reviews by rating">
                {([5, 4, 3, 2, 1] as const).map((n) => (
                  <li key={n} className="flex items-center gap-3 text-[13px]">
                    <span className="w-12 text-muted">{n} star{n === 1 ? "" : "s"}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--site-line)]">
                      <span className="block h-full rounded-full bg-[var(--site-primary)]" style={{ width: `${(r.distribution[n] / r.count) * 100}%` }} />
                    </span>
                    <span className="tabular w-5 text-right text-muted">{r.distribution[n]}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-[17px] text-muted">No reviews yet. Studied with us? Tell others what it was like.</p>
          )}
        </div>
        <div>
          {r.items.length > 0 && (
            <ul className="divide-y divide-[var(--site-line)]">
              {r.items.map((x) => (
                <li key={x.id} className="py-6 first:pt-0">
                  <Stars rating={x.rating} className="text-[var(--site-primary)]" />
                  <p className="mt-3 whitespace-pre-line text-[16px] leading-relaxed">{x.body}</p>
                  <p className="mt-3 text-[14px] text-muted">
                    <span className="font-medium text-ink">{x.name}</span>
                    {x.courseTitle && <>, {x.courseTitle}</>}, {formatDate(x.date.slice(0, 10))}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {s.allowSubmissions && (
            <details className="group mt-6 rounded-[22px] border border-[var(--site-line)] bg-surface" open={r.count === 0}>
              <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4 text-[15px] font-medium [&::-webkit-details-marker]:hidden">
                Write a review
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="transition-transform group-open:rotate-45">
                  <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </summary>
              <div className="px-6 pb-6">
                <p className="mb-4 text-[14px] text-muted">Reviews appear once our team has checked them. We never show your email.</p>
                <ReviewForm uni={uni} action={submitReviewAction} courses={data.courseOptions} />
              </div>
            </details>
          )}
        </div>
      </div>
    </Band>
  );
}

function Gallery({ s, data }: { s: PageSection; data: HomeData }) {
  if (data.gallery.length === 0) return null;
  return (
    <Band id="gallery">
      <SectionHead id="gallery" heading={s.heading} intro={s.intro} />
      <div className="columns-1 gap-4 sm:columns-2 lg:columns-3">
        {data.gallery.map((g) => (
          <figure key={g.id} className="mb-4 break-inside-avoid">
            <SiteImage image={g.image} sizes="(min-width: 1024px) 370px, (min-width: 640px) 50vw, 100vw" className="h-auto w-full rounded-[18px]" />
            {g.caption && <figcaption className="mt-2 text-[13px] text-muted">{g.caption}</figcaption>}
          </figure>
        ))}
      </div>
    </Band>
  );
}

function Videos({ s, data }: { s: PageSection; data: HomeData }) {
  if (data.videos.length === 0) return null;
  return (
    <Band id="videos">
      <SectionHead id="videos" heading={s.heading} intro={s.intro} />
      <div className="grid gap-x-8 gap-y-12 md:grid-cols-2">
        {data.videos.map((v) => (
          <div key={v.id}>
            <YouTubeLite id={v.youtubeId} title={v.title} />
            <h3 className="mt-4 text-[18px] font-semibold leading-snug">{v.title}</h3>
            {v.description && <p className="mt-1 text-[15px] text-muted">{v.description}</p>}
          </div>
        ))}
      </div>
    </Band>
  );
}

function Blog({ uni, s, data }: { uni: string; s: PageSection; data: HomeData }) {
  const [first, ...rest] = data.posts;
  if (!first) return null;
  return (
    <Band id="blog">
      <SectionHead
        id="blog"
        heading={s.heading}
        intro={s.intro}
        action={
          <Link href={`/site/${uni}/blog`} className="text-[15px] font-medium text-[var(--site-primary)] underline decoration-1 underline-offset-4">
            All posts
          </Link>
        }
      />
      <PostCard uni={uni} p={first} large />
      {rest.length > 0 && (
        <div className="mt-14 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((p) => (
            <PostCard key={p.id} uni={uni} p={p} />
          ))}
        </div>
      )}
    </Band>
  );
}

function Team({ s, data }: { s: PageSection; data: HomeData }) {
  if (data.team.length === 0) return null;
  return (
    <Band id="team">
      <SectionHead id="team" heading={s.heading} intro={s.intro} />
      <ul className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {data.team.map((m) => (
          <li key={m.id} className="flex items-start gap-4">
            {m.photo ? (
              <SiteImage image={m.photo} alt={`Photo of ${m.name}`} sizes="72px" className="h-[72px] w-[72px] shrink-0 rounded-full object-cover" />
            ) : (
              <span aria-hidden className="h-[72px] w-[72px] shrink-0 rounded-full bg-[var(--site-soft)]" />
            )}
            <div className="min-w-0">
              <div className="font-semibold">{m.name}</div>
              <div className="text-[14px] text-[var(--site-primary)]">{m.title}</div>
              {m.bio && <p className="mt-2 text-[14px] leading-relaxed text-muted">{m.bio}</p>}
              {m.linkedinUrl && (
                <a href={m.linkedinUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[13px] underline underline-offset-4">
                  LinkedIn
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Band>
  );
}

function Enquiry({ uni, site, s, data }: { uni: string; site: SiteInfo; s: PageSection; data: HomeData }) {
  return (
    <Band id="enquiry" tone="soft">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
        <div>
          <SectionHead id="enquiry" heading={s.heading} intro={s.intro} />
          <ul className="space-y-3 text-[16px]">
            {site.phone && (
              <li>
                <span className="text-muted">Call </span>
                <a href={telHref(site.phone)} className="font-medium underline decoration-1 underline-offset-4">
                  {site.phone}
                </a>
              </li>
            )}
            {site.whatsapp && (
              <li>
                <span className="text-muted">WhatsApp </span>
                <a href={whatsappHref(site.whatsapp)} target="_blank" rel="noopener noreferrer" className="font-medium underline decoration-1 underline-offset-4">
                  {site.whatsapp}
                </a>
              </li>
            )}
            {site.email && (
              <li>
                <span className="text-muted">Email </span>
                <a href={`mailto:${site.email}`} className="font-medium underline decoration-1 underline-offset-4">
                  {site.email}
                </a>
              </li>
            )}
          </ul>
        </div>
        <div className="rounded-[28px] bg-surface p-6 shadow-[0_1px_0_var(--site-line)] sm:p-8">
          <EnquiryForm uni={uni} action={submitEnquiryAction} courses={data.courseOptions} source="home" />
        </div>
      </div>
    </Band>
  );
}

function Contact({ site, s }: { site: SiteInfo; s: PageSection }) {
  if (!site.address && !site.phone && !site.email && !Object.values(site.social).some(Boolean)) return null;
  return (
    <Band id="contact">
      <SectionHead id="contact" heading={s.heading} intro={s.intro} />
      <div className="grid gap-10 border-t border-[var(--site-line)] pt-8 md:grid-cols-3">
        {site.address && (
          <div>
            <h3 className="text-[14px] text-muted">Address</h3>
            <p className="mt-2 whitespace-pre-line text-[16px] leading-relaxed">{site.address}</p>
            {site.mapUrl && (
              <a href={site.mapUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-[15px] font-medium text-[var(--site-primary)] underline decoration-1 underline-offset-4">
                Open in Maps
              </a>
            )}
          </div>
        )}
        {(site.phone || site.whatsapp) && (
          <div>
            <h3 className="text-[14px] text-muted">Phone</h3>
            {site.phone && (
              <a href={telHref(site.phone)} className="mt-2 block text-[16px] font-medium hover:underline">
                {site.phone}
              </a>
            )}
            {site.whatsapp && (
              <a href={whatsappHref(site.whatsapp)} target="_blank" rel="noopener noreferrer" className="mt-1 block text-[15px] text-muted hover:underline">
                WhatsApp {site.whatsapp}
              </a>
            )}
          </div>
        )}
        <div>
          {site.email && (
            <>
              <h3 className="text-[14px] text-muted">Email</h3>
              <a href={`mailto:${site.email}`} className="mt-2 block break-all text-[16px] font-medium hover:underline">
                {site.email}
              </a>
            </>
          )}
          <div className="mt-5">
            <SocialLinks social={site.social} />
          </div>
        </div>
      </div>
    </Band>
  );
}

/** The home page: the given sections, in order. Used by the live page and the draft preview. */
export function HomeSections({ uni, site, data }: { uni: string; site: SiteInfo; data: HomeData }) {
  return (
    <>
      {data.sections.map((s) => {
        switch (s.type) {
          case "hero":
            return <Hero key={s.type} uni={uni} site={site} s={s} data={data} />;
          case "about":
            return <About key={s.type} site={site} s={s} />;
          case "courses":
            return <Courses key={s.type} uni={uni} s={s} data={data} />;
          case "faculty":
            return <Faculty key={s.type} uni={uni} s={s} data={data} />;
          case "testimonials":
            return <Testimonials key={s.type} s={s} data={data} />;
          case "reviews":
            return <Reviews key={s.type} uni={uni} s={s} data={data} />;
          case "gallery":
            return <Gallery key={s.type} s={s} data={data} />;
          case "videos":
            return <Videos key={s.type} s={s} data={data} />;
          case "blog":
            return <Blog key={s.type} uni={uni} s={s} data={data} />;
          case "team":
            return <Team key={s.type} s={s} data={data} />;
          case "enquiry":
            return <Enquiry key={s.type} uni={uni} site={site} s={s} data={data} />;
          case "contact":
            return <Contact key={s.type} site={site} s={s} />;
        }
      })}
    </>
  );
}

/** Before the first publish: who we are and how to reach us. */
export function ComingSoon({ site }: { site: SiteInfo }) {
  return (
    <section className={cx(container, "py-20 sm:py-28")}>
      <div className="max-w-2xl">
        <h1 className="text-[40px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[52px]">{site.name}</h1>
        {site.tagline && <p className="mt-4 text-[19px] leading-relaxed text-muted">{site.tagline}</p>}
        <p className="mt-8 text-[17px]">Our new website is on its way.</p>
        <ul className="mt-6 space-y-2 text-[16px]">
          {site.phone && (
            <li>
              Call{" "}
              <a href={telHref(site.phone)} className="font-medium underline underline-offset-4">
                {site.phone}
              </a>
            </li>
          )}
          {site.email && (
            <li>
              Email{" "}
              <a href={`mailto:${site.email}`} className="font-medium underline underline-offset-4">
                {site.email}
              </a>
            </li>
          )}
          <li>
            Students:{" "}
            <a href="/login" className="font-medium underline underline-offset-4">
              sign in
            </a>
          </li>
        </ul>
      </div>
    </section>
  );
}
