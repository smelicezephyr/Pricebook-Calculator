import { EventEmitter } from 'events';

export const MAX_CONCURRENT_PUSHES = 3;

interface QueuedPush {
  tenantId: number;
  historyId: number;
}

class PushQueue extends EventEmitter {
  private activePushes: Map<number, number> = new Map(); // tenantId -> historyId

  // Per-tenant lane: holds pushes queued because that tenant already has an active push.
  // A tenant's next push starts automatically the moment the current one finishes.
  private tenantQueues: Map<number, QueuedPush[]> = new Map();

  // Global queue: holds pushes for tenants that have no active push but the
  // system-wide concurrent-tenant cap (MAX_CONCURRENT_PUSHES) is reached.
  private globalQueue: QueuedPush[] = [];

  getActiveCount(): number {
    return this.activePushes.size;
  }

  /** Total items waiting across all tenant lanes and the global queue. */
  getQueueLength(): number {
    let total = this.globalQueue.length;
    for (const lane of this.tenantQueues.values()) total += lane.length;
    return total;
  }

  /** Number of pushes queued in a specific tenant's lane (not counting the one running). */
  getTenantQueueLength(tenantId: number): number {
    return this.tenantQueues.get(tenantId)?.length ?? 0;
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
    this.processQueue(tenantId);
  }

  /**
   * Queue a push. Routes to the correct lane:
   * - If the tenant is already active → add to that tenant's per-tenant lane.
   * - If the global cap is reached but the tenant is free → add to the global queue.
   *
   * Returns the 1-based position within the chosen lane and which lane was used.
   */
  addToQueue(tenantId: number, historyId: number): { position: number; lane: 'tenant' | 'global' } {
    if (this.activePushes.has(tenantId)) {
      // Tenant is busy — queue in its own lane
      if (!this.tenantQueues.has(tenantId)) {
        this.tenantQueues.set(tenantId, []);
      }
      const lane = this.tenantQueues.get(tenantId)!;
      lane.push({ tenantId, historyId });
      const position = lane.length;
      console.log(`[PushQueue] Queued tenant ${tenantId} (history ${historyId}) in tenant lane at position ${position}`);
      return { position, lane: 'tenant' };
    } else {
      // Global cap reached — add to global queue
      this.globalQueue.push({ tenantId, historyId });
      const position = this.globalQueue.length;
      console.log(`[PushQueue] Queued tenant ${tenantId} (history ${historyId}) in global queue at position ${position}`);
      return { position, lane: 'global' };
    }
  }

  removeFromQueue(historyId: number): boolean {
    // Check global queue first
    const gi = this.globalQueue.findIndex(q => q.historyId === historyId);
    if (gi !== -1) {
      this.globalQueue.splice(gi, 1);
      console.log(`[PushQueue] Removed history ${historyId} from global queue`);
      return true;
    }
    // Check all per-tenant lanes
    for (const [tenantId, lane] of this.tenantQueues.entries()) {
      const ti = lane.findIndex(q => q.historyId === historyId);
      if (ti !== -1) {
        lane.splice(ti, 1);
        if (lane.length === 0) this.tenantQueues.delete(tenantId);
        console.log(`[PushQueue] Removed history ${historyId} from tenant ${tenantId} lane`);
        return true;
      }
    }
    return false;
  }

  /** Returns 1-based queue position (within the tenant's own lane, or within the global queue). */
  getQueuePosition(historyId: number): number {
    // Check per-tenant lanes first
    for (const lane of this.tenantQueues.values()) {
      const idx = lane.findIndex(q => q.historyId === historyId);
      if (idx !== -1) return idx + 1;
    }
    // Check global queue
    const gi = this.globalQueue.findIndex(q => q.historyId === historyId);
    return gi === -1 ? -1 : gi + 1;
  }

