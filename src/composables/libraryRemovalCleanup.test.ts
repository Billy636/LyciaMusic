import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { Song } from '../types';
import { useCollectionsStore } from '../features/collections/store';
import { useLibraryStore } from '../features/library/store';
import { usePlaybackStore } from '../features/playback/store';
import {
  cleanupRemovedLibrarySongPaths,
  collectSongPathsInFolderScope,
  isPathInFolderScope,
} from './libraryRemovalCleanup';

const makeSong = (path: string, title = 'Demo'): Song => ({
  path,
  name: `${title}.flac`,
  title,
  artist: 'Artist',
  artist_names: ['Artist'],
  effective_artist_names: ['Artist'],
  album: 'Album',
  album_artist: 'Artist',
  album_key: 'album::artist',
  is_various_artists_album: false,
  collapse_artist_credits: false,
  duration: 180,
});

describe('library removal cleanup', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('matches songs inside a removed folder with normalized separators and casing', () => {
    expect(isPathInFolderScope('C:\\Music\\Rock\\', 'c:/music/rock/song.flac')).toBe(true);
    expect(isPathInFolderScope('C:\\Music\\Rock', 'C:\\Music\\Rock')).toBe(true);
    expect(isPathInFolderScope('C:\\Music\\Rock', 'C:\\Music\\Rocky\\song.flac')).toBe(false);
  });

  it('collects only song paths under the removed folder', () => {
    const songs = [
      makeSong('C:\\Music\\Rock\\a.flac'),
      makeSong('C:\\Music\\Rock\\Live\\b.flac'),
      makeSong('C:\\Music\\Jazz\\c.flac'),
    ];

    expect(collectSongPathsInFolderScope(songs, 'c:/music/rock')).toEqual([
      'C:\\Music\\Rock\\a.flac',
      'C:\\Music\\Rock\\Live\\b.flac',
    ]);
  });

  it('stops active removed songs and clears app references to removed paths', async () => {
    const libraryStore = useLibraryStore();
    const collectionsStore = useCollectionsStore();
    const playbackStore = usePlaybackStore();
    const removedSong = makeSong('C:\\Music\\Rock\\a.flac', 'Removed');
    const nestedRemovedSong = makeSong('C:\\Music\\Rock\\Live\\b.flac', 'Nested Removed');
    const keptSong = makeSong('C:\\Music\\Jazz\\c.flac', 'Kept');
    const stopPlayback = vi.fn().mockResolvedValue(undefined);
    const removeFromHistory = vi.fn().mockResolvedValue(undefined);
    const removeSongStatistics = vi.fn().mockResolvedValue(undefined);
    const clearCaches = vi.fn();

    libraryStore.localCustomOrder = [removedSong.path, keptSong.path];
    libraryStore.folderCustomOrder = {
      'C:\\Music\\Rock': [removedSong.path],
      'C:\\Music\\Jazz': [keptSong.path, nestedRemovedSong.path],
    };
    collectionsStore.favoritePaths = [removedSong.path, keptSong.path];
    collectionsStore.playlists = [
      {
        id: 'playlist-1',
        name: 'Playlist',
        songPaths: [keptSong.path, removedSong.path, nestedRemovedSong.path],
        createdAt: '2026-05-13',
      },
    ];
    collectionsStore.recentSongs = [
      { path: removedSong.path, playedAt: 1 },
      { path: keptSong.path, playedAt: 2 },
    ];
    playbackStore.playQueue = [removedSong, keptSong, nestedRemovedSong];
    playbackStore.tempQueue = [nestedRemovedSong];
    playbackStore.currentSong = removedSong;

    await cleanupRemovedLibrarySongPaths({
      removedPaths: [removedSong.path, nestedRemovedSong.path],
      removedFolderPath: 'C:\\Music\\Rock',
      stopPlayback,
      removeFromHistory,
      removeSongStatistics,
      clearCaches,
    });

    expect(stopPlayback).toHaveBeenCalledOnce();
    expect(playbackStore.playQueue.map(song => song.path)).toEqual([keptSong.path]);
    expect(playbackStore.tempQueue).toEqual([]);
    expect(playbackStore.currentSong).toBeNull();
    expect(collectionsStore.favoritePaths).toEqual([keptSong.path]);
    expect(collectionsStore.playlists[0].songPaths).toEqual([keptSong.path]);
    expect(collectionsStore.recentSongs).toEqual([{ path: keptSong.path, playedAt: 2 }]);
    expect(libraryStore.localCustomOrder).toEqual([keptSong.path]);
    expect(libraryStore.folderCustomOrder).toEqual({
      'C:\\Music\\Rock': [],
      'C:\\Music\\Jazz': [keptSong.path],
    });
    expect(removeFromHistory).toHaveBeenCalledWith([removedSong.path, nestedRemovedSong.path]);
    expect(removeSongStatistics).toHaveBeenCalledWith([removedSong.path, nestedRemovedSong.path]);
    expect(clearCaches).toHaveBeenCalledWith([removedSong.path, nestedRemovedSong.path]);
  });
});
