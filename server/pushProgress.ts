import { EventEmitter } from 'events';

export interface PushProgress {
  stage: 'materials' | 'equipment' | 'services' | 'updating' | 'complete' | 'error' | 'cancelled';
  message: string;
  current: number;
  total: number;
  percent: number;
  startedAt?: number;  // Unix timestamp when push started
  phaseStartedAt?: number;  // Unix timestamp when current phase started
}

class PushProgressEmitter extends EventEmitter {
  private progressByTenant: Map<number, PushProgress> = new Map();
  private cancelledTenants: Set<number> = new Set();
  private startTimeByTenant: Map<number, number> = new Map();
  private phaseStartTimeByTenant: Map<number, { stage: string; startedAt: number }> = new Map();

  emit(event: 'progress', tenantId: number, progress: PushProgress): boolean {
    this.progressByTenant.set(tenantId, progress);
    return super.emit(event, tenantId, progress);
  }

  getProgress(tenantId: number): PushProgress | undefined {
    return this.progressByTenant.get(tenantId);
  }

  clearProgress(tenantId: number): void {
    this.progressByTenant.delete(tenantId);
    this.cancelledTenants.delete(tenantId);
    this.startTimeByTenant.delete(tenantId);
    this.phaseStartTimeByTenant.delete(tenantId);
  }

  requestCancel(tenantId: number): void {
    this.cancelledTenants.add(tenantId);
  }

  isCancelled(tenantId: number): boolean {
    return this.cancelledTenants.has(tenantId);
  }

  clearCancel(tenantId: number): void {
    this.cancelledTenants.delete(tenantId);
  }

  startPush(tenantId: number): number {
    const now = Date.now();
    this.startTimeByTenant.set(tenantId, now);
    return now;
  }

  getStartTime(tenantId: number): number | undefined {
    return this.startTimeByTenant.get(tenantId);
  }

  startPhase(tenantId: number, stage: string): number {
    const now = Date.now();
    this.phaseStartTimeByTenant.set(tenantId, { stage, startedAt: now });
    return now;
  }

  getPhaseStartTime(tenantId: number): number | undefined {
    return this.phaseStartTimeByTenant.get(tenantId)?.startedAt;
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
    startedAt: pushProgressEmitter.getStartTime(tenantId),
    phaseStartedAt: pushProgressEmitter.getPhaseStartTime(tenantId),
  });
}
