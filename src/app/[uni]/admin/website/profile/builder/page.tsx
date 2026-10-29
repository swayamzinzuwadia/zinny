import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, PageHeader, cx } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { canManageSite } from "@/modules/website-builder/access";
import { discardDraftAction, moveSectionAction, publishPageAction, sectionVisibilityAction } from "@/modules/website-builder/actions";
import { ActionButton } from "@/modules/website-builder/components/action-button";
import { NoAccess, ProfileTabs, VisibilityBadge } from "@/modules/website-builder/components/admin";
import { SectionEditor } from "@/modules/website-builder/components/section-editor";
import { getPage } from "@/modules/website-builder/builder";
import { listFacultyProfiles } from "@/modules/website-builder/faculty";
import { formatMoment } from "@/modules/website-builder/format";
import { SECTION_INFO } from "@/modules/website-builder/sections";

export const metadata = { title: "Website builder" };

export default async function BuilderPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  if (!canManageSite(actor)) {
    return (
      <>
        <PageHeader title="Website builder" />
        <NoAccess uni={uni} />
      </>
    );
  }
  const [page, faculty] = await Promise.all([getPage(actor), listFacultyProfiles(actor, "pending")]);
  const tz = university.timezone;
  const publishedSections = new Map((page.published ?? []).map((s, i) => [s.type, { ...s, position: i }]));

  return (
    <>
      <PageHeader
        title="Website builder"
        subtitle="Your home page, section by section. Changes are saved as a draft; visitors see them once you publish."
        actions={
          <>
            <a href={`/site/${uni}/preview`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:border-brand/40">
              Preview draft
            </a>
            {page.published && (
              <a href={`/site/${uni}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-full px-4 text-[14px] font-medium text-brand hover:bg-brand-soft">
                View live site
              </a>
            )}
          </>
        }
      />
      <ProfileTabs uni={uni} actor={actor} active="builder" pendingProfiles={faculty.counts.pending} />

      <Card className={cx("mb-8 flex flex-wrap items-center justify-between gap-4", page.hasChanges && "border-gold/60")}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {!page.published ? (
              <Badge tone="gold">Not published yet</Badge>
            ) : page.hasChanges ? (
              <Badge tone="gold">Unpublished changes</Badge>
            ) : (
              <Badge tone="brand">Up to date</Badge>
            )}
          </div>
          <p className="mt-2 text-[14px] text-muted">
            {!page.published
              ? `Publish to put your website online at /site/${uni}.`
              : page.hasChanges
                ? `Visitors still see the version published ${formatMoment(page.publishedAt!, tz)}. Preview the draft, then publish it.`
                : `Visitors see exactly this page. Last published ${formatMoment(page.publishedAt!, tz)}.`}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {page.published && page.hasChanges && (
            <ActionForm action={discardDraftAction} confirm="Discard every change since the last publish? This can't be undone.">
              <input type="hidden" name="uni" value={uni} />
              <SubmitButton variant="secondary" pendingText="Discarding…">
                Discard changes
              </SubmitButton>
            </ActionForm>
          )}
          {(page.hasChanges || !page.published) && (
            <ActionForm action={publishPageAction}>
              <input type="hidden" name="uni" value={uni} />
              <SubmitButton pendingText="Publishing…">{page.published ? "Publish changes" : "Publish website"}</SubmitButton>
            </ActionForm>
          )}
        </div>
      </Card>

      <ol className="space-y-3" aria-label="Home page sections, in order">
        {page.draft.map((s, i) => {
          const live = publishedSections.get(s.type);
          const changed = !!page.published && (!live || JSON.stringify({ ...live, position: undefined }) !== JSON.stringify(s) || live.position !== i);
          return (
            <li key={s.type} className={cx("rounded-[22px] border bg-surface", s.visible ? "border-line" : "border-dashed border-line bg-canvas/50")}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
                <span className="tabular w-6 shrink-0 text-[13px] text-faint">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium">{SECTION_INFO[s.type].label}</span>
                    <VisibilityBadge visible={s.visible} />
                    {changed && <span className="text-[12px] text-gold-strong">Changed in draft</span>}
                  </div>
                  <p className="mt-0.5 truncate text-[13px] text-muted">
                    {s.heading ? <>“{s.heading}”. </> : null}
                    {SECTION_INFO[s.type].fills}
                  </p>
                </div>
                <div className="flex flex-wrap items-start gap-1.5">
                  <ActionButton action={moveSectionAction} fields={{ uni, type: s.type, direction: "up" }} variant="ghost" label={`Move ${SECTION_INFO[s.type].label} up`}>
                    <Arrow up />
                  </ActionButton>
                  <ActionButton action={moveSectionAction} fields={{ uni, type: s.type, direction: "down" }} variant="ghost" label={`Move ${SECTION_INFO[s.type].label} down`}>
                    <Arrow />
                  </ActionButton>
                  <ActionButton action={sectionVisibilityAction} fields={{ uni, type: s.type, visible: String(!s.visible) }}>
                    {s.visible ? "Hide" : "Show"}
                  </ActionButton>
                </div>
              </div>
              <details className="group border-t border-line">
                <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-2.5 text-[13px] text-brand hover:bg-canvas/60">
                  <span>Edit {SECTION_INFO[s.type].label.toLowerCase()}</span>
                  <span aria-hidden className="transition-transform group-open:rotate-180">
                    <Arrow />
                  </span>
                </summary>
                <div className="px-5 pb-5 pt-2">
                  <SectionEditor uni={uni} section={s} />
                </div>
              </details>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function Arrow({ up }: { up?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className={up ? "rotate-180" : undefined}>
      <path d="M3 5.5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
