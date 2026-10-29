/**
 * npm run check:ownership — fails if this agent changed a file it doesn't own.
 *
 * Reads AGENT (shell, .env.local or .env) and docs/plan/ownership.json, lists every file
 * changed since the tag foundation-v1 (committed, staged, unstaged and untracked, including
 * deletions and both sides of renames), and allows only paths that start with:
 *   - the agent's own prefixes in ownership.json,
 *   - the shared prefixes ("shared" in ownership.json: package.json, package-lock.json),
 *   - tests/<module>/, docs/handoff/<agent>.md and docs/handoff/<agent>/.
 * Prefixes are matched literally (not as globs), because route folders contain brackets.
 */
import "../src/db/load-env";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Ownership = {
  shared: string[];
  agents: Record<string, { module: string; port: number; paths: string[] }>;
};

export const BASE_TAG = "foundation-v1";

export function allowedPrefixes(ownership: Ownership, agent: string): string[] {
  const entry = ownership.agents[agent];
  if (!entry) throw new Error(`Unknown agent "${agent}". Known agents: ${Object.keys(ownership.agents).join(", ")}.`);
  return [...entry.paths, ...ownership.shared, `tests/${entry.module}/`, `docs/handoff/${agent}.md`, `docs/handoff/${agent}/`];
}

/** A path is allowed when it equals a file prefix or sits under a directory prefix (ending in "/"). */
export function isAllowed(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p));
}

export function violations(paths: string[], prefixes: string[]): string[] {
  return [...new Set(paths)].filter((p) => !isAllowed(p, prefixes)).sort();
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** NUL-separated `git diff --name-status -z` output → every path touched (both sides of renames, if any). */
function namesFromStatus(z: string): string[] {
  const parts = z.split("\0").filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i++];
    if (status.startsWith("R") || status.startsWith("C")) {
      out.push(parts[i++], parts[i++]);
    } else {
      out.push(parts[i++]);
    }
  }
  return out;
}

export function changedFiles(base = BASE_TAG): string[] {
  try {
    git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  } catch {
    throw new Error(`The tag ${base} doesn't exist in this repository. Fetch tags (git fetch --tags) and try again.`);
  }
  // Committed since the tag plus staged and unstaged changes: diff the tag against the working tree.
  const tracked = namesFromStatus(git(["diff", "--name-status", "-z", "--no-renames", base]));
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
  return [...new Set([...tracked, ...untracked])].sort();
}

function main() {
  const agent = process.env.AGENT;
  if (!agent) {
    console.error("AGENT is not set. Run `npm run agent:setup -- <agent> <port>` first, or run AGENT=<agent> npm run check:ownership.");
    process.exit(1);
  }
  const ownership = JSON.parse(readFileSync(join(process.cwd(), "docs/plan/ownership.json"), "utf8")) as Ownership;
  const prefixes = allowedPrefixes(ownership, agent);
  const changed = changedFiles();
  const bad = violations(changed, prefixes);
  if (bad.length) {
    console.error(`check:ownership failed for ${agent}: ${bad.length} changed file${bad.length === 1 ? "" : "s"} outside your ownership.\n`);
    for (const p of bad) console.error(`  ${p}`);
    console.error(
      `\nYou may change only:\n${prefixes.map((p) => `  ${p}`).join("\n")}\n\n` +
        "Revert these files (git checkout foundation-v1 -- <file>, or delete new ones) and put what you needed under " +
        '"Requests for other owners" in your handoff.',
    );
    process.exit(1);
  }
  console.log(`check:ownership passed for ${agent}: ${changed.length} changed file${changed.length === 1 ? "" : "s"}, all yours.`);
}

if (process.argv[1]?.endsWith("check-ownership.ts")) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
