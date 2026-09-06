import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';

import type { Playlist, Song } from '../types';
import { usePlaybackStore } from '../features/playback/store';
import { useHomeBatchActions } from './useHomeBatchActions';

const deleteMusicFileMock = vi.fn();

vi.mock('../services/tauri/fileApi', () => ({
  fileApi: {
    deleteMusicFile: (...args: unknown[]) => deleteMusicFileMock(...args),
  },
}));

const makeSong = (path: string): Song => ({
  path,
  name: path.split(/[\\/]/).pop() ?? path,
  title: path.split(/[\\/]/).pop() ?? path,
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

describe('useHomeBatchActions physical delete', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    deleteMusicFileMock.mockReset();
  });

  it('removes deleted songs from current playback and queues', async () => {
    const deletedSong = makeSong('C:\\Music\\deleted.flac');
    const keptSong = makeSong('C:\\Music\\kept.flac');
    const playbackStore = usePlaybackStore();
    playbackStore.playQueue = [deletedSong, keptSong];
    playbackStore.tempQueue = [deletedSong];
    playbackStore.currentSong = deletedSong;
    deleteMusicFileMock.mockResolvedValue(undefined);

    const selectedPaths = ref(new Set([deletedSong.path]));
    const canonicalSongPaths = ref([deletedSong.path, keptSong.path]);
    const sourceSongPaths = ref([deletedSong.path, keptSong.path]);
    const favoritePaths = ref([deletedSong.path, keptSong.path]);
    const playlists = ref<Playlist[]>([
      { id: 'playlist-1', name: 'Playlist', songPaths: [deletedSong.path, keptSong.path] },
    ]);
    const removeFromHistory = vi.fn().mockResolvedValue(undefined);

    const actions = useHomeBatchActions({
      currentViewMode: ref('folder'),
      selectedPaths,
      isBatchMode: ref(true),
      isManagementMode: ref(true),
      canonicalSongPaths,
      sourceSongPaths,
      favoritePaths,
      playlists,
      moveFilesToFolder: vi.fn(),
      removeFromHistory,
      showToast: vi.fn(),
      getRoutePath: () => '/',
    });

    actions.handleFolderBatchDelete();
    await actions.executeConfirmAction();

    expect(playbackStore.playQueue.map(song => song.path)).toEqual([keptSong.path]);
    expect(playbackStore.tempQueue).toEqual([]);
    expect(playbackStore.currentSong).toBeNull();
    expect(favoritePaths.value).toEqual([keptSong.path]);
    expect(playlists.value[0]?.songPaths).toEqual([keptSong.path]);
    expect(removeFromHistory).toHaveBeenCalledWith([deletedSong.path]);
  });

  it('removes selected songs from playlist when in playlist view', async () => {
    const song1 = 'C:\\Music\\song1.flac';
    const song2 = 'C:\\Music\\song2.flac';
    const song3 = 'C:\\Music\\song3.flac';

    const selectedPaths = ref(new Set([song1, song2]));
    const isBatchMode = ref(true);
    const filterCondition = ref('target-playlist');
    const playlists = ref<Playlist[]>([
      { id: 'target-playlist', name: 'Target Playlist', songPaths: [song1, song2, song3] },
      { id: 'other-playlist', name: 'Other Playlist', songPaths: [song1, song3] },
    ]);

    const actions = useHomeBatchActions({
      currentViewMode: ref('playlist'),
      filterCondition,
      selectedPaths,
      isBatchMode,
      isManagementMode: ref(false),
      canonicalSongPaths: ref([song1, song2, song3]),
      sourceSongPaths: ref([song1, song2, song3]),
      favoritePaths: ref([]),
      playlists,
      moveFilesToFolder: vi.fn(),
      removeFromHistory: vi.fn(),
      showToast: vi.fn(),
      getRoutePath: () => '/',
    });

    actions.requestBatchDelete();
    expect(actions.showConfirm.value).toBe(true);

    await actions.executeConfirmAction();

    expect(playlists.value.find(p => p.id === 'target-playlist')?.songPaths).toEqual([song3]);
    expect(playlists.value.find(p => p.id === 'other-playlist')?.songPaths).toEqual([song1, song3]);
    expect(selectedPaths.value.size).toBe(0);
    expect(isBatchMode.value).toBe(false);
    expect(actions.showConfirm.value).toBe(false);
  });
});
