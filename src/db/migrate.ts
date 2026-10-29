import "./load-env";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

/** Applies table migrations, then the row-level security policies and grants. */
export async function runMigrations(url = process.env.DATABASE_URL_OWNER) {
  if (!url) throw new Error("DATABASE_URL_OWNER is not set");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: join(process.cwd(), "drizzle") });
    await sql.unsafe(readFileSync(join(process.cwd(), "src/db/policies.sql"), "utf8"));
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  runMigrations()
    .then(() => console.log("Migrations and policies applied."))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
