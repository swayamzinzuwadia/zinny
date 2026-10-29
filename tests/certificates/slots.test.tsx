import type { ReactNode } from "react";
import { prerenderToNodeStream } from "react-dom/static.node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { SlotList, SlotOutlet } from "@/components/slots";
import { getCourseLite, universityLite, withTenant, type Actor } from "@/server/core";
import { setTestModules, slotsInReach, visibleSlots } from "@/server/registry";
import certificates from "@/modules/certificates";
import { courseTarget } from "@/server/services/courses";
import { certWorld, withTempStorage } from "./helpers";

withTempStorage();
beforeAll(() => setTestModules([certificates], { only: true }));
afterAll(async () => {
  setTestModules([]);
  await closeDb();
});

async function html(node: ReactNode) {
  const { prelude } = await prerenderToNodeStream(<>{node}</>);
  let out = "";
  for await (const chunk of prelude) out += chunk.toString();
  return out.replaceAll("<!-- -->", "");
}

async function world(name: string) {
  const w = await certWorld(name);
  const university = await withTenant(w.admin, (tx) => universityLite(tx));
  const target = await withTenant(w.admin, (tx) => courseTarget(tx, w.uni.id, w.course.id));
  const course = async () => withTenant(w.admin, (tx) => getCourseLite(tx, w.course.id));
  const courseTab = async (actor: Actor) => {
    const tab = visibleSlots("adminCourseTabs", actor, target).find((t) => t.key === "certificates");
    if (!tab) return null;
    return html(<SlotOutlet slot="adminCourseTabs" entry={tab} props={{ uni: "u", actor, university, course: await course(), target, searchParams: {} }} />);
  };
  const learnerTab = async (actor: Actor, enrolmentId: string, status: "active" | "completed") => {
    const t = { universityId: w.uni.id, departmentIds: [w.dept.id], batchIds: [w.batch.id], ownerUserId: actor.userId };
    const tab = visibleSlots("learnerCourseTabs", actor, t).find((x) => x.key === "certificate");
    if (!tab) return null;
    const batch = { ...w.batch, target: { universityId: w.uni.id, departmentIds: [w.dept.id], batchIds: [w.batch.id] } };
    return html(
      <SlotOutlet
        slot="learnerCourseTabs"
        entry={tab}
        props={{ uni: "u", actor, university, enrolment: { enrolmentId, courseId: w.course.id, batchId: w.batch.id, status }, course: await course(), batch, target: t, searchParams: {} }}
      />,
    );
  };
  return { ...w, university, target, courseTab, learnerTab };
}

describe("certificates slots", () => {
  it("registers the reserved keys and orders", () => {
    expect(certificates.adminCourseTabs?.map((t) => [t.key, t.order, t.action, t.label])).toEqual([["certificates", 500, "cert.view", "Certificates"]]);
    expect(certificates.learnerCourseTabs?.map((t) => [t.key, t.order, t.action, t.label])).toEqual([["certificate", 500, "self.view_certificates", "Certificate"]]);
    expect(certificates.learnerHubSections?.map((t) => [t.key, t.order, t.action])).toEqual([["certificates", 500, "self.view_certificates"]]);
    expect(certificates.dashboardCards?.map((t) => [t.key, t.order, t.action])).toEqual([["certificates-issued", 500, "cert.view"]]);
    expect(certificates.eventHandlers?.map((h) => [h.id, h.on])).toEqual([["certificates.issue-on-completion", ["enrolment.completed"]]]);
    expect(certificates.jobs?.map((j) => [j.id, j.every])).toEqual([["certificates.expiry", "day"]]);
  });

  it("course tab: rules and issuing for Admin and HOD, a read-only view for faculty and board, nothing for students", async () => {
    const w = await world("Slot Course U");
    const { enrolmentId } = await w.enrolled("Riya Slot");
    await w.complete(enrolmentId);
    await w.enrolled("Kabir Slot");

    const admin = (await w.courseTab(w.admin))!;
    expect(admin).toContain("Certificate rules");
    expect(admin).toContain("Save rules");
    expect(admin).toContain("Issue by hand");
    expect(admin).toContain("Riya Slot");
    expect(admin).toContain("Kabir Slot, Weekday morning");

    const faculty = (await w.courseTab(w.faculty))!;
    expect(faculty).toContain("Riya Slot");
    expect(faculty).not.toContain("Save rules");
    expect(faculty).not.toContain("Issue by hand");
    expect(faculty).toContain("View only");

    expect(await w.courseTab(w.board)).toContain("Riya Slot");
    expect(await w.courseTab(await w.student("Student Slot"))).toBeNull();
    expect(await w.courseTab(w.otherHod)).toBeNull();

    await w.setCertificates(false);
    expect(await w.courseTab(w.admin)).toContain("Certificates are off for this course");
  });

  it("learner tab and hub section show the learner's own certificate", async () => {
    const w = await world("Slot Learner U");
    const riya = await w.enrolled("Riya Learner Slot");
    const before = (await w.learnerTab(riya.actor, riya.enrolmentId, "active"))!;
    expect(before).toContain("Complete the course to earn your certificate");

    const hubBefore = await html(
      <SlotList slot="learnerHubSections" entries={visibleSlots("learnerHubSections", riya.actor, { universityId: w.uni.id, ownerUserId: riya.actor.userId })} props={{ uni: "u", actor: riya.actor, university: w.university, enrolments: [] }} />,
    );
    expect(hubBefore).toBe("");

    await w.complete(riya.enrolmentId);
    const after = (await w.learnerTab(riya.actor, riya.enrolmentId, "completed"))!;
    expect(after).toContain("Download PDF");
    expect(after).toContain("Copy share link");
    expect(after).toContain("<svg");
    expect(after).toContain("Riya Learner Slot");

    const hub = await html(
      <SlotList slot="learnerHubSections" entries={visibleSlots("learnerHubSections", riya.actor, { universityId: w.uni.id, ownerUserId: riya.actor.userId })} props={{ uni: "u", actor: riya.actor, university: w.university, enrolments: [] }} />,
    );
    expect(hub).toContain("Certificates");
    expect(hub).toContain("Data Analytics");
    expect(hub).toContain("See all certificates");

    // Staff don't get the learner tab.
    expect(visibleSlots("learnerCourseTabs", w.hod, { universityId: w.uni.id, batchIds: [w.batch.id], ownerUserId: w.hod.userId })).toEqual([]);

    await w.setCertificates(false);
    const kabir = await w.enrolled("Kabir Learner Slot");
    expect(await w.learnerTab(kabir.actor, kabir.enrolmentId, "active")).toContain("doesn&#x27;t award a certificate");
  });

  it("dashboard card: this month's count within the viewer's reach", async () => {
    const w = await world("Slot Dashboard U");
    const a = await w.enrolled("Dash One");
    await w.complete(a.enrolmentId);
    const card = async (actor: Actor) =>
      html(<SlotList slot="dashboardCards" entries={slotsInReach("dashboardCards", actor, w.uni.id)} props={{ uni: "u", actor, university: w.university, today: new Date().toISOString().slice(0, 10) }} />);
    const admin = await card(w.admin);
    expect(admin).toContain("Certificates issued");
    expect(admin).toMatch(/>1<\/div>/);
    expect(await card(w.otherHod)).toMatch(/>0<\/div>/);
    expect(await card(await w.student("Dash Student"))).toBe("");
  });
});
