import "./src/db/load-env";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // Core tables, then every module's own tables (each module owns its schema.ts).
  schema: ["./src/db/schema.ts", "./src/modules/*/schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL_OWNER! },
});
