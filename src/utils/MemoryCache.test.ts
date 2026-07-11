import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemoryCache, type MemoryCacheEvictionReason } from './MemoryCache';

describe('MemoryCache', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('evicts the least recently used entry when the weight budget is exceeded', () => {
    const cache = new MemoryCache<string, number>({
      maxEntries: 10,
      maxWeight: 6,
      ttlMs: 60_000,
      weightOf: (_key, value) => value,
    });

    cache.set('a', 3);
    cache.set('b', 3);
    expect(cache.get('a')).toBe(3);
    cache.set('c', 3);

    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(3);
    expect(cache.get('c')).toBe(3);
    expect(cache.stats()).toMatchObject({
      size: 2,
      weight: 6,
      evictions: 1,
      weightEvictions: 1,
    });
  });

  it('keeps a protected current entry while evicting older eligible data', () => {
    let protectedKey = 'current';
    const cache = new MemoryCache<string, number>({
      maxEntries: 10,
      maxWeight: 4,
      ttlMs: 60_000,
      weightOf: (_key, value) => value,
      isProtected: key => key === protectedKey,
    });

    cache.set('current', 5);
    cache.set('older', 2);

    expect(cache.get('current')).toBe(5);
    expect(cache.get('older')).toBeUndefined();
    expect(cache.stats().weight).toBe(5);

    protectedKey = 'next';
    cache.prune();
    expect(cache.has('current')).toBe(false);
  });

  it('supports per-entry TTL and reports eviction callbacks', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T00:00:00Z'));
    const reasons: MemoryCacheEvictionReason[] = [];
    const cache = new MemoryCache<string, string>({
      maxEntries: 2,
      ttlMs: 1_000,
      onEvict: (_key, _value, reason) => reasons.push(reason),
    });

    cache.set('short', 'value', { ttlMs: 10 });
    vi.advanceTimersByTime(11);

    expect(cache.get('short')).toBeUndefined();
    expect(cache.stats().expired).toBe(1);
    expect(reasons).toEqual(['expired']);
  });

  it('re-prunes when the weight budget is reduced', () => {
    const cache = new MemoryCache<string, number>({
      maxEntries: 10,
      maxWeight: 10,
      ttlMs: 60_000,
      weightOf: (_key, value) => value,
    });

    cache.set('older', 4);
    cache.set('newer', 4);
    cache.setMaxWeight(4);

    expect(cache.get('older')).toBeUndefined();
    expect(cache.get('newer')).toBe(4);
    expect(cache.stats().maxWeight).toBe(4);
  });
});
