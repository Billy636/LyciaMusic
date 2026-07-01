import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { Song } from '../types';
import { useCollectionsActions } from '../features/collections/useCollectionsActions';
import { useFileImport } from './useFileImport';
import { useLibrarySync } from '../features/library/useLibrarySync';
import { usePlaybackActions } from '../features/playback/usePlaybackActions';
import { useWindowActions } from './useWindowActions';

const demoSong = {
  path: '/music/demo.flac',
  name: 'demo.flac',
  title: 'Demo',
  artist: 'Artist',
  artist_names: ['Artist'],
  effective_artist_names: ['Artist'],
  album: 'Album',
  album_artist: 'Artist',
  album_key: 'Album::Artist',
  is_various_artists_album: false,
  collapse_artist_credits: false,
  duration: 120,
} satisfies Song;

describe('player action hooks', () => {
  it('forwards playback and window actions to runtime services', async () => {
    const playSong = vi.fn();
    const nextSong = vi.fn();
    const toggleAlwaysOnTop = vi.fn();
    const toggleQueue = vi.fn();

    const playbackActions = usePlaybackActions({
      currentSong: ref(demoSong),
      playMode: ref(1),
      getPlayerPlayback: () => ({
        playSong,
        pauseSong: vi.fn(),
        togglePlay: vi.fn(),
        seekTo: vi.fn(),
        playAt: vi.fn(),
        handleSeek: vi.fn(),
        stepSeek: vi.fn(),
      }),
      getPlayerQueue: () => ({
        toggleMode: vi.fn(),
        playNext: vi.fn(),
        nextSong,
        prevSong: vi.fn(),
        clearQueue: vi.fn(),
        removeSongFromQueue: vi.fn(),
        addSongToQueue: vi.fn(),
        addSongsToQueue: vi.fn(),
        addSongPathsToQueue: vi.fn(),
      }),
      playerUiShell: {
        handleVolume: vi.fn(),
        handleVolumeWheel: vi.fn(),
        toggleMute: vi.fn(),
        togglePlaylist: vi.fn(),
        toggleMiniPlaylist: vi.fn(),
        closeMiniPlaylist: vi.fn(),
        handleScan: vi.fn(),
        removeSongFromList: vi.fn(),
      },
    });
    const windowActions = useWindowActions({
      playerUiShell: {
        toggleAlwaysOnTop,
        togglePlayerDetail: vi.fn(),
        toggleQueue,
      },
    });

    playbackActions.handleAutoNext();
    windowActions.toggleAlwaysOnTop(true);
    windowActions.toggleQueue();

    expect(playSong).toHaveBeenCalledWith(demoSong);
    expect(nextSong).not.toHaveBeenCalled();
    expect(toggleAlwaysOnTop).toHaveBeenCalledWith(true);
    expect(toggleQueue).toHaveBeenCalledTimes(1);
  });

  it('forwards collection, library, and import actions', () => {
    const createPlaylist = vi.fn();
    const scanLibrary = vi.fn();
    const addFoldersFromStructure = vi.fn();

    const collectionsActions = useCollectionsActions({
      playerPlaylist: {
        createPlaylist,
        deletePlaylist: vi.fn(),
        addToPlaylist: vi.fn(),
        removeFromPlaylist: vi.fn(),
        addSongsToPlaylist: vi.fn(),
        viewPlaylist: vi.fn(),
        getSongsFromPlaylist: vi.fn(() => []),
        openAddToPlaylistDialog: vi.fn(),
      },
      playerHistoryFavorites: {
        isFavorite: vi.fn(() => false),
        toggleFavorite: vi.fn(),
        addToHistory: vi.fn(),
        removeFromHistory: vi.fn(),
        clearHistory: vi.fn(),
        clearFavorites: vi.fn(),
      },
    });
    const librarySync = useLibrarySync({
      fetchLibraryFolders: vi.fn(),
      addLibraryFolder: vi.fn(),
      addLibraryFolderLinked: vi.fn(),
      removeLibraryFolder: vi.fn(),
      removeLibraryFolderLinked: vi.fn(),
      handleExternalPaths: vi.fn(),
      scanLibrary,
      addLibraryFolderPath: vi.fn(),
      refreshFolder: vi.fn(),
      refreshAllFolders: vi.fn(),
    });
    const fileImportActions = useFileImport({
      addFolder: vi.fn(),
      addFoldersFromStructure,
      getSongsInFolder: vi.fn(() => [demoSong]),
      clearLocalMusic: vi.fn(),
    });

    collectionsActions.createPlaylist('Daily Mix', [demoSong.path]);
    librarySync.scanLibrary();
    fileImportActions.addFoldersFromStructure();

    expect(createPlaylist).toHaveBeenCalledWith('Daily Mix', [demoSong.path]);
    expect(scanLibrary).toHaveBeenCalledTimes(1);
    expect(addFoldersFromStructure).toHaveBeenCalledTimes(1);
  });
});
