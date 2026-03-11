import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, "../drymem.sqlite");
const walPath = path.join(__dirname, "../drymem.sqlite-wal");
const shmPath = path.join(__dirname, "../drymem.sqlite-shm");

function deleteFileIfExists(filePath: string) {
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      console.error(`Error deleting ${path.basename(filePath)}:`, error);
    }
  }
}

deleteFileIfExists(dbPath);
deleteFileIfExists(walPath);
deleteFileIfExists(shmPath);
