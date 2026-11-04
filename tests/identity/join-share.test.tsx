import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { prerenderToNodeStream } from "react-dom/static.node";
import { closeDb } from "@/db/client";
import { loadActor } from "@/server/actor";
import type { Actor } from "@/server/authz/engine";
import { getJoinSettings } from "@/modules/identity/joining";
import { joinLink, joinMessage, joinQrSvg, whatsAppShareHref } from "@/modules/identity/share";
import { InviteStrip } from "@/modules/identity/components/invite-strip";
import { setupCourse } from "../fixtures";

const session = vi.hoisted(() => ({ ctx: null as null | { actor: Actor; university: { id: string; name: string } } }));
vi.mock("@/server/context", () => ({
  spaceContext: async () => session.ctx,
}));
// next/font only works inside Next's compiler.
vi.mock("@/modules/marketing/fonts", () => ({ display: { variable: "" } }));
const { default: JoinPoster } = await import("@/app/[uni]/join-poster/page");

async function html(node: ReactNode) {
  const { prelude } = await prerenderToNodeStream(<>{node}</>);
  let out = "";
  for await (const chunk of prelude) out += chunk.toString();
  return out.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'");
}

afterEach(() => vi.unstubAllEnvs());
afterAll(closeDb);

describe("sharing the joining code", () => {
  it("builds the sign-up link, the message and a WhatsApp link that carries it", () => {
    vi.stubEnv("APP_URL", "https://app.zinny.test/");
    const link = joinLink("PTFQX5");
    expect(link).toBe("https://app.zinny.test/signup?code=PTFQX5");
    const message = joinMessage("Brightpath Academy", link, "PTFQX5");
    expect(message).toBe("Join Brightpath Academy on Zinny. Create your student account here: https://app.zinny.test/signup?code=PTFQX5\nJoining code: PTFQX5");
    const wa = new URL(whatsAppShareHref(message));
    expect(wa.origin).toBe("https://wa.me");
    expect(wa.searchParams.get("text")).toBe(message);
  });

  it("draws the link as an SVG QR code", async () => {
    const svg = await joinQrSvg("https://app.zinny.test/signup?code=PTFQX5");
    expect(svg).toMatch(/^<svg[^>]*viewBox="0 0 \d+ \d+"/);
    expect(svg).toContain('stroke="#063a2f"');
  });

  it("the dashboard strip shows the code, the ways to share it, and what happens next", async () => {
    vi.stubEnv("APP_URL", "https://app.zinny.test");
    const approval = await html(<InviteStrip uni="bright" institute="Brightpath Academy" code="PTFQX5" mode="approval" canManage />);
    expect(approval).toContain("Invite students");
    expect(approval).toContain("PTFQX5");
    expect(approval).toContain("Copy link");
    expect(approval).toContain("Copy code");
    expect(approval).toContain("Share on WhatsApp");
    expect(approval).toContain('href="/bright/join-poster"');
    expect(approval).toContain('href="/bright/admin/users/requests"');
    expect(approval).toContain("wait for an Admin or HOD to accept them");
    expect(approval).toContain("Join requests and settings");
    // A HOD answers requests but can't change how students join.
    const instant = await html(<InviteStrip uni="bright" institute="Brightpath Academy" code="PTFQX5" mode="instant" canManage={false} />);
    expect(instant).toContain("join straight away");
    expect(instant).not.toContain("and settings");
  });
});

describe("the joining poster", () => {
  const poster = () => JoinPoster({ params: Promise.resolve({ uni: "poster-u" }) });

  it("is for the people who accept new students, with the institute's QR code, link and code", async () => {
    const { admin, hod, uni } = await setupCourse({ name: "Poster University" });
    const { code } = await getJoinSettings(admin);
    for (const actor of [admin, hod]) {
      session.ctx = { actor, university: { id: uni.id, name: uni.name } };
      const out = await html(await poster());
      expect(out).toContain("Join Poster University");
      expect(out).toContain(`/signup?code=${code}`);
      expect(out).toContain("<svg");
      expect(out).toContain("Print poster");
    }
  });

  it("isn't for teachers", async () => {
    const { facultyUserId, uni } = await setupCourse({ name: "Poster Faculty U" });
    session.ctx = { actor: await loadActor(facultyUserId, uni.id), university: { id: uni.id, name: uni.name } };
    await expect(poster()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });
});
