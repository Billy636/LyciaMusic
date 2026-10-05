import { onScopeDispose, reactive, shallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue';
import { useCoverCache, type CoverKind } from './useCoverCache';

const VISIBLE_COVER_CONCURRENCY = 4;

/** Keep rendered covers alive independently of the shared URL cache's LRU/TTL. */
export function useVisibleCoverUrls(paths: MaybeRefOrGetter<readonly string[]>, kind: CoverKind = 'thumbnail') {
  const { coverCache, cardCoverCache, fullCoverCache, loadCover, isCoverLoading, coverCacheResetVersion } = useCoverCache();
  const selectedCache = kind === 'card' ? cardCoverCache : kind === 'full' ? fullCoverCache : coverCache;
  const displayedCoverUrls = reactive(new Map<string, string>());
  const visiblePaths = shallowRef<string[]>([]);
  const pendingPaths = new Set<string>();
  const attemptedPaths = new Set<string>();
  let visiblePathSet = new Set<string>();
  let disposed = false;
  let resetVersion = 0;

  const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

  const loadMissingCovers = () => {
    if (disposed || isHidden()) {
      return;
    }

    for (const path of visiblePaths.value) {
      if (pendingPaths.size >= VISIBLE_COVER_CONCURRENCY) {
        break;
      }
      if (displayedCoverUrls.has(path) || pendingPaths.has(path) || attemptedPaths.has(path)) {
        continue;
      }

      attemptedPaths.add(path);
      pendingPaths.add(path);
      const requestResetVersion = resetVersion;
      void loadCover(path, kind).then(url => {
        if (!disposed && requestResetVersion === resetVersion && visiblePathSet.has(path) && url) {
          displayedCoverUrls.set(path, url);
        }
      }).catch(() => {
        // Missing artwork is a valid result; retry on re-entry or window restore,
        // not on every render/cache eviction.
      }).finally(() => {
        pendingPaths.delete(path);
        loadMissingCovers();
      });
    }
  };

  watch(
    () => visiblePaths.value.map(path => [path, selectedCache.get(path)] as const),
    entries => {
      for (const [path, url] of entries) {
        if (url) {
          displayedCoverUrls.set(path, url);
        }
      }
    },
    // Capture preloads immediately, even when a batch exceeds the shared LRU.
    // An eviction must never erase an image still owned by this view.
    { flush: 'sync' },
  );

  watch(
    () => [...toValue(paths)],
    nextPaths => {
      visiblePathSet = new Set(nextPaths.filter(Boolean));
      for (const path of displayedCoverUrls.keys()) {
        if (!visiblePathSet.has(path)) {
          displayedCoverUrls.delete(path);
        }
      }
      for (const path of attemptedPaths) {
        if (!visiblePathSet.has(path)) {
          attemptedPaths.delete(path);
        }
      }
      visiblePaths.value = [...visiblePathSet];
      loadMissingCovers();
    },
    { immediate: true, flush: 'sync' },
  );

  watch(coverCacheResetVersion, () => {
    // An explicit reset (for example, replacing embedded artwork) is different
    // from LRU/TTL eviction: discard stale URLs and retry invalidated requests.
    resetVersion += 1;
    displayedCoverUrls.clear();
    attemptedPaths.clear();
    loadMissingCovers();
  }, { flush: 'sync' });

  const handleVisibilityChange = () => {
    if (!isHidden()) {
      // Hiding the window invalidates in-flight shared-cache requests. Clearing
      // attempts also lets a still-pending cancelled request retry on settlement.
      attemptedPaths.clear();
      loadMissingCovers();
    }
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  onScopeDispose(() => {
    disposed = true;
    visiblePathSet.clear();
    displayedCoverUrls.clear();
    attemptedPaths.clear();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  });

  return {
    displayedCoverUrls,
    getDisplayedCoverUrl: (path: string | undefined) => path ? displayedCoverUrls.get(path) ?? '' : '',
    isCoverLoading: (path: string | undefined) => isCoverLoading(path, kind),
  };
}
