import type { MemoryRecord } from "../../infrastructure/database/memory-repository.js";
import { MemoryRepository } from "../../infrastructure/database/memory-repository.js";

/**
 * Use Case: Save a memory
 * Encapsulates the business logic for saving/updating memories
 */
export class SaveMemoryUseCase {
  static execute(data: MemoryRecord): { success: true; id: number } | { success: false; error: string } {
    return MemoryRepository.save(data);
  }
}

/**
 * Use Case: Search memories
 * Encapsulates the business logic for searching memories
 */
export class SearchMemoriesUseCase {
  static execute(keyword: string, project_path: string): any[] {
    return MemoryRepository.search(keyword, project_path);
  }
}

/**
 * Use Case: Get project context
 * Encapsulates the business logic for retrieving recent project context
 */
export class GetContextUseCase {
  static execute(project_path: string): any[] {
    return MemoryRepository.getContext(project_path);
  }
}

/**
 * Use Case: Delete a memory (soft delete)
 * Encapsulates the business logic for deleting memories
 */
export class DeleteMemoryUseCase {
  static execute(topic_key: string, project_path: string): boolean {
    return MemoryRepository.delete(topic_key, project_path);
  }
}
