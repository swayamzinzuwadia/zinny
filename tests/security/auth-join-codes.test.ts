/**
 * AUTH-08: joining codes are 6 characters. /join and sign-up with a code looked codes up with no
 * limit, so a script could guess its way into an institute that admits students straight away
 * ("instant" mode). Codes that match nothing are now counted per person and per network.
 */
import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { LIMITS } from "@/server/auth/config";
import { signUpWithCode } from "@/modules/identity/auth";
import { getJoinSettings, joinWithCode, setJoinMode } from "@/modules/identity/joining";
import { makeUser, setupCourse } from "../fixtures";

afterAll(closeDb);

const net = () => `10.47.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const guess = (i: number) => `ZZ${String(i).padStart(4, "0").replace(/0/g, "Q").replace(/1/g, "R")}`;

describe("AUTH-08: guessing joining codes", () => {
  it("pauses /join for a person after too many codes that match nothing, the right code included", async () => {
    const { admin } = await setupCourse({ name: "Instant Join U" });
    await setJoinMode(admin, "instant");
    const { code } = await getJoinSettings(admin);
    const learner = await makeUser("Code Guesser");
    for (let i = 0; i < LIMITS.joinCodeGuesses.limit; i++) {
      await expect(joinWithCode(learner.id, { code: guess(i), ip: net() })).rejects.toThrow(/can't find/);
    }
    await expect(joinWithCode(learner.id, { code, ip: net() })).rejects.toThrow(/Too many joining codes/);

    // Someone else, on another network, with the right code, is unaffected.
    const other = await makeUser("Real Student");
    expect((await joinWithCode(other.id, { code, ip: net() })).status).toBe("joined");
  });

  it("pauses sign-up with a code for a network after too many codes that match nothing", async () => {
    const { admin } = await setupCourse({ name: "Instant Signup U" });
    await setJoinMode(admin, "instant");
    const { code } = await getJoinSettings(admin);
    const ip = net();
    const form = (i: number, c: string) => ({ name: "Guess Bot", email: `guess.${i}.${Date.now()}@example.test`, password: "a long pass phrase 42", confirm: "a long pass phrase 42", ip, code: c });
    for (let i = 0; i < LIMITS.joinCodeGuesses.limit; i++) {
      await expect(signUpWithCode(form(i, guess(i)))).rejects.toThrow(/can't find/);
    }
    await expect(signUpWithCode(form(99, code))).rejects.toThrow(/Too many joining codes/);
    // From another network the right code works.
    const ok = await signUpWithCode({ ...form(100, code), ip: net() });
    expect(ok.status).toBe("created");
  });
});
