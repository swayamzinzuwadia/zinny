/**
 * The home page's sections: what each one is, its defaults, and how stored or submitted
 * values are cleaned. Shared by the service, the builder UI and the public site.
 *
 * The page always holds each of the twelve sections exactly once. An admin orders them,
 * shows or hides them, and edits their wording; the content inside most of them
 * (courses, faculty, testimonials…) comes from elsewhere automatically.
 */

export const SECTION_TYPES = [
  "hero",
  "about",
  "courses",
  "faculty",
  "testimonials",
  "reviews",
  "gallery",
  "videos",
  "blog",
  "team",
  "enquiry",
  "contact",
] as const;

export type SectionType = (typeof SECTION_TYPES)[number];

export type Highlight = { value: string; label: string };

export type PageSection = {
  type: SectionType;
  visible: boolean;
  heading: string;
  intro: string;
  /** hero: the picture on the right. Null = the institute's cover image. */
  imageMediaId?: string | null;
  /** hero: show "Next batch starts …" from the course calendar. */
  showNextBatch?: boolean;
  /** about: the main text. Empty = the "About" text from the institute profile. */
  body?: string;
  /** about: up to four short facts, like "1998 / Founded". */
  highlights?: Highlight[];
  /** courses, gallery, blog: how many to show (0 = all, courses only). */
  limit?: number;
  /** reviews: show the "Write a review" form. */
  allowSubmissions?: boolean;
};

export const SECTION_INFO: Record<SectionType, { label: string; fills: string }> = {
  hero: { label: "Hero", fills: "The first thing visitors see: your headline, a picture and the next batch date." },
  about: { label: "About", fills: "Your story. Uses the About text from the institute profile unless you write something here." },
  courses: { label: "Courses", fills: "Filled automatically from your published courses, with their next batch and seats left." },
  faculty: { label: "Faculty", fills: "Faculty profiles you have approved." },
  testimonials: { label: "Testimonials", fills: "Testimonials marked as shown, in your order." },
  reviews: { label: "Reviews", fills: "Approved reviews and the average rating." },
  gallery: { label: "Gallery", fills: "Photos from your gallery that are marked as shown." },
  videos: { label: "Videos", fills: "YouTube videos marked as shown." },
  blog: { label: "Blog highlights", fills: "Your latest published blog posts." },
  team: { label: "Team", fills: "Team members marked as shown, in your order." },
  enquiry: { label: "Enquiry form", fills: "A form that sends enquiries to your inbox." },
  contact: { label: "Contact", fills: "Address, phone, email, map and social links from the institute profile." },
};

/** Options for "how many to show". */
export const LIMIT_OPTIONS: Partial<Record<SectionType, number[]>> = {
  courses: [0, 3, 6, 9, 12],
  gallery: [6, 9, 12, 18, 24],
  blog: [2, 3, 4, 6],
};

export const LIMITS = { heading: 120, intro: 400, body: 6000, highlightValue: 24, highlightLabel: 60, highlights: 4 } as const;

/** The page a new university starts with. */
export function defaultSections(): PageSection[] {
  const s = (type: SectionType, heading: string, intro = "", extra: Partial<PageSection> = {}): PageSection => ({
    type,
    visible: true,
    heading,
    intro,
    ...extra,
  });
  return [
    s("hero", "Learn from people who practise what they teach", "Degree and certificate courses with small batches, live classes and timings that fit around work.", {
      imageMediaId: null,
      showNextBatch: true,
    }),
    s("about", "About us", "", { body: "", highlights: [] }),
    s("courses", "Courses", "Pick a course, then choose the batch that fits your week.", { limit: 0 }),
    s("faculty", "Faculty", "The people who teach our courses."),
    s("testimonials", "What our students say"),
    s("reviews", "Reviews", "", { allowSubmissions: true }),
    s("gallery", "Campus life", "", { limit: 12 }),
    s("videos", "Videos"),
    s("blog", "From our blog", "", { limit: 3 }),
    s("team", "Leadership"),
    s("enquiry", "Ask us anything", "Tell us what you would like to study. Our admissions team replies within one working day."),
    s("contact", "Visit or call us"),
  ];
}

const isType = (t: unknown): t is SectionType => typeof t === "string" && (SECTION_TYPES as readonly string[]).includes(t);
const text = (v: unknown, max: number, fallback = "") => (typeof v === "string" ? v.trim().slice(0, max) : fallback);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One section with every field of its type present and in range. Unknown fields are dropped. */
export function cleanSection(raw: Partial<PageSection> & { type: SectionType }): PageSection {
  const def = defaultSections().find((d) => d.type === raw.type)!;
  const out: PageSection = {
    type: raw.type,
    visible: typeof raw.visible === "boolean" ? raw.visible : def.visible,
    heading: text(raw.heading, LIMITS.heading, def.heading),
    intro: text(raw.intro, LIMITS.intro, def.intro),
  };
  switch (raw.type) {
    case "hero":
      out.imageMediaId = typeof raw.imageMediaId === "string" && UUID.test(raw.imageMediaId) ? raw.imageMediaId : null;
      out.showNextBatch = typeof raw.showNextBatch === "boolean" ? raw.showNextBatch : true;
      break;
    case "about":
      out.body = text(raw.body, LIMITS.body);
      out.highlights = (Array.isArray(raw.highlights) ? raw.highlights : [])
        .map((h) => ({ value: text(h?.value, LIMITS.highlightValue), label: text(h?.label, LIMITS.highlightLabel) }))
        .filter((h) => h.value && h.label)
        .slice(0, LIMITS.highlights);
      break;
    case "courses":
    case "gallery":
    case "blog": {
      const options = LIMIT_OPTIONS[raw.type]!;
      out.limit = typeof raw.limit === "number" && options.includes(raw.limit) ? raw.limit : def.limit;
      break;
    }
    case "reviews":
      out.allowSubmissions = typeof raw.allowSubmissions === "boolean" ? raw.allowSubmissions : true;
      break;
  }
  return out;
}

/**
 * Whatever is stored (possibly from an older version) → every section exactly once,
 * in the stored order, with any missing section added at the end, hidden.
 */
export function normaliseSections(stored: unknown): PageSection[] {
  const list = Array.isArray(stored) ? stored : [];
  const seen = new Set<SectionType>();
  const out: PageSection[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object" || !isType((raw as PageSection).type)) continue;
    const type = (raw as PageSection).type;
    if (seen.has(type)) continue;
    seen.add(type);
    out.push(cleanSection(raw as PageSection));
  }
  for (const def of defaultSections()) {
    if (!seen.has(def.type)) out.push({ ...def, visible: false });
  }
  return out;
}

/** Media ids a page refers to (so housekeeping never deletes them). */
export function sectionMediaIds(sections: PageSection[] | null | undefined): string[] {
  return (sections ?? []).flatMap((s) => (s.imageMediaId ? [s.imageMediaId] : []));
}

/** Two section lists are the same page (used for "unpublished changes"). */
export function samePage(a: PageSection[] | null, b: PageSection[] | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(normaliseSections(a)) === JSON.stringify(normaliseSections(b));
}
