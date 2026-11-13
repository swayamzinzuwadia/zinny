/**
 * Runs before `next build` (prebuild). On Vercel only, brings the deployed database up to
 * the schema of the code being deployed: `drizzle-kit push --force`, then row-level
 * security and grants from src/db/policies.sql. Data is kept; nothing is wiped or seeded.
 *
 * Needs DATABASE_URL_OWNER in the Vercel project's environment variables (the unpooled
 * owner connection string). Set ZINNY_SKIP_DB_PUSH=1 there to turn this off.
 *
 * A failed push fails the build, so Vercel keeps serving the previous deployment instead
 * of new code against an old schema.
 */
import { pushDatabase } from "./db-push";

async function main() {
  if (!process.env.VERCEL) return;
  if (process.env.ZINNY_SKIP_DB_PUSH === "1") {
    console.log("deploy-db: ZINNY_SKIP_DB_PUSH=1, leaving the database as it is.");
    return;
  }
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) {
    console.warn("deploy-db: DATABASE_URL_OWNER is not set in Vercel, so the database schema was not updated.");
    return;
  }
  const started = Date.now();
  await pushDatabase(url);
  console.log(`deploy-db: schema and row-level security are up to date (${Math.round((Date.now() - started) / 1000)}s).`);
}

main().catch((e) => {
  console.error("deploy-db: could not update the database schema.");
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
