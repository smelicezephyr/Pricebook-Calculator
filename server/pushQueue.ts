import { EventEmitter } from 'events';

export const MAX_CONCURRENT_PUSHES = 3;

interface QueuedPush {
  tenantId: number;
  historyId: number;
}

class PushQueue extends EventEmitter {
  private activePushes: Map<number, number> = new Map(); // tenantId -> historyId
  private queue: QueuedPush[] = [];

  getActiveCount(): number {
    return this.activePushes.size;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  isActive(tenantId: number): boolean {
    return this.activePushes.has(tenantId);
  }

  getActiveHistoryId(tenantId: number): number | undefined {
    return this.activePushes.get(tenantId);
  }

  canStart(): boolean {
    return this.activePushes.size < MAX_CONCURRENT_PUSHES;
  }

  startPush(tenantId: number, historyId: number): boolean {
    if (this.activePushes.size >= MAX_CONCURRENT_PUSHES) {
      return false;
    }
    this.activePushes.set(tenantId, historyId);
    console.log(`[PushQueue] Started push for tenant ${tenantId} (history ${historyId}). Active: ${this.activePushes.size}/${MAX_CONCURRENT_PUSHES}`);
    return true;
  }

  completePush(tenantId: number): void {
    this.activePushes.delete(tenantId);
    console.log(`[PushQueue] Completed push for tenant ${tenantId}. Active: ${this.activePushes.size}/${MAX_CONCURRENT_PUSHES}`);
    this.processQueue();
  }

  addToQueue(tenantId: number, historyId: number): number {
    const position = this.queue.length + 1;
    this.queue.push({ tenantId, historyId });
    console.log(`[PushQueue] Added tenant ${tenantId} (history ${historyId}) to queue at position ${position}`);
    return position;
  }

  removeFromQueue(historyId: number): boolean {
    const index = this.queue.findIndex(q => q.historyId === historyId);
    if (index !== -1) {
      this.queue.splice(index, 1);
      console.log(`[PushQueue] Removed history ${historyId} from queue`);
      return true;
    }
    return false;
  }

  getQueuePosition(historyId: number): number {
    const index = this.queue.findIndex(q => q.historyId === historyId);
    return index === -1 ? -1 : index + 1;
  }

  private processQueue(): void {
    while (this.queue.length > 0 && this.activePushes.size < MAX_CONCURRENT_PUSHES) {
      const next = this.queue.shift();
      if (next) {
        console.log(`[PushQueue] Dequeuing history ${next.historyId} for tenant ${next.tenantId}`);
        this.emit('ready', next);
      }
    }
  }

  getStatus(): { active: Array<{tenantId: number; historyId: number}>; queued: QueuedPush[] } {
    return {
      active: Array.from(this.activePushes.entries()).map(([tenantId, historyId]) => ({ tenantId, historyId })),
      queued: [...this.queue]
    };
  }
}

export const pushQueue = new PushQueue();

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      const msg = (error.message ?? '').toLowerCase();

      const isRateLimited =
        error.status === 429 ||
        msg.includes('429') ||
        msg.includes('rate limit') ||
        msg.includes('too many requests');

      const isGatewayError =
        error.status === 502 || error.status === 503 || error.status === 504 ||
        msg.includes('(502)') || msg.includes('(503)') || msg.includes('(504)');

      const isSnapshotIsolation =
        msg.includes('snapshot isolation') ||
        msg.includes('ddl statement');

      const isTransient = isRateLimited || isGatewayError || isSnapshotIsolation;

      if (!isTransient || attempt === maxRetries) {
        throw error;
      }

      const delay = (isGatewayError || isSnapshotIsolation ? 2000 : baseDelayMs) * Math.pow(2, attempt);
      const statusCode = error.status ?? (msg.match(/\((\d{3})\)/)?.[1] ?? null);
      const reason = isRateLimited
        ? 'Rate limited (429)'
        : isGatewayError
        ? `Gateway error (${statusCode ?? '5xx'})`
        : 'Snapshot isolation conflict';
      console.log(`[Retry] ${reason}. Attempt ${attempt + 1}/${maxRetries}. Waiting ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}
