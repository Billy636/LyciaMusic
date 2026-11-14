import { MemoryCache } from '../utils/MemoryCache';

export type ViewportCoverSnapshot = string[];
export type ViewportCoverUrlSnapshotEntry = {
  path: string;
  url: string;
};

export type ViewportCoverUrlSnapshot = ViewportCoverUrlSnapshotEntry[];

export const artistHeaderCache = new MemoryCache<string, string>({
  maxEntries: 32,
  ttlMs: 10 * 60 * 1000,
});

export const albumHeaderCache = new MemoryCache<string, string>({
  maxEntries: 32,
  ttlMs: 10 * 60 * 1000,
});

export const sidebarPlaylistCoverCache = new MemoryCache<string, string>({
  maxEntries: 80,
  // Sidebar playlist covers are few and stable; keep them longer to avoid
  // disappearing thumbnails on unrelated rerenders after short TTL expiry.
  ttlMs: 24 * 60 * 60 * 1000,
});

export const listScrollCache = new MemoryCache<string, number>({
  maxEntries: 30,
  ttlMs: 30 * 60 * 1000,
});

export const artistViewportCoverSnapshotCache = new MemoryCache<string, ViewportCoverUrlSnapshot>({
  maxEntries: 2,
  ttlMs: 10 * 60 * 1000,
});

export const albumViewportCoverSnapshotCache = new MemoryCache<string, ViewportCoverSnapshot>({
  maxEntries: 1,
  ttlMs: 10 * 60 * 1000,
});

export const songTableViewportCoverSnapshotCache = new MemoryCache<string, ViewportCoverSnapshot>({
  maxEntries: 12,
  ttlMs: 10 * 60 * 1000,
});

export function pruneImageCaches() {
  artistHeaderCache.prune();
  albumHeaderCache.prune();
  sidebarPlaylistCoverCache.prune();
  listScrollCache.prune();
  artistViewportCoverSnapshotCache.prune();
  albumViewportCoverSnapshotCache.prune();
  songTableViewportCoverSnapshotCache.prune();
}

export function clearImageCaches() {
  artistHeaderCache.clear();
  albumHeaderCache.clear();
  sidebarPlaylistCoverCache.clear();
  listScrollCache.clear();
  artistViewportCoverSnapshotCache.clear();
  albumViewportCoverSnapshotCache.clear();
  songTableViewportCoverSnapshotCache.clear();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      pruneImageCaches();
    }
  });
}
