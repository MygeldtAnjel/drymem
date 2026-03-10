// src/reset.ts
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// SQLite database files paths in the project root
const dbPath = path.join(__dirname, "../drymem.sqlite");
const walPath = path.join(__dirname, "../drymem.sqlite-wal");
const shmPath = path.join(__dirname, "../drymem.sqlite-shm");

console.log("⚠️ Starting complete Drymem database cleanup...");

function deleteFileIfExists(filePath: string) {
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      console.log(`🗑️  Deleted: ${path.basename(filePath)}`);
    } catch (error) {
      console.error(`❌ Error deleting ${path.basename(filePath)}:`, error);
    }
  }
}

// Delete the database and its temporary files
deleteFileIfExists(dbPath);
deleteFileIfExists(walPath);
deleteFileIfExists(shmPath);

console.log("✅ Cleanup completed. The database has been removed.");
console.log("💡 Tip: Run 'npm run db:migrate' to create a new one from scratch.");
