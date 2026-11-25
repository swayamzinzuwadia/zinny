/**
 * AUTH-01, at the request layer: a phone-code session opens its own institute and nothing
 * else. Elsewhere (another institute, the Zinny panel, the marketplace, /join, /privacy) the
 * browser counts as signed out, so the person signs in again with their password.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb } from "@/db/client";
import { createSession, sessionCookieName } from "@/server/auth/session";
import { grant, makeUniversity, makeUser } from "../fixtures";
import { cookieJar } from "../identity/helpers";

const browser = vi.hoisted(() => ({ jar: null as null | { get(name: string): { value: string } | undefined } }));
vi.mock("next/headers", () => ({
  cookies: async () => browser.jar ?? { get: () => undefined },
  headers: async () => new Headers(),
}));

const { currentUserId } = await import("@/server/auth/session");
const { platformContext, spaceContext } = await import("@/server/context");

afterAll(closeDb);

const client = { ip: "10.45.0.1", userAgent: "Mozilla/5.0 (Linux; Android 15) Chrome/141.0 Mobile" };

/** "in", or where the request was sent instead. */
async function outcome(run: () => Promise<unknown>) {
  try {
    await run();
    return "in";
  } catch (e) {
    const digest = String((e as { digest?: string }).digest ?? e);
    return digest.startsWith("NEXT_REDIRECT") ? digest.split(";")[2] : digest;
  }
}

async function scene() {
  const academy = await makeUniversity("Phone Academy");
  const college = await makeUniversity("Other College");
  const u = await makeUser("Two Place Teacher");
  await grant(u.id, "institute_admin", { universityId: academy.id });
  await grant(u.id, "institute_admin", { universityId: college.id });
  await grant(u.id, "super_admin");
  return { academy, college, u };
}

beforeEach(() => {
  browser.jar = null;
});

describe("AUTH-01: where a phone-code session counts", () => {
  it("opens the institute the code was entered at, and no other", async () => {
    const { academy, college, u } = await scene();
    const s = await createSession(u.id, "phone", client, new Date(), { scopeUniversityId: academy.id });
    browser.jar = cookieJar({ [sessionCookieName()]: s.token });

    expect(await outcome(() => spaceContext(academy.slug))).toBe("in");
    // Deny: another institute where the same person is an admin asks them to sign in again.
    expect(await outcome(() => spaceContext(college.slug))).toBe(`/login?next=/${college.slug}`);
    // Deny: the Zinny panel too, though the account is a Super Admin.
    expect(await outcome(() => platformContext())).toBe("/login?next=/platform");
    // Deny: pages outside any institute see no one signed in.
    expect(await currentUserId()).toBeNull();
  });

  it("a password session of the same person opens everything they hold", async () => {
    const { academy, college, u } = await scene();
    const s = await createSession(u.id, "password", client);
    browser.jar = cookieJar({ [sessionCookieName()]: s.token });

    expect(await outcome(() => spaceContext(academy.slug))).toBe("in");
    expect(await outcome(() => spaceContext(college.slug))).toBe("in");
    expect(await outcome(() => platformContext())).toBe("in");
    expect(await currentUserId()).toBe(u.id);
  });
});
