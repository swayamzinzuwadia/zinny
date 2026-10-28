import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything you can run queries on: the pool or an open transaction. */
export type Conn = Db | Tx;

type Pools = { app?: Db; system?: Db; raw: postgres.Sql[] };
const g = globalThis as unknown as { __zinny?: Pools };
const pools: Pools = (g.__zinny ??= { raw: [] });

function make(url: string | undefined, name: string): Db {
  if (!url) throw new Error(`${name} is not set`);
  const client = postgres(url, { max: 10, onnotice: () => {} });
  pools.raw.push(client);
  return drizzle(client, { schema });
}

/** Row-level security applies. Use through withTenant() only. */
export function appDb(): Db {
  return (pools.app ??= make(process.env.DATABASE_URL, "DATABASE_URL"));
}

/**
 * Bypasses row-level security. Only for: sign-in, the Zinny team panel,
 * background jobs and migrations. Never for anything a university user triggers directly.
 */
export function systemDb(): Db {
  return (pools.system ??= make(process.env.DATABASE_URL_OWNER, "DATABASE_URL_OWNER"));
}

export async function closeDb() {
  await Promise.all(pools.raw.map((c) => c.end({ timeout: 5 })));
  pools.raw = [];
  pools.app = undefined;
  pools.system = undefined;
}
