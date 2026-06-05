import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
import { useLibraryStore } from './store';

import {
  isStaleLibraryPathRequestError,
  useLibraryAllSongPathCache,
} from '../../composables/useLibraryAllSongPathCache';
import { useLibraryCollectionSongPathCache } from '../../composables/useLibraryCollectionSongPathCache';
import { useLibraryDetailSongPathCache } from '../../composables/useLibraryDetailSongPathCache';
import { useLibraryFolderSongPathCache } from '../../composables/useLibraryFolderSongPathCache';
import type { AlbumDetailSortMode, FolderSortMode, LocalSortMode, PlaylistSortMode } from '../../services/storage/playerStorage';
import type { HistoryItem, Playlist, Song } from '../../types';
import { sortItemsByAlphabetIndex } from '../../utils/alphabetIndex';
import {
  getSongArtistSearchText,
  getSongFileNameLabel,
  getSongTitleLabel,
  matchesAlbumKey,
  songHasArtist,
} from './playerLibraryViewShared';

interface UseLibraryCurrentViewSongsOptions {
  canonicalSongPaths: Ref<string[]>;
  playlists: Ref<Playlist[]>;
  recentSongs: Ref<HistoryItem[]>;
  songLookup: ComputedRef<Map<string, Song>>;
  favoriteSongPaths: ComputedRef<string[]>;
  currentFolderSongPaths: ComputedRef<string[]>;
  currentViewMode: Ref<string>;
  searchQuery: Ref<string>;
  localMusicTab: Ref<'default' | 'artist' | 'album'>;
  currentArtistFilter: Ref<string>;
  currentAlbumFilter: Ref<string>;
  currentFolderFilter: Ref<string>;
  filterCondition: Ref<string>;
  favTab: Ref<'songs' | 'artists' | 'albums'>;
  favDetailFilter: Ref<{ type: 'artist' | 'album'; name: string } | null>;
  folderSortMode: Ref<FolderSortMode>;
  localSortMode: Ref<LocalSortMode>;
  albumDetailSortMode: Ref<AlbumDetailSortMode>;
  localCustomOrder: Ref<string[]>;
  playlistSortMode: Ref<PlaylistSortMode>;
}

