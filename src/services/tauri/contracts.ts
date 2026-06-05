import type {
  AlbumCatalogItem,
  ArtistCatalogItem,
  FolderNode,
  LibraryFolder,
  RecentAlbumCatalogItem,
  RecentPlaylistCatalogItem,
  Playlist,
  RemoteConnectionResult,
  RemoteCacheUsage,
  RemoteFileEntry,
  RemoteSource,
  RemoteSourceInput,
  RemoteSyncResult,
  Song,
  SongDetail,
} from '../../types';
import type { AudioOutputMode } from '../../types';

export interface AudioDevice {
  id: string;
  name: string;
}

export interface AudioOutputStatus {
  selected_device_id: string | null;
  active_device_name: string | null;
  follows_system_default: boolean;
  requested_output_mode: AudioOutputMode;
  active_output_mode: AudioOutputMode;
  fallback_reason: string | null;
}

export interface MovedMusicFilePath {
  old_path: string;
  new_path: string;
}

export interface BatchMoveMusicFilesResult {
  moved_paths: MovedMusicFilePath[];
}

export type LyricsStorageSource = 'embedded' | 'sidecar' | 'empty';

export interface SongLyricsForEdit {
  lyrics: string;
  source: LyricsStorageSource;
  sourcePath: string | null;
}

export interface SongInfoEditPayload {
  title: string;
  artist: string;
  album: string;
  trackNumber: string | null;
  discNumber: string | null;
  year: string | null;
  coverPath: string | null;
}

export interface SaveSongInfoResponse {
  song: Song;
  detail: SongDetail;
}

export interface RecentHistoryRecord {
  songPath: string;
  playedAt: number;
}

export interface RecentHistoryImportRecord {
  songPath: string;
  playedAt: number;
}

export interface StatisticsExportResult {
  filePath: string;
  exportId: string;
  exportedAt: string;
}

export interface StatisticsImportPreview {
  version: number;
  exportedAt: string;
  appVersion: string;
  exportId: string;
  songStatsCount: number;
  dailyStatsCount: number;
  recentPlaysCount: number;
  matchedSongCount: number;
  unmatchedSongCount: number;
  duplicateImportDetected: boolean;
}

export interface StatisticsImportResult {
  mode: 'overwrite' | 'merge';
  matchedSongCount: number;
  unmatchedSongCount: number;
  mergedSongCount: number;
  importedRecentPlaysCount: number;
  duplicateImportSkipped: boolean;
}

export interface LoudnessRecord {
  songId: number;
  songPath: string;
  loudnessLufs: number | null;
  estimatedLoudnessLufs: number | null;
  samplePeak: number | null;
  truePeak: number | null;
  tagTrackGainDb: number | null;
  tagTrackPeak: number | null;
  tagAlbumGainDb: number | null;
  tagAlbumPeak: number | null;
  tagR128TrackGainDb: number | null;
  tagR128AlbumGainDb: number | null;
  fileSize: number;
  fileModifiedAt: number;
  scanSource: string;
  analyzerName: string | null;
  analyzerVersion: number;
  scanStatus: string;
  scannedAt: number | null;
  errorMessage: string | null;
}

export interface PlayAudioOptions {
  path: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  duration: number;
  outputMode: AudioOutputMode;
  startOffsetMs?: number;
  songId?: number | null;
  volumeBalanceEnabled?: boolean | null;
  gainOffsetDb?: number | null;
  preventClipping?: boolean | null;
}

export interface UpdateLoudnessSettingsOptions {
  enabled: boolean;
  songId?: number | null;
  songPath?: string | null;
  gainOffsetDb: number;
  preventClipping: boolean;
}

export interface UpdatePlaybackMetadataOptions {
  title: string;
  artist: string;
  album: string;
  cover: string;
  duration: number;
  isPlaying: boolean;
}

export interface SeekAudioOptions {
  time: number;
  isPlaying: boolean;
  requestId: number;
}

export interface WindowMaterialCapabilities {
  isWindows: boolean;
  supportsAcrylic: boolean;
  supportsMica: boolean;
  supportsBlur: boolean;
  systemTransparencyEnabled: boolean | null;
  windowsBuildNumber: number | null;
}

export interface ForegroundFullscreenState {
  isFullscreen: boolean;
}

