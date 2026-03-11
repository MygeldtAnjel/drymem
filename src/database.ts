import { runMigrations } from "./infrastructure/database/migrations.js";
import { MemoryRepository } from "./infrastructure/database/memory-repository.js";

export { runMigrations };
export { MemoryRepository as dbRepository };

export function memSave(data: { topic_key: string; project_path: string; scope: string; query_input: string; proposed_code: string; content: string; status: string; }): string {
  const result = MemoryRepository.save(data);
  if (result.success) {
    return "SUCCESS";
  }
  return result.error || "Unknown error";
}

export function memSearch(keyword: string, project_path: string): any[] {
  return MemoryRepository.search(keyword, project_path);
}

export function memContext(project_path: string): any[] {
  return MemoryRepository.getContext(project_path);
}

export function memDelete(topic_key: string, project_path: string): boolean {
  return MemoryRepository.delete(topic_key, project_path);
}
