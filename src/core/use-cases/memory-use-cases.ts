import type { MemoryRecord } from "../../infrastructure/database/memory-repository.js";
import { MemoryRepository } from "../../infrastructure/database/memory-repository.js";

export class SaveMemoryUseCase {
  static execute(data: MemoryRecord): { success: true; id: number } | { success: false; error: string } {
    return MemoryRepository.save(data);
  }
}

export class SearchMemoriesUseCase {
  static execute(keyword: string, project_path: string): any[] {
    return MemoryRepository.search(keyword, project_path);
  }
}

export class GetContextUseCase {
  static execute(project_path: string): any[] {
    return MemoryRepository.getContext(project_path);
  }
}

export class DeleteMemoryUseCase {
  static execute(topic_key: string, project_path: string): boolean {
    return MemoryRepository.delete(topic_key, project_path);
  }
}
