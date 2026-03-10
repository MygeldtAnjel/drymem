import { runMigrations } from "./database.ts";

console.log("Starting database review...");
try {
  runMigrations();
  console.log("Migration process completed successfully.");
  process.exit(0);
} catch (error) {
  console.error("❌ Fatal error during migration:", error);
  process.exit(1);
}
