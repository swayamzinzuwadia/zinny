"use server";

/**
 * Server actions for the Website section and the public site's forms. They only read the
 * form, call a service and refresh what changed: the admin pages, and the public site's
 * cached pages (revalidateTag) whenever something visitors can see may have changed.
 */
import { revalidatePath, revalidateTag } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { attempt, num, str } from "@/server/action";
import { spaceContext } from "@/server/context";
import { createPost, deletePost, publishPost, unpublishPost, updatePost } from "./blog";
import { discardDraft, moveSection, publishPage, setSectionVisible, updateSection, type SectionInput } from "./builder";
import { siteTag } from "./cached";
import {
  addGalleryPhotos,
  createTeamMember,
  createTestimonial,
  createVideo,
  deleteItem,
  moveItem,
  setItemVisible,
  updateGalleryCaption,
  updateTeamMember,
  updateTestimonial,
  updateVideo,
  type Collection,
} from "./content";
import { addEnquiryNote, assignEnquiry, setEnquiryStatus, submitEnquiry, type EnquiryStatus } from "./enquiries";
import { approveFacultyProfile, saveFacultyProfile, sendBackFacultyProfile, setFacultyProfileVisible } from "./faculty";
import { saveProfile, SOCIAL_NETWORKS } from "./profile";
import { siteBySlug } from "./public";
import { clientIp } from "./rate-limit";
import { deleteReview, moderateReview, submitReview } from "./reviews";

async function ctx(data: FormData) {
  const uni = str(data, "uni");
  const { actor } = await spaceContext(uni);
  return { uni, actor };
}

/** Admin pages and the public site both show the change. */
function refresh(uni: string) {
  revalidateTag(siteTag(uni));
  revalidatePath(`/${uni}/admin/website`, "layout");
}

/** Only admin pages changed (enquiries, drafts). */
function refreshAdmin(uni: string) {
  revalidatePath(`/${uni}/admin/website`, "layout");
}

const opt = (d: FormData, k: string) => (d.has(k) ? str(d, k) : undefined);
const bool = (d: FormData, k: string) => d.get(k) === "on" || d.get(k) === "true" || d.get(k) === "1";

/* ───────────────────────────── Institute profile ───────────────────────────── */

export async function saveProfileAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await saveProfile(actor, {
      tagline: str(data, "tagline"),
      about: str(data, "about"),
      foundedYear: str(data, "foundedYear"),
      address: str(data, "address"),
      city: str(data, "city"),
      mapUrl: str(data, "mapUrl"),
      phone: str(data, "phone"),
      email: str(data, "email"),
      whatsapp: str(data, "whatsapp"),
      social: Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n.key, str(data, `social_${n.key}`)])),
      primaryColor: bool(data, "useBrandColour") ? null : str(data, "primaryColor"),
      logoMediaId: opt(data, "logoMediaId"),
      coverMediaId: opt(data, "coverMediaId"),
    });
    refresh(uni);
    return "Profile saved. Your website shows the changes now.";
  });
}

/* ───────────────────────────── Website builder ───────────────────────────── */

export async function updateSectionAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const type = str(data, "type");
  return attempt(async () => {
    const input: SectionInput = { heading: str(data, "heading"), intro: str(data, "intro") };
    if (type === "hero") {
      input.imageMediaId = str(data, "imageMediaId") || null;
      input.showNextBatch = bool(data, "showNextBatch");
    }
    if (type === "about") {
      input.body = str(data, "body");
      input.highlights = [0, 1, 2, 3].map((i) => ({ value: str(data, `hlValue${i}`), label: str(data, `hlLabel${i}`) }));
    }
    if (data.has("limit")) input.limit = num(data, "limit");
    if (type === "reviews") input.allowSubmissions = bool(data, "allowSubmissions");
    await updateSection(actor, type, input);
    refreshAdmin(uni);
    return "Saved to the draft. Publish to show it on your website.";
  });
}

export async function sectionVisibilityAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await setSectionVisible(actor, str(data, "type"), str(data, "visible") === "true");
    refreshAdmin(uni);
  });
}

