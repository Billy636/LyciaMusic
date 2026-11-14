import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref, type EffectScope } from 'vue';

const coreMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));
vi.mock('@tauri-apps/api/core', () => coreMocks);

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

const flushLoads = async () => {
  for (let index = 0; index < 150; index += 1) {
    await Promise.resolve();
  }
};

describe('visible cover URLs', () => {
  const scopes: EffectScope[] = [];
  let visibility: DocumentVisibilityState;
  let documentStub: EventTarget;
  let cache: ReturnType<typeof import('./useCoverCache').useCoverCache>;
  let useVisibleCoverUrls: typeof import('./useVisibleCoverUrls').useVisibleCoverUrls;

  const mount = (initialPaths: string[]) => {
    const paths = ref(initialPaths);
    const scope = effectScope();
    scopes.push(scope);
    const covers = scope.run(() => useVisibleCoverUrls(paths))!;
    return { paths, scope, ...covers };
  };

  const setVisibility = (value: DocumentVisibilityState) => {
    visibility = value;
    documentStub.dispatchEvent(new Event('visibilitychange'));
  };

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    visibility = 'visible';
    documentStub = new EventTarget();
    Object.defineProperty(documentStub, 'visibilityState', { get: () => visibility });
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    coreMocks.invoke.mockImplementation(async (_command: string, { path }: { path: string }) => `/covers${path}.jpg`);
    const module = await import('./useCoverCache');
    cache = module.useCoverCache();
    ({ useVisibleCoverUrls } = await import('./useVisibleCoverUrls'));
  });

  afterEach(() => {
    scopes.splice(0).forEach(scope => scope.stop());
    cache?.clearCoverCaches();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps rendered images when the five-minute shared cache expires', async () => {
    const covers = mount(['/album.flac']);
    await flushLoads();
    const url = covers.getDisplayedCoverUrl('/album.flac');
    expect(url).toBe('asset:///covers/album.flac.jpg');

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);

    expect(cache.coverCache.size).toBe(0);
    expect(covers.getDisplayedCoverUrl('/album.flac')).toBe(url);
    expect(coreMocks.invoke).toHaveBeenCalledTimes(1);
  });

  it('keeps every rendered cover even when there are more than 64 albums', async () => {
    const paths = Array.from({ length: 80 }, (_, index) => `/album-${index}.flac`);
    const covers = mount(paths);
    await flushLoads();

    expect(coreMocks.invoke).toHaveBeenCalledTimes(80);
    expect(cache.coverCache.size).toBe(64);
    expect(covers.displayedCoverUrls.size).toBe(80);
    for (const path of paths) {
      expect(covers.getDisplayedCoverUrl(path)).toBe(`asset:///covers${path}.jpg`);
    }
  });

  it('captures later preloads after an initial empty result instead of depending on a cache fallback', async () => {
    coreMocks.invoke.mockResolvedValueOnce('');
    const covers = mount(['/album.flac']);
    await flushLoads();
    expect(covers.getDisplayedCoverUrl('/album.flac')).toBe('');

    cache.primeCoverPath('/album.flac', '/covers/recovered.jpg');
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);

    expect(covers.getDisplayedCoverUrl('/album.flac')).toBe('asset:///covers/recovered.jpg');
  });

  it('bounds visible loads and abandons queued off-screen paths after scrolling', async () => {
    const pending = deferred<string>();
    coreMocks.invoke.mockReturnValue(pending.promise);
    const covers = mount(Array.from({ length: 10 }, (_, index) => `/old-${index}.flac`));
    expect(coreMocks.invoke).toHaveBeenCalledTimes(4);

    covers.paths.value = ['/new.flac'];
    coreMocks.invoke.mockResolvedValue('/covers/new.jpg');
    pending.resolve('/covers/old.jpg');
    await flushLoads();

    expect(coreMocks.invoke).toHaveBeenCalledTimes(5);
    expect([...covers.displayedCoverUrls.keys()]).toEqual(['/new.flac']);
    expect(covers.getDisplayedCoverUrl('/new.flac')).toBe('asset:///covers/new.jpg');
  });

  it('releases off-screen URLs and reloads them when returning after eviction', async () => {
    const covers = mount(['/first.flac']);
    await flushLoads();
    covers.paths.value = ['/second.flac'];
    await flushLoads();
    expect(covers.getDisplayedCoverUrl('/first.flac')).toBe('');

    cache.clearCoverCaches();
    covers.paths.value = ['/first.flac'];
    await flushLoads();
    expect([...covers.displayedCoverUrls.keys()]).toEqual(['/first.flac']);
    expect(covers.getDisplayedCoverUrl('/first.flac')).toBe('asset:///covers/first.flac.jpg');
  });

  it('tracks in-place changes to the visible path array and deduplicates paths', async () => {
    const covers = mount(['/first.flac', '/first.flac', '']);
    await flushLoads();
    covers.paths.value.splice(0, covers.paths.value.length, '/second.flac');
    await flushLoads();

    expect(coreMocks.invoke).toHaveBeenCalledTimes(2);
    expect([...covers.displayedCoverUrls.keys()]).toEqual(['/second.flac']);
  });

  it('retries an in-flight cover invalidated by an explicit cache reset without leaving the page', async () => {
    const pending = deferred<string>();
    coreMocks.invoke.mockReturnValueOnce(pending.promise);
    const covers = mount(['/album.flac']);

    cache.clearCoverCaches();
    pending.resolve('/covers/outdated.jpg');
    await flushLoads();

    expect(coreMocks.invoke).toHaveBeenCalledTimes(2);
    expect(covers.getDisplayedCoverUrl('/album.flac')).toBe('asset:///covers/album.flac.jpg');
  });

  it('reloads displayed artwork after explicit invalidation instead of retaining a stale URL', async () => {
    const covers = mount(['/album.flac']);
    await flushLoads();
    coreMocks.invoke.mockResolvedValue('/covers/replaced.jpg');

    cache.clearCoverCaches();
    await flushLoads();

    expect(coreMocks.invoke).toHaveBeenCalledTimes(2);
    expect(covers.getDisplayedCoverUrl('/album.flac')).toBe('asset:///covers/replaced.jpg');
  });

  it('does not restore a settled stale URL when the cache is reset before its view callback runs', async () => {
    const pending = deferred<string>();
    coreMocks.invoke.mockReturnValueOnce(pending.promise);
    const covers = mount(['/album.flac']);

    pending.resolve('/covers/outdated.jpg');
    await pending.promise;
    cache.clearCoverCaches();
    await flushLoads();

    expect(coreMocks.invoke).toHaveBeenCalledTimes(2);
    expect(covers.getDisplayedCoverUrl('/album.flac')).toBe('asset:///covers/album.flac.jpg');
  });

  it('preserves covers through hiding and restores missing covers without scrolling', async () => {
    const covers = mount(['/album.flac']);
    await flushLoads();
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
    covers.paths.value = ['/album.flac', '/missing.flac'];
    expect(coreMocks.invoke).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    await flushLoads();
    expect(covers.getDisplayedCoverUrl('/album.flac')).toBe('asset:///covers/album.flac.jpg');
    expect(covers.getDisplayedCoverUrl('/missing.flac')).toBe('asset:///covers/missing.flac.jpg');
    expect(coreMocks.invoke).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])('retries a hidden-window cancelled request (settles before restore: %s)', async settlesBeforeRestore => {
    const pending = deferred<string>();
    coreMocks.invoke.mockReturnValueOnce(pending.promise);
    const covers = mount(['/album.flac']);
    setVisibility('hidden');

    if (settlesBeforeRestore) {
      pending.resolve('/covers/cancelled.jpg');
      await flushLoads();
    }
    setVisibility('visible');
    if (!settlesBeforeRestore) {
      pending.resolve('/covers/cancelled.jpg');
    }
    await flushLoads();

    expect(coreMocks.invoke).toHaveBeenCalledTimes(2);
    expect(covers.getDisplayedCoverUrl('/album.flac')).toBe('asset:///covers/album.flac.jpg');
  });

  it('does not repeatedly retry missing artwork on unrelated cache changes or timers', async () => {
    coreMocks.invoke.mockResolvedValue('');
    const covers = mount(['/missing.flac']);
    await flushLoads();
    cache.primeCoverPath('/unrelated.flac', '/covers/unrelated.jpg');
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    expect(coreMocks.invoke).toHaveBeenCalledTimes(1);
    expect(covers.getDisplayedCoverUrl('/missing.flac')).toBe('');
  });

  it('ignores late responses and removes visibility listeners when disposed', async () => {
    const pending = deferred<string>();
    coreMocks.invoke.mockReturnValueOnce(pending.promise);
    const covers = mount(['/album.flac', '/next.flac']);
    covers.scope.stop();
    pending.resolve('/covers/late.jpg');
    await flushLoads();
    setVisibility('hidden');
    setVisibility('visible');

    expect(covers.displayedCoverUrls.size).toBe(0);
    expect(coreMocks.invoke).toHaveBeenCalledTimes(2);
  });
});
