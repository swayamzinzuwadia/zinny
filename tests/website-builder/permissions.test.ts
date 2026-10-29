import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import type { Actor } from "@/server/core";
import { createPost, deletePost, getPost, listPosts, publishPost, unpublishPost, updatePost } from "@/modules/website-builder/blog";
import { discardDraft, getPage, moveSection, publishPage, setSectionVisible, updateSection } from "@/modules/website-builder/builder";
import {
  addGalleryPhotos,
  createTeamMember,
  createTestimonial,
  createVideo,
  deleteItem,
  listGallery,
  listTeam,
  listTestimonials,
  listVideos,
  moveItem,
  setItemVisible,
  updateGalleryCaption,
  updateTeamMember,
  updateTestimonial,
  updateVideo,
} from "@/modules/website-builder/content";
import {
  approveFacultyProfile,
  getMyProfile,
  listFacultyProfiles,
  saveFacultyProfile,
  sendBackFacultyProfile,
  setFacultyProfileVisible,
} from "@/modules/website-builder/faculty";
import { uploadImage } from "@/modules/website-builder/media";
import { siteOverview } from "@/modules/website-builder/overview";
import { previewHome, previewPost } from "@/modules/website-builder/public";
import { getProfile, saveProfile } from "@/modules/website-builder/profile";
import { deleteReview, listReviews, moderateReview, submitReview } from "@/modules/website-builder/reviews";
import { enquiriesReport } from "@/modules/website-builder/reports";
import { freshIp, png, siteFixture } from "./helpers";

afterAll(closeDb);

const ID = "11111111-1111-4111-8111-111111111111";
const bio = "Teaches data analytics with real datasets from local businesses every week.";

/** Every service that changes or reads the website's admin side, called with harmless input. */
function managerCalls(uni: { slug: string }): [string, (a: Actor) => Promise<unknown>][] {
  return [
    ["getProfile", (a) => getProfile(a)],
    ["saveProfile", (a) => saveProfile(a, { tagline: "Hello" })],
    ["getPage", (a) => getPage(a)],
    ["updateSection", (a) => updateSection(a, "hero", { heading: "Hi", intro: "" })],
    ["setSectionVisible", (a) => setSectionVisible(a, "team", false)],
    ["moveSection", (a) => moveSection(a, "team", "up")],
    ["publishPage", (a) => publishPage(a)],
    ["discardDraft", (a) => discardDraft(a)],
    ["previewHome", (a) => previewHome(a, uni.slug)],
    ["previewPost", (a) => previewPost(a, uni.slug, ID)],
    ["listTestimonials", (a) => listTestimonials(a)],
    ["createTestimonial", (a) => createTestimonial(a, { name: "Priya", quote: "Wonderful teaching." })],
    ["updateTestimonial", (a) => updateTestimonial(a, ID, { name: "Priya", quote: "Wonderful teaching." })],
    ["listTeam", (a) => listTeam(a)],
    ["createTeamMember", (a) => createTeamMember(a, { name: "Anita", title: "Registrar" })],
    ["updateTeamMember", (a) => updateTeamMember(a, ID, { name: "Anita", title: "Registrar" })],
    ["listVideos", (a) => listVideos(a)],
    ["createVideo", (a) => createVideo(a, { title: "Tour", url: "https://youtu.be/aircAruvnKk" })],
    ["updateVideo", (a) => updateVideo(a, ID, { title: "Tour", url: "https://youtu.be/aircAruvnKk" })],
    ["listGallery", (a) => listGallery(a)],
    ["addGalleryPhotos", (a) => addGalleryPhotos(a, [ID])],
    ["updateGalleryCaption", (a) => updateGalleryCaption(a, ID, "Lawn")],
    ["moveItem", (a) => moveItem(a, "team", ID, "up")],
    ["setItemVisible", (a) => setItemVisible(a, "team", ID, false)],
    ["deleteItem", (a) => deleteItem(a, "team", ID)],
    ["listReviews", (a) => listReviews(a)],
    ["moderateReview", (a) => moderateReview(a, ID, "approve")],
    ["deleteReview", (a) => deleteReview(a, ID)],
    ["listPosts", (a) => listPosts(a)],
    ["getPost", (a) => getPost(a, ID)],
    ["createPost", (a) => createPost(a, { title: "News" })],
    ["updatePost", (a) => updatePost(a, ID, { title: "News", slug: "news" })],
    ["publishPost", (a) => publishPost(a, ID)],
    ["unpublishPost", (a) => unpublishPost(a, ID)],
    ["deletePost", (a) => deletePost(a, ID)],
    ["listFacultyProfiles", (a) => listFacultyProfiles(a)],
    ["approveFacultyProfile", (a) => approveFacultyProfile(a, ID)],
    ["sendBackFacultyProfile", (a) => sendBackFacultyProfile(a, ID, "Add a photo please")],
    ["setFacultyProfileVisible", (a) => setFacultyProfileVisible(a, ID, false)],
    ["siteOverview", (a) => siteOverview(a)],
    ["uploadImage(logo)", async (a) => uploadImage(a, { kind: "logo", bytes: await png() })],
    ["enquiriesReport", (a) => enquiriesReport.run(a, {})],
  ];
}