export async function moveSectionAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await moveSection(actor, str(data, "type"), str(data, "direction") === "up" ? "up" : "down");
    refreshAdmin(uni);
  });
}

export async function publishPageAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await publishPage(actor);
    refresh(uni);
    return "Published. Your website now shows this version.";
  });
}

export async function discardDraftAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await discardDraft(actor);
    refreshAdmin(uni);
    return "Draft changes discarded. The draft matches your live website again.";
  });
}

/* ───────────────────────────── Lists: testimonials, team, videos, gallery ───────────────────────────── */

const COLLECTIONS: Collection[] = ["testimonials", "team", "gallery", "videos"];
const collectionOf = (d: FormData): Collection => {
  const c = str(d, "collection") as Collection;
  if (!COLLECTIONS.includes(c)) throw new Error("Unknown collection");
  return c;
};

export async function moveItemAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await moveItem(actor, collectionOf(data), str(data, "id"), str(data, "direction") === "up" ? "up" : "down");
    refresh(uni);
  });
}

export async function itemVisibilityAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await setItemVisible(actor, collectionOf(data), str(data, "id"), str(data, "visible") === "true");
    refresh(uni);
  });
}

export async function deleteItemAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await deleteItem(actor, collectionOf(data), str(data, "id"));
    refresh(uni);
    return "Deleted.";
  });
}

export async function saveTestimonialAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const id = str(data, "id");
  return attempt(async () => {
    const input = { name: str(data, "name"), byline: str(data, "byline"), quote: str(data, "quote"), photoMediaId: opt(data, "photoMediaId") };
    if (id) await updateTestimonial(actor, id, input);
    else await createTestimonial(actor, input);
    refresh(uni);
    return id ? "Testimonial saved." : "Testimonial added. It shows on your website now.";
  });
}

export async function saveTeamMemberAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const id = str(data, "id");
  return attempt(async () => {
    const input = { name: str(data, "name"), title: str(data, "title"), bio: str(data, "bio"), linkedinUrl: str(data, "linkedinUrl"), photoMediaId: opt(data, "photoMediaId") };
    if (id) await updateTeamMember(actor, id, input);
    else await createTeamMember(actor, input);
    refresh(uni);
    return id ? "Team member saved." : "Team member added. They show on your website now.";
  });
}

export async function saveVideoAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const id = str(data, "id");
  return attempt(async () => {
    const input = { title: str(data, "title"), url: str(data, "url"), description: str(data, "description") };
    if (id) await updateVideo(actor, id, input);
    else await createVideo(actor, input);
    refresh(uni);
    return id ? "Video saved." : "Video added. It shows on your website now.";
  });
}

/** Called by the gallery uploader once its files are uploaded. */
export async function addGalleryPhotosAction(uni: string, mediaIds: string[]): Promise<ActionState> {
  const { actor } = await spaceContext(uni);
  return attempt(async () => {
    const rows = await addGalleryPhotos(actor, mediaIds);
    refresh(uni);
    return rows.length === 1 ? "Photo added to the gallery." : `${rows.length} photos added to the gallery.`;
  });
}

export async function saveGalleryCaptionAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await updateGalleryCaption(actor, str(data, "id"), str(data, "caption"));
    refresh(uni);
    return "Caption saved.";
  });
}

/* ───────────────────────────── Reviews ───────────────────────────── */

export async function moderateReviewAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await moderateReview(actor, str(data, "id"), str(data, "decision") === "approve" ? "approve" : "hide");
    refresh(uni);
  });
}

export async function deleteReviewAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await deleteReview(actor, str(data, "id"));
    refresh(uni);
    return "Review deleted.";
  });
}

/* ───────────────────────────── Enquiries ───────────────────────────── */

export async function enquiryStatusAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await setEnquiryStatus(actor, str(data, "id"), str(data, "status") as EnquiryStatus);
    refreshAdmin(uni);
  });
}

export async function assignEnquiryAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    const to = str(data, "assigneeUserId");
    await assignEnquiry(actor, str(data, "id"), to || null, { slug: uni });
    refreshAdmin(uni);
    return to ? "Assigned." : "Unassigned.";
  });
}