export interface TauriCommandMap {
  add_library_folder: { payload: { path: string }; response: void };
  // Deprecated compat command. Do not use in new main-flow code.
  add_sidebar_folder: { payload: { path: string }; response: void };
  remove_library_folder: { payload: { path: string }; response: void };
  // Deprecated compat command. Do not use in new main-flow code.
  remove_sidebar_folder: { payload: { path: string }; response: void };
  get_library_hierarchy: { payload: undefined; response: FolderNode[] };
  get_library_artist_catalog: { payload: undefined; response: ArtistCatalogItem[] };
  get_library_album_catalog: { payload: undefined; response: AlbumCatalogItem[] };
  get_library_song_paths_by_artist: { payload: { artistName: string }; response: string[] };
  get_library_song_paths_by_album: { payload: { albumKey: string }; response: string[] };
  get_library_song_paths_for_all_view: {
    payload: {
      query?: string;
      artistFilter?: string;
      albumFilter?: string;
      sortMode: 'title' | 'artist' | 'added_at' | 'added_at_asc' | 'file_modified_at' | 'file_modified_at_asc';
    };
    response: string[];
  };
  get_library_song_paths_for_folder_view: {
    payload: {
      folderPath: string;
      query?: string;
      sortMode: 'title' | 'name' | 'artist' | 'added_at' | 'added_at_asc';
    };
    response: string[];
  };
  get_folder_children: { payload: { folderPath: string }; response: FolderNode[] };
  get_library_folders: { payload: undefined; response: LibraryFolder[] };
  get_remote_sources: { payload: undefined; response: RemoteSource[] };
  test_remote_source: { payload: { source: RemoteSourceInput }; response: RemoteConnectionResult };
  add_remote_source: { payload: { source: RemoteSourceInput }; response: RemoteSource };
  update_remote_source: { payload: { source: RemoteSourceInput }; response: RemoteSource };
  remove_remote_source: { payload: { sourceId: string }; response: void };
  sync_remote_source: { payload: { sourceId: string }; response: RemoteSyncResult };
  precache_remote_song: { payload: { remoteUri: string }; response: void };
  get_remote_cache_usage: { payload: undefined; response: RemoteCacheUsage };
  clear_remote_cache: { payload: undefined; response: RemoteCacheUsage };
  list_remote_directory: { payload: { sourceId: string; path: string }; response: RemoteFileEntry[] };
  // Deprecated compat command. Main folder-tree flow must use get_library_hierarchy.
  get_sidebar_hierarchy: { payload: undefined; response: FolderNode[] };
  create_folder: { payload: { parentPath: string; folderName: string }; response: string };
  refresh_folder_songs: {
    payload: { folderPath: string; minimumDurationSeconds?: number };
    response: void;
  };
  delete_folder: { payload: { path: string }; response: void };
  move_file_to_folder: {
    payload: { sourcePath: string; targetFolder: string };
    response: void;
  };
  batch_move_music_files: {
    payload: { paths: string[]; targetFolder: string };
    response: BatchMoveMusicFilesResult;
  };
  get_folder_first_song: {
    payload: { folderPath: string };
    response: string | null;
  };
  scan_music_folder: {
    payload: { folderPath: string; minimumDurationSeconds?: number };
    response: Song[];
  };
  move_music_file: { payload: { oldPath: string; newPath: string }; response: void };
  show_in_folder: { payload: { path: string }; response: void };
  delete_music_file: { payload: { path: string }; response: void };
  is_directory: { payload: { path: string }; response: boolean };
  parse_audio_files: {
    payload: { paths: string[]; minimumDurationSeconds?: number };
    response: Song[];
  };
  set_volume: { payload: { volume: number }; response: void };
  get_playback_progress: { payload: undefined; response: number };
  get_audio_visualizer_samples: { payload: undefined; response: number[] };
  record_play: {
    payload: {
      payload: {
        songPath: string;
        listenedMs: number;
        durationMs: number;
        title: string;
        artist: string;
        album: string;
        trackNumber?: string;
      };
    };
    response: void;
  };
  get_song_cover_thumbnail: { payload: { path: string }; response: string };
  get_song_cover: { payload: { path: string }; response: string };
  clear_cover_cache: { payload: undefined; response: void };
  get_song_lyrics: { payload: { path: string }; response: string };
  get_song_lyrics_for_edit: { payload: { path: string }; response: SongLyricsForEdit };
  save_song_lyrics: {
    payload: {
      path: string;
      lyrics: string;
      source: LyricsStorageSource;
      sourcePath: string | null;
    };
    response: SongLyricsForEdit;
  };
  save_song_info: {
    payload: {
      path: string;
      payload: SongInfoEditPayload;
    };
    response: SaveSongInfoResponse;
  };
  get_song_detail: { payload: { path: string }; response: SongDetail };
  play_audio: { payload: PlayAudioOptions; response: void };
  update_playback_metadata: { payload: UpdatePlaybackMetadataOptions; response: void };
  pause_audio: { payload: undefined; response: void };
  stop_audio: { payload: undefined; response: void };
  resume_audio: { payload: undefined; response: void };
  seek_audio: { payload: SeekAudioOptions; response: void };
  set_audio_output_mode: { payload: { outputMode: AudioOutputMode }; response: void };
  set_output_device: { payload: { deviceId: string | null }; response: void };
  get_output_devices: { payload: undefined; response: AudioDevice[] };
  get_current_output_device: { payload: undefined; response: AudioOutputStatus };
  add_to_history: { payload: { songPath: string }; response: void };
  remove_from_recent_history: { payload: { songPaths: string[] }; response: void };
  remove_songs_from_history_and_statistics: { payload: { songPaths: string[] }; response: void };
  clear_recent_history: { payload: undefined; response: void };
  get_recent_history: { payload: { limit: number }; response: RecentHistoryRecord[] };
  get_favorite_artist_catalog: { payload: { favoritePaths: string[] }; response: ArtistCatalogItem[] };
  get_favorite_album_catalog: { payload: { favoritePaths: string[] }; response: AlbumCatalogItem[] };
  get_favorite_song_paths_view: {
    payload: {
      favoritePaths: string[];
      query?: string;
      sortMode: 'title' | 'artist' | 'added_at' | 'added_at_asc' | 'file_modified_at' | 'file_modified_at_asc';
      detailFilterType?: 'artist' | 'album';
      detailFilterValue?: string;
    };
    response: string[];
  };
  get_recent_album_catalog: {
    payload: { recentEntries: RecentHistoryImportRecord[] };
    response: RecentAlbumCatalogItem[];
  };
  get_recent_song_paths_view: {
    payload: {
      recentEntries: RecentHistoryImportRecord[];
      query?: string;
      sortMode: 'title' | 'artist' | 'added_at' | 'added_at_asc' | 'file_modified_at' | 'file_modified_at_asc';
    };
    response: string[];
  };
  get_recent_playlist_catalog: {
    payload: {
      playlists: Playlist[];
      recentEntries: RecentHistoryImportRecord[];
    };
    response: RecentPlaylistCatalogItem[];
  };
  import_recent_history: {
    payload: { entries: RecentHistoryImportRecord[] };
    response: void;
  };
  export_statistics_file: {
    payload: {
      options: {
        filePath: string;
        includeRecentPlays: boolean;
      };
    };
    response: StatisticsExportResult;
  };
  preview_statistics_import: {
    payload: {
      options: {
        filePath: string;
      };
    };
    response: StatisticsImportPreview;
  };
  import_statistics_file: {
    payload: {
      options: {
        filePath: string;
        mode: 'overwrite' | 'merge';
        continueDuplicateImport: boolean;
      };
    };
    response: StatisticsImportResult;
  };
  set_mini_boundary_enabled: { payload: { enabled: boolean }; response: void };
  set_dark_mode_for_window: { payload: { dark: boolean }; response: void };
  get_window_material_capabilities: {
    payload: undefined;
    response: WindowMaterialCapabilities;
  };
  get_foreground_fullscreen_state: {
    payload: undefined;
    response: ForegroundFullscreenState;
  };
  refresh_current_window_topmost: {
    payload: { enabled: boolean };
    response: void;
  };
  refresh_taskbar_window_topmost: { payload: undefined; response: boolean };
  start_topmost_guard: { payload: undefined; response: void };
  stop_topmost_guard: { payload: undefined; response: void };
  clear_all_app_data: { payload: undefined; response: void };
  open_external_program: {
    payload: { path: string; args: string[] };
    response: void;
  };
  consume_pending_open_paths: { payload: undefined; response: string[] };
  get_track_loudness_info: {
    payload: { songId: number };
    response: LoudnessRecord | null;
  };
  update_loudness_settings: {
    payload: UpdateLoudnessSettingsOptions;
    response: void;
  };
  set_equalizer_settings: {
    payload: { enabled: boolean; preamp: number; gains: number[] };
    response: void;
  };
  file_exists: {
    payload: { path: string };
    response: boolean;
  };
}
