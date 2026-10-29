import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { closeDb } from "@/db/client";
import { idnInvites, idnOtpChallenges, idnPhotos, idnSettings } from "@/modules/identity/schema";
import { expectTenantIsolated } from "../helpers/isolation";
import { makeUser } from "../fixtures";

const owner = postgres(process.env.DATABASE_URL_OWNER!, { max: 1, onnotice: () => {} });
afterAll(async () => {
  await owner.end();
  await closeDb();
});

describe("identity tables are isolated per university", () => {
  it("idn_invites", async () => {
    const u = await makeUser("Iso Invitee");
    await expectTenantIsolated(idnInvites, (uni) => ({
      universityId: uni.id,
      userId: u.id,
      role: "student" as const,
      tokenHash: `${uni.id}-${Math.random()}`,
      expiresAt: new Date(Date.now() + 86_400_000),
    }));
  });

  it("idn_otp_challenges", async () => {
    await expectTenantIsolated(idnOtpChallenges, (uni) => ({
      universityId: uni.id,
      phone: "+919800000000",
      codeHash: "x",
      nonceHash: "y",
      expiresAt: new Date(Date.now() + 300_000),
    }));
  });

  it("idn_photos", async () => {
    await expectTenantIsolated(idnPhotos, async (uni) => ({
      universityId: uni.id,
      userId: (await makeUser("Iso Photo")).id,
      storageKey: `${uni.id}/identity/photos/x.webp`,
    }));
  });

  it("idn_settings", async () => {
    // One row per university (primary key), so each call needs its own university:
    // the helper's second insert as B must still be refused for A's id.
    let calls = 0;
    await expectTenantIsolated(idnSettings, (uni) => {
      calls++;
      return { universityId: uni.id, phoneSignIn: calls === 1 };
    });
  });

  it("the global tables (reset tokens, session details, rate limits) are closed to the app role", async () => {
    const rows = await owner<{ t: string; s: boolean; i: boolean; u: boolean; d: boolean }[]>`
      select t,
        has_table_privilege('zinny_app', 'public.' || t, 'SELECT') as s,
        has_table_privilege('zinny_app', 'public.' || t, 'INSERT') as i,
        has_table_privilege('zinny_app', 'public.' || t, 'UPDATE') as u,
        has_table_privilege('zinny_app', 'public.' || t, 'DELETE') as d
      from unnest(array['idn_tokens', 'idn_sessions', 'idn_throttles']) as t`;
    expect(rows.every((r) => !r.s && !r.i && !r.u && !r.d)).toBe(true);
  });
});