export function useLibraryCurrentViewSongs({
  canonicalSongPaths,
  playlists,
  recentSongs,
  songLookup,
  favoriteSongPaths,
  currentFolderSongPaths,
  currentViewMode,
  searchQuery,
  localMusicTab,
  currentArtistFilter,
  currentAlbumFilter,
  currentFolderFilter,
  filterCondition,
  favTab,
  favDetailFilter,
  folderSortMode,
  localSortMode,
  albumDetailSortMode,
  localCustomOrder,
  playlistSortMode,
}: UseLibraryCurrentViewSongsOptions) {
  const libraryStore = useLibraryStore();

  const allViewLoading = ref(false);
  const allViewUseCanonicalFallback = ref(false);
  const lastSuccessfulAllViewSongPaths = ref<string[]>([]);
  const currentQueryKey = ref('');

  const { loadAllViewSongPaths } = useLibraryAllSongPathCache();
  const { loadFavoriteSongPaths, loadRecentSongPaths } = useLibraryCollectionSongPathCache();
  const { loadArtistSongPaths, loadAlbumSongPaths } = useLibraryDetailSongPathCache();
  const { loadFolderViewSongPaths } = useLibraryFolderSongPathCache();
  const allViewSongPaths = ref<string[]>([]);
  const favoriteViewSongPaths = ref<string[]>([]);
  const recentViewSongPaths = ref<string[]>([]);
  const folderViewSongPaths = ref<string[]>([]);
  const localArtistFilterPaths = ref<string[]>([]);
  const localAlbumFilterPaths = ref<string[]>([]);
  const detailViewSongPaths = ref<string[]>([]);
  let allViewRequestId = 0;
  let favoriteViewRequestId = 0;
  let recentViewRequestId = 0;
  let folderViewRequestId = 0;
  let localArtistRequestId = 0;
  let localAlbumRequestId = 0;
  let detailViewRequestId = 0;

  const resolveRecentSongPaths = () =>
    recentSongs.value
      .map(item => item.path)
      .filter(path => songLookup.value.has(path));

  watch(
    [
      currentViewMode,
      searchQuery,
      localMusicTab,
      currentArtistFilter,
      currentAlbumFilter,
      localSortMode,
      canonicalSongPaths,
    ],
    async ([viewMode, query, musicTab, artistFilter, albumFilter, sortMode]) => {
      const requestId = ++allViewRequestId;

      if (viewMode !== 'all' || sortMode === 'custom') {
        allViewSongPaths.value = [];
        return;
      }

      const nextQueryKey = `${musicTab}\u0001${artistFilter}\u0001${albumFilter}\u0001${sortMode}\u0001${query}`;
      const isQueryKeyChanged = currentQueryKey.value !== nextQueryKey;
      currentQueryKey.value = nextQueryKey;

      // 如果过滤/查询条件变了，立即清空上一次结果，防旧数据筛选错乱
      if (isQueryKeyChanged) {
        allViewSongPaths.value = [];
        allViewUseCanonicalFallback.value = false;
        lastSuccessfulAllViewSongPaths.value = [];
      }

      allViewLoading.value = true;

      // 扫描导入版本风暴控制：若正处于扫描中且已有旧成功数据，为防 batch 频繁失效风暴，延迟加载并使用旧列表做过渡渲染
      const isScanning = !!libraryStore.libraryScanProgress && !libraryStore.libraryScanProgress.done;
      if (isScanning && lastSuccessfulAllViewSongPaths.value.length > 0) {
        allViewLoading.value = false;
        return;
      }

      const loadCurrentAllViewPaths = () => loadAllViewSongPaths({
        query,
        artistFilter: musicTab === 'artist' ? artistFilter : '',
        albumFilter: musicTab === 'album' ? albumFilter : '',
        sortMode,
      });

      try {
        const paths = await loadCurrentAllViewPaths();

        if (requestId !== allViewRequestId) {
          return;
        }

        allViewSongPaths.value = paths;
        allViewUseCanonicalFallback.value = false;
        lastSuccessfulAllViewSongPaths.value = paths; // 缓存成功列表
      } catch (error) {
        if (requestId !== allViewRequestId) {
          return;
        }
        if (isStaleLibraryPathRequestError(error)) {
          allViewUseCanonicalFallback.value = true;
          try {
            const paths = await loadCurrentAllViewPaths();
            if (requestId !== allViewRequestId) {
              return;
            }
            allViewSongPaths.value = paths;
            allViewUseCanonicalFallback.value = false;
            lastSuccessfulAllViewSongPaths.value = paths;
          } catch (retryError) {
            if (!isStaleLibraryPathRequestError(retryError)) {
              allViewSongPaths.value = [];
              allViewUseCanonicalFallback.value = false;
            }
          }
          return;
        }
        allViewUseCanonicalFallback.value = false;
        allViewSongPaths.value = [];
      } finally {
        if (requestId === allViewRequestId) {
          allViewLoading.value = false;
        }
      }
    },
    { immediate: true },
  );

  watch(
    [
      currentViewMode,
      favoriteSongPaths,
      searchQuery,
      favTab,
      favDetailFilter,
      localSortMode,
      canonicalSongPaths,
    ],
    async ([viewMode, paths, query, currentFavTab, detailFilter, sortMode]) => {
      const requestId = ++favoriteViewRequestId;

      if (viewMode !== 'favorites' || sortMode === 'custom') {
        favoriteViewSongPaths.value = [];
        return;
      }

      const effectiveDetailFilter = currentFavTab === 'songs' ? null : detailFilter;
      if (paths.length === 0 || (currentFavTab !== 'songs' && !effectiveDetailFilter)) {
        favoriteViewSongPaths.value = [];
        return;
      }

      try {
        const resolvedDetailFilter = currentFavTab === 'songs'
          ? null
          : effectiveDetailFilter?.type === 'album'
            ? { type: 'album' as const, name: effectiveDetailFilter.name }
            : { type: 'artist' as const, name: effectiveDetailFilter!.name };

        const nextPaths = await loadFavoriteSongPaths({
          favoritePaths: paths,
          query,
          sortMode,
          detailFilter: resolvedDetailFilter,
        });

        if (requestId !== favoriteViewRequestId) {
          return;
        }

        favoriteViewSongPaths.value = nextPaths;
      } catch {
        if (requestId !== favoriteViewRequestId) {
          return;
        }

        favoriteViewSongPaths.value = [];
      }
    },
    { deep: true, immediate: true },
  );

  watch(
    [
      currentViewMode,
      recentSongs,
      searchQuery,
      localSortMode,
      canonicalSongPaths,
    ],
    async ([viewMode, items, query, sortMode]) => {
      const requestId = ++recentViewRequestId;

      if (viewMode !== 'recent' || sortMode === 'custom') {
        recentViewSongPaths.value = [];
        return;
      }

      if (items.length === 0) {
        recentViewSongPaths.value = [];
        return;
      }

      try {
        const nextPaths = await loadRecentSongPaths({
          recentSongs: items,
          query,
          sortMode,
        });

        if (requestId !== recentViewRequestId) {
          return;
        }

        recentViewSongPaths.value = nextPaths;
      } catch {
        if (requestId !== recentViewRequestId) {
          return;
        }

        recentViewSongPaths.value = [];
      }
    },
    { deep: true, immediate: true },
  );

  watch(
    [
      currentViewMode,
      currentFolderFilter,
      searchQuery,
      folderSortMode,
      currentFolderSongPaths,
    ],
    async ([viewMode, folderFilter, query, sortMode]) => {
      const requestId = ++folderViewRequestId;

      if (viewMode !== 'folder' || !folderFilter || sortMode === 'custom') {
        folderViewSongPaths.value = [];
        return;
      }

      try {
        const nextPaths = await loadFolderViewSongPaths({
          folderPath: folderFilter,
          query,
          sortMode,
        });

        if (requestId !== folderViewRequestId) {
          return;
        }

        folderViewSongPaths.value = nextPaths;
      } catch {
        if (requestId !== folderViewRequestId) {
          return;
        }

        folderViewSongPaths.value = [];
      }
    },
    { immediate: true },
  );

  watch(
    [
      currentViewMode,
      localMusicTab,
      currentArtistFilter,
      canonicalSongPaths,
    ],
    async ([viewMode, musicTab, artistFilter]) => {
      const requestId = ++localArtistRequestId;

      if (viewMode !== 'all' || musicTab !== 'artist' || !artistFilter) {
        localArtistFilterPaths.value = [];
        return;
      }

      try {
        const paths = await loadArtistSongPaths(artistFilter);
        if (requestId !== localArtistRequestId) {
          return;
        }

        localArtistFilterPaths.value = paths;
      } catch {
        if (requestId !== localArtistRequestId) {
          return;
        }

        localArtistFilterPaths.value = [];
      }
    },
    { immediate: true },
  );

  watch(
    [
      currentViewMode,
      localMusicTab,
      currentAlbumFilter,
      canonicalSongPaths,
    ],
    async ([viewMode, musicTab, albumFilter]) => {
      const requestId = ++localAlbumRequestId;

      if (viewMode !== 'all' || musicTab !== 'album' || !albumFilter) {
        localAlbumFilterPaths.value = [];
        return;
      }

      try {
        const paths = await loadAlbumSongPaths(albumFilter);
        if (requestId !== localAlbumRequestId) {
          return;
        }

        localAlbumFilterPaths.value = paths;
      } catch {
        if (requestId !== localAlbumRequestId) {
          return;
        }

        localAlbumFilterPaths.value = [];
      }
    },
    { immediate: true },
  );

  watch(
    [
      currentViewMode,
      filterCondition,
      canonicalSongPaths,
    ],
    async ([viewMode, filter]) => {
      const requestId = ++detailViewRequestId;

      if (!filter || (viewMode !== 'artist' && viewMode !== 'album')) {
        detailViewSongPaths.value = [];
        return;
      }

      try {
        const paths = viewMode === 'artist'
          ? await loadArtistSongPaths(filter)
          : await loadAlbumSongPaths(filter);

        if (requestId !== detailViewRequestId) {
          return;
        }

        detailViewSongPaths.value = paths;
      } catch {
        if (requestId !== detailViewRequestId) {
          return;
        }

        detailViewSongPaths.value = [];
      }
    },
    { immediate: true },
  );

  const materializeSongPaths = (paths: string[]) =>
    paths
      .map(path => songLookup.value.get(path))
      .filter((song): song is Song => !!song);

  const resolveFavoriteFallbackPaths = () => {
    if (favTab.value === 'songs') {
      return [...favoriteSongPaths.value];
    }

    if (favTab.value === 'artists') {
      return favDetailFilter.value?.type === 'artist'
        ? favoriteSongPaths.value.filter(path => songHasArtist(songLookup.value.get(path)!, favDetailFilter.value!.name))
        : [];
    }

    if (favTab.value === 'albums') {
      return favDetailFilter.value?.type === 'album'
        ? favoriteSongPaths.value.filter(path => matchesAlbumKey(songLookup.value.get(path)!, favDetailFilter.value!.name))
        : [];
    }

    return [...favoriteSongPaths.value];
  };

  const sortSongPathsByLocalMode = (paths: string[], mode: LocalSortMode) => {
    const sortedPaths = [...paths];

    if (mode === 'title') {
      sortedPaths.sort((left, right) =>
        (songLookup.value.get(left)?.title || songLookup.value.get(left)?.name || '').localeCompare(
          songLookup.value.get(right)?.title || songLookup.value.get(right)?.name || '',
          'zh-CN',
        ),
      );
    } else if (mode === 'artist') {
      sortedPaths.sort((left, right) =>
        (songLookup.value.get(left)?.artist || '').localeCompare(songLookup.value.get(right)?.artist || '', 'zh-CN'),
      );
    } else if (mode === 'added_at') {
      sortedPaths.sort((left, right) =>
        (songLookup.value.get(right)?.added_at || 0) - (songLookup.value.get(left)?.added_at || 0),
      );
    } else if (mode === 'added_at_asc') {
      sortedPaths.sort((left, right) =>
        (songLookup.value.get(left)?.added_at || 0) - (songLookup.value.get(right)?.added_at || 0),
      );
    } else if (mode === 'file_modified_at') {
      sortedPaths.sort((left, right) =>
        (songLookup.value.get(right)?.file_modified_at || 0) - (songLookup.value.get(left)?.file_modified_at || 0),
      );
    } else if (mode === 'file_modified_at_asc') {
      sortedPaths.sort((left, right) =>
        (songLookup.value.get(left)?.file_modified_at || 0) - (songLookup.value.get(right)?.file_modified_at || 0),
      );
    }

    return sortedPaths;
  };

  const parseSortIndexValue = (value?: string) => {
    if (!value) {
      return null;
    }

    const match = value.trim().match(/\d+/);
    if (!match) {
      return null;
    }

    const parsed = Number.parseInt(match[0], 10);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const compareSongLabel = (left: string, right: string) =>
    getSongTitleLabel(songLookup.value.get(left)!).localeCompare(
      getSongTitleLabel(songLookup.value.get(right)!),
      'zh-CN',
    );

  const sortSongPathsByAlbumDetailMode = (paths: string[], mode: AlbumDetailSortMode) => {
    if (mode !== 'track_number' && mode !== 'track_number_desc') {
      return sortSongPathsByLocalMode(paths, mode as LocalSortMode);
    }

    const sortedPaths = [...paths];
    sortedPaths.sort((left, right) => {
      const leftSong = songLookup.value.get(left);
      const rightSong = songLookup.value.get(right);
      const leftDisc = parseSortIndexValue(leftSong?.disc_number);
      const rightDisc = parseSortIndexValue(rightSong?.disc_number);
      let result = 0;

      if (leftDisc === null && rightDisc !== null) {
        result = 1;
      } else if (leftDisc !== null && rightDisc === null) {
        result = -1;
      } else if (leftDisc !== null && rightDisc !== null && leftDisc !== rightDisc) {
        result = leftDisc - rightDisc;
      }

      if (result === 0) {
        const leftTrack = parseSortIndexValue(leftSong?.track_number);
        const rightTrack = parseSortIndexValue(rightSong?.track_number);

        if (leftTrack === null && rightTrack !== null) {
          result = 1;
        } else if (leftTrack !== null && rightTrack === null) {
          result = -1;
        } else if (leftTrack !== null && rightTrack !== null && leftTrack !== rightTrack) {
          result = leftTrack - rightTrack;
        }
      }

      if (result === 0) {
        result = compareSongLabel(left, right) || left.localeCompare(right, 'zh-CN');
      }

      return mode === 'track_number_desc' ? -result : result;
    });

    return sortedPaths;
  };

  const currentViewSongPaths = computed(() => {
    if (searchQuery.value.trim()) {
      const query = searchQuery.value.toLowerCase();

      if (currentViewMode.value === 'all' && localSortMode.value !== 'custom') {
        if (localSortMode.value === 'title') {
          return sortItemsByAlphabetIndex(
            allViewSongPaths.value,
            (path) => getSongTitleLabel(songLookup.value.get(path)!),
          );
        }
        return allViewSongPaths.value;
      }

      const matchesQuery = (path: string) => {
        const song = songLookup.value.get(path);
        if (!song) {
          return false;
        }

        return song.name.toLowerCase().includes(query)
          || getSongArtistSearchText(song).includes(query)
          || song.album.toLowerCase().includes(query);
      };

      if (currentViewMode.value === 'favorites') {
        if (localSortMode.value !== 'custom') {
          return favoriteViewSongPaths.value;
        }

        return resolveFavoriteFallbackPaths().filter(matchesQuery);
      }

      if (currentViewMode.value === 'recent') {
        if (localSortMode.value !== 'custom') {
          return recentViewSongPaths.value;
        }

        return resolveRecentSongPaths().filter(matchesQuery);
      }

      if (currentViewMode.value === 'all') {
        if (localSortMode.value !== 'custom') {
          return allViewSongPaths.value;
        }

        return sortItemsByAlphabetIndex(
          canonicalSongPaths.value.filter(matchesQuery),
          (path) => getSongTitleLabel(songLookup.value.get(path)!),
        );
      }

      if (currentViewMode.value === 'folder') {
        if (folderSortMode.value !== 'custom') {
          if (folderSortMode.value === 'name') {
            return sortItemsByAlphabetIndex(
              folderViewSongPaths.value,
              (path) => getSongFileNameLabel(songLookup.value.get(path)!),
            );
          }
          if (folderSortMode.value === 'title') {
            return sortItemsByAlphabetIndex(
              folderViewSongPaths.value,
              (path) => getSongTitleLabel(songLookup.value.get(path)!),
            );
          }
          return folderViewSongPaths.value;
        }

        return sortItemsByAlphabetIndex(currentFolderSongPaths.value.filter(matchesQuery), (path) =>
          getSongTitleLabel(songLookup.value.get(path)!),
        );
      }

      if (currentViewMode.value === 'artist') {
        const filteredPaths = detailViewSongPaths.value.filter(matchesQuery);
        return localSortMode.value === 'custom'
          ? filteredPaths
          : sortSongPathsByLocalMode(filteredPaths, localSortMode.value);
      }

      if (currentViewMode.value === 'album') {
        return sortSongPathsByAlbumDetailMode(
          detailViewSongPaths.value.filter(matchesQuery),
          albumDetailSortMode.value,
        );
      }

      return canonicalSongPaths.value.filter(matchesQuery);
    }

    if (currentViewMode.value === 'all') {
      if (localSortMode.value !== 'custom') {
        let pathsToRender = allViewSongPaths.value;
        const isCurrentlyEmpty = allViewSongPaths.value.length === 0;

        if (isCurrentlyEmpty) {
          if (lastSuccessfulAllViewSongPaths.value.length > 0) {
            // 1. 优先展示上一次渲染成功的结果，实现毫秒级快速切回过渡
            pathsToRender = lastSuccessfulAllViewSongPaths.value;
          } else if (allViewLoading.value || allViewUseCanonicalFallback.value) {
            // 2. 首次导入空档期且正在加载中：以常驻内存 canonicalSongPaths 辅以本地简排做临时兜底，根除空白
            pathsToRender = sortSongPathsByLocalMode(canonicalSongPaths.value, localSortMode.value);
          }
        }
        pathsToRender = pathsToRender.filter(path => songLookup.value.has(path));

        if (localSortMode.value === 'title') {
          return sortItemsByAlphabetIndex(
            pathsToRender,
            (path) => getSongTitleLabel(songLookup.value.get(path)!),
          );
        }
        return pathsToRender;
      }

      let base = [...canonicalSongPaths.value];
      if (localMusicTab.value === 'artist' && currentArtistFilter.value) {
        base = [...localArtistFilterPaths.value];
      } else if (localMusicTab.value === 'album' && currentAlbumFilter.value) {
        base = [...localAlbumFilterPaths.value];
      }

      const orderMap = new Map(localCustomOrder.value.map((path, index) => [path, index]));
      base.sort((left, right) => {
        const leftIndex = orderMap.has(left) ? orderMap.get(left)! : Number.MAX_SAFE_INTEGER;
        const rightIndex = orderMap.has(right) ? orderMap.get(right)! : Number.MAX_SAFE_INTEGER;
        return leftIndex - rightIndex;
      });

      return base;
    }

    if (currentViewMode.value === 'folder') {
      if (folderSortMode.value !== 'custom') {
        if (folderSortMode.value === 'name') {
          return sortItemsByAlphabetIndex(
            folderViewSongPaths.value,
            (path) => getSongFileNameLabel(songLookup.value.get(path)!),
          );
        }
        if (folderSortMode.value === 'title') {
          return sortItemsByAlphabetIndex(
            folderViewSongPaths.value,
            (path) => getSongTitleLabel(songLookup.value.get(path)!),
          );
        }
        return folderViewSongPaths.value;
      }

      return currentFolderSongPaths.value;
    }

    if (currentViewMode.value === 'artist') {
      return localSortMode.value === 'custom'
        ? detailViewSongPaths.value
        : sortSongPathsByLocalMode(detailViewSongPaths.value, localSortMode.value);
    }

    if (currentViewMode.value === 'album') {
      return sortSongPathsByAlbumDetailMode(detailViewSongPaths.value, albumDetailSortMode.value);
    }

    if (currentViewMode.value === 'recent') {
      if (localSortMode.value !== 'custom') {
        return recentViewSongPaths.value;
      }

      return sortSongPathsByLocalMode(resolveRecentSongPaths(), localSortMode.value);
    }

    if (currentViewMode.value === 'favorites') {
      if (localSortMode.value !== 'custom') {
        return favoriteViewSongPaths.value;
      }

      const paths = resolveFavoriteFallbackPaths();
      return sortSongPathsByLocalMode(paths, localSortMode.value);
    }

    if (currentViewMode.value === 'playlist') {
      const playlist = playlists.value.find(item => item.id === filterCondition.value);
      if (!playlist) {
        return [];
      }

      const paths = playlist.songPaths.filter(path => songLookup.value.has(path));

      if (playlistSortMode.value === 'title') {
        paths.sort((left, right) =>
          (songLookup.value.get(left)?.title || songLookup.value.get(left)?.name || '').localeCompare(
            songLookup.value.get(right)?.title || songLookup.value.get(right)?.name || '',
            'zh-CN',
          ),
        );
      } else if (playlistSortMode.value === 'name') {
        paths.sort((left, right) =>
          (songLookup.value.get(left)?.name || '').localeCompare(songLookup.value.get(right)?.name || '', 'zh-CN'),
        );
      } else if (playlistSortMode.value === 'artist') {
        paths.sort((left, right) =>
          (songLookup.value.get(left)?.artist || '').localeCompare(songLookup.value.get(right)?.artist || '', 'zh-CN'),
        );
      } else if (playlistSortMode.value === 'added_at') {
        paths.sort((left, right) =>
          (songLookup.value.get(right)?.added_at || 0) - (songLookup.value.get(left)?.added_at || 0),
        );
      } else if (playlistSortMode.value === 'added_at_asc') {
        paths.sort((left, right) =>
          (songLookup.value.get(left)?.added_at || 0) - (songLookup.value.get(right)?.added_at || 0),
        );
      }

      return paths;
    }

    return [];
  });

  const currentViewSongs = computed(() => {
    canonicalSongPaths.value;
    return materializeSongPaths(currentViewSongPaths.value);
  });

  const currentViewSongCount = computed(() => currentViewSongs.value.length);

  return {
    currentViewSongPaths,
    currentViewSongCount,
    currentViewSongs,
  };
}
