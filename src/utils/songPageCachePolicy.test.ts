import { describe, expect, it } from 'vitest';

import { resolveSongPageCachePolicy } from './songPageCachePolicy';

describe('resolveSongPageCachePolicy', () => {
  it('caches a small library completely when it fits the memory budget', () => {
    const policy = resolveSongPageCachePolicy({
      librarySize: 20,
      viewportHeight: 720,
      rowHeight: 72,
    });

    expect(policy.visibleRows).toBe(10);
    expect(policy.cacheWholeLibrary).toBe(true);
    expect(policy.maxCachedRows).toBe(20);
  });

  it('keeps only a bounded window for a large library', () => {
    const policy = resolveSongPageCachePolicy({
      librarySize: 50_000,
      viewportHeight: 720,
      rowHeight: 72,
      memoryBudgetBytes: 8 * 1024 * 1024,
      estimatedRowBytes: 4 * 1024,
    });

    expect(policy.cacheWholeLibrary).toBe(false);
    expect(policy.maxCachedRows).toBeLessThan(50_000);
    expect(policy.maxCachedRows).toBeLessThanOrEqual(2048);
  });

  it('prefetches farther while scrolling quickly', () => {
    const idle = resolveSongPageCachePolicy({
      librarySize: 50_000,
      viewportHeight: 720,
      rowHeight: 72,
      scrollVelocityPxPerSecond: 0,
    });
    const fast = resolveSongPageCachePolicy({
      librarySize: 50_000,
      viewportHeight: 720,
      rowHeight: 72,
      scrollVelocityPxPerSecond: 2_880,
    });

    expect(fast.prefetchPages).toBeGreaterThan(idle.prefetchPages);
  });

  it('adapts the cache ceiling to the supplied memory budget', () => {
    const lowMemory = resolveSongPageCachePolicy({
      librarySize: 50_000,
      viewportHeight: 900,
      rowHeight: 72,
      memoryBudgetBytes: 8 * 1024 * 1024,
    });
    const highMemory = resolveSongPageCachePolicy({
      librarySize: 50_000,
      viewportHeight: 900,
      rowHeight: 72,
      memoryBudgetBytes: 32 * 1024 * 1024,
    });

    expect(highMemory.maxCachedRows).toBeGreaterThan(lowMemory.maxCachedRows);
  });
});
