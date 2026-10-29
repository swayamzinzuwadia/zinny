/** Wave 1 integration: named kinds for what the other modules send, with working buttons. */
import { describe, expect, it } from "vitest";
import { isSecurityKind, kindDefinition, MODULE_KINDS } from "@/modules/notifications-delivery/kinds";

describe("module notification kinds", () => {
  it("names every kind the merged modules send", () => {
    for (const kind of [
      "attendance.low",
      "attendance.low_summary",
      "certificate.issued",
      "certificate.revoked",
      "certificate.expiring",
      "certificate.expired",
      "gamification.badge",
      "gamification.challenge_won",
      "assignment.new",
      "assignment.due_soon",
      "assignment.graded",
      "poll.open",
      "assess.test.published",
      "assess.result.ready",
      "payment.refunded",
      "finance.refund_failed",
    ]) {
      expect(kindDefinition(kind).description, kind).not.toMatch(/Sent by another part of Zinny/);
      expect(MODULE_KINDS.map((k) => k.kind), kind).toContain(kind);
    }
    expect(kindDefinition("attendance.low").label).toBe("Low attendance");
    expect(kindDefinition("attendance.low_summary").audience).toBe("staff");
  });

  it("the button uses the notification's own link, else the kind's page", () => {
    const cert = kindDefinition("certificate.issued");
    expect(cert.link("demo", { path: "/demo/learn/certificates" })).toBe("/demo/learn/certificates");
    expect(cert.link("demo", {})).toBe("/demo/learn/certificates");
    expect(kindDefinition("assignment.graded").link("demo", { href: "/demo/learn/assignments/a1" })).toBe("/demo/learn/assignments/a1");
    expect(kindDefinition("attendance.low").link("demo", { href: "https://evil.example/x" })).toBe("/demo/learn/my");
  });

  it("keeps the generic channel defaults and text, and none of them is a security kind", () => {
    for (const k of MODULE_KINDS) {
      expect(k.defaults, k.kind).toEqual({ email: "on", sms: "off", whatsapp: "off" });
      expect(k.template.emailSubject).toBe("{{title}}");
      expect(isSecurityKind(k.kind), k.kind).toBe(false);
    }
  });

  it("identity's password-changed email is a named security kind", () => {
    expect(kindDefinition("security.password_changed").label).toBe("Password changed");
    expect(isSecurityKind("security.password_changed")).toBe(true);
  });
});
