import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref, type EffectScope } from 'vue';

import { useSongArtistIndexKeys } from './useSongArtistIndexKeys';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../services/tauri/invoke', () => ({ tauriInvoke: invoke }));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

const flush = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

describe('song artist index keys', () => {
  const scopes: EffectScope[] = [];

  const mount = (initialPaths: string[], initiallyEnabled = true, withVersion = true) => {
    const paths = ref(initialPaths);
    const enabled = ref(initiallyEnabled);
    const version = ref(1);
    const scope = effectScope();
    scopes.push(scope);
    const result = scope.run(() => useSongArtistIndexKeys({
      paths,
      enabled,
      libraryDataVersion: withVersion ? version : undefined,
    }))!;
    return { paths, enabled, version, scope, ...result };
  };

  beforeEach(() => {
    invoke.mockReset().mockImplementation(async (_command, { paths }: { paths: string[] }) => paths.map(() => 'A'));
  });

  afterEach(() => scopes.splice(0).forEach(scope => scope.stop()));

  it('preserves input order and maps missing database paths to null', async () => {
    invoke.mockResolvedValue(['0', 'C', 'Z', '#', '']);
    const result = mount(['/number', '/chinese', '/last', '/symbol', '/missing']);
    expect(result.artistIndexKeys.value).toBeNull();
    await flush();

    expect(invoke).toHaveBeenCalledExactlyOnceWith('get_library_song_artist_index_keys', {
      paths: ['/number', '/chinese', '/last', '/symbol', '/missing'],
    });
    expect(result.artistIndexKeys.value).toEqual(['0', 'C', 'Z', '#', null]);
  });

  it('loads only when enabled with a nonempty path list', async () => {
    const result = mount([], false);
    await flush();
    result.paths.value = ['/song'];
    await flush();
    expect(invoke).not.toHaveBeenCalled();
    result.enabled.value = true;
    await flush();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.artistIndexKeys.value).toEqual(['A']);
  });

  it('does not query again for identical path contents, reads or unrelated state', async () => {
    const result = mount(['/song'], true, false);
    await flush();
    result.paths.value = ['/song'];
    result.enabled.value = true;
    const unrelatedViewport = ref(0);
    unrelatedViewport.value = 720;
    expect(result.artistIndexKeys.value).toEqual(['A']);
    await flush();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('clears old keys immediately and discards late results after fast path changes', async () => {
    const older = deferred<string[]>();
    const newer = deferred<string[]>();
    invoke.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const result = mount(['/old']);
    await flush();
    result.paths.value = ['/new'];
    expect(result.artistIndexKeys.value).toBeNull();
    await flush();
    newer.resolve(['N']);
    await flush();
    expect(result.artistIndexKeys.value).toEqual(['N']);
    older.resolve(['O']);
    await flush();
    expect(result.artistIndexKeys.value).toEqual(['N']);
  });

  it('reloads appended and reordered paths, including in-place edits', async () => {
    const result = mount(['/one']);
    await flush();
    result.paths.value.push('/two');
    expect(result.artistIndexKeys.value).toBeNull();
    await flush();
    expect(invoke).toHaveBeenLastCalledWith('get_library_song_artist_index_keys', { paths: ['/one', '/two'] });
    expect(result.artistIndexKeys.value).toEqual(['A', 'A']);

    result.paths.value.reverse();
    await flush();
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(invoke).toHaveBeenLastCalledWith('get_library_song_artist_index_keys', { paths: ['/two', '/one'] });
  });

  it('refreshes the same paths after metadata version changes and rejects the older version', async () => {
    const older = deferred<string[]>();
    invoke.mockReturnValueOnce(older.promise).mockResolvedValueOnce(['B']);
    const result = mount(['/song']);
    await flush();
    result.version.value += 1;
    await flush();
    expect(result.artistIndexKeys.value).toEqual(['B']);
    older.resolve(['A']);
    await flush();
    expect(result.artistIndexKeys.value).toEqual(['B']);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it.each(['disable', 'clear', 'dispose'] as const)('does not write a pending response after %s', async action => {
    const pending = deferred<string[]>();
    invoke.mockReturnValue(pending.promise);
    const result = mount(['/song']);
    await flush();
    if (action === 'disable') result.enabled.value = false;
    if (action === 'clear') result.paths.value.length = 0;
    if (action === 'dispose') result.scope.stop();
    expect(result.artistIndexKeys.value).toBeNull();
    pending.resolve(['A']);
    await flush();
    expect(result.artistIndexKeys.value).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('clears already loaded keys when disabled and loads again when enabled', async () => {
    const result = mount(['/song']);
    await flush();
    result.enabled.value = false;
    expect(result.artistIndexKeys.value).toBeNull();
    result.enabled.value = true;
    await flush();
    expect(result.artistIndexKeys.value).toEqual(['A']);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['incorrect length', ['A', 'B']],
    ['invalid key', ['AA']],
    ['lowercase key', ['a']],
    ['whitespace key', [' ']],
    ['non-string key', [null]],
    ['not an array', null],
  ])('rejects malformed responses: %s', async (_label, response) => {
    invoke.mockResolvedValue(response);
    const result = mount(['/song']);
    await flush();
    expect(result.artistIndexKeys.value).toBeNull();
  });

  it('quietly degrades after failure and retries on a later library version', async () => {
    invoke.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(['C']);
    const result = mount(['/song']);
    await flush();
    expect(result.artistIndexKeys.value).toBeNull();
    result.version.value += 1;
    await flush();
    expect(result.artistIndexKeys.value).toEqual(['C']);
  });

  it('skips an IPC that was invalidated before its queued start', async () => {
    const result = mount(['/song']);
    result.enabled.value = false;
    await flush();
    expect(invoke).not.toHaveBeenCalled();
    expect(result.artistIndexKeys.value).toBeNull();
  });
});
