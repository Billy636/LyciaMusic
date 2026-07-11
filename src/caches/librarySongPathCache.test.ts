import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  estimateLibrarySongPathCacheWeight,
  LibrarySongPathCache,
  type LibrarySongPathCacheEntry,
} from './librarySongPathCache';

const entry = (path: string): LibrarySongPathCacheEntry => ({ paths: [path] });
const namespacedWeight = (namespace: string, key: string, value: LibrarySongPathCacheEntry) =>
  estimateLibrarySongPathCacheWeight(`${namespace}\u0000${key}`, value);

describe('LibrarySongPathCache', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('estimates larger path and title-label results with a larger weight', () => {
    const small = estimateLibrarySongPathCacheWeight('all\u0000small', entry('C:/a.mp3'));
    const large = estimateLibrarySongPathCacheWeight('all\u0000large', {
      paths: ['C:/music/a-very-long-song-path.mp3', 'C:/music/another-song.mp3'],
      titleLabels: new Map([
        ['C:/music/a-very-long-song-path.mp3', 'A very long title'],
        ['C:/music/another-song.mp3', 'Another title'],
      ]),
    });

    expect(large).toBeGreaterThan(small);
  });

  it('shares one weighted LRU budget across path-cache namespaces', () => {
    const folderEntry = entry('C:/music/folder-song.mp3');
    const detailEntry = entry('C:/music/detail-song.mp3');
    const collectionEntry = entry('C:/music/collection-song.mp3');
    const folderWeight = namespacedWeight('folder', 'older', folderEntry);
    const detailWeight = namespacedWeight('detail', 'current', detailEntry);
    const collectionWeight = namespacedWeight('collection', 'newer', collectionEntry);
    const maxWeight = detailWeight
      + Math.max(folderWeight, collectionWeight)
      + 10;
    const cache = new LibrarySongPathCache({
      maxEntries: 10,
      maxWeight,
      lowPowerMaxWeight: maxWeight,
    });

    cache.set('folder', 'older', folderEntry, 60_000);
    cache.activate('detail', 'current');
    cache.set('detail', 'current', detailEntry, 60_000);
    cache.set('collection', 'newer', collectionEntry, 60_000);

    expect(cache.get('folder', 'older')).toBeUndefined();
    expect(cache.get('detail', 'current')).toEqual(detailEntry);
    expect(cache.get('collection', 'newer')).toEqual(collectionEntry);
    expect(cache.stats().weightEvictions).toBe(1);
  });

  it('protects the active query while shrinking the background budget', () => {
    const olderEntry = entry('C:/music/older-song.mp3');
    const currentEntry = entry('C:/music/current-song.mp3');
    const olderWeight = namespacedWeight('folder', 'older', olderEntry);
    const currentWeight = namespacedWeight('all', 'current', currentEntry);
    const cache = new LibrarySongPathCache({
      maxEntries: 10,
      maxWeight: olderWeight + currentWeight,
      lowPowerMaxWeight: currentWeight,
    });

    cache.set('folder', 'older', olderEntry, 60_000);
    cache.activate('all', 'current');
    cache.set('all', 'current', currentEntry, 60_000);
    cache.setLowPower(true);

    expect(cache.get('folder', 'older')).toBeUndefined();
    expect(cache.get('all', 'current')).toEqual(currentEntry);
    expect(cache.stats()).toMatchObject({
      maxWeight: currentWeight,
      weight: currentWeight,
    });
  });

  it('clears one namespace without invalidating the current result in another', () => {
    const cache = new LibrarySongPathCache({ maxWeight: 10_000, lowPowerMaxWeight: 5_000 });
    cache.set('folder', 'folder', entry('C:/folder.mp3'), 60_000);
    cache.activate('detail', 'detail');
    cache.set('detail', 'detail', entry('C:/detail.mp3'), 60_000);

    cache.clearNamespace('folder');

    expect(cache.get('folder', 'folder')).toBeUndefined();
    expect(cache.get('detail', 'detail')?.paths).toEqual(['C:/detail.mp3']);
  });

  it('releases active title labels when their cache entry expires', () => {
    vi.useFakeTimers();
    const cache = new LibrarySongPathCache({ maxWeight: 10_000, lowPowerMaxWeight: 5_000 });
    const currentEntry: LibrarySongPathCacheEntry = {
      paths: ['C:/song.mp3'],
      titleLabels: new Map([['C:/song.mp3', 'Song']]),
    };
    cache.activate('all', 'current');
    cache.set('all', 'current', currentEntry, 10);
    expect(cache.getActive('all')).toBe(currentEntry);

    vi.advanceTimersByTime(11);
    cache.stats();

    expect(cache.getActive('all')).toBeUndefined();
  });
});