describe("website-builder: only website.manage holders edit the site", () => {
  it("deny: HOD, faculty, Board, Accounts and students are refused every website admin call", async () => {
    const { uni, hod, faculty, board, studentActor } = await siteFixture("Deny U");
    const { person } = await import("../fixtures");
    const accounts = await (await person("Accounts Arun", "accounts_fees", { universityId: uni.id })).actor();
    for (const who of [hod, faculty, board, accounts, studentActor]) {
      for (const [name, call] of managerCalls(uni)) {
        await expect(call(who), `${name} as ${who.name}`).rejects.toThrow(/access|teaching staff/);
      }
    }
  });

  it("allow: the Institute Admin gets past the permission check on every call", async () => {
    const { uni, admin } = await siteFixture("Allow U");
    for (const [name, call] of managerCalls(uni)) {
      // Calls on the made-up id fail as "not found" (or a validation message), never as access denied.
      const err = await call(admin).then(
        () => null,
        (e: Error) => e,
      );
      expect(err?.message ?? "", name).not.toMatch(/access/);
    }
  });
});

describe("website-builder: faculty edit only their own public profile", () => {
  it("allow: a faculty member writes, uploads a photo for and sends their own profile", async () => {
    const { faculty } = await siteFixture("Own Profile U");
    const photo = await uploadImage(faculty, { kind: "faculty", bytes: await png() });
    const saved = await saveFacultyProfile(faculty, faculty.userId, { headline: "Lecturer", bio, subjects: "SQL", photoMediaId: photo.id }, { submit: true });
    expect(saved.status).toBe("pending");
    expect(saved.userId).toBe(faculty.userId);
    const mine = await getMyProfile(faculty);
    expect(mine.eligible && mine.profile?.draft.photoMediaId).toBe(photo.id);
  });

  it("deny: not someone else's profile, not even as an admin; and not for people who don't teach", async () => {
    const { faculty, otherFaculty, otherFacultyUserId, admin, studentActor, board } = await siteFixture("Other Profile U");
    await expect(saveFacultyProfile(faculty, otherFacultyUserId, { headline: "Hacked", bio }, { submit: true })).rejects.toThrow(/access/);
    await expect(saveFacultyProfile(admin, faculty.userId, { headline: "Edited by admin", bio }, { submit: true })).rejects.toThrow(/access/);
    // Their own works for the other faculty member.
    await saveFacultyProfile(otherFaculty, otherFacultyUserId, { headline: "Mine", bio }, { submit: false });
    // People without a teaching role have no public profile, even for themselves.
    for (const who of [studentActor, board]) {
      await expect(saveFacultyProfile(who, who.userId, { headline: "Me", bio }, { submit: true })).rejects.toThrow(/teaching staff/);
      await expect(uploadImage(who, { kind: "faculty", bytes: await png() })).rejects.toThrow(/teaching staff|access/);
      expect(await getMyProfile(who)).toEqual({ eligible: false });
    }
    // Faculty can't approve anything, including their own profile.
    const saved = await saveFacultyProfile(faculty, faculty.userId, { headline: "Lecturer", bio }, { submit: true });
    await expect(approveFacultyProfile(faculty, saved.id)).rejects.toThrow(/access/);
    await expect(setFacultyProfileVisible(faculty, saved.id, true)).rejects.toThrow(/access/);
  });

  it("the approval flow: send, send back with a note, fix, approve; editing again keeps the approved version live", async () => {
    const { admin, faculty } = await siteFixture("Approval U");
    await expect(saveFacultyProfile(faculty, faculty.userId, { headline: "", bio: "short" }, { submit: true })).rejects.toThrow(/headline/i);
    const draft = await saveFacultyProfile(faculty, faculty.userId, { headline: "Lecturer", bio: "short" }, { submit: false });
    expect(draft.status).toBe("draft");
    await expect(approveFacultyProfile(admin, draft.id)).rejects.toThrow(/waiting for approval/);

    const sent = await saveFacultyProfile(faculty, faculty.userId, { headline: "Lecturer", bio, subjects: ["SQL", "sql", "Python"] }, { submit: true });
    expect(sent.draft.subjects).toEqual(["SQL", "Python"]);
    expect((await listFacultyProfiles(admin, "pending")).rows.map((r) => r.id)).toEqual([sent.id]);

    const back = await sendBackFacultyProfile(admin, sent.id, "Please add a photo.");
    expect(back).toMatchObject({ status: "changes_requested", reviewNote: "Please add a photo." });

    const again = await saveFacultyProfile(faculty, faculty.userId, { headline: "Senior Lecturer", bio, subjects: "SQL" }, { submit: true });
    expect(again).toMatchObject({ status: "pending", reviewNote: "" });
    const approved = await approveFacultyProfile(admin, again.id);
    expect(approved.status).toBe("approved");
    expect(approved.published?.headline).toBe("Senior Lecturer");

    const edited = await saveFacultyProfile(faculty, faculty.userId, { headline: "Principal Lecturer", bio, subjects: "SQL" }, { submit: false });
    expect(edited.status).toBe("draft");
    expect(edited.published?.headline).toBe("Senior Lecturer");
    // Saving it back to exactly the live version needs no approval.
    const same = await saveFacultyProfile(faculty, faculty.userId, { headline: "Senior Lecturer", bio, subjects: "SQL" }, { submit: true });
    expect(same.status).toBe("approved");
  });
});

describe("website-builder: public submissions need no account but are bounded", () => {
  it("anyone may send a review; it waits for moderation", async () => {
    const { uni, admin } = await siteFixture("Review Flow U");
    const res = await submitReview(uni.id, { name: "Visitor Vee", email: "vee@example.com", rating: 4, body: "Helpful faculty and clear explanations." }, { ip: freshIp() });
    expect(res.status).toBe("saved");
    const { rows, counts } = await listReviews(admin, "pending");
    expect(rows.map((r) => r.review.authorName)).toEqual(["Visitor Vee"]);
    expect(counts).toEqual({ pending: 1 });
  });
});
