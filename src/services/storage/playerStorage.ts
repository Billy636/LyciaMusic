import type { AppSettings, HistoryItem, Playlist, Song, EqualizerPreset } from '../../types';
import { localStore } from './localStore';

export type ArtistSortMode = 'count' | 'name' | 'custom';
export type AlbumSortMode = 'count' | 'name' | 'artist' | 'custom';
export type FolderSortMode = 'title' | 'name' | 'artist' | 'added_at' | 'added_at_asc' | 'custom';
export type LocalSortMode = 'title' | 'artist' | 'added_at' | 'added_at_asc' | 'file_modified_at' | 'file_modified_at_asc' | 'custom';
export type AlbumDetailSortMode = 'track_number' | 'track_number_desc' | 'title' | 'artist' | 'added_at' | 'added_at_asc' | 'file_modified_at' | 'file_modified_at_asc';
export type PlaylistSortMode = 'title' | 'name' | 'artist' | 'added_at' | 'added_at_asc' | 'custom';

export const playerStorageKeys = {
  settings: 'player_settings',
  volume: 'player_volume',
  playMode: 'player_mode',
  lastTime: 'player_last_time',
  outputDevice: 'player_output_device',
  outputDeviceMode: 'player_output_device_mode',
  watchedFolders: 'player_watched_folders',
  favorites: 'player_favorites',
  playlists: 'player_custom_playlists',
  artistSortMode: 'player_artist_sort_mode',
  albumSortMode: 'player_album_sort_mode',
  albumDetailSortMode: 'player_album_detail_sort_mode',
  folderSortMode: 'player_folder_sort_mode',
  localSortMode: 'player_local_sort_mode',
  playlistSortMode: 'player_playlist_sort_mode',
  artistCustomOrder: 'player_artist_custom_order',
  albumCustomOrder: 'player_album_custom_order',
  folderCustomOrder: 'player_folder_custom_order',
  localCustomOrder: 'player_local_custom_order',
  legacyAppSettings: 'app_settings',
  equalizerPresets: 'player_equalizer_presets',
} as const;

const isSong = (value: unknown): value is Song =>
  !!value && typeof value === 'object' && typeof (value as Song).path === 'string';

const normalizeHistoryItem = (value: unknown): HistoryItem | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const item = value as HistoryItem & { song?: Song };
  if (typeof item.path === 'string' && typeof item.playedAt === 'number') {
    return {
      path: item.path,
      playedAt: item.playedAt,
    };
  }

  if (isSong(item.song) && typeof item.playedAt === 'number') {
    return {
      path: item.song.path,
      playedAt: item.playedAt,
    };
  }

  return null;
};

export const playerStorage = {
  getString: localStore.getString,
  setString: localStore.setString,
  remove: localStore.remove,

  readStringArray(key: string): string[] | null {
    const parsed = localStore.getJson<unknown>(key);
    if (!Array.isArray(parsed)) {
      return null;
    }

    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  },

  readSongArray(key: string): Song[] {
    const parsed = localStore.getJson<unknown>(key);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isSong);
  },

  readSong(key: string): Song | null {
    const parsed = localStore.getJson<unknown>(key);
    return isSong(parsed) ? parsed : null;
  },

  readHistory(key: string): HistoryItem[] {
    const parsed = localStore.getJson<unknown>(key);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(normalizeHistoryItem)
      .filter((item): item is HistoryItem => !!item);
  },

  readSettings<T extends AppSettings>(key = playerStorageKeys.settings): T | null {
    const parsed = localStore.getJson<unknown>(key);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    return parsed as T;
  },

  readObject<T extends object>(key: string): T | null {
    const parsed = localStore.getJson<unknown>(key);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    return parsed as T;
  },

  writeSettings(settings: AppSettings, key = playerStorageKeys.settings) {
    localStore.setJson(key, settings);
  },

  readNumber(key: string): number | null {
    const raw = localStore.getString(key);
    if (!raw) {
      return null;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  },

  writeNumber(key: string, value: number) {
    localStore.setString(key, value.toString());
  },

  readPlaylists(key = playerStorageKeys.playlists): Playlist[] {
    const parsed = localStore.getJson<unknown>(key);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is Playlist => {
      if (!item || typeof item !== 'object') {
        return false;
      }

      const playlist = item as Playlist;
      return typeof playlist.id === 'string' && typeof playlist.name === 'string' && Array.isArray(playlist.songPaths);
    });
  },

  // 均衡器预设管理
  readEqualizerPresets(): EqualizerPreset[] {
    const parsed = localStore.getJson<unknown>(playerStorageKeys.equalizerPresets);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is EqualizerPreset => 
      !!item && typeof item === 'object' && typeof item.id === 'string'
    );
  },
  
  writeEqualizerPresets(presets: EqualizerPreset[]) {
    localStore.setJson(playerStorageKeys.equalizerPresets, presets);
  },

  writePlayerState(options: {
    playlistPathKey: string;
    queuePathKey: string;
    legacyPlaylistKey: string;
    legacyQueueKey: string;
    sourceSongPaths: string[];
    watchedFolders: string[];
    favoritePaths: string[];
    playlists: Playlist[];
    settings: AppSettings;
    playQueuePaths: string[];
    artistCustomOrder: string[];
    albumCustomOrder: string[];
    folderCustomOrder: Record<string, string[]>;
    localCustomOrder: string[];
  }) {
    localStore.setJson(options.playlistPathKey, options.sourceSongPaths);
    localStore.setJson(playerStorageKeys.watchedFolders, options.watchedFolders);
    localStore.setJson(playerStorageKeys.favorites, options.favoritePaths);
    localStore.setJson(playerStorageKeys.playlists, options.playlists);
    localStore.setJson(playerStorageKeys.settings, options.settings);
    localStore.setJson(options.queuePathKey, options.playQueuePaths);
    localStore.setJson(playerStorageKeys.artistCustomOrder, options.artistCustomOrder);
    localStore.setJson(playerStorageKeys.albumCustomOrder, options.albumCustomOrder);
    localStore.setJson(playerStorageKeys.folderCustomOrder, options.folderCustomOrder);
    localStore.setJson(playerStorageKeys.localCustomOrder, options.localCustomOrder);
    localStore.remove(options.legacyPlaylistKey);
    localStore.remove(options.legacyQueueKey);
  },
};
