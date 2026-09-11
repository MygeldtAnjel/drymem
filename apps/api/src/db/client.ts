/** The database handle. One pool for the process. */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "../env.js";
import * as schema from "./schema.js";

export const sql = postgres(env.DATABASE_URL, { max: 10, onnotice: () => {} });
export const db = drizzle(sql, { schema });
export { schema };
