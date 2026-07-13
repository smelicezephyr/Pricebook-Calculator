interface RateEntry {
  rate: number;
  technicianName: string;
  technicianCount: number;
  cachedAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const _cache = new Map<number, RateEntry>();

export function getCachedTechRate(tenantDbId: number): RateEntry | null {
  const entry = _cache.get(tenantDbId);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    _cache.delete(tenantDbId);
    return null;
  }
  return entry;
}

export function setCachedTechRate(
  tenantDbId: number,
  rate: number,
  technicianName: string,
  technicianCount: number,
): void {
  _cache.set(tenantDbId, { rate, technicianName, technicianCount, cachedAt: Date.now() });
}
