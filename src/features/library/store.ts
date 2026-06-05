import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';

import type {
  AlbumSortMode,
  AlbumDetailSortMode,
  ArtistSortMode,
  FolderSortMode,
  LocalSortMode,
} from '../../services/storage/playerStorage';
import type {
  AlbumCatalogItem,
  ArtistCatalogItem,
  FolderNode,
  LibraryFolder,
  LibrarySong,
  LibraryScanProgress,
  LibraryScanSession,
  Song,
} from '../../types';

const areSamePaths = (left: string[], right: string[]) =>
  left.length === right.length && left.every((path, index) => path === right[index]);

const resolveSharedPaths = (paths: string[], existing: string[], sibling: string[]) => {
  if (areSamePaths(existing, paths)) {
    return existing;
  }

  if (areSamePaths(sibling, paths)) {
    return sibling;
  }

  return paths;
};

export const useLibraryStore = defineStore('library', () => {
  const songPool = new Map<string, LibrarySong>();
  const songCatalogVersion = ref(0);
  const libraryDataVersion = ref(0);
  const stringPool = new Map<string, string>();
  const arrayPool = new Map<string, string[]>();
  const rebuildInternPools = () => {
    const nextStringPool = new Map<string, string>();
    const nextArrayPool = new Map<string, string[]>();

    const registerString = (value: string | undefined) => {
      if (!value) {
        return value;
      }

      const existing = nextStringPool.get(value);
      if (existing) {
        return existing;
      }

      nextStringPool.set(value, value);
      return value;
    };

    const registerStringArray = (values: string[] = []) => {
      if (values.length === 0) {
        return [];
      }

      const normalized = values.map(value => registerString(value) ?? '');
      const key = normalized.join('\u0001');
      const existing = nextArrayPool.get(key);
      if (existing) {
        return existing;
      }

      nextArrayPool.set(key, normalized);
      return normalized;
    };

    for (const song of songPool.values()) {
      song.name = registerString(song.name) ?? '';
      song.title = registerString(song.title);
      song.path = registerString(song.path) ?? '';
      song.artist = registerString(song.artist) ?? '';
      song.artist_names = registerStringArray(song.artist_names);
      song.effective_artist_names = registerStringArray(song.effective_artist_names);
      song.album = registerString(song.album) ?? '';
      song.album_artist = registerString(song.album_artist) ?? '';
      song.album_key = registerString(song.album_key) ?? '';
      song.track_number = registerString(song.track_number);
      song.disc_number = registerString(song.disc_number);
      song.format = registerString(song.format);
    }

    stringPool.clear();
    nextStringPool.forEach((value, key) => {
      stringPool.set(key, value);
    });

    arrayPool.clear();
    nextArrayPool.forEach((value, key) => {
      arrayPool.set(key, value);
    });
  };

  const songKeys: Array<keyof LibrarySong> = [
    'id',
    'name',
    'title',
    'path',
    'comment',
    'artist',
    'artist_names',
    'effective_artist_names',
    'album',
    'album_artist',
    'album_key',
    'track_number',
    'disc_number',
    'is_various_artists_album',
    'collapse_artist_credits',
    'duration',
    'bitrate',
    'sample_rate',
    'bit_depth',
    'format',
    'added_at',
    'file_modified_at',
  ];

  const canonicalSongPaths = shallowRef<string[]>([]);
  const sourceSongPaths = shallowRef<string[]>([]);
  const artistCatalog = shallowRef<ArtistCatalogItem[]>([]);
  const albumCatalog = shallowRef<AlbumCatalogItem[]>([]);

  const internString = (value: string | undefined) => {
    if (!value) {
      return value;
    }

    const existing = stringPool.get(value);
    if (existing) {
      return existing;
    }

    stringPool.set(value, value);
    return value;
  };

  const internStringArray = (values: string[] = []) => {
    if (values.length === 0) {
      return [];
    }

    const normalized = values.map(value => internString(value) ?? '');
    const key = normalized.join('\u0001');
    const existing = arrayPool.get(key);
    if (existing) {
      return existing;
    }

    arrayPool.set(key, normalized);
    return normalized;
  };

  const normalizeSongRecord = (song: LibrarySong): LibrarySong => ({
    ...song,
    name: internString(song.name) ?? '',
    title: internString(song.title),
    comment: internString(song.comment),
    path: internString(song.path) ?? '',
    artist: internString(song.artist) ?? '',
    artist_names: internStringArray(song.artist_names),
    effective_artist_names: internStringArray(song.effective_artist_names),
    album: internString(song.album) ?? '',
    album_artist: internString(song.album_artist) ?? '',
    album_key: internString(song.album_key) ?? '',
    track_number: internString(song.track_number),
    disc_number: internString(song.disc_number),
    format: internString(song.format),
  });

  const syncSongRecord = (target: LibrarySong, source: LibrarySong) => {
    let changed = false;

    songKeys.forEach((key) => {
      const nextValue = source[key];
      const normalizedValue = Array.isArray(nextValue)
        ? internStringArray(nextValue)
        : typeof nextValue === 'string'
          ? internString(nextValue)
          : nextValue;
      const prevValue = target[key];

      const isSameArray = Array.isArray(prevValue)
        && Array.isArray(normalizedValue)
        && prevValue.length === normalizedValue.length
        && prevValue.every((item, index) => item === normalizedValue[index]);

      if (prevValue === normalizedValue || isSameArray) {
        return;
      }

      (target as Record<keyof LibrarySong, unknown>)[key] = normalizedValue;
      changed = true;
    });

    return changed;
  };

  const internSong = (song: LibrarySong) => {
    const path = song?.path;
    if (!path) {
      return { song, changed: false };
    }

    const existing = songPool.get(path);
    if (!existing) {
      songPool.set(path, normalizeSongRecord(song));
      return { song: songPool.get(path) as LibrarySong, changed: true };
    }

    return {
      song: existing,
      changed: syncSongRecord(existing, normalizeSongRecord(song)),
    };
  };

  const normalizeSongCollection = (songs: LibrarySong[]) => {
    const startTime = import.meta.env.DEV ? performance.now() : 0;
    const nextPaths: string[] = [];
    const seenPaths = new Set<string>();
    let changed = false;

    songs.forEach((song) => {
      if (!song?.path || seenPaths.has(song.path)) {
        return;
      }

      seenPaths.add(song.path);
      nextPaths.push(song.path);

      const interned = internSong(song);
      if (interned.changed) {
        changed = true;
      }
    });

    if (import.meta.env.DEV) {
      const duration = performance.now() - startTime;
      console.log(`[Profiling] normalizeSongCollection took ${duration.toFixed(2)}ms (input songs: ${songs.length}, changed: ${changed})`);
    }

    return { paths: nextPaths, changed };
  };

  const pruneSongPool = () => {
    const referencedPaths = new Set<string>([
      ...canonicalSongPaths.value,
      ...sourceSongPaths.value,
    ]);

    let removed = false;
    for (const path of songPool.keys()) {
      if (!referencedPaths.has(path)) {
        songPool.delete(path);
        removed = true;
      }
    }

    if (removed) {
      rebuildInternPools();
      songCatalogVersion.value += 1;
    }
  };

  const materializeSongs = (paths: string[]) => {
    songCatalogVersion.value;
    return paths
      .map(path => songPool.get(path))
      .filter((song): song is LibrarySong => !!song);
  };

  const updateCanonicalSongPaths = (paths: string[], didChangeSongPool = false) => {
    const nextPaths = resolveSharedPaths(paths, canonicalSongPaths.value, sourceSongPaths.value);
    const didChangePaths = canonicalSongPaths.value !== nextPaths;
    if (didChangePaths) {
      canonicalSongPaths.value = nextPaths;
    }

    if (didChangeSongPool) {
      songCatalogVersion.value += 1;
    }
    if (didChangePaths || didChangeSongPool) {
      libraryDataVersion.value += 1;
    }

    pruneSongPool();
  };

  const updateSourceSongPaths = (paths: string[], didChangeSongPool = false) => {
    const nextPaths = resolveSharedPaths(paths, sourceSongPaths.value, canonicalSongPaths.value);
    if (sourceSongPaths.value !== nextPaths) {
      sourceSongPaths.value = nextPaths;
    }

    if (didChangeSongPool) {
      songCatalogVersion.value += 1;
    }

    pruneSongPool();
  };

  const setCanonicalSongs = (songs: LibrarySong[]) => {
    const normalized = normalizeSongCollection(songs);
    updateCanonicalSongPaths(normalized.paths, normalized.changed);
  };

  const setSourceSongs = (songs: LibrarySong[]) => {
    const normalized = normalizeSongCollection(songs);
    updateSourceSongPaths(normalized.paths, normalized.changed);
  };

  const setSongRecord = (song: LibrarySong) => {
    const interned = internSong(song);
    if (interned.changed) {
      songCatalogVersion.value += 1;
    }
  };

  const getSongByPath = (path: string | null | undefined, fallback?: Song | null) => {
    if (!path) {
      return fallback ?? null;
    }

    return songPool.get(path) ?? fallback ?? null;
  };

  const resolveSongsByPaths = (paths: string[], fallbackSongs: Song[] = []) => {
    const fallbackLookup = new Map<string, Song>();
    fallbackSongs.forEach((song) => {
      if (song?.path && !fallbackLookup.has(song.path)) {
        fallbackLookup.set(song.path, song);
      }
    });

    return paths
      .map(path => getSongByPath(path, fallbackLookup.get(path)))
      .filter((song): song is Song => !!song);
  };

  const songLookup = computed(() => {
    songCatalogVersion.value;
    return songPool as Map<string, Song>;
  });

  const canonicalSongs = computed<Song[]>({
    get: () => materializeSongs(canonicalSongPaths.value),
    set: setCanonicalSongs,
  });

  const sourceSongs = computed<Song[]>({
    get: () => materializeSongs(sourceSongPaths.value),
    set: setSourceSongs,
  });

  const libraryFolders = ref<LibraryFolder[]>([]);
  const libraryHierarchy = ref<FolderNode[]>([]);
  const libraryScanProgress = ref<LibraryScanProgress | null>(null);
  const libraryScanSession = ref<LibraryScanSession | null>(null);
  const lastLibraryScanError = ref<string | null>(null);
  const watchedFolders = ref<string[]>([]);
  const artistSortMode = ref<ArtistSortMode>('name');
  const albumSortMode = ref<AlbumSortMode>('name');
  const albumDetailSortMode = ref<AlbumDetailSortMode>('track_number');
  const artistCustomOrder = ref<string[]>([]);
  const albumCustomOrder = ref<string[]>([]);
  const folderSortMode = ref<FolderSortMode>('title');
  const folderCustomOrder = ref<Record<string, string[]>>({});
  const localSortMode = ref<LocalSortMode>('title');
  const localCustomOrder = ref<string[]>([]);

  const setLibraryFolders = (folders: LibraryFolder[]) => {
    libraryFolders.value = folders;
  };

  const setLibraryHierarchy = (tree: FolderNode[]) => {
    libraryHierarchy.value = tree;
  };

  const setArtistCatalog = (items: ArtistCatalogItem[]) => {
    artistCatalog.value = items;
  };

  const setAlbumCatalog = (items: AlbumCatalogItem[]) => {
    albumCatalog.value = items;
  };

  const setLibraryScanProgress = (progress: LibraryScanProgress | null) => {
    libraryScanProgress.value = progress;
  };

  const setLibraryScanSession = (session: LibraryScanSession | null) => {
    libraryScanSession.value = session;
  };

  const setLastLibraryScanError = (message: string | null) => {
    lastLibraryScanError.value = message;
  };

  const setWatchedFolders = (paths: string[]) => {
    watchedFolders.value = paths;
  };

  const reorderWatchedFolders = (from: number, to: number) => {
    const list = [...watchedFolders.value];
    const [removed] = list.splice(from, 1);
    if (!removed) {
      return;
    }

    list.splice(to, 0, removed);
    watchedFolders.value = list;
  };

  const patchLibrarySongs = (payload: { songs: LibrarySong[]; deleted_paths: string[] }) => {
    const startTime = import.meta.env.DEV ? performance.now() : 0;
    const incomingSongs = payload.songs ?? [];
    const incomingDeleted = payload.deleted_paths ?? [];

    if (incomingSongs.length === 0 && incomingDeleted.length === 0) {
      return;
    }

    let didChange = false;

    // 1. 处理删除：直接在路径数组和 Map 中局部剔除，不引发全量重建
    if (incomingDeleted.length > 0) {
      const deletedSet = new Set(incomingDeleted);
      const nextCanonical = canonicalSongPaths.value.filter(path => !deletedSet.has(path));
      if (nextCanonical.length !== canonicalSongPaths.value.length) {
        canonicalSongPaths.value = nextCanonical;
        didChange = true;
      }

      const nextSource = sourceSongPaths.value.filter(path => !deletedSet.has(path));
      if (nextSource.length !== sourceSongPaths.value.length) {
        sourceSongPaths.value = nextSource;
        didChange = true;
      }

      incomingDeleted.forEach((path) => {
        if (songPool.delete(path)) {
          didChange = true;
        }
      });
    }

    // 2. 处理新增或局部更新（原地更新以保留外部播放引用）
    if (incomingSongs.length > 0) {
      const addedPaths: string[] = [];

      incomingSongs.forEach((song) => {
        if (!song?.path) {
          return;
        }

        const path = song.path;
        const existing = songPool.has(path);

        // 原地同步或新增
        const interned = internSong(song);
        if (interned.changed) {
          didChange = true;
        }

        if (!existing) {
          addedPaths.push(path);
        }
      });

      if (addedPaths.length > 0) {
        canonicalSongPaths.value = [...canonicalSongPaths.value, ...addedPaths];
        sourceSongPaths.value = [...sourceSongPaths.value, ...addedPaths];
        didChange = true;
      }
    }

    if (didChange) {
      songCatalogVersion.value += 1;
      libraryDataVersion.value += 1;
    }

    if (import.meta.env.DEV) {
      const duration = performance.now() - startTime;
      console.log(`[Profiling] patchLibrarySongs took ${duration.toFixed(2)}ms (added/updated payload: ${incomingSongs.length}, deleted: ${incomingDeleted.length})`);
    }
  };

  const setCanonicalSongOrder = (paths: string[]) => {
    const startTime = import.meta.env.DEV ? performance.now() : 0;
    if (!Array.isArray(paths)) {
      return;
    }

    // 安全边界：只接收已在前端缓存的路径项，排掉空洞风险项
    const validPaths = paths.filter(path => songPool.has(path));

    if (areSamePaths(canonicalSongPaths.value, validPaths)) {
      return;
    }

    canonicalSongPaths.value = validPaths;
    songCatalogVersion.value += 1;
    libraryDataVersion.value += 1;

    if (import.meta.env.DEV) {
      const duration = performance.now() - startTime;
      console.log(`[Profiling] setCanonicalSongOrder took ${duration.toFixed(2)}ms (input order paths: ${paths.length}, filtered valid: ${validPaths.length})`);
    }
  };

  return {
    libraryDataVersion,
    canonicalSongs,
    canonicalSongPaths,
    sourceSongs,
    sourceSongPaths,
    songLookup,
    getSongByPath,
    resolveSongsByPaths,
    setSongRecord,
    libraryFolders,
    libraryHierarchy,
    artistCatalog,
    albumCatalog,
    songList: sourceSongs,
    librarySongs: canonicalSongs,
    folderTree: libraryHierarchy,
    libraryScanProgress,
    libraryScanSession,
    lastLibraryScanError,
    watchedFolders,
    artistSortMode,
    albumSortMode,
    albumDetailSortMode,
    artistCustomOrder,
    albumCustomOrder,
    folderSortMode,
    folderCustomOrder,
    localSortMode,
    localCustomOrder,
    setSourceSongs,
    setCanonicalSongs,
    setLibraryFolders,
    setLibraryHierarchy,
    setArtistCatalog,
    setAlbumCatalog,
    setSongList: setSourceSongs,
    setLibrarySongs: setCanonicalSongs,
    setFolderTree: setLibraryHierarchy,
    setLibraryScanProgress,
    setLibraryScanSession,
    setLastLibraryScanError,
    setWatchedFolders,
    reorderWatchedFolders,
    patchLibrarySongs,
    setCanonicalSongOrder,
  };
});
