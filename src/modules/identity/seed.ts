/**
 * identity demo data for the Demo University (runs after the core seed):
 *  - phone sign-in turned on, and mobile numbers for the demo accounts;
 *  - three people who haven't joined yet (one pending invitation for a faculty member,
 *    one pending and one expired for students), and two who joined from their invitation;
 *  - earlier sign-ins on other devices for Riya and Asha, so their sessions list is real;
 *  - a profile photo for Asha (generated here, no download).
 * Prints a working invitation link so the invite page can be tried straight away.
 */
import sharp from "sharp";
import { and, eq, isNull } from "drizzle-orm";
import type { SeedContext } from "@/contracts/module";
import { audit, withTenant } from "@/server/core";
import { appUrl } from "@/server/auth/config";
import { sha256 } from "@/server/auth/tokens";
import { makeInviteToken, seedClearSessions, seedSession, seedSetPhone, seedWithoutPassword } from "./auth";
import { uploadPhoto } from "./profile";
import { idnInvites } from "./schema";
import { setPhoneSignIn } from "./settings";

const DAY = 86_400_000;
const HOUR = 3_600_000;

const PHONES: Record<string, string> = {
  "asha@demo.edu": "98200 11010",
  "hema@demo.edu": "98200 11011",
  "farah@demo.edu": "98200 11012",
  "riya@demo.edu": "98200 11001",
  "kabir@demo.edu": "98200 11002",
  "pallavi@demo.edu": "98200 11003",
};

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";

/** An abstract portrait in brand colours: no text, so no fonts are needed. */
async function placeholderPhoto(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b5e4c"/><stop offset="1" stop-color="#063a2f"/></linearGradient></defs>
    <rect width="512" height="512" fill="url(#g)"/>
    <circle cx="256" cy="206" r="92" fill="#f7eccb"/>
    <path d="M86 512c18-104 90-170 170-170s152 66 170 170z" fill="#f7eccb"/>
    <path d="M164 190c6-70 52-104 98-104 58 0 96 40 92 112-22-34-62-50-98-50-38 0-70 16-92 42z" fill="#14261f"/>
    <circle cx="420" cy="92" r="26" fill="#d4a72a"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function seed(ctx: SeedContext) {
  const now = new Date();
  const id = (email: string) => {
    const v = ctx.ids.users[email];
    if (!v) throw new Error(`identity seed: no seeded user ${email}`);
    return v;
  };
  const asha = await ctx.actorFor("asha@demo.edu");

  // Sign-in options and mobile numbers.
  await setPhoneSignIn(asha, true);
  for (const [email, phone] of Object.entries(PHONES)) await seedSetPhone(id(email), phone);

  // People who haven't joined yet. The core seed gave everyone the demo password, so these
  // three get theirs taken away, as if they'd only just been added.
  const pending: { email: string; role: "permanent_faculty" | "student"; sentAgo: number }[] = [
    { email: "neel@demo.edu", role: "permanent_faculty", sentAgo: 2 * HOUR },
    { email: "neil@demo.edu", role: "student", sentAgo: 2 * DAY },
    { email: "diya@demo.edu", role: "student", sentAgo: 9 * DAY },
  ];
  const links: string[] = [];
  await withTenant(ctx.systemActor, async (tx) => {
    for (const p of pending) {
      const userId = id(p.email);
      await seedWithoutPassword(userId);
      // One live link per person, as in the app.
      await tx
        .update(idnInvites)
        .set({ revokedAt: now, revokeReason: "replaced" })
        .where(and(eq(idnInvites.userId, userId), isNull(idnInvites.acceptedAt), isNull(idnInvites.revokedAt)));
      const token = makeInviteToken(ctx.universityId);
      const sentAt = new Date(now.getTime() - p.sentAgo);
      const [row] = await tx
        .insert(idnInvites)
        .values({
          universityId: ctx.universityId,
          userId,
          role: p.role,
          tokenHash: sha256(token),
          sentAt,
          createdAt: sentAt,
          expiresAt: new Date(sentAt.getTime() + 7 * DAY),
          invitedBy: asha.userId,
        })
        .returning({ id: idnInvites.id });
      await audit(tx, asha, "invite.send", "idn_invite", row.id, { userId, role: p.role, seed: true });
      if (p.sentAgo < 7 * DAY) links.push(`  ${p.email}: ${appUrl()}/invite/${token}`);
    }
    // Two people who joined from their invitation.
    for (const [email, role, joinedAgo] of [
      ["farah@demo.edu", "permanent_faculty", 12 * DAY],
      ["riya@demo.edu", "student", 20 * DAY],
    ] as const) {
      const sentAt = new Date(now.getTime() - joinedAgo - 5 * HOUR);
      await tx.insert(idnInvites).values({
        universityId: ctx.universityId,
        userId: id(email),
        role,
        tokenHash: sha256(makeInviteToken(ctx.universityId)),
        sentAt,
        createdAt: sentAt,
        expiresAt: new Date(sentAt.getTime() + 7 * DAY),
        acceptedAt: new Date(now.getTime() - joinedAgo),
        invitedBy: asha.userId,
      });
    }
    const [check] = await tx.select({ n: idnInvites.id }).from(idnInvites).where(eq(idnInvites.universityId, ctx.universityId)).limit(1);
    if (!check) throw new Error("identity seed: invitations weren't saved");
  });

  // Earlier sign-ins on other devices.
  for (const email of ["riya@demo.edu", "asha@demo.edu"]) await seedClearSessions(id(email));
  await seedSession(id("riya@demo.edu"), { method: "phone", ip: "49.36.112.20", userAgent: ANDROID, createdAt: new Date(now.getTime() - 3 * DAY), lastSeenAt: new Date(now.getTime() - 2 * HOUR) });
  await seedSession(id("riya@demo.edu"), { method: "password", ip: "103.21.58.7", userAgent: WINDOWS, createdAt: new Date(now.getTime() - 9 * DAY), lastSeenAt: new Date(now.getTime() - 4 * DAY) });
  await seedSession(id("asha@demo.edu"), { method: "password", ip: "103.21.58.40", userAgent: MAC, createdAt: new Date(now.getTime() - 6 * DAY), lastSeenAt: new Date(now.getTime() - 20 * HOUR) });
  await seedSession(id("asha@demo.edu"), { method: "phone", ip: "49.36.112.81", userAgent: IPHONE, createdAt: new Date(now.getTime() - 1 * DAY), lastSeenAt: new Date(now.getTime() - 35 * 60_000) });

  const photo = await placeholderPhoto();
  await uploadPhoto(asha, asha.userId, { bytes: photo, type: "image/png", size: photo.length });

  console.log(`  identity: phone sign-in is on; try 98200 11001 (Riya). Codes are printed in the server console.`);
  console.log(`  identity: invitation links you can open now:\n${links.join("\n")}`);
}
