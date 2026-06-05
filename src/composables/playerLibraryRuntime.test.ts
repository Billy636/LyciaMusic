import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { Song } from '../types';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('./useLibraryAllSongPathCache', () => ({
  useLibraryAllSongPathCache: () => ({
    clearLibraryAllSongPathCache: vi.fn(),
  }),
}));

vi.mock('./useLibraryCollectionSongPathCache', () => ({
  useLibraryCollectionSongPathCache: () => ({
    clearLibraryCollectionSongPathCache: vi.fn(),
  }),
}));

vi.mock('./useLibraryDetailSongPathCache', () => ({
  useLibraryDetailSongPathCache: () => ({
    clearLibraryDetailSongPathCache: vi.fn(),
  }),
}));

vi.mock('./useLibraryFolderSongPathCache', () => ({
  useLibraryFolderSongPathCache: () => ({
    clearLibraryFolderSongPathCache: vi.fn(),
  }),
}));

const makeSong = (overrides: Partial<Song> = {}): Song => ({
  path: 'C:\\Music\\stale.flac',
  name: 'stale.flac',
  title: 'Stale',
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

describe('playerLibraryRuntime.scanLibrary', () => {
  beforeEach(() => {
    vi.resetModules();
    invokeMock.mockReset();
    setActivePinia(createPinia());
  });

  it('queues a follow-up scan when a manual refresh arrives during an active scan', async () => {
    const { useLibraryStore } = await import('../features/library/store');
    const { createPlayerLibraryRuntime } = await import('./playerLibraryRuntime');

    const libraryStore = useLibraryStore();
    libraryStore.setLibraryFolders([
      {
        path: 'C:\\Music',
        song_count: 1,
      },
    ]);

    let releaseFirstScan!: () => void;
    const firstScanGate = new Promise<void>((resolve) => {
      releaseFirstScan = resolve;
    });

    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'scan_library') {
        const scanCallCount = invokeMock.mock.calls.filter(([name]) => name === 'scan_library').length;
        if (scanCallCount === 1) {
          await firstScanGate;
          return [
            {
              path: 'C:\\Music\\stale.flac',
              name: 'stale.flac',
              title: 'Stale',
              artist: 'Artist',
              artist_names: ['Artist'],
              effective_artist_names: ['Artist'],
              album: 'Album',
              album_artist: 'Artist',
              album_key: 'album::artist',
              is_various_artists_album: false,
              collapse_artist_credits: false,
              duration: 180,
            },
          ];
        }

        return [
          {
            path: 'C:\\Music\\fresh.flac',
            name: 'fresh.flac',
            title: 'Fresh',
            artist: 'Artist',
            artist_names: ['Artist'],
            effective_artist_names: ['Artist'],
            album: 'Album',
            album_artist: 'Artist',
            album_key: 'album::artist',
            is_various_artists_album: false,
            collapse_artist_credits: false,
            duration: 180,
          },
        ];
      }

      if (command === 'get_library_artist_catalog' || command === 'get_library_album_catalog') {
        return [];
      }

      return [];
    });

    const runtime = createPlayerLibraryRuntime({
      fetchLibraryFolders: vi.fn(async () => {}),
      fetchFolderTree: vi.fn(async () => {}),
      flushBufferedLibraryScanBatch: vi.fn(),
      refreshStateSongReferences: vi.fn(),
      finalizeLibraryScanProgress: vi.fn(),
      onSilentScanError: vi.fn(),
    });

    const firstScanPromise = runtime.scanLibrary({ trigger: 'bootstrap', visibility: 'silent' });
    const manualRefreshPromise = runtime.scanLibrary({ trigger: 'manual-rescan', visibility: 'inline' });

    expect(invokeMock.mock.calls.filter(([name]) => name === 'scan_library')).toHaveLength(1);

    releaseFirstScan();

    await Promise.all([firstScanPromise, manualRefreshPromise]);

    expect(invokeMock.mock.calls.filter(([name]) => name === 'scan_library')).toHaveLength(2);
    expect(libraryStore.librarySongs.map(song => song.path)).toEqual(['C:\\Music\\fresh.flac']);
  });

  it('clears in-memory library songs when the last library folder has been removed', async () => {
    const { useLibraryStore } = await import('../features/library/store');
    const { createPlayerLibraryRuntime } = await import('./playerLibraryRuntime');

    const libraryStore = useLibraryStore();
    const staleSong = makeSong();
    libraryStore.setLibrarySongs([staleSong]);
    libraryStore.setSourceSongs([staleSong]);
    libraryStore.setLibraryFolders([]);
    libraryStore.setLibraryHierarchy([
      {
        path: 'C:\\Music',
        name: 'Music',
        children: [],
        child_count: 0,
        children_loaded: true,
        song_count: 1,
        cover_song_path: staleSong.path,
        is_expanded: false,
      },
    ]);
    libraryStore.setArtistCatalog([{ name: 'Artist', count: 1, firstSongPath: staleSong.path }]);
    libraryStore.setAlbumCatalog([{ key: 'album::artist', name: 'Album', artist: 'Artist', count: 1, firstSongPath: staleSong.path }]);

    const refreshStateSongReferences = vi.fn();
    const runtime = createPlayerLibraryRuntime({
      fetchLibraryFolders: vi.fn(async () => {}),
      fetchFolderTree: vi.fn(async () => {}),
      flushBufferedLibraryScanBatch: vi.fn(),
      refreshStateSongReferences,
      finalizeLibraryScanProgress: vi.fn(),
      onSilentScanError: vi.fn(),
    });

    await runtime.scanLibrary({ trigger: 'manual-rescan', visibility: 'inline' });

    expect(libraryStore.librarySongs).toEqual([]);
    expect(libraryStore.songList).toEqual([]);
    expect(libraryStore.folderTree).toEqual([]);
    expect(libraryStore.artistCatalog).toEqual([]);
    expect(libraryStore.albumCatalog).toEqual([]);
    expect(refreshStateSongReferences).toHaveBeenCalledWith([]);
    expect(invokeMock).not.toHaveBeenCalledWith('scan_library');
  });

  it('passes the configured short audio threshold to library scans', async () => {
    const { useLibraryStore } = await import('../features/library/store');
    const { useSettingsStore } = await import('../features/settings/store');
    const { createPlayerLibraryRuntime } = await import('./playerLibraryRuntime');

    const libraryStore = useLibraryStore();
    const settingsStore = useSettingsStore();
    libraryStore.setLibraryFolders([
      {
        path: 'C:\\Music',
        song_count: 1,
      },
    ]);
    settingsStore.patchSettings({
      libraryMinDurationSeconds: 9,
    });

    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'scan_library') {
        return [];
      }

      return [];
    });

    const runtime = createPlayerLibraryRuntime({
      fetchLibraryFolders: vi.fn(async () => {}),
      fetchFolderTree: vi.fn(async () => {}),
      flushBufferedLibraryScanBatch: vi.fn(),
      refreshStateSongReferences: vi.fn(),
      finalizeLibraryScanProgress: vi.fn(),
      onSilentScanError: vi.fn(),
    });

    await runtime.scanLibrary({ trigger: 'manual-rescan', visibility: 'inline' });

    expect(invokeMock).toHaveBeenCalledWith('scan_library', {
      minimumDurationSeconds: 9,
    });
  });
});
