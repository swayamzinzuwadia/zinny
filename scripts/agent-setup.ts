/**
 * npm run agent:setup -- <agent> <port>
 *
 * Once per worktree. Gives an agent its own databases and port:
 *   1. connects with DATABASE_ADMIN_URL (a superuser; default below),
 *   2. creates the roles zinny_owner and zinny_app if they're missing,
 *   3. creates zinny_<agent> and zinny_<agent>_test (hyphens become underscores),
 *   4. writes .env.local with AGENT, PORT and the four database URLs,
 *   5. pushes the schema and row-level security to both databases, then seeds the dev one.
 *
 * Re-running is safe: existing roles and databases are kept, and the dev database is
 * re-seeded. Pass --reset to drop and recreate both databases first.
 * Needs only files in git (no .env), so it works in a fresh worktree.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const DEFAULT_ADMIN_URL = "postgres://zinny_owner:zinny@localhost:5432/postgres";
const OWNER = { name: "zinny_owner", password: "zinny" };
const APP = { name: "zinny_app", password: "zinny_app" };

type Ownership = { agents: Record<string, { module: string; port: number }> };

export function dbNamesFor(agent: string) {
  const base = `zinny_${agent.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
  return { dev: base, test: `${base}_test` };
}

function urlFor(admin: URL, user: { name: string; password: string }, db: string) {
  const u = new URL(admin.toString());
  u.username = user.name;
  u.password = user.password;
  u.pathname = `/${db}`;
  return u.toString();
}

export function renderEnvLocal(o: { agent: string; port: number; admin: URL; dev: string; test: string }) {
  return [
    `# Written by npm run agent:setup -- ${o.agent} ${o.port}. Local to this worktree; never committed.`,
    `AGENT=${o.agent}`,
    `PORT=${o.port}`,
    `# Owner role: schema pushes, sign-in lookups, the Zinny team panel. Bypasses row-level security.`,
    `DATABASE_URL_OWNER=${urlFor(o.admin, OWNER, o.dev)}`,
    `# App role: everything a university user does. Row-level security always applies.`,
    `DATABASE_URL=${urlFor(o.admin, APP, o.dev)}`,
    `TEST_DATABASE_URL_OWNER=${urlFor(o.admin, OWNER, o.test)}`,
    `TEST_DATABASE_URL=${urlFor(o.admin, APP, o.test)}`,
    "",
  ].join("\n");
}

async function ensureRolesAndDatabases(adminUrl: string, dbs: string[], reset: boolean) {
  const sql = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    for (const r of [OWNER, APP]) {
      const [exists] = await sql`select 1 from pg_roles where rolname = ${r.name}`;
      if (!exists) {
        // The owner must own the tables (so the app role is subject to RLS) and create databases.
        const attrs = r === OWNER ? "LOGIN SUPERUSER CREATEDB" : "LOGIN NOSUPERUSER NOBYPASSRLS";
        await sql.unsafe(`create role ${r.name} ${attrs} password '${r.password}'`);
        console.log(`Created role ${r.name}.`);
      }
    }
    for (const db of dbs) {
      if (reset) {
        await sql.unsafe(`drop database if exists ${db} with (force)`);
      }
      const [exists] = await sql`select 1 from pg_database where datname = ${db}`;
      if (!exists) {
        await sql.unsafe(`create database ${db} owner ${OWNER.name}`);
        console.log(`Created database ${db}.`);
      } else {
        console.log(`Database ${db} already exists; keeping it.`);
      }
    }
  } finally {
    await sql.end();
  }
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv) {
  const res = spawnSync(cmd, args, { stdio: "inherit", env, cwd: process.cwd() });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (exit ${res.status}).`);
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--reset");
  const reset = process.argv.includes("--reset");
  const [agent, portArg] = args;
  if (!agent || !portArg || !/^\d+$/.test(portArg)) {
    console.error("Usage: npm run agent:setup -- <agent> <port>   e.g. npm run agent:setup -- assessments 3101");
    process.exit(1);
  }
  const port = Number(portArg);
  const ownershipPath = join(process.cwd(), "docs/plan/ownership.json");
  if (existsSync(ownershipPath)) {
    const ownership = JSON.parse(readFileSync(ownershipPath, "utf8")) as Ownership;
    const entry = ownership.agents[agent];
    if (!entry) console.warn(`Note: "${agent}" isn't in docs/plan/ownership.json; check:ownership will refuse every change.`);
    else if (entry.port !== port) console.warn(`Note: ownership.json gives ${agent} port ${entry.port}; using ${port} as asked.`);
  }

  const adminUrl = process.env.DATABASE_ADMIN_URL || DEFAULT_ADMIN_URL;
  const admin = new URL(adminUrl);
  const { dev, test } = dbNamesFor(agent);
  console.log(`Setting up ${agent} on port ${port}: databases ${dev} and ${test} (admin ${admin.username}@${admin.host}).`);
  await ensureRolesAndDatabases(adminUrl, [dev, test], reset);

  writeFileSync(join(process.cwd(), ".env.local"), renderEnvLocal({ agent, port, admin, dev, test }));
  console.log("Wrote .env.local.");

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AGENT: agent,
    PORT: String(port),
    DATABASE_URL_OWNER: urlFor(admin, OWNER, dev),
    DATABASE_URL: urlFor(admin, APP, dev),
    TEST_DATABASE_URL_OWNER: urlFor(admin, OWNER, test),
    TEST_DATABASE_URL: urlFor(admin, APP, test),
  };
  // Through npm, so pre-scripts (gen) run too, against this worktree's databases.
  // The test database gets its schema too; the test run itself also resets it.
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npm, ["run", "db:push"], env);
  run(npm, ["run", "db:push"], { ...env, DATABASE_URL_OWNER: env.TEST_DATABASE_URL_OWNER, DATABASE_URL: env.TEST_DATABASE_URL });
  run(npm, ["run", "db:seed"], env);
  console.log(`\nReady. Start the app with \`npm run dev\` (http://localhost:${port}) and run tests with \`npm test\`.`);
}

if (process.argv[1]?.endsWith("agent-setup.ts")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
