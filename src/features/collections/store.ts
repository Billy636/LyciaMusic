import { ref, watch } from 'vue';
import { defineStore } from 'pinia';

import type { PlaylistSortMode } from '../../services/storage/playerStorage';
import type { HistoryItem, Playlist, Song } from '../../types';
import { useLibraryStore } from '../library/store';
import { playerStorage, playerStorageKeys } from '../../services/storage/playerStorage';
import { localStore } from '../../services/storage/localStore';
import { isPlaylistSortMode } from './playlistSort';

const formatPlaylistDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
};

export const useCollectionsStore = defineStore('collections', () => {
  const RECENT_SONG_LIMIT = 100;
  const RECENT_STORAGE_KEY = 'lycia_recent_songs_v1';
  const favoritePaths = ref<string[]>([]);
  const playlists = ref<Playlist[]>([]);
  const initialized = ref(false);
  const storedRecent = localStore.getJson<HistoryItem[]>(RECENT_STORAGE_KEY);
  const identityOfItem = (item: HistoryItem) => item.identity || item.path;
  const uniqueRecent = (items: HistoryItem[]) => {
    const seen = new Set<string>();
    return items.filter(item => {
      const key = identityOfItem(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, RECENT_SONG_LIMIT);
  };
  const recentSongs = ref<HistoryItem[]>(Array.isArray(storedRecent)
    ? uniqueRecent(storedRecent.filter(item => item && typeof item.path === 'string' && typeof item.playedAt === 'number'))
    : []);
  watch(recentSongs, items => {
    localStore.setJson(RECENT_STORAGE_KEY, items);
  }, { deep: true, flush: 'sync' });
  const playlistSortMode = ref<PlaylistSortMode>('custom');
  const storedOverrides = playerStorage.readObject<Record<string, unknown>>(playerStorageKeys.playlistSortOverrides);
  const playlistSortOverrides = ref<Record<string, PlaylistSortMode>>(Object.fromEntries(
    Object.entries(storedOverrides ?? {}).filter((entry): entry is [string, PlaylistSortMode] =>
      !!entry[0] && isPlaylistSortMode(entry[1])),
  ));
  watch(playlistSortOverrides, value => {
    localStore.setJson(playerStorageKeys.playlistSortOverrides, value);
  }, { deep: true, flush: 'sync' });

  const getPlaylistSortOverride = (id: string): PlaylistSortMode | undefined =>
    Object.prototype.hasOwnProperty.call(playlistSortOverrides.value, id) ? playlistSortOverrides.value[id] : undefined;
  const setPlaylistSortOverride = (id: string, mode: PlaylistSortMode | null) => {
    if (!playlists.value.some(playlist => playlist.id === id)) return;
    if (mode === null) delete playlistSortOverrides.value[id];
    else playlistSortOverrides.value = { ...playlistSortOverrides.value, [id]: mode };
  };
  const resetPlaylistSortOverrides = () => { playlistSortOverrides.value = {}; };

  const setFavoritePaths = (paths: string[]) => {
    favoritePaths.value = paths;
  };

  const setPlaylists = (nextPlaylists: Playlist[]) => {
    playlists.value = nextPlaylists;
    initialized.value = true;
  };

  const setRecentSongs = (historyItems: HistoryItem[]) => {
    recentSongs.value = historyItems;
  };

  const createPlaylist = (name: string, initialSongs: string[] = []) => {
    if (!name.trim()) {
      return null;
    }

    const playlist: Playlist = {
      id: Date.now().toString() + Math.random().toString().slice(2),
      name,
      songPaths: [...initialSongs],
      createdAt: formatPlaylistDate(),
    };

    playlists.value.push(playlist);
    return playlist.id;
  };

  const deletePlaylist = (id: string) => {
    delete playlistSortOverrides.value[id];
    const beforeLength = playlists.value.length;
    playlists.value = playlists.value.filter(playlist => playlist.id !== id);
    return beforeLength !== playlists.value.length;
  };

  const getPlaylistById = (playlistId: string) =>
    playlists.value.find(item => item.id === playlistId);

  const addToPlaylist = (playlistId: string, path: string) => {
    const playlist = getPlaylistById(playlistId);
    if (playlist && !playlist.importData?.linked && !playlist.songPaths.includes(path)) {
      playlist.songPaths.push(path);
      return true;
    }

    return false;
  };

  const removeFromPlaylist = (playlistId: string, path: string) => {
    const playlist = getPlaylistById(playlistId);
    if (!playlist || playlist.importData?.linked) {
      return false;
    }

    const beforeLength = playlist.songPaths.length;
    playlist.songPaths = playlist.songPaths.filter(songPath => songPath !== path);
    return beforeLength !== playlist.songPaths.length;
  };

  const addSongsToPlaylist = (playlistId: string, songPaths: string[]) => {
    const playlist = getPlaylistById(playlistId);
    if (!playlist || playlist.importData?.linked) {
      return 0;
    }

    let addedCount = 0;
    for (const path of songPaths) {
      if (!playlist.songPaths.includes(path)) {
        playlist.songPaths.push(path);
        addedCount += 1;
      }
    }

    return addedCount;
  };

  const reorderPlaylists = (from: number, to: number) => {
    const list = [...playlists.value];
    const [removed] = list.splice(from, 1);
    if (!removed) {
      return;
    }

    list.splice(to, 0, removed);
    playlists.value = list;
  };

  const getSongsFromPlaylist = (playlistId: string): Song[] => {
    const libraryStore = useLibraryStore();
    const playlist = getPlaylistById(playlistId);
    if (!playlist) {
      return [];
    }

    const songMap = new Map<string, Song>();
    libraryStore.songList.forEach(song => {
      songMap.set(song.path, song);
    });

    return playlist.songPaths
      .map(path => songMap.get(path))
      .filter((song): song is Song => !!song);
  };

  const isFavoritePath = (path: string | null | undefined) => {
    if (!path) {
      return false;
    }

    return favoritePaths.value.includes(path);
  };

  const toggleFavoritePath = (path: string) => {
    if (isFavoritePath(path)) {
      favoritePaths.value = favoritePaths.value.filter(item => item !== path);
      return false;
    }

    favoritePaths.value.push(path);
    return true;
  };

  const removeFavoritePaths = (paths: string[]) => {
    if (paths.length === 0) {
      return;
    }

    const blocked = new Set(paths);
    favoritePaths.value = favoritePaths.value.filter(path => !blocked.has(path));
  };

  const clearFavorites = () => {
    favoritePaths.value = [];
  };

  const addRecentSong = (song: Song) => {
    const now = Date.now();
    const identity = [song.artist, song.title || song.name].filter(Boolean)
      .map(value => String(value).trim().toLowerCase()).join('|');
    // 当前播放的歌始终置顶；按路径或歌手+标题任一命中都视为同一首，
    // 旧位置移除后重新置顶，避免同曲多文件 / 元数据差异产生重复。
    const rest = recentSongs.value.filter(item =>
      item.path !== song.path && (!identity || item.identity !== identity));
    recentSongs.value = [{ path: song.path, playedAt: now, identity }, ...rest].slice(0, RECENT_SONG_LIMIT);
  };

  const removeRecentSongs = (songPaths: string[]) => {
    if (songPaths.length === 0) {
      return;
    }

    const blocked = new Set(songPaths);
    recentSongs.value = recentSongs.value.filter(item => !blocked.has(item.path));
  };

  const clearRecentSongs = () => {
    recentSongs.value = [];
  };

  return {
    initialized,
    favoritePaths,
    playlists,
    recentSongs,
    playlistSortMode,
    playlistSortOverrides,
    getPlaylistSortOverride,
    setPlaylistSortOverride,
    resetPlaylistSortOverrides,
    setFavoritePaths,
    setPlaylists,
    setRecentSongs,
    createPlaylist,
    deletePlaylist,
    getPlaylistById,
    addToPlaylist,
    removeFromPlaylist,
    addSongsToPlaylist,
    reorderPlaylists,
    getSongsFromPlaylist,
    isFavoritePath,
    toggleFavoritePath,
    removeFavoritePaths,
    clearFavorites,
    addRecentSong,
    removeRecentSongs,
    clearRecentSongs,
  };
});
