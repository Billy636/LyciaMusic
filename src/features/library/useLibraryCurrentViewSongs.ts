import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
import { useLibraryStore } from './store';
import { storeToRefs } from 'pinia';
import { useNavigationStore } from '../../shared/stores/navigation';
import { tauriInvoke } from '../../services/tauri/invoke';

import {
  isStaleLibraryPathRequestError,
  useLibraryAllSongPathCache,
} from '../../composables/useLibraryAllSongPathCache';
import { useLibraryCollectionSongPathCache } from '../../composables/useLibraryCollectionSongPathCache';
import { useLibraryDetailSongPathCache } from '../../composables/useLibraryDetailSongPathCache';
import { useLibraryFolderSongPathCache } from '../../composables/useLibraryFolderSongPathCache';
import type { AlbumDetailSortMode, FolderSortMode, LocalSortMode, PlaylistSortMode } from '../../services/storage/playerStorage';
import type { HistoryItem, Playlist, Song } from '../../types';
import { isProfilingEnabled } from '../../utils/profiling';
import {
  compareSongPathsByTrackNumber,
  getSongArtistSearchText,
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
  debugOwnerId?: number;
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
  debugOwnerId = 0,
}: UseLibraryCurrentViewSongsOptions) {
  const libraryStore = useLibraryStore();
  const { searchRevision } = storeToRefs(useNavigationStore());

  const allViewLoading = ref(false);
  const allViewUseCanonicalFallback = ref(false);
  const lastSuccessfulAllViewSongPaths = ref<string[]>([]);
  const currentQueryKey = ref('');

  const { loadAllViewSongPaths } = useLibraryAllSongPathCache();
  const { loadFavoriteSongPaths, loadRecentSongPaths } = useLibraryCollectionSongPathCache();
  const { loadAlbumSongPaths } = useLibraryDetailSongPathCache();
  const { loadFolderViewSongPaths, libraryFolderSongPathCacheVersion } = useLibraryFolderSongPathCache();
  const allViewSongPaths = ref<string[]>([]);
  const allSearchTotal = ref(0);
  const allSearchLoadingMore = ref(false);
  const activeAllSearchKey = ref('');
  const favoriteViewSongPaths = ref<string[]>([]);
  const recentViewSongPaths = ref<string[]>([]);
  const folderViewSongPaths = ref<string[]>([]);
  const playlistViewSongPaths = ref<string[]>([]);
  const detailViewSongPaths = ref<string[]>([]);
  const favoriteSearchHasMore = ref(false);
  const recentSearchHasMore = ref(false);
  const folderSearchHasMore = ref(false);
  const playlistSearchHasMore = ref(false);
  const detailSearchHasMore = ref(false);
  const secondarySearchLoadingMore = ref(false);
  let allViewRequestId = 0;
  let favoriteViewRequestId = 0;
  let recentViewRequestId = 0;
  let folderViewRequestId = 0;
  let playlistViewRequestId = 0;
  let detailViewRequestId = 0;
  const canonicalPathSet = computed(() => new Set(canonicalSongPaths.value));

  watch(
    [
      currentViewMode,
      searchQuery,
      localMusicTab,
      currentArtistFilter,
      currentAlbumFilter,
      localSortMode,
      canonicalSongPaths,
      searchRevision,
    ],
    async ([viewMode, query, musicTab, artistFilter, albumFilter, sortMode]) => {
      const requestId = ++allViewRequestId;
      const profileStart = isProfilingEnabled() ? performance.now() : 0;

      if (isProfilingEnabled()) {
        console.log(
          `[Profiling] useLibraryCurrentViewSongs#${debugOwnerId} all-view watcher#${requestId} start (view: ${viewMode}, sort: ${sortMode}, query: ${query ? 'yes' : 'no'}, canonical paths: ${canonicalSongPaths.value.length})`,
        );
      }

      if (viewMode !== 'all') {
        allViewSongPaths.value = [];
        if (isProfilingEnabled()) {
          console.log(
            `[Profiling] useLibraryCurrentViewSongs#${debugOwnerId} all-view watcher#${requestId} skipped in ${(performance.now() - profileStart).toFixed(2)}ms`,
          );
        }
        return;
      }

      const isWaitingForBootstrapLibrary =
        canonicalSongPaths.value.length === 0 &&
        libraryStore.libraryDataVersion === 0;
      if (isWaitingForBootstrapLibrary) {
        allViewSongPaths.value = [];
        allViewLoading.value = false;
        if (isProfilingEnabled()) {
          console.log(
            `[Profiling] useLibraryCurrentViewSongs#${debugOwnerId} all-view watcher#${requestId} delayed initial path IPC in ${(performance.now() - profileStart).toFixed(2)}ms`,
          );
        }
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

      if (query.trim() && sortMode !== 'custom') {
        activeAllSearchKey.value = nextQueryKey;
        try {
          const page = await tauriInvoke('get_library_song_path_page_for_all_view', {
            query,
            artistFilter: musicTab === 'artist' ? artistFilter : '',
            albumFilter: musicTab === 'album' ? albumFilter : '',
            sortMode,
            offset: 0,
            limit: 256,
          });
          if (requestId === allViewRequestId && activeAllSearchKey.value === nextQueryKey) {
            allViewSongPaths.value = page.paths;
            allSearchTotal.value = page.total;
            lastSuccessfulAllViewSongPaths.value = page.paths;
          }
        } catch {
          if (requestId === allViewRequestId) {
            allViewSongPaths.value = [];
            allSearchTotal.value = 0;
          }
        } finally {
          if (requestId === allViewRequestId) {
            allViewLoading.value = false;
          }
        }
        return;
      }

      activeAllSearchKey.value = '';
      allSearchTotal.value = 0;

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
        sortMode: sortMode === 'custom' ? 'title' : sortMode,
      });

      try {
        const paths = await loadCurrentAllViewPaths();

        if (requestId !== allViewRequestId) {
          return;
        }

        allViewSongPaths.value = paths;
        allViewUseCanonicalFallback.value = false;
        lastSuccessfulAllViewSongPaths.value = paths; // 缓存成功列表
        if (isProfilingEnabled()) {
          console.log(
            `[Profiling] useLibraryCurrentViewSongs#${debugOwnerId} all-view watcher#${requestId} loaded paths in ${(performance.now() - profileStart).toFixed(2)}ms (paths: ${paths.length})`,
          );
        }
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
            if (isProfilingEnabled()) {
              console.log(
                `[Profiling] useLibraryCurrentViewSongs#${debugOwnerId} all-view watcher#${requestId} retry loaded paths in ${(performance.now() - profileStart).toFixed(2)}ms (paths: ${paths.length})`,
              );
            }
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
        if (isProfilingEnabled()) {
          console.log(
            `[Profiling] useLibraryCurrentViewSongs#${debugOwnerId} all-view watcher#${requestId} failed in ${(performance.now() - profileStart).toFixed(2)}ms`,
          );
        }
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
      searchRevision,
    ],
    async ([viewMode, paths, query, currentFavTab, detailFilter, sortMode]) => {
      const requestId = ++favoriteViewRequestId;

      if (viewMode !== 'favorites') {
        favoriteViewSongPaths.value = [];
        favoriteSearchHasMore.value = false;
        return;
      }

      const effectiveDetailFilter = currentFavTab === 'songs' ? null : detailFilter;
      if (paths.length === 0 || (currentFavTab !== 'songs' && !effectiveDetailFilter)) {
        favoriteViewSongPaths.value = [];
        favoriteSearchHasMore.value = false;
        return;
      }

      try {
        const resolvedDetailFilter = currentFavTab === 'songs'
          ? null
          : effectiveDetailFilter?.type === 'album'
            ? { type: 'album' as const, name: effectiveDetailFilter.name }
            : { type: 'artist' as const, name: effectiveDetailFilter!.name };
        if (query.trim() && sortMode !== 'custom') {
          const nextPaths = await tauriInvoke('get_favorite_song_paths_view', {
            favoritePaths: paths,
            query,
            sortMode,
            detailFilterType: resolvedDetailFilter?.type,
            detailFilterValue: resolvedDetailFilter?.name,
            offset: 0,
            limit: 256,
          });
          if (requestId === favoriteViewRequestId) {
            favoriteViewSongPaths.value = nextPaths;
            favoriteSearchHasMore.value = nextPaths.length === 256;
          }
          return;
        }
        favoriteSearchHasMore.value = false;
        const nextPaths = await loadFavoriteSongPaths({
          favoritePaths: paths,
          query,
          sortMode: sortMode === 'custom' ? 'title' : sortMode,
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
      searchRevision,
    ],
    async ([viewMode, items, query, sortMode]) => {
      const requestId = ++recentViewRequestId;

      if (viewMode !== 'recent') {
        recentViewSongPaths.value = [];
        recentSearchHasMore.value = false;
        return;
      }

      if (items.length === 0) {
        recentViewSongPaths.value = [];
        recentSearchHasMore.value = false;
        return;
      }

      try {
        if (query.trim() && sortMode !== 'custom') {
          const nextPaths = await tauriInvoke('get_recent_song_paths_view', {
            recentEntries: items.map(item => ({ songPath: item.path, playedAt: item.playedAt })),
            query,
            sortMode,
            offset: 0,
            limit: 256,
          });
          if (requestId === recentViewRequestId) {
            recentViewSongPaths.value = nextPaths;
            recentSearchHasMore.value = nextPaths.length === 256;
          }
          return;
        }
        recentSearchHasMore.value = false;
        const nextPaths = await loadRecentSongPaths({
          recentSongs: items,
          query,
          sortMode: sortMode === 'custom' ? 'title' : sortMode,
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
      canonicalSongPaths,
      libraryFolderSongPathCacheVersion,
      searchRevision,
    ],
    async ([viewMode, folderFilter, query, sortMode]) => {
      const requestId = ++folderViewRequestId;

      if (viewMode !== 'folder' || !folderFilter) {
        folderViewSongPaths.value = [];
        folderSearchHasMore.value = false;
        return;
      }

      try {
        if (query.trim() && sortMode !== 'custom') {
          const nextPaths = await tauriInvoke('get_library_song_paths_for_folder_view', {
            folderPath: folderFilter,
            query,
            sortMode,
            offset: 0,
            limit: 256,
          });
          if (requestId === folderViewRequestId) {
            folderViewSongPaths.value = nextPaths;
            folderSearchHasMore.value = nextPaths.length === 256;
          }
          return;
        }
        folderSearchHasMore.value = false;
        const nextPaths = await loadFolderViewSongPaths({
          folderPath: folderFilter,
          query,
          sortMode: sortMode === 'custom' ? 'title' : sortMode,
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
    [currentViewMode, playlists, filterCondition, searchQuery, playlistSortMode, canonicalSongPaths, searchRevision],
    async ([viewMode, , , query, sortMode]) => {
      const requestId = ++playlistViewRequestId;
      if (viewMode !== 'playlist') {
        playlistViewSongPaths.value = [];
        playlistSearchHasMore.value = false;
        return;
      }

      const playlist = playlists.value.find(item => item.id === filterCondition.value);
      const paths = playlist?.songPaths.filter(path => canonicalPathSet.value.has(path)) ?? [];
      if (paths.length === 0) {
        playlistViewSongPaths.value = [];
        playlistSearchHasMore.value = false;
        return;
      }

      try {
        if (query.trim() && sortMode !== 'custom') {
          const resolvedPaths = await tauriInvoke('get_favorite_song_paths_view', {
            favoritePaths: paths,
            query,
            sortMode,
            offset: 0,
            limit: 256,
          });
          if (requestId === playlistViewRequestId) {
            playlistViewSongPaths.value = resolvedPaths;
            playlistSearchHasMore.value = resolvedPaths.length === 256;
          }
          return;
        }
        playlistSearchHasMore.value = false;
        const resolvedPaths = await loadFavoriteSongPaths({
          favoritePaths: paths,
          query,
          sortMode: sortMode === 'custom' ? 'title' : sortMode,
        });
        if (requestId === playlistViewRequestId) {
          const resolvedPathSet = new Set(resolvedPaths);
          playlistViewSongPaths.value = sortMode === 'custom'
            ? paths.filter(path => resolvedPathSet.has(path))
            : resolvedPaths;
        }
      } catch {
        if (requestId === playlistViewRequestId) {
          playlistViewSongPaths.value = paths;
        }
      }
    },
    { deep: true, immediate: true },
  );

  watch(
    [
      currentViewMode,
      filterCondition,
      searchQuery,
      localSortMode,
      albumDetailSortMode,
      canonicalSongPaths,
      searchRevision,
    ],
    async ([viewMode, filter, query, currentLocalSortMode, currentAlbumSortMode]) => {
      const requestId = ++detailViewRequestId;

      if (!filter || (viewMode !== 'artist' && viewMode !== 'album')) {
        detailViewSongPaths.value = [];
        detailSearchHasMore.value = false;
        return;
      }

      try {
        if (query.trim() && !(viewMode === 'artist' && currentLocalSortMode === 'custom')) {
          const sortMode = viewMode === 'artist'
            ? currentLocalSortMode === 'custom' ? 'title' : currentLocalSortMode
            : currentAlbumSortMode;
          const page = await tauriInvoke('get_library_song_path_page_for_all_view', {
            query,
            artistFilter: viewMode === 'artist' ? filter : '',
            albumFilter: viewMode === 'album' ? filter : '',
            sortMode,
            offset: 0,
            limit: 256,
          });
          if (requestId === detailViewRequestId) {
            detailViewSongPaths.value = page.paths;
            detailSearchHasMore.value = page.paths.length < page.total;
          }
          return;
        }
        detailSearchHasMore.value = false;
        const paths = viewMode === 'artist'
          ? currentLocalSortMode === 'custom'
            ? await loadAllViewSongPaths({
                query,
                artistFilter: filter,
                sortMode: 'title',
              })
            : await loadAllViewSongPaths({
                query,
                artistFilter: filter,
                sortMode: currentLocalSortMode,
              })
          : currentAlbumSortMode === 'track_number' || currentAlbumSortMode === 'track_number_desc'
            ? await loadAlbumSongPaths(filter, currentAlbumSortMode)
            : await loadAllViewSongPaths({
                query,
                albumFilter: filter,
                sortMode: currentAlbumSortMode,
              });

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

  const sortSongPathsByLocalMode = (paths: string[], mode: LocalSortMode) => {
    const sortedPaths = [...paths];
    if (songLookup.value.size === 0) {
      return sortedPaths;
    }

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

  const sortSongPathsByAlbumDetailMode = (paths: string[], mode: AlbumDetailSortMode) => {
    if (songLookup.value.size === 0) {
      return [...paths];
    }
    if (mode !== 'track_number' && mode !== 'track_number_desc') {
      return sortSongPathsByLocalMode(paths, mode as LocalSortMode);
    }

    const sortedPaths = [...paths];
    sortedPaths.sort((left, right) => {
      const result = compareSongPathsByTrackNumber(left, right, songLookup.value);
      return mode === 'track_number_desc' ? -result : result;
    });

    return sortedPaths;
  };

  const applyCustomPathOrder = (paths: string[], customOrder: string[]) => {
    const orderMap = new Map(customOrder.map((path, index) => [path, index]));
    return [...paths].sort((left, right) => {
      const leftIndex = orderMap.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = orderMap.get(right) ?? Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex;
    });
  };

  const currentViewSongPaths = computed(() => {
    searchRevision.value;
    const profileStart = isProfilingEnabled() ? performance.now() : 0;
    const result = (() => {
    if (searchQuery.value.trim()) {
      const query = searchQuery.value.toLowerCase();

      if (currentViewMode.value === 'all' && localSortMode.value !== 'custom') {
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
        return localSortMode.value === 'custom'
          ? applyCustomPathOrder(favoriteViewSongPaths.value, localCustomOrder.value)
          : favoriteViewSongPaths.value;
      }

      if (currentViewMode.value === 'recent') {
        return localSortMode.value === 'custom'
          ? applyCustomPathOrder(recentViewSongPaths.value, localCustomOrder.value)
          : recentViewSongPaths.value;
      }

      if (currentViewMode.value === 'all') {
        return localSortMode.value === 'custom'
          ? applyCustomPathOrder(allViewSongPaths.value, localCustomOrder.value)
          : allViewSongPaths.value;
      }

      if (currentViewMode.value === 'folder') {
        return folderSortMode.value === 'custom'
          ? applyCustomPathOrder(
              folderViewSongPaths.value,
              currentFolderSongPaths.value,
            )
          : folderViewSongPaths.value;
      }

      if (currentViewMode.value === 'artist') {
        return localSortMode.value === 'custom'
          ? applyCustomPathOrder(detailViewSongPaths.value, localCustomOrder.value)
          : detailViewSongPaths.value;
      }

      if (currentViewMode.value === 'album') {
        return detailViewSongPaths.value;
      }

      if (currentViewMode.value === 'playlist') {
        return playlistViewSongPaths.value;
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
        pathsToRender = pathsToRender.filter(path => canonicalPathSet.value.has(path));
        return pathsToRender;
      }

      return applyCustomPathOrder(allViewSongPaths.value, localCustomOrder.value);
    }

    if (currentViewMode.value === 'folder') {
      if (folderSortMode.value !== 'custom') {
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

      return applyCustomPathOrder(recentViewSongPaths.value, localCustomOrder.value);
    }

    if (currentViewMode.value === 'favorites') {
      if (localSortMode.value !== 'custom') {
        return favoriteViewSongPaths.value;
      }

      return applyCustomPathOrder(favoriteViewSongPaths.value, localCustomOrder.value);
    }

    if (currentViewMode.value === 'playlist') {
      return playlistViewSongPaths.value;
    }

    return [];
    })();

    if (isProfilingEnabled()) {
      console.log(
        `[Profiling] useLibraryCurrentViewSongs#${debugOwnerId} currentViewSongPaths computed in ${(performance.now() - profileStart).toFixed(2)}ms (view: ${currentViewMode.value}, sort: ${localSortMode.value}/${folderSortMode.value}, paths: ${result.length}, canonical: ${canonicalSongPaths.value.length}, query: ${searchQuery.value.trim() ? 'yes' : 'no'})`,
      );
    }

    return result;
  });

  const currentViewSongs = computed(() => {
    const profileStart = isProfilingEnabled() ? performance.now() : 0;
    canonicalSongPaths.value;
    const paths = currentViewSongPaths.value;
    const songs = materializeSongPaths(paths);

    if (isProfilingEnabled()) {
      console.log(
        `[Profiling] useLibraryCurrentViewSongs#${debugOwnerId} currentViewSongs computed in ${(performance.now() - profileStart).toFixed(2)}ms (paths: ${paths.length}, songs: ${songs.length})`,
      );
    }

    return songs;
  });

  const loadMoreCurrentSearchResults = async () => {
    if (!searchQuery.value.trim()) {
      return;
    }

    if (currentViewMode.value === 'all') {
      if (
        localSortMode.value === 'custom'
        || allSearchLoadingMore.value
        || allViewSongPaths.value.length >= allSearchTotal.value
      ) {
        return;
      }
      const queryKey = activeAllSearchKey.value;
      const offset = allViewSongPaths.value.length;
      allSearchLoadingMore.value = true;
      try {
        const page = await tauriInvoke('get_library_song_path_page_for_all_view', {
          query: searchQuery.value,
          artistFilter: localMusicTab.value === 'artist' ? currentArtistFilter.value : '',
          albumFilter: localMusicTab.value === 'album' ? currentAlbumFilter.value : '',
          sortMode: localSortMode.value,
          offset,
          limit: 256,
        });
        if (queryKey === activeAllSearchKey.value && offset === allViewSongPaths.value.length) {
          allViewSongPaths.value = [...allViewSongPaths.value, ...page.paths];
          allSearchTotal.value = page.total;
        }
      } finally {
        if (queryKey === activeAllSearchKey.value) {
          allSearchLoadingMore.value = false;
        }
      }
      return;
    }

    if (secondarySearchLoadingMore.value) {
      return;
    }
    const query = searchQuery.value;
    const viewMode = currentViewMode.value;
    secondarySearchLoadingMore.value = true;
    try {
      if (viewMode === 'favorites' && favoriteSearchHasMore.value && localSortMode.value !== 'custom') {
        const effectiveDetailFilter = favTab.value === 'songs' ? null : favDetailFilter.value;
        const paths = await tauriInvoke('get_favorite_song_paths_view', {
          favoritePaths: favoriteSongPaths.value,
          query,
          sortMode: localSortMode.value,
          detailFilterType: effectiveDetailFilter?.type,
          detailFilterValue: effectiveDetailFilter?.name,
          offset: favoriteViewSongPaths.value.length,
          limit: 256,
        });
        if (query === searchQuery.value && viewMode === currentViewMode.value) {
          favoriteViewSongPaths.value = [...favoriteViewSongPaths.value, ...paths];
          favoriteSearchHasMore.value = paths.length === 256;
        }
      } else if (viewMode === 'recent' && recentSearchHasMore.value && localSortMode.value !== 'custom') {
        const paths = await tauriInvoke('get_recent_song_paths_view', {
          recentEntries: recentSongs.value.map(item => ({ songPath: item.path, playedAt: item.playedAt })),
          query,
          sortMode: localSortMode.value,
          offset: recentViewSongPaths.value.length,
          limit: 256,
        });
        if (query === searchQuery.value && viewMode === currentViewMode.value) {
          recentViewSongPaths.value = [...recentViewSongPaths.value, ...paths];
          recentSearchHasMore.value = paths.length === 256;
        }
      } else if (viewMode === 'folder' && folderSearchHasMore.value && folderSortMode.value !== 'custom') {
        const paths = await tauriInvoke('get_library_song_paths_for_folder_view', {
          folderPath: currentFolderFilter.value,
          query,
          sortMode: folderSortMode.value,
          offset: folderViewSongPaths.value.length,
          limit: 256,
        });
        if (query === searchQuery.value && viewMode === currentViewMode.value) {
          folderViewSongPaths.value = [...folderViewSongPaths.value, ...paths];
          folderSearchHasMore.value = paths.length === 256;
        }
      } else if (viewMode === 'playlist' && playlistSearchHasMore.value && playlistSortMode.value !== 'custom') {
        const playlist = playlists.value.find(item => item.id === filterCondition.value);
        const paths = await tauriInvoke('get_favorite_song_paths_view', {
          favoritePaths: playlist?.songPaths ?? [],
          query,
          sortMode: playlistSortMode.value,
          offset: playlistViewSongPaths.value.length,
          limit: 256,
        });
        if (query === searchQuery.value && viewMode === currentViewMode.value) {
          playlistViewSongPaths.value = [...playlistViewSongPaths.value, ...paths];
          playlistSearchHasMore.value = paths.length === 256;
        }
      } else if ((viewMode === 'artist' || viewMode === 'album') && detailSearchHasMore.value) {
        if (viewMode === 'artist' && localSortMode.value === 'custom') {
          return;
        }
        const page = await tauriInvoke('get_library_song_path_page_for_all_view', {
          query,
          artistFilter: viewMode === 'artist' ? filterCondition.value : '',
          albumFilter: viewMode === 'album' ? filterCondition.value : '',
          sortMode: viewMode === 'artist'
            ? localSortMode.value === 'custom' ? 'title' : localSortMode.value
            : albumDetailSortMode.value,
          offset: detailViewSongPaths.value.length,
          limit: 256,
        });
        if (query === searchQuery.value && viewMode === currentViewMode.value) {
          detailViewSongPaths.value = [...detailViewSongPaths.value, ...page.paths];
          detailSearchHasMore.value = detailViewSongPaths.value.length < page.total;
        }
      }
    } finally {
      secondarySearchLoadingMore.value = false;
    }
  };

  const hasMoreCurrentSearchResults = computed(() => {
    if (!searchQuery.value.trim()) return false;
    if (currentViewMode.value === 'all') return allViewSongPaths.value.length < allSearchTotal.value;
    if (currentViewMode.value === 'favorites') return favoriteSearchHasMore.value;
    if (currentViewMode.value === 'recent') return recentSearchHasMore.value;
    if (currentViewMode.value === 'folder') return folderSearchHasMore.value;
    if (currentViewMode.value === 'playlist') return playlistSearchHasMore.value;
    if (currentViewMode.value === 'artist' || currentViewMode.value === 'album') return detailSearchHasMore.value;
    return false;
  });

  return {
    currentViewSongPaths,
    currentViewSongs,
    loadMoreCurrentSearchResults,
    hasMoreCurrentSearchResults,
    currentSearchResultTotal: computed(() => (
      currentViewMode.value === 'all' && searchQuery.value.trim()
        ? allSearchTotal.value
        : currentViewSongPaths.value.length
    )),
  };
}
