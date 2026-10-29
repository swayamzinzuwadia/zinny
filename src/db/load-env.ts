/**
 * Loads `.env.local` (written by `npm run agent:setup`), then `.env`. The first file to
 * set a variable wins, and variables already set in the shell always win. Used by the
 * seed, Drizzle, the tests and every script, so they all agree on which database to use.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";

export const ENV_FILES = [".env.local", ".env"] as const;

export function loadEnvFiles(cwd = process.cwd()) {
  for (const file of ENV_FILES) {
    const path = join(cwd, file);
    if (existsSync(path)) config({ path, quiet: true });
  }
}

loadEnvFiles();
