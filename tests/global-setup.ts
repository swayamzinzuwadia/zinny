import postgres from "postgres";
import "./env";
import { runMigrations } from "../src/db/migrate";

/** Fresh schema for every test run. */
export default async function setup() {
  const url = process.env.DATABASE_URL_OWNER!;
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe(`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await sql.end();
  await runMigrations(url);
}