export async function enquiryNoteAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await addEnquiryNote(actor, str(data, "id"), str(data, "body"));
    refreshAdmin(uni);
    return "Note added.";
  });
}

/* ───────────────────────────── Blog ───────────────────────────── */

export async function createPostAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  let id = "";
  const result = await attempt(async () => {
    id = (await createPost(actor, { title: str(data, "title") })).id;
    refreshAdmin(uni);
  });
  if (id) redirect(`/${uni}/admin/website/sections/blog/${id}`);
  return result;
}

export async function savePostAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const id = str(data, "id");
  return attempt(async () => {
    const { post } = await updatePost(actor, id, {
      title: str(data, "title"),
      slug: str(data, "slug"),
      excerpt: str(data, "excerpt"),
      bodyHtml: String(data.get("bodyHtml") ?? ""),
      coverMediaId: opt(data, "coverMediaId"),
      authorUserId: opt(data, "authorUserId"),
    });
    if (str(data, "intent") === "publish" && post.status !== "published") {
      await publishPost(actor, id);
      refresh(uni);
      return "Published. The post is on your website now.";
    }
    if (post.status === "published") {
      refresh(uni);
      return "Saved. The live post shows the changes now.";
    }
    refreshAdmin(uni);
    return "Draft saved.";
  });
}

export async function unpublishPostAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await unpublishPost(actor, str(data, "id"));
    refresh(uni);
    return "Unpublished. The post is a draft again and is no longer on your website.";
  });
}

export async function deletePostAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  let done = false;
  const result = await attempt(async () => {
    await deletePost(actor, str(data, "id"));
    refresh(uni);
    done = true;
  });
  if (done) redirect(`/${uni}/admin/website/sections/blog`);
  return result;
}

/* ───────────────────────────── Faculty profiles ───────────────────────────── */

export async function saveMyProfileAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const submit = str(data, "intent") === "submit";
  return attempt(async () => {
    const saved = await saveFacultyProfile(
      actor,
      actor.userId,
      { headline: str(data, "headline"), bio: str(data, "bio"), subjects: str(data, "subjects"), photoMediaId: opt(data, "photoMediaId") },
      { submit },
    );
    refreshAdmin(uni);
    if (saved.status === "approved") return "Saved. Nothing changed from your live profile.";
    return submit ? "Sent for approval. You'll get a notification when it's live." : "Draft saved. Send it for approval when it's ready.";
  });
}

export async function approveProfileAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await approveFacultyProfile(actor, str(data, "id"));
    refresh(uni);
    return "Approved. The profile is live.";
  });
}

export async function sendBackProfileAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await sendBackFacultyProfile(actor, str(data, "id"), str(data, "note"));
    refreshAdmin(uni);
    return "Sent back with your note.";
  });
}

export async function profileVisibilityAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await setFacultyProfileVisible(actor, str(data, "id"), str(data, "visible") === "true");
    refresh(uni);
  });
}

/* ───────────────────────────── Public forms ───────────────────────────── */

async function publicContext(data: FormData) {
  const slug = str(data, "uni");
  const site = await siteBySlug(slug);
  if (!site) throw new Error("Unknown site");
  return { slug, site, ip: clientIp(await headers()) };
}

export async function submitEnquiryAction(_: ActionState, data: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { slug, site, ip } = await publicContext(data);
    await submitEnquiry(
      site.universityId,
      {
        name: str(data, "name"),
        email: str(data, "email"),
        phone: str(data, "phone"),
        message: str(data, "message"),
        courseId: str(data, "courseId") || null,
        source: str(data, "source"),
        website: str(data, "website"),
      },
      { ip, slug },
    );
    return "Thank you. We have your enquiry and will get back to you within one working day.";
  });
}

export async function submitReviewAction(_: ActionState, data: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { slug, site, ip } = await publicContext(data);
    await submitReview(
      site.universityId,
      {
        name: str(data, "name"),
        email: str(data, "email"),
        rating: str(data, "rating"),
        body: str(data, "body"),
        courseId: str(data, "courseId") || null,
        website: str(data, "website"),
      },
      { ip, slug },
    );
    return "Thank you. Your review will appear once our team has checked it.";
  });
}
