/** Learner app polish before delivery: navigation, copy and what a learner is shown. */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clashLines } from "@/app/[uni]/learn/clash-lines";
import { LEARN_PARENTS, learnSections } from "@/app/[uni]/learn/nav";
import { LEARNER_SHOW_ANSWERS } from "@/modules/assessments/lib/labels";
import { CertificateCard } from "@/modules/certificates/components/certificate-card";
import type { CertificateView } from "@/modules/certificates/service/certificates";
import { leadersLine } from "@/modules/gamification/components/learner";
import marketplace from "@/modules/marketplace";
import { CORE_KINDS, MODULE_KINDS, PAYMENT_KINDS, forLearnerSettings, learnerDescription } from "@/modules/notifications-delivery/kinds";
import type { Clash } from "@/server/services/schedule";

const base = "/demo/learn";

describe("learner navigation", () => {
  it("students reach Tests and Polls from the tabs and the phone menu, after Assignments", () => {
    const { primary, more } = learnSections(base, "student", true);
    expect(primary.map((i) => i.label)).toEqual(["Today", "Timetable", "Courses", "My learning"]);
    expect(more.map((i) => i.label)).toEqual(["Assignments", "Tests", "Polls", "Leaderboard", "Certificates", "My library", "Marketplace"]);
  });

  it("a parent has a single home page, so no tab bar", () => {
    const { primary, more } = learnSections(base, "parent", false);
    expect([...primary, ...more]).toHaveLength(1);
  });

  it("Polls, Assignments and Certificates are top level: no back pill on their own pages", () => {
    for (const prefix of ["/polls", "/assignments", "/certificates"]) {
      expect(LEARN_PARENTS.find((p) => p.prefix === prefix)?.href).toBe(prefix);
    }
  });
});

describe("clash warning", () => {
  const clash = (weekday: number, day: string, batchName = "Weekday morning"): Clash => ({
    batchId: batchName,
    batchName,
    courseTitle: "Data Analytics",
    weekday,
    when: `${day} 9 am–11 am`,
  });

  it("says each clashing batch once, with its days together", () => {
    const week = [clash(1, "Mon"), clash(2, "Tue"), clash(3, "Wed"), clash(4, "Thu"), clash(5, "Fri")];
    expect(clashLines(week)).toEqual(["Data Analytics (Weekday morning), Mon to Fri, 9 am–11 am"]);
    expect(clashLines([clash(2, "Tue"), clash(4, "Thu")])).toEqual(["Data Analytics (Weekday morning), Tue and Thu, 9 am–11 am"]);
    expect(clashLines([clash(1, "Mon"), clash(6, "Sat", "Weekend")])).toEqual([
      "Data Analytics (Weekday morning), Mon, 9 am–11 am",
      "Data Analytics (Weekend), Sat, 9 am–11 am",
    ]);
  });
});

describe("learner copy", () => {
  it("test rules speak to the student, not about them", () => {
    expect(LEARNER_SHOW_ANSWERS.after_submit).toBe("You see the answers as soon as you submit.");
    for (const text of Object.values(LEARNER_SHOW_ANSWERS)) expect(text).not.toMatch(/student/i);
  });

  it("every learner notification kind has a description in the learner's own words", () => {
    for (const k of [...CORE_KINDS, ...MODULE_KINDS].filter((k) => k.audience === "learners")) {
      const text = learnerDescription(k.kind);
      expect(text, k.kind).toMatch(/\byou(r)?\b/i);
      expect(text, k.kind).not.toMatch(/a learner/i);
    }
  });

  it("learner settings never list staff kinds, and list payment kinds only for someone who has paid", () => {
    expect(forLearnerSettings("switch.requested", true)).toBe(false);
    expect(forLearnerSettings("finance.refund_due", true)).toBe(false);
    for (const kind of PAYMENT_KINDS) {
      expect(forLearnerSettings(kind, false), kind).toBe(false);
      expect(forLearnerSettings(kind, true), kind).toBe(true);
    }
    expect(forLearnerSettings("timetable.changed", false)).toBe(true);
  });
});

describe("challenge leaders", () => {
  const row = (name: string, reached: boolean) => ({ userId: name, name, value: reached ? 5 : 3, reachedAt: reached ? new Date() : null, position: null });

  it("an ended challenge names its winners, a running one who finished first or who leads", () => {
    expect(leadersLine({ status: "ended", leaders: [row("Meera N.", true), row("Riya S.", true)], finishers: 4 })).toBe("Won by Meera N., Riya S. and 2 more");
    expect(leadersLine({ status: "ended", leaders: [row("Tara I.", false)], finishers: 0 })).toBeNull();
    expect(leadersLine({ status: "active", leaders: [row("Neil J.", true), row("Riya S.", false)], finishers: 1 })).toBe("First to finish: Neil J.");
    expect(leadersLine({ status: "active", leaders: [row("Tara I.", false)], finishers: 0 })).toBe("Leading: Tara I.");
  });
});

describe("learner home and certificates", () => {
  it("the marketplace card comes after the student's own learning", () => {
    expect(marketplace.learnerHomeCards?.find((c) => c.key === "library")?.order).toBeGreaterThanOrEqual(900);
  });

  it("a revoked certificate can't be downloaded or shared from the learner app", () => {
    const c: CertificateView = {
      id: "00000000-0000-4000-8000-000000000001",
      code: "JWJDKT2JT300",
      displayCode: "JWJD-KT2J-T300",
      verifyPath: "/verify/JWJDKT2JT300",
      userId: "u",
      studentName: "Kabir Mehta",
      courseId: "c",
      courseTitle: "Python Basics",
      batchId: "b",
      enrolmentId: "e",
      completedOn: "2026-11-04",
      issuedOn: "2026-11-04",
      validUntil: null,
      status: "valid",
      source: "automatic",
      issueReason: null,
      revokeReason: null,
      replacesId: null,
      replacedById: null,
      design: "classic",
    };
    const valid = renderToStaticMarkup(<CertificateCard uni="demo" c={c} svg={null} />);
    expect(valid).toContain("Download PDF");
    const revoked = renderToStaticMarkup(<CertificateCard uni="demo" c={{ ...c, status: "revoked" }} svg={null} />);
    expect(revoked).toContain("revoked this certificate");
    expect(revoked).not.toContain("Download PDF");
    expect(revoked).not.toMatch(/share link/i);
  });
});
