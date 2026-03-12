import { runMigrations } from "./infrastructure/database/migrations.js";

try {
  runMigrations();
  process.exit(0);
} catch (error) {
  process.exit(1);
}
