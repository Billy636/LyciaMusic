import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { Song } from '../types';
import { useCollectionsStore } from '../features/collections/store';
import { useLibraryStore } from '../features/library/store';
import { usePlaybackStore } from '../features/playback/store';
import { useSettingsStore } from '../features/settings/store';
import { createPlayerFileManager } from './playerFileManager';

const scanMusicFolderMock = vi.fn();
const batchMoveMusicFilesMock = vi.fn();
const getFolderFirstSongMock = vi.fn();
const deleteMusicFileMock = vi.fn();

vi.mock('../services/tauri/fileApi', () => ({
  fileApi: {
    scanMusicFolder: (...args: unknown[]) => scanMusicFolderMock(...args),
    deleteFolder: vi.fn(),
    moveFileToFolder: vi.fn(),
    batchMoveMusicFiles: (...args: unknown[]) => batchMoveMusicFilesMock(...args),
    getFolderFirstSong: (...args: unknown[]) => getFolderFirstSongMock(...args),
    moveMusicFile: vi.fn(),
    showInFolder: vi.fn(),
    deleteMusicFile: (...args: unknown[]) => deleteMusicFileMock(...args),
  },
}));

const makeSong = (overrides: Partial<Song> = {}): Song => ({
  path: 'C:\\Music\\A\\demo.flac',
  name: 'demo.flac',
  title: 'Demo',
  artist: 'Artist',
  artist_names: ['Artist'],
  effective_artist_names: ['Artist'],
  album: 'Album',
  album_artist: 'Artist',
  album_key: 'album::artist',
  is_various_artists_album: false,
  collapse_artist_credits: false,
  duration: 180,
  ...overrides,
});

describe('playerFileManager.refreshFolder', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    scanMusicFolderMock.mockReset();
    batchMoveMusicFilesMock.mockReset();
    getFolderFirstSongMock.mockReset();
    deleteMusicFileMock.mockReset();
  });

  it('removes deleted songs from library state and related collections when refreshing a folder', async () => {
    const libraryStore = useLibraryStore();
    const collectionsStore = useCollectionsStore();
    const playbackStore = usePlaybackStore();
    const removeFromHistory = vi.fn().mockResolvedValue(undefined);

    const keptSong = makeSong({
      path: 'C:\\Music\\A\\b.flac',
      name: 'b.flac',
      title: 'B',
    });
    const removedSong = makeSong({
      path: 'C:\\Music\\A\\a.flac',
      name: 'a.flac',
      title: 'A',
    });
    const addedSong = makeSong({
      path: 'C:\\Music\\A\\d.flac',
      name: 'd.flac',
      title: 'D',
    });
    const outsideSong = makeSong({
      path: 'C:\\Music\\Elsewhere\\c.flac',
      name: 'c.flac',
      title: 'C',
    });

    libraryStore.librarySongs = [removedSong, keptSong, outsideSong];
    libraryStore.songList = [removedSong, keptSong, outsideSong];
    collectionsStore.favoritePaths = [removedSong.path, outsideSong.path];
    collectionsStore.playlists = [
      {
        id: 'playlist-1',
        name: 'Playlist',
        songPaths: [removedSong.path, outsideSong.path],
      },
    ];
    collectionsStore.recentSongs = [
      { path: removedSong.path, playedAt: 1 },
      { path: outsideSong.path, playedAt: 2 },
    ];
    playbackStore.playQueue = [removedSong, outsideSong];
    playbackStore.tempQueue = [removedSong];
    playbackStore.currentSong = removedSong;

    scanMusicFolderMock.mockResolvedValue([keptSong, addedSong]);

    const fileManager = createPlayerFileManager({
      removeLibraryFolderLinked: vi.fn(),
      removeFromHistory,
      showToast: vi.fn(),
    });

    const summary = await fileManager.refreshFolder('c:/music/a');

    expect(summary).toEqual({
      removedCount: 1,
      removedPaths: [removedSong.path],
    });
    expect(libraryStore.librarySongs.map(song => song.path)).toEqual([
      outsideSong.path,
      keptSong.path,
      addedSong.path,
    ]);
    expect(libraryStore.songList.map(song => song.path)).toEqual([
      outsideSong.path,
      keptSong.path,
      addedSong.path,
    ]);
    expect(collectionsStore.favoritePaths).toEqual([outsideSong.path]);
    expect(collectionsStore.playlists[0]?.songPaths).toEqual([outsideSong.path]);
    expect(collectionsStore.recentSongs.map(item => item.path)).toEqual([outsideSong.path]);
    expect(playbackStore.playQueue.map(song => song.path)).toEqual([outsideSong.path]);
    expect(playbackStore.tempQueue).toEqual([]);
    expect(playbackStore.currentSong).toBeNull();
    expect(removeFromHistory).toHaveBeenCalledWith([removedSong.path]);
  });

  it('passes the configured short audio threshold when refreshing a folder', async () => {
    const settingsStore = useSettingsStore();
    settingsStore.patchSettings({
      libraryMinDurationSeconds: 60,
    });
    scanMusicFolderMock.mockResolvedValue([]);

    const fileManager = createPlayerFileManager({
      removeLibraryFolderLinked: vi.fn(),
      removeFromHistory: vi.fn(),
      showToast: vi.fn(),
    });

    await fileManager.refreshFolder('c:/music/a');

    expect(scanMusicFolderMock).toHaveBeenCalledWith('c:/music/a', 60);
  });
});

