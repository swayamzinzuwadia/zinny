/**
 * The website builder: the home page as ordered sections, edited as a draft and published
 * in one step. Publishing copies the draft over the live page; the public site only ever
 * reads the published copy. "Discard changes" copies the live page back over the draft.
 */
import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { audit, withTenant, type Actor } from "@/server/core";
import { ConflictError, ValidationError } from "@/server/errors";
import { assertManage } from "./access";
import { assertMediaOf } from "./media";
import { sitePages } from "./schema";
import { LIMITS, SECTION_INFO, SECTION_TYPES, cleanSection, defaultSections, normaliseSections, samePage, type PageSection, type SectionType } from "./sections";

export type PageState = {
  draft: PageSection[];
  published: PageSection[] | null;
  publishedAt: Date | null;
  draftUpdatedAt: Date;
  /** The draft differs from the live page (or nothing is live yet). */
  hasChanges: boolean;
};

type PageRow = typeof sitePages.$inferSelect;

/** The stored page, or null before the first edit (the default sections apply). */
export async function pageRow(tx: Tx, universityId: string): Promise<PageRow | null> {
  const [row] = await tx.select().from(sitePages).where(eq(sitePages.universityId, universityId));
  return row ?? null;
}

/** The stored page, created with the default sections if this is the first edit. Locked for update. */
async function pageForUpdate(tx: Tx, universityId: string): Promise<PageRow> {
  await tx.insert(sitePages).values({ universityId, draft: defaultSections(), published: null }).onConflictDoNothing();
  const [row] = await tx.select().from(sitePages).where(eq(sitePages.universityId, universityId)).for("update");
  return row;
}

export function pageState(row: PageRow | null): PageState {
  const draft = normaliseSections(row?.draft ?? defaultSections());
  const published = row?.published ? normaliseSections(row.published) : null;
  return {
    draft,
    published,
    publishedAt: row?.publishedAt ?? null,
    draftUpdatedAt: row?.draftUpdatedAt ?? new Date(0),
    hasChanges: !samePage(draft, published),
  };
}

export async function getPage(actor: Actor): Promise<PageState> {
  const universityId = assertManage(actor);
  return withTenant(actor, async (tx) => pageState(await pageRow(tx, universityId)));
}

function assertType(type: string): SectionType {
  if (!(SECTION_TYPES as readonly string[]).includes(type)) throw new ValidationError("That section doesn't exist. Reload the page and try again.");
  return type as SectionType;
}

async function changeDraft(actor: Actor, action: string, data: Record<string, unknown>, fn: (draft: PageSection[], tx: Tx) => Promise<PageSection[]> | PageSection[]) {
  const universityId = assertManage(actor);
  return withTenant(actor, async (tx) => {
    const row = await pageForUpdate(tx, universityId);
    const next = normaliseSections(await fn(normaliseSections(row.draft), tx));
    const [saved] = await tx
      .update(sitePages)
      .set({ draft: next, draftUpdatedAt: new Date(), draftUpdatedBy: actor.userId || null })
      .where(eq(sitePages.id, row.id))
      .returning();
    await audit(tx, actor, action, "site_page", row.id, data);
    return pageState(saved);
  });
}

export type SectionInput = {
  heading?: string;
  intro?: string;
  imageMediaId?: string | null;
  showNextBatch?: boolean;
  body?: string;
  highlights?: { value: string; label: string }[];
  limit?: number;
  allowSubmissions?: boolean;
};

/** Edit a section's wording and settings in the draft. */
export async function updateSection(actor: Actor, type: string, input: SectionInput) {
  const t = assertType(type);
  const heading = (input.heading ?? "").trim();
  if (!heading) throw new ValidationError(`Give the ${SECTION_INFO[t].label} section a heading.`);
  if (heading.length > LIMITS.heading) throw new ValidationError(`The heading can be at most ${LIMITS.heading} characters.`);
  if ((input.intro ?? "").trim().length > LIMITS.intro) throw new ValidationError(`The introduction can be at most ${LIMITS.intro} characters.`);
  if ((input.body ?? "").trim().length > LIMITS.body) throw new ValidationError(`The text can be at most ${LIMITS.body} characters.`);
  for (const h of input.highlights ?? []) {
    if ((h.value.trim() && !h.label.trim()) || (!h.value.trim() && h.label.trim())) {
      throw new ValidationError("Each highlight needs both a figure and a label, like 1998 and Founded.");
    }
  }
  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as SectionInput;
  return changeDraft(actor, "site.edit_section", { section: t }, async (draft, tx) => {
    if (t === "hero" && patch.imageMediaId) await assertMediaOf(tx, patch.imageMediaId);
    return draft.map((s) => (s.type === t ? cleanSection({ ...s, ...patch, type: t, heading, visible: s.visible }) : s));
  });
}

export async function setSectionVisible(actor: Actor, type: string, visible: boolean) {
  const t = assertType(type);
  return changeDraft(actor, visible ? "site.show_section" : "site.hide_section", { section: t }, (draft) =>
    draft.map((s) => (s.type === t ? { ...s, visible } : s)),
  );
}

export async function moveSection(actor: Actor, type: string, direction: "up" | "down") {
  const t = assertType(type);
  return changeDraft(actor, "site.move_section", { section: t, direction }, (draft) => {
    const i = draft.findIndex((s) => s.type === t);
    const j = direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= draft.length) return draft;
    const next = [...draft];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
}

/** Make the draft the live page. */
export async function publishPage(actor: Actor): Promise<PageState> {
  const universityId = assertManage(actor);
  return withTenant(actor, async (tx) => {
    const row = await pageForUpdate(tx, universityId);
    const draft = normaliseSections(row.draft);
    if (!draft.some((s) => s.visible)) throw new ValidationError("Show at least one section before publishing.");
    const [saved] = await tx
      .update(sitePages)
      .set({ published: draft, publishedAt: new Date(), publishedBy: actor.userId || null })
      .where(eq(sitePages.id, row.id))
      .returning();
    await audit(tx, actor, "site.publish_page", "site_page", row.id, { sections: draft.filter((s) => s.visible).map((s) => s.type) });
    return pageState(saved);
  });
}

/** Throw away draft changes: the draft becomes the live page again. */
export async function discardDraft(actor: Actor): Promise<PageState> {
  const universityId = assertManage(actor);
  return withTenant(actor, async (tx) => {
    const row = await pageRow(tx, universityId);
    if (!row?.published) throw new ConflictError("Nothing is published yet, so there are no changes to discard.");
    const [saved] = await tx
      .update(sitePages)
      .set({ draft: normaliseSections(row.published), draftUpdatedAt: new Date(), draftUpdatedBy: actor.userId || null })
      .where(eq(sitePages.id, row.id))
      .returning();
    await audit(tx, actor, "site.discard_draft", "site_page", row.id, {});
    return pageState(saved);
  });
}
