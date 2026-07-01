import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LibrarySong } from '../types';
import { useLibrarySongWindowCache } from './useLibrarySongWindowCache';

const tauriInvokeMock = vi.fn();

vi.mock('../services/tauri/invoke', () => ({
  tauriInvoke: (...args: unknown[]) => tauriInvokeMock(...args),
}));

const makeSong = (path: string): LibrarySong => ({
  path,
  name: path.split('/').pop() ?? path,
  title: path,
  artist: 'Artist',
  artist_names: ['Artist'],
  effective_artist_names: ['Artist'],
  album: 'Album',
  album_artist: 'Artist',
  album_key: 'album::artist',
  is_various_artists_album: false,
  collapse_artist_credits: false,
  duration: 180,
  bitrate: 1411,
  sample_rate: 96000,
  bit_depth: 24,
  format: 'flac',
  source_type: 'local',
});

describe('useLibrarySongWindowCache', () => {
  beforeEach(() => {
    tauriInvokeMock.mockReset();
    tauriInvokeMock.mockImplementation(async (_command: string, payload: { paths: string[] }) =>
      payload.paths.map(makeSong));
  });

  it('loads visible and prefetched pages while preserving path order', async () => {
    const paths = Array.from({ length: 100 }, (_, index) => `/library/${index}.flac`);
    const cache = useLibrarySongWindowCache();

    await cache.ensureWindow({
      paths,
      start: 0,
      end: 10,
      viewportHeight: 720,
      rowHeight: 72,
    });

    expect(tauriInvokeMock).toHaveBeenCalledWith('get_library_songs_by_paths', {
      paths: paths.slice(0, 32),
    });
    expect(cache.getSongAt(0)?.path).toBe(paths[0]);
    expect(cache.getSongAt(31)?.path).toBe(paths[31]);
    expect(cache.getSongAt(32)?.path).toBe(paths[32]);
  });

  it('joins duplicate requests for the same visible window', async () => {
    const paths = Array.from({ length: 100 }, (_, index) => `/library/${index}.flac`);
    const cache = useLibrarySongWindowCache();

    await Promise.all([
      cache.ensureWindow({ paths, start: 0, end: 10, viewportHeight: 720, rowHeight: 72 }),
      cache.ensureWindow({ paths, start: 0, end: 10, viewportHeight: 720, rowHeight: 72 }),
    ]);

    expect(tauriInvokeMock).toHaveBeenCalledTimes(2);
  });

  it('evicts pages far away from the active window under a small memory budget', async () => {
    const paths = Array.from({ length: 1_000 }, (_, index) => `/library/${index}.flac`);
    const cache = useLibrarySongWindowCache();
    const options = {
      paths,
      viewportHeight: 720,
      rowHeight: 72,
      memoryBudgetBytes: 32 * 4 * 1024,
    };

    await cache.ensureWindow({ ...options, start: 0, end: 10 });
    await cache.ensureWindow({ ...options, start: 900, end: 910 });

    expect(cache.loadedPageCount.value).toBeLessThanOrEqual(3);
    expect(cache.cachedSongCount.value).toBeLessThanOrEqual(96);
    expect(cache.getSongAt(0)).toBeUndefined();
    expect(cache.getSongAt(900)?.path).toBe(paths[900]);
  });
});