describe('playerFileManager.moveFilesToFolder', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    scanMusicFolderMock.mockReset();
    batchMoveMusicFilesMock.mockReset();
    getFolderFirstSongMock.mockReset();
    deleteMusicFileMock.mockReset();
  });

  it('keeps files that failed to move in the source list and counts only moved files', async () => {
    const libraryStore = useLibraryStore();
    const removeFromHistory = vi.fn().mockResolvedValue(undefined);
    const showToast = vi.fn();

    const movedSongA = makeSong({
      path: 'C:\\Music\\A\\a.flac',
      name: 'a.flac',
      title: 'A',
    });
    const movedSongB = makeSong({
      path: 'C:\\Music\\A\\b.flac',
      name: 'b.flac',
      title: 'B',
    });
    const failedSong = makeSong({
      path: 'C:\\Music\\A\\c.flac',
      name: 'c.flac',
      title: 'C',
    });

    libraryStore.songList = [movedSongA, movedSongB, failedSong];
    libraryStore.libraryHierarchy = [
      {
        name: 'A',
        path: 'C:\\Music\\A',
        children: [],
        child_count: 0,
        children_loaded: true,
        song_count: 3,
        cover_song_path: movedSongA.path,
        is_expanded: false,
      },
      {
        name: 'B',
        path: 'C:\\Music\\B',
        children: [],
        child_count: 0,
        children_loaded: true,
        song_count: 0,
        cover_song_path: null,
        is_expanded: false,
      },
    ];

    batchMoveMusicFilesMock.mockResolvedValue({
      moved_paths: [
        { old_path: movedSongA.path, new_path: 'C:\\Music\\B\\a.flac' },
        { old_path: movedSongB.path, new_path: 'C:\\Music\\B\\b.flac' },
      ],
    });
    getFolderFirstSongMock.mockImplementation((folderPath: string) => {
      if (folderPath === 'C:\\Music\\A') return Promise.resolve(failedSong.path);
      if (folderPath === 'C:\\Music\\B') return Promise.resolve('C:\\Music\\B\\a.flac');
      return Promise.resolve(null);
    });

    const fileManager = createPlayerFileManager({
      removeLibraryFolderLinked: vi.fn(),
      removeFromHistory,
      showToast,
    });

    const movedCount = await fileManager.moveFilesToFolder(
      [movedSongA.path, movedSongB.path, failedSong.path],
      'C:\\Music\\B',
    );

    expect(movedCount).toBe(2);
    expect(libraryStore.songList.map(song => song.path)).toEqual([failedSong.path]);
    expect(libraryStore.libraryHierarchy[0]?.song_count).toBe(1);
    expect(libraryStore.libraryHierarchy[0]?.cover_song_path).toBe(failedSong.path);
    expect(libraryStore.libraryHierarchy[1]?.song_count).toBe(2);
    expect(libraryStore.libraryHierarchy[1]?.cover_song_path).toBe('C:\\Music\\B\\a.flac');
  });
});

describe('playerFileManager.deleteFromDisk', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    scanMusicFolderMock.mockReset();
    batchMoveMusicFilesMock.mockReset();
    getFolderFirstSongMock.mockReset();
    deleteMusicFileMock.mockReset();
  });

  it('removes deleted songs from current playback and queues', async () => {
    const libraryStore = useLibraryStore();
    const collectionsStore = useCollectionsStore();
    const playbackStore = usePlaybackStore();
    const removeFromHistory = vi.fn().mockResolvedValue(undefined);
    const showToast = vi.fn();

    const deletedSong = makeSong({
      path: 'C:\\Music\\A\\deleted.flac',
      name: 'deleted.flac',
      title: 'Deleted',
    });
    const keptSong = makeSong({
      path: 'C:\\Music\\A\\kept.flac',
      name: 'kept.flac',
      title: 'Kept',
    });

    libraryStore.librarySongs = [keptSong];
    libraryStore.songList = [keptSong];
    collectionsStore.favoritePaths = [deletedSong.path, keptSong.path];
    collectionsStore.playlists = [
      { id: 'playlist-1', name: 'Playlist', songPaths: [deletedSong.path, keptSong.path] },
    ];
    playbackStore.playQueue = [deletedSong, keptSong];
    playbackStore.tempQueue = [deletedSong];
    playbackStore.currentSong = deletedSong;
    deleteMusicFileMock.mockResolvedValue(undefined);

    const fileManager = createPlayerFileManager({
      removeLibraryFolderLinked: vi.fn(),
      removeFromHistory,
      showToast,
    });

    await fileManager.deleteFromDisk(deletedSong);

    expect(playbackStore.playQueue.map(song => song.path)).toEqual([keptSong.path]);
    expect(playbackStore.tempQueue).toEqual([]);
    expect(playbackStore.currentSong).toBeNull();
    expect(collectionsStore.favoritePaths).toEqual([keptSong.path]);
    expect(collectionsStore.playlists[0]?.songPaths).toEqual([keptSong.path]);
    expect(removeFromHistory).toHaveBeenCalledWith([deletedSong.path]);
  });
});
