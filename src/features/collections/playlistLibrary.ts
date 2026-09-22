import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';

import { localStore } from '../../services/storage/localStore';
import type { Playlist } from '../../types';
import { matchesPinyinSearch } from '../../utils/pinyinSearch';
import { useCollectionsStore } from './store';

export const PLAYLIST_SHORTCUT_LIMIT = 6;
const PLAYLIST_LIBRARY_STORAGE_KEY = 'player_playlist_library';

export type PlaylistLibraryFilter = 'all' | 'pinned' | 'empty';
export type PlaylistLibraryViewMode = 'grid' | 'list';
export type PlaylistLibrarySortMode = 'custom' | 'newest' | 'name' | 'count';

export interface PlaylistLibraryOptions {
  query: string;
  filter: PlaylistLibraryFilter;
  sortMode: PlaylistLibrarySortMode;
  pinnedIds: readonly string[];
}

interface PlaylistLibraryPreferences {
  viewMode: PlaylistLibraryViewMode;
  sortMode: PlaylistLibrarySortMode;
  pinnedIds: string[];
}

const normalizePreferences = (raw: unknown): PlaylistLibraryPreferences => {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
  const sortMode = source?.sortMode;

  return {
    viewMode: source?.viewMode === 'list' ? 'list' : 'grid',
    sortMode: sortMode === 'newest' || sortMode === 'name' || sortMode === 'count'
      ? sortMode
      : 'custom',
    pinnedIds: Array.isArray(source?.pinnedIds)
      ? [...new Set(source.pinnedIds.filter(
        (id): id is string => typeof id === 'string' && id.trim().length > 0,
      ))]
      : [],
  };
};

const readPreferences = (): PlaylistLibraryPreferences => {
  try {
    return normalizePreferences(localStore.getJson<unknown>(PLAYLIST_LIBRARY_STORAGE_KEY));
  } catch {
    // Storage may be unavailable; library browsing still works with session preferences.
    return normalizePreferences(null);
  }
};

const createdDay = (playlist: Playlist): number => {
  const timestamp = Date.parse(playlist.createdAt ?? '');
  return Number.isFinite(timestamp)
    ? Math.floor(timestamp / 86_400_000)
    : Number.NEGATIVE_INFINITY;
};

export const filterAndSortPlaylists = (
  playlists: readonly Playlist[],
  options: PlaylistLibraryOptions,
): Playlist[] => {
  const pinned = new Set(options.pinnedIds);
  const query = options.query.trim();

  return playlists
    .map((playlist, index) => ({ playlist, index }))
    .filter(({ playlist }) => {
      if (options.filter === 'pinned' && !pinned.has(playlist.id)) return false;
      if (options.filter === 'empty' && playlist.songPaths.length > 0) return false;
      return !query || matchesPinyinSearch([playlist.name], query);
    })
    .sort((left, right) => {
      const pinOrder = Number(pinned.has(right.playlist.id)) - Number(pinned.has(left.playlist.id));
      if (pinOrder) return pinOrder;

      switch (options.sortMode) {
        case 'newest': {
          const leftDay = createdDay(left.playlist);
          const rightDay = createdDay(right.playlist);
          if (leftDay !== rightDay) return rightDay > leftDay ? 1 : -1;
          return right.index - left.index;
        }
        case 'name':
          return left.playlist.name.localeCompare(right.playlist.name, 'zh-CN', {
            numeric: true,
            sensitivity: 'base',
          }) || left.index - right.index;
        case 'count':
          return right.playlist.songPaths.length - left.playlist.songPaths.length
            || left.index - right.index;
        default:
          return left.index - right.index;
      }
    })
    .map(({ playlist }) => playlist);
};

export const getShortcutPlaylists = (
  playlists: readonly Playlist[],
  pinnedIds: readonly string[],
  limit = PLAYLIST_SHORTCUT_LIMIT,
): Playlist[] => {
  const pinned = new Set(pinnedIds);
  const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : PLAYLIST_SHORTCUT_LIMIT;

  return [
    ...playlists.filter(playlist => pinned.has(playlist.id)),
    ...playlists.filter(playlist => !pinned.has(playlist.id)),
  ].slice(0, normalizedLimit);
};

export const usePlaylistLibraryStore = defineStore('playlistLibrary', () => {
  const collections = useCollectionsStore();
  const preferences = readPreferences();
  const searchQuery = ref('');
  const filter = ref<PlaylistLibraryFilter>('all');
  const viewMode = ref<PlaylistLibraryViewMode>(preferences.viewMode);
  const sortMode = ref<PlaylistLibrarySortMode>(preferences.sortMode);
  const pinnedIds = ref<string[]>(preferences.pinnedIds);

  const visiblePlaylists = computed(() => filterAndSortPlaylists(collections.playlists, {
    query: searchQuery.value,
    filter: filter.value,
    sortMode: sortMode.value,
    pinnedIds: pinnedIds.value,
  }));
  const shortcutPlaylists = computed(() => getShortcutPlaylists(collections.playlists, pinnedIds.value));
  const pinnedCount = computed(() => {
    const pinned = new Set(pinnedIds.value);
    return collections.playlists.filter(playlist => pinned.has(playlist.id)).length;
  });
  const emptyCount = computed(() => collections.playlists.filter(playlist => !playlist.songPaths.length).length);

  const isPinned = (id: string) => pinnedIds.value.includes(id);

  const removePinned = (ids: string[]) => {
    const removed = new Set(ids);
    const next = pinnedIds.value.filter(id => !removed.has(id));
    if (next.length !== pinnedIds.value.length) pinnedIds.value = next;
  };

  const setPinned = (ids: string[], pinned: boolean) => {
    if (!pinned) {
      removePinned(ids);
      return;
    }

    const existing = new Set(collections.playlists.map(playlist => playlist.id));
    const next = new Set(pinnedIds.value);
    ids.forEach(id => {
      if (existing.has(id)) next.add(id);
    });
    if (next.size !== pinnedIds.value.length) pinnedIds.value = [...next];
  };

  const togglePin = (id: string) => {
    const next = !isPinned(id);
    setPinned([id], next);
    return isPinned(id);
  };

  watch([viewMode, sortMode, pinnedIds], () => {
    try {
      localStore.setJson(PLAYLIST_LIBRARY_STORAGE_KEY, {
        viewMode: viewMode.value,
        sortMode: sortMode.value,
        pinnedIds: pinnedIds.value,
      });
    } catch {
      // Keep the current session usable even if storage is full or disabled.
    }
  }, { deep: true });

  watch(() => collections.playlists.map(playlist => playlist.id), (currentIds, previousIds) => {
    // Do not prune persisted pins before the collections store has finished restoring.
    // Only IDs that actually disappeared from a known collection are removed here.
    const current = new Set(currentIds);
    removePinned(previousIds.filter(id => !current.has(id)));
  });

  return {
    searchQuery,
    filter,
    viewMode,
    sortMode,
    pinnedIds,
    visiblePlaylists,
    shortcutPlaylists,
    pinnedCount,
    emptyCount,
    isPinned,
    togglePin,
    setPinned,
    removePinned,
  };
});
