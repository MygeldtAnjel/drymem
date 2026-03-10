import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ES Modules configuration (get the current directory path)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("drymem.sqlite");
db.pragma("journal_mode = WAL");

export { db };
export default db;
