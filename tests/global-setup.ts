import "./env";
import { pushDatabase } from "../scripts/db-push";

/** Fresh test database for every run: drop everything, push the schema, apply row-level security. */
export default async function setup() {
  await pushDatabase(process.env.DATABASE_URL_OWNER!, { reset: true });
}
