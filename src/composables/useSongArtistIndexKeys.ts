import { onScopeDispose, shallowRef, watch, type Ref } from 'vue';

import { tauriInvoke } from '../services/tauri/invoke';
import { INDEX_KEYS, type AlphabetIndexKey } from '../utils/alphabetIndex';

interface SongArtistIndexOptions {
  paths: Ref<readonly string[]>;
  enabled: Ref<boolean>;
  libraryDataVersion?: Ref<number>;
}

interface ArtistIndexSnapshot {
  paths: string[];
  enabled: boolean;
  version: number | undefined;
}

const validIndexKeys = new Set<string>(INDEX_KEYS);
const samePaths = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((path, index) => path === right[index]);

/** Fetch compact artist keys for the exact path order, independent of paged metadata. */
export function useSongArtistIndexKeys({ paths, enabled, libraryDataVersion }: SongArtistIndexOptions) {
  const artistIndexKeys = shallowRef<Array<AlphabetIndexKey | null> | null>(null);
  let requestId = 0;
  let disposed = false;
  let lastSnapshot: ArtistIndexSnapshot | null = null;

  const isCurrentRequest = (id: number, snapshot: ArtistIndexSnapshot) =>
    !disposed
    && id === requestId
    && enabled.value
    && Object.is(libraryDataVersion?.value, snapshot.version)
    && samePaths(paths.value, snapshot.paths);

  const loadKeys = async (id: number, snapshot: ArtistIndexSnapshot) => {
    // Coalesce synchronous in-place array edits before sending their final order.
    await Promise.resolve();
    if (!isCurrentRequest(id, snapshot)) return;

    try {
      const response: unknown = await tauriInvoke('get_library_song_artist_index_keys', { paths: snapshot.paths });
      if (!isCurrentRequest(id, snapshot)) return;
      if (
        !Array.isArray(response)
        || response.length !== snapshot.paths.length
        || !response.every(key => typeof key === 'string' && (key === '' || validIndexKeys.has(key)))
      ) {
        return;
      }

      artistIndexKeys.value = response.map(key => key === '' ? null : key as AlphabetIndexKey);
    } catch {
      // Missing/unavailable index data must not be guessed from song filenames.
      // A later path, enablement or library-version change can retry the request.
    }
  };

  watch(
    () => ({
      paths: [...paths.value],
      enabled: enabled.value,
      version: libraryDataVersion?.value,
    }),
    snapshot => {
      if (
        lastSnapshot
        && snapshot.enabled === lastSnapshot.enabled
        && Object.is(snapshot.version, lastSnapshot.version)
        && samePaths(snapshot.paths, lastSnapshot.paths)
      ) {
        return;
      }

      lastSnapshot = snapshot;
      const id = ++requestId;
      artistIndexKeys.value = null;
      if (disposed || !snapshot.enabled || snapshot.paths.length === 0) return;
      void loadKeys(id, snapshot);
    },
    { immediate: true, flush: 'sync' },
  );

  onScopeDispose(() => {
    disposed = true;
    requestId += 1;
    artistIndexKeys.value = null;
  });

  return { artistIndexKeys };
}
