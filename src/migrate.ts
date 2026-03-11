import { runMigrations } from "./database.ts";

try {
  runMigrations();
  process.exit(0);
} catch (error) {
  process.exit(1);
}
