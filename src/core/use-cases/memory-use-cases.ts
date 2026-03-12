import type { ObservationRecord, SaveResult } from "../../infrastructure/database/memory-repository.js";
import { MemoryRepository } from "../../infrastructure/database/memory-repository.js";

export class SaveMemoryUseCase {
  static execute(data: ObservationRecord): SaveResult {
    return MemoryRepository.save(data);
  }
}

export class SearchMemoriesUseCase {
  static execute(
    keyword: string,
    project_path: string,
    options: { type?: string; scope?: string; limit?: number } = {}
  ): any[] {
    return MemoryRepository.search(keyword, project_path, options);
  }
}

export class GetContextUseCase {
  static execute(project_path: string, limit?: number): string {
    return MemoryRepository.getContext(project_path, limit);
  }
}

export class DeleteMemoryUseCase {
  static execute(id: number, project_path: string): boolean {
    return MemoryRepository.delete(id, project_path);
  }
}

export class SessionUseCase {
  static start(id: string, project_path: string, directory?: string): void {
    MemoryRepository.createSession(id, project_path, directory);
  }
  static end(id: string, summary?: string): void {
    MemoryRepository.endSession(id, summary);
  }
}

export class SuggestTopicKeyUseCase {
  static execute(type: string, title: string, content?: string): string {
    return MemoryRepository.suggestTopicKey(type, title, content);
  }
}
