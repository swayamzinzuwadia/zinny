import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { prerenderToNodeStream } from "react-dom/static.node";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { universityLite, withTenant } from "@/server/core";
import { setTestModules, slotsInReach } from "@/server/registry";
import websiteBuilder from "@/modules/website-builder";
import { publishPage, updateSection } from "@/modules/website-builder/builder";
import { MyProfileCard, WebsiteCard } from "@/modules/website-builder/components/dashboard-cards";
import { submitEnquiry, setEnquiryStatus } from "@/modules/website-builder/enquiries";
import { saveFacultyProfile } from "@/modules/website-builder/faculty";
import { housekeeping } from "@/modules/website-builder/jobs";
import { uploadImage } from "@/modules/website-builder/media";
import { saveProfile } from "@/modules/website-builder/profile";
import { enquiriesReport } from "@/modules/website-builder/reports";
import { siteEnquiries, siteMedia, siteSubmissions } from "@/modules/website-builder/schema";
import { submitReview } from "@/modules/website-builder/reviews";
import { systemActorFor } from "@/server/core";
import { freshIp, png, siteFixture } from "./helpers";

afterEach(() => setTestModules([]));
afterAll(closeDb);

async function html(node: ReactNode) {
  const { prelude } = await prerenderToNodeStream(<>{node}</>);
  let out = "";
  for await (const chunk of prelude) out += chunk.toString();
  return out.replaceAll("<!-- -->", "");
}

describe("website-builder: dashboard cards", () => {
  it("admins see what needs attention; faculty see their own profile card; others see neither", async () => {
    const { uni, admin, faculty, hod, board } = await siteFixture("Cards U");
    setTestModules([websiteBuilder], { only: true });
    const university = await withTenant(admin, (tx) => universityLite(tx));
    const props = (actor: typeof admin) => ({ uni: uni.slug, actor, university, today: "2030-01-01" });

    expect(slotsInReach("dashboardCards", admin, uni.id).map((c) => c.key)).toEqual(["website", "my-profile-page"]);
    expect(slotsInReach("dashboardCards", faculty, uni.id).map((c) => c.key)).toEqual(["my-profile-page"]);
    expect(slotsInReach("dashboardCards", board, uni.id).map((c) => c.key)).toEqual(["my-profile-page"]);

    await submitEnquiry(uni.id, { name: "Karan", email: "karan@example.com" }, { ip: freshIp() });
    await submitReview(uni.id, { name: "Ravi", email: "r@example.com", rating: 5, body: "Very good course indeed, thanks." }, { ip: freshIp() });
    const adminCard = await html(await WebsiteCard(props(admin)));
    expect(adminCard).toContain("1 new enquiry");
    expect(adminCard).toContain("1 review to approve or hide");
    expect(adminCard).toContain("Website not published yet");
    expect(adminCard).toContain(`/${uni.slug}/admin/website/sections/enquiries`);
    expect(await WebsiteCard(props(hod))).toBeNull();
    expect(await MyProfileCard(props(admin))).toBeNull(); // admins don't teach
    expect(await MyProfileCard(props(board))).toBeNull();

    const before = await html(await MyProfileCard(props(faculty)));
    expect(before).toContain("Write my profile page");
    expect(before).toContain(`/${uni.slug}/admin/website/profile/me`);
    await saveFacultyProfile(faculty, faculty.userId, { headline: "Lecturer", bio: "Teaches analytics with real company data every week." }, { submit: true });
    expect(await html(await MyProfileCard(props(faculty)))).toContain("Waiting for an admin to approve it.");
    expect(await html(await MyProfileCard(props(hod)))).toContain("Write my profile page");
  });
});

describe("website-builder: housekeeping job and enquiries report", () => {
  it("forgets old rate-limit records and deletes images nothing uses, keeping everything in use", async () => {
    const { uni, admin } = await siteFixture("Housekeeping U");
    const keep = await uploadImage(admin, { kind: "logo", bytes: await png() });
    const hero = await uploadImage(admin, { kind: "hero", bytes: await png() });
    const unused = await uploadImage(admin, { kind: "cover", bytes: await png() });
    const fresh = await uploadImage(admin, { kind: "cover", bytes: await png() });
    await saveProfile(admin, { logoMediaId: keep.id });
    await updateSection(admin, "hero", { heading: "Hi", imageMediaId: hero.id });
    await publishPage(admin);
    const old = new Date(Date.now() - 3 * 86_400_000);
    for (const id of [keep.id, hero.id, unused.id]) await systemDb().update(siteMedia).set({ createdAt: old }).where(eq(siteMedia.id, id));
    await systemDb().insert(siteSubmissions).values([
      { universityId: uni.id, kind: "enquiry", fingerprint: "old", createdAt: new Date(Date.now() - 8 * 86_400_000) },
      { universityId: uni.id, kind: "enquiry", fingerprint: "new" },
    ]);

    await housekeeping.run(systemActorFor(uni.id));

    const left = (await systemDb().select().from(siteMedia).where(eq(siteMedia.universityId, uni.id))).map((m) => m.id).sort();
    expect(left).toEqual([keep.id, hero.id, fresh.id].sort());
    expect((await systemDb().select().from(siteSubmissions).where(eq(siteSubmissions.universityId, uni.id))).map((s) => s.fingerprint)).toEqual(["new"]);
  });

  it("lists enquiries in a date range (days in the university's time zone)", async () => {
    const { uni, admin, course } = await siteFixture("Report U");
    const a = await submitEnquiry(uni.id, { name: "Early Ela", email: "ela@example.com", phone: "+91 98765 00000", courseId: course.id }, { ip: freshIp() });
    const b = await submitEnquiry(uni.id, { name: "Late Lal", email: "lal@example.com" }, { ip: freshIp() });
    if (a.status !== "saved" || b.status !== "saved") throw new Error("not saved");
    // 1 Oct 00:10 IST is still 30 Sep in UTC; 2 Oct 23:50 IST.
    await systemDb().update(siteEnquiries).set({ createdAt: new Date("2030-09-30T18:40:00Z") }).where(eq(siteEnquiries.id, a.id));
    await systemDb().update(siteEnquiries).set({ createdAt: new Date("2030-10-02T18:20:00Z") }).where(eq(siteEnquiries.id, b.id));
    await setEnquiryStatus(admin, a.id, "contacted");

    const day1 = await enquiriesReport.run(admin, { from: "2030-10-01", to: "2030-10-01" });
    expect(day1.rows).toEqual([{ received: "2030-10-01", name: "Early Ela", email: "ela@example.com", phone: "+91 98765 00000", course: "Data Analytics", status: "Contacted", assignee: "" }]);
    const both = await enquiriesReport.run(admin, { from: "2030-10-01", to: "2030-10-02" });
    expect(both.rows.map((r) => r.name)).toEqual(["Late Lal", "Early Ela"]);
    expect(both.columns.map((c) => c.key)).toEqual(["received", "name", "email", "phone", "course", "status", "assignee"]);
    expect(websiteBuilder.reports?.map((r) => r.id)).toEqual(["website-builder.enquiries"]);
  });
});
