import { EventEmitter } from 'events';

export interface PushProgress {
  stage: 'materials' | 'equipment' | 'services' | 'updating' | 'complete' | 'error';
  message: string;
  current: number;
  total: number;
  percent: number;
}

class PushProgressEmitter extends EventEmitter {
  private progressByTenant: Map<number, PushProgress> = new Map();

  emit(event: 'progress', tenantId: number, progress: PushProgress): boolean {
    this.progressByTenant.set(tenantId, progress);
    return super.emit(event, tenantId, progress);
  }

  getProgress(tenantId: number): PushProgress | undefined {
    return this.progressByTenant.get(tenantId);
  }

  clearProgress(tenantId: number): void {
    this.progressByTenant.delete(tenantId);
  }
}

export const pushProgressEmitter = new PushProgressEmitter();

export function emitProgress(
  tenantId: number,
  stage: PushProgress['stage'],
  message: string,
  current: number,
  total: number
): void {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  pushProgressEmitter.emit('progress', tenantId, {
    stage,
    message,
    current,
    total,
    percent,
  });
}