  /**
   * Returns position and the size of the lane this historyId belongs to.
   * laneLength is the tenant-lane length when in a tenant lane, or the global
   * queue length when in the global queue.  Both are -1 when not found.
   */
  getQueuePositionDetails(historyId: number): { position: number; laneLength: number } {
    for (const lane of this.tenantQueues.values()) {
      const idx = lane.findIndex(q => q.historyId === historyId);
      if (idx !== -1) return { position: idx + 1, laneLength: lane.length };
    }
    const gi = this.globalQueue.findIndex(q => q.historyId === historyId);
    if (gi !== -1) return { position: gi + 1, laneLength: this.globalQueue.length };
    return { position: -1, laneLength: -1 };
  }

  private processQueue(completedTenantId: number): void {
    // Priority 1: promote the next item from the tenant that just finished.
    // This keeps the tenant's own backlog moving without competing for the global cap.
    const tenantLane = this.tenantQueues.get(completedTenantId);
    if (tenantLane && tenantLane.length > 0 && this.activePushes.size < MAX_CONCURRENT_PUSHES) {
      const next = tenantLane.shift()!;
      if (tenantLane.length === 0) this.tenantQueues.delete(completedTenantId);
      console.log(`[PushQueue] Promoting tenant lane: history ${next.historyId} for tenant ${next.tenantId}`);
      this.emit('ready', next);
    }

    // Priority 2: promote waiting items from the global queue for different tenants.
    while (this.globalQueue.length > 0 && this.activePushes.size < MAX_CONCURRENT_PUSHES) {
      const next = this.globalQueue.shift()!;
      // Safety: if this tenant somehow became active in the meantime, re-route to its lane
      if (this.activePushes.has(next.tenantId)) {
        if (!this.tenantQueues.has(next.tenantId)) this.tenantQueues.set(next.tenantId, []);
        this.tenantQueues.get(next.tenantId)!.unshift(next);
        continue;
      }
      console.log(`[PushQueue] Promoting global queue: history ${next.historyId} for tenant ${next.tenantId}`);
      this.emit('ready', next);
    }
  }

  getStatus(): { active: Array<{tenantId: number; historyId: number}>; queued: QueuedPush[] } {
    const allQueued: QueuedPush[] = [...this.globalQueue];
    for (const lane of this.tenantQueues.values()) allQueued.push(...lane);
    return {
      active: Array.from(this.activePushes.entries()).map(([tenantId, historyId]) => ({ tenantId, historyId })),
      queued: allQueued,
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

      // 500 included: Cloudflare returns 500 for its own infra failures (not just app errors)
      const isGatewayError =
        error.status === 500 || error.status === 502 || error.status === 503 || error.status === 504 ||
        msg.includes('(500)') || msg.includes('(502)') || msg.includes('(503)') || msg.includes('(504)');

      const isSnapshotIsolation =
        msg.includes('snapshot isolation') ||
        msg.includes('ddl statement');

      // Timeouts: fetch aborted after 30s, connection reset, or ECONNRESET
      const isTimeout =
        msg.includes('timeout after 30s') ||
        msg.includes('network timeout') ||
        msg.includes('econnreset') ||
        error.name === 'AbortError';

      const isTransient = isRateLimited || isGatewayError || isSnapshotIsolation || isTimeout;

      if (!isTransient || attempt === maxRetries) {
        throw error;
      }

      const delayBase = isTimeout ? 5000 : isGatewayError || isSnapshotIsolation ? 2000 : baseDelayMs;
      const delay = delayBase * Math.pow(2, attempt);
      const statusCode = error.status ?? (msg.match(/\((\d{3})\)/)?.[1] ?? null);
      const reason = isRateLimited
        ? 'Rate limited (429)'
        : isGatewayError
        ? `Gateway error (${statusCode ?? '5xx'})`
        : isTimeout
        ? 'Request timeout'
        : 'Snapshot isolation conflict';
      console.log(`[Retry] ${reason}. Attempt ${attempt + 1}/${maxRetries}. Waiting ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}
