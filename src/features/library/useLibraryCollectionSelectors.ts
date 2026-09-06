import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';

import { tauriInvoke } from '../../services/tauri/invoke';
import type {
  HistoryItem,
  Playlist,
  RecentAlbumCatalogItem,
  RecentPlaylistCatalogItem,
  Song,
} from '../../types';
import {
  type AlbumListItem,
  type ArtistListItem,
} from './playerLibraryViewShared';

interface UseLibraryCollectionSelectorsOptions {
  canonicalSongPaths: Ref<string[]>;
  favoritePaths: Ref<string[]>;
  playlists: Ref<Playlist[]>;
  recentSongs: Ref<HistoryItem[]>;
  songLookup: ComputedRef<Map<string, Song>>;
}

export function useLibraryCollectionSelectors({
  canonicalSongPaths,
  favoritePaths,
  playlists,
  recentSongs,
  songLookup,
}: UseLibraryCollectionSelectorsOptions) {
  const favArtistList = ref<ArtistListItem[]>([]);
  const favAlbumList = ref<AlbumListItem[]>([]);
  const recentAlbumList = ref<RecentAlbumCatalogItem[]>([]);
  const recentPlaylistList = ref<RecentPlaylistCatalogItem[]>([]);
  let favoriteArtistRequestId = 0;
  let favoriteAlbumRequestId = 0;
  let recentAlbumRequestId = 0;
  let recentPlaylistRequestId = 0;

  const favoriteSongPaths = computed(() => {
    const favoritePathSet = new Set(favoritePaths.value);
    return canonicalSongPaths.value.filter(path => favoritePathSet.has(path));
  });

  const favoriteSongList = computed(() =>
    favoriteSongPaths.value
      .map(path => songLookup.value.get(path))
      .filter((song): song is Song => !!song),
  );

  watch(
    favoriteSongPaths,
    async (paths) => {
      const requestId = ++favoriteArtistRequestId;

      if (paths.length === 0) {
        favArtistList.value = [];
        return;
      }

      try {
        const result = await tauriInvoke('get_favorite_artist_catalog', {
          favoritePaths: paths,
        });

        if (requestId !== favoriteArtistRequestId) {
          return;
        }

        favArtistList.value = result;
      } catch {
        if (requestId !== favoriteArtistRequestId) {
          return;
        }

        favArtistList.value = [];
      }
    },
    { immediate: true },
  );

  watch(
    favoriteSongPaths,
    async (paths) => {
      const requestId = ++favoriteAlbumRequestId;

      if (paths.length === 0) {
        favAlbumList.value = [];
        return;
      }

      try {
        const result = await tauriInvoke('get_favorite_album_catalog', {
          favoritePaths: paths,
        });

        if (requestId !== favoriteAlbumRequestId) {
          return;
        }

        favAlbumList.value = result;
      } catch {
        if (requestId !== favoriteAlbumRequestId) {
          return;
        }

        favAlbumList.value = [];
      }
    },
    { immediate: true },
  );

  watch(
    recentSongs,
    async (items) => {
      const requestId = ++recentAlbumRequestId;

      if (items.length === 0) {
        recentAlbumList.value = [];
        return;
      }

      try {
        const result = await tauriInvoke('get_recent_album_catalog', {
          recentEntries: items.map(item => ({
            songPath: item.path,
            playedAt: item.playedAt,
          })),
        });

        if (requestId !== recentAlbumRequestId) {
          return;
        }

        recentAlbumList.value = result;
      } catch {
        if (requestId !== recentAlbumRequestId) {
          return;
        }

        recentAlbumList.value = [];
      }
    },
    { deep: true, immediate: true },
  );

  watch(
    [playlists, recentSongs],
    async ([playlistItems, recentItems]) => {
      const requestId = ++recentPlaylistRequestId;

      if (playlistItems.length === 0 || recentItems.length === 0) {
        recentPlaylistList.value = [];
        return;
      }

      try {
        const result = await tauriInvoke('get_recent_playlist_catalog', {
          playlists: playlistItems,
          recentEntries: recentItems.map(item => ({
            songPath: item.path,
            playedAt: item.playedAt,
          })),
        });

        if (requestId !== recentPlaylistRequestId) {
          return;
        }

        recentPlaylistList.value = result;
      } catch {
        if (requestId !== recentPlaylistRequestId) {
          return;
        }

        recentPlaylistList.value = [];
      }
    },
    { deep: true, immediate: true },
  );

  return {
    favoriteSongPaths,
    favoriteSongList,
    favArtistList,
    favAlbumList,
    recentAlbumList,
    recentPlaylistList,
  };
}
