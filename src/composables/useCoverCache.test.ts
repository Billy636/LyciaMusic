import { beforeEach, describe, expect, it, vi } from 'vitest';

const coreMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

vi.mock('@tauri-apps/api/core', () => coreMocks);

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
};

describe('cover cache', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    coreMocks.convertFileSrc.mockImplementation((path: string) => `asset://${path}`);
  });

  it('keeps retained in-flight full cover requests valid', async () => {
    const path = '/music/current.flac';
    const coverPath = 'C:\\covers\\current.png';
    const pendingCover = createDeferred<string>();
    coreMocks.invoke.mockReturnValueOnce(pendingCover.promise);

    const { useCoverCache } = await import('./useCoverCache');
    const coverCache = useCoverCache();
    const request = coverCache.loadFullCover(path);

    coverCache.retainFullCoverPaths([path]);
    pendingCover.resolve(coverPath);

    await expect(request).resolves.toBe(`asset://${coverPath}`);
    expect(coverCache.getFullCoverUrl(path)).toBe(`asset://${coverPath}`);
  });

  it('invalidates in-flight full cover requests outside the retained paths', async () => {
    const oldPath = '/music/old.flac';
    const currentPath = '/music/current.flac';
    const pendingCover = createDeferred<string>();
    coreMocks.invoke.mockReturnValueOnce(pendingCover.promise);

    const { useCoverCache } = await import('./useCoverCache');
    const coverCache = useCoverCache();
    const request = coverCache.loadFullCover(oldPath);

    coverCache.retainFullCoverPaths([currentPath]);
    pendingCover.resolve('C:\\covers\\old.png');

    await expect(request).resolves.toBe('');
    expect(coverCache.getFullCoverUrl(oldPath)).toBe('');
  });

  it('runs background full cover preloads one at a time', async () => {
    const firstCover = createDeferred<string>();
    const secondCover = createDeferred<string>();
    coreMocks.invoke
      .mockReturnValueOnce(firstCover.promise)
      .mockReturnValueOnce(secondCover.promise);

    const { useCoverCache } = await import('./useCoverCache');
    const coverCache = useCoverCache();

    coverCache.preloadFullCovers([
      '/music/first.flac',
      '/music/second.flac',
    ]);

    expect(coreMocks.invoke).toHaveBeenCalledTimes(1);
    expect(coreMocks.invoke).toHaveBeenLastCalledWith('get_song_cover', {
      path: '/music/first.flac',
    });

    firstCover.resolve('C:\\covers\\first.png');
    await firstCover.promise;
    await Promise.resolve();

    expect(coreMocks.invoke).toHaveBeenCalledTimes(2);
    expect(coreMocks.invoke).toHaveBeenLastCalledWith('get_song_cover', {
      path: '/music/second.flac',
    });

    secondCover.resolve('C:\\covers\\second.png');
    await secondCover.promise;
  });

  it('uses a primed thumbnail path without invoking the backend', async () => {
    const path = '/music/current.flac';
    const coverPath = 'C:\\covers\\current-thumb.jpg';

    const { useCoverCache } = await import('./useCoverCache');
    const coverCache = useCoverCache();

    expect(coverCache.primeCoverPath(path, coverPath)).toBe(`asset://${coverPath}`);
    await expect(coverCache.loadCover(path)).resolves.toBe(`asset://${coverPath}`);
    expect(coreMocks.invoke).not.toHaveBeenCalled();
  });

  it('loads full cover path from backend and caches it', async () => {
    const path = '/music/current.flac';
    const coverPath = 'C:\\covers\\current-full.png';
    coreMocks.invoke.mockResolvedValueOnce(coverPath);

    const { useCoverCache } = await import('./useCoverCache');
    const coverCache = useCoverCache();

    await expect(coverCache.loadFullCoverPath(path)).resolves.toBe(coverPath);
    expect(coreMocks.invoke).toHaveBeenCalledWith('get_song_cover', { path });

    // Subsequent call should use cached value and not invoke backend
    coreMocks.invoke.mockClear();
    await expect(coverCache.loadFullCoverPath(path)).resolves.toBe(coverPath);
    expect(coreMocks.invoke).not.toHaveBeenCalled();
  });
});
