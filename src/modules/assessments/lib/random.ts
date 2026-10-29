import { randomBytes, randomInt } from "node:crypto";

/** A short random id for an answer option. Random, so it says nothing about which option is correct. */
export function optionId(): string {
  return randomBytes(5).toString("base64url").slice(0, 6);
}

/** A shuffled copy (Fisher–Yates with a cryptographic source). */
export function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
