/**
 * npm run db:push   — applies the current schema (core + every module's schema.ts) to the
 *                     dev database with `drizzle-kit push --force`, then row-level security
 *                     and grants from src/db/policies.sql.
 * npm run db:reset  — drops everything in that database first, then does the same. Use it
 *                     when push needs to ask about a renamed table or column (it can't ask
 *                     outside a terminal), or to start clean. Run db:seed afterwards.
 *
 * Uses DATABASE_URL_OWNER from the shell, .env.local or .env (in that order).
 */
import "../src/db/load-env";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

export async function applyPolicies(url: string, cwd = process.cwd()) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(readFileSync(join(cwd, "src/db/policies.sql"), "utf8"));
  } finally {
    await sql.end();
  }
}

export async function dropEverything(url: string) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  } finally {
    await sql.end();
  }
}

/** Runs drizzle-kit push against `url`. Throws with drizzle-kit's own output when it fails. */
export function drizzlePush(url: string, cwd = process.cwd()) {
  const bin = join(cwd, "node_modules", ".bin", process.platform === "win32" ? "drizzle-kit.cmd" : "drizzle-kit");
  const res = spawnSync(bin, ["push", "--force"], {
    cwd,
    env: { ...process.env, DATABASE_URL_OWNER: url },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  // drizzle-kit can print an error and still exit 0, so check the output too.
  if (res.status !== 0 || /^\s*Error\b|error:/im.test(out)) {
    const needsPrompt = /Interactive prompts require a TTY/.test(out);
    throw new Error(
      needsPrompt
        ? "drizzle-kit needs to ask whether a table or column was renamed, and it can only ask in a terminal.\n" +
            "Either run `npx drizzle-kit push` yourself in a terminal and answer, or run `npm run db:reset` (drops all data) and then `npm run db:seed`."
        : `drizzle-kit push failed:\n${out}`,
    );
  }
}

/** Push the schema and apply row-level security, optionally after wiping the database. */
export async function pushDatabase(url: string, opts: { reset?: boolean; cwd?: string } = {}) {
  if (opts.reset) await dropEverything(url);
  drizzlePush(url, opts.cwd);
  await applyPolicies(url, opts.cwd);
}

async function main() {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) throw new Error("DATABASE_URL_OWNER is not set. Run `npm run agent:setup -- <agent> <port>` or fill in .env.");
  const reset = process.argv.includes("--reset");
  const dbName = new URL(url).pathname.slice(1);
  await pushDatabase(url, { reset });
  console.log(`${reset ? "Reset and pushed" : "Pushed"} the schema and row-level security to ${dbName}.`);
}

if (process.argv[1]?.endsWith("db-push.ts")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
