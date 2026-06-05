import {
  computed,
  nextTick,
  onUnmounted,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from 'vue';
import { storeToRefs } from 'pinia';
import type { FolderNode, Song } from '../types';
import { usePlaybackStore } from '../features/playback/store';
import {
  INDEX_KEYS,
  getAlphabetIndexKey,
  type AlphabetIndexKey,
} from '../utils/alphabetIndex';

const ROW_HEIGHT = 72;
const INDEX_PROXIMITY_PX = 72;
const INDEX_AUTO_HIDE_MS = 500;
const SCROLL_TO_TOP_VIEW_MODES = new Set(['all', 'playlist', 'artist', 'album']);

type StringRef = Ref<string> | ComputedRef<string>;

interface UseSongTableAlphabetIndexOptions {
  songs: Ref<Song[]>;
  scrollTop: Ref<number>;
  containerHeight: Ref<number>;
  containerRef: Ref<HTMLElement | null>;
  rootRef: Ref<HTMLElement | null>;
  routePath: StringRef;
  currentViewMode: Ref<string>;
  localSortMode: Ref<string>;
  folderSortMode: Ref<string>;
  activeRootPath: Ref<string | null>;
  currentFolderFilter: Ref<string>;
  folderTree: Ref<FolderNode[]>;
  refreshFolder: (folderPath: string) => Promise<unknown>;
  expandFolderPath: (path: string) => Promise<unknown>;
}

export function useSongTableAlphabetIndex({
  songs,
  scrollTop,
  containerHeight,
  containerRef,
  rootRef,
  routePath,
  currentViewMode,
  localSortMode,
  folderSortMode,
  activeRootPath,
  currentFolderFilter,
  folderTree,
  refreshFolder,
  expandFolderPath,
}: UseSongTableAlphabetIndexOptions) {
  const { currentSong } = storeToRefs(usePlaybackStore());
  const indexBarRef = ref<HTMLElement | null>(null);
  const isIndexDragging = ref(false);
  const dragIndexKey = ref<AlphabetIndexKey | null>(null);
  const hoverIndexKey = ref<AlphabetIndexKey | null>(null);
  const isIndexBarVisible = ref(false);
  let hideIndexBarTimer: ReturnType<typeof setTimeout> | null = null;

  const indexLabelGetter = computed<((song: Song) => string) | null>(() => {
    if (currentViewMode.value === 'all' && localSortMode.value === 'title') {
      return (song: Song) => song.title || song.name;
    }

    if (currentViewMode.value === 'folder' && ['title', 'name'].includes(folderSortMode.value)) {
      return folderSortMode.value === 'name'
        ? (song: Song) => song.name
        : (song: Song) => song.title || song.name;
    }

    return null;
  });

  const showAlphabetIndex = computed(() =>
    routePath.value === '/' && !!indexLabelGetter.value && songs.value.length > 0,
  );

  const firstSongIndexByKey = computed(() => {
    const keyMap = new Map<AlphabetIndexKey, number>();

    if (!indexLabelGetter.value) {
      return keyMap;
    }

    songs.value.forEach((song, index) => {
      const key = getAlphabetIndexKey(indexLabelGetter.value!(song));
      if (!keyMap.has(key)) {
        keyMap.set(key, index);
      }
    });

    return keyMap;
  });

  const activeIndexKey = computed<AlphabetIndexKey | null>(() => {
    if (!indexLabelGetter.value || songs.value.length === 0) {
      return null;
    }

    const visibleIndex = Math.min(
      songs.value.length - 1,
      Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT)),
    );

    return getAlphabetIndexKey(indexLabelGetter.value(songs.value[visibleIndex]));
  });

  const currentSongIndex = computed(() => {
    if (!currentSong.value?.path) {
      return -1;
    }

    return songs.value.findIndex((song) => song.path === currentSong.value?.path);
  });

  const normalizePath = (path: string | null | undefined) =>
    (path || '').replace(/\\/g, '/').replace(/\/+$/, '');

  const getParentFolderPath = (path: string) => path.replace(/[\\/][^\\/]+$/, '');

  const findOwningRootPath = (targetPath: string) => {
    const normalizedTarget = normalizePath(targetPath);
    const rootPaths = folderTree.value
      .map((node) => node.path)
      .filter((rootPath) => {
        const normalizedRoot = normalizePath(rootPath);
        return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
      })
      .sort((left, right) => normalizePath(right).length - normalizePath(left).length);

    return rootPaths[0] || null;
  };

  const canLocateCurrentSong = computed(() => {
    if (!currentSong.value?.path) {
      return false;
    }

    if (currentSongIndex.value >= 0) {
      return true;
    }

    if (currentViewMode.value !== 'folder') {
      return false;
    }

    return !!findOwningRootPath(getParentFolderPath(currentSong.value.path));
  });

  const isCurrentSongVisibleInViewport = computed(() => {
    if (currentSongIndex.value < 0) {
      return false;
    }

    const viewportHeight = Math.max(
      containerHeight.value,
      containerRef.value?.clientHeight ?? 0,
    );

    if (viewportHeight <= 0) {
      return false;
    }

    const viewportTop = scrollTop.value;
    const viewportBottom = viewportTop + viewportHeight;
    const currentRowTop = currentSongIndex.value * ROW_HEIGHT;
    const currentRowBottom = currentRowTop + ROW_HEIGHT;

    return currentRowBottom > viewportTop && currentRowTop < viewportBottom;
  });

  const showLocateCurrentSongButton = computed(() =>
    routePath.value === '/' &&
    canLocateCurrentSong.value &&
    !isCurrentSongVisibleInViewport.value,
  );

  const showScrollToTopButton = computed(() =>
    routePath.value === '/' &&
    SCROLL_TO_TOP_VIEW_MODES.has(currentViewMode.value) &&
    songs.value.length > 0 &&
    scrollTop.value > ROW_HEIGHT,
  );

  const clearHideIndexBarTimer = () => {
    if (hideIndexBarTimer) {
      clearTimeout(hideIndexBarTimer);
      hideIndexBarTimer = null;
    }
  };

  const showIndexBar = () => {
    if (!showAlphabetIndex.value) {
      return;
    }

    clearHideIndexBarTimer();
    isIndexBarVisible.value = true;
  };

  const scheduleHideIndexBar = () => {
    clearHideIndexBarTimer();

    if (!showAlphabetIndex.value || isIndexDragging.value) {
      return;
    }

    hideIndexBarTimer = setTimeout(() => {
      if (!isIndexDragging.value) {
        isIndexBarVisible.value = false;
      }
    }, INDEX_AUTO_HIDE_MS);
  };

  const revealIndexBarTemporarily = () => {
    showIndexBar();
    scheduleHideIndexBar();
  };

  const jumpToSongIndex = (songIndex: number) => {
    if (!containerRef.value) {
      return;
    }

    const targetTop = songIndex * ROW_HEIGHT;
    containerRef.value.scrollTo({ top: targetTop, behavior: 'auto' });
    scrollTop.value = targetTop;
  };

  const scrollToTop = () => {
    containerRef.value?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const scrollFolderTargetsIntoView = (folderPath: string, rootPath: string | null) => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-folder-path]')).filter(
      (element) =>
        element.dataset.folderPath === folderPath ||
        (!!rootPath && element.dataset.folderPath === rootPath),
    );

    targets.forEach((element) => {
      element.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'smooth',
      });
    });
  };

  const scrollToCurrentSong = async () => {
    if (!currentSong.value?.path) {
      return;
    }

    showIndexBar();

    if (currentSongIndex.value >= 0) {
      if (currentViewMode.value === 'folder' && currentFolderFilter.value) {
        scrollFolderTargetsIntoView(currentFolderFilter.value, activeRootPath.value);
      }
      jumpToSongIndex(currentSongIndex.value);
      scheduleHideIndexBar();
      return;
    }

    if (currentViewMode.value !== 'folder') {
      scheduleHideIndexBar();
      return;
    }

    const targetFolderPath = getParentFolderPath(currentSong.value.path);
    const targetRootPath = findOwningRootPath(targetFolderPath);

    if (!targetRootPath) {
      scheduleHideIndexBar();
      return;
    }

    activeRootPath.value = targetRootPath;
    currentFolderFilter.value = targetFolderPath;
    await expandFolderPath(targetFolderPath);
    await refreshFolder(targetFolderPath);
    await nextTick();
    requestAnimationFrame(() => {
      scrollFolderTargetsIntoView(targetFolderPath, targetRootPath);
    });

    const refreshedSongIndex = songs.value.findIndex((song) => song.path === currentSong.value?.path);
    if (refreshedSongIndex >= 0) {
      jumpToSongIndex(refreshedSongIndex);
    }

    scheduleHideIndexBar();
  };

  const handleIndexHotspotEnter = () => {
    showIndexBar();
  };

  const handleIndexHotspotMove = () => {
    showIndexBar();
  };

  const handleIndexHotspotLeave = () => {
    scheduleHideIndexBar();
  };

  const handleRootMouseMove = (event: MouseEvent) => {
    if (!showAlphabetIndex.value || !rootRef.value) {
      return;
    }

    const rect = rootRef.value.getBoundingClientRect();
    if (rect.right - event.clientX <= INDEX_PROXIMITY_PX) {
      revealIndexBarTemporarily();
    }
  };

  const handleRootMouseLeave = () => {
    scheduleHideIndexBar();
  };

  const resolveNearestIndexKey = (targetKey: AlphabetIndexKey) => {
    if (firstSongIndexByKey.value.has(targetKey)) {
      return targetKey;
    }

    const targetIndex = INDEX_KEYS.indexOf(targetKey);
    for (let offset = 1; offset < INDEX_KEYS.length; offset += 1) {
      const forwardKey = INDEX_KEYS[targetIndex + offset];
      if (forwardKey && firstSongIndexByKey.value.has(forwardKey)) {
        return forwardKey;
      }

      const backwardKey = INDEX_KEYS[targetIndex - offset];
      if (backwardKey && firstSongIndexByKey.value.has(backwardKey)) {
        return backwardKey;
      }
    }

    return null;
  };

  const navigateToIndexKey = (targetKey: AlphabetIndexKey) => {
    const resolvedKey = resolveNearestIndexKey(targetKey);
    if (!resolvedKey || !firstSongIndexByKey.value.has(resolvedKey)) {
      return;
    }

    const songIndex = firstSongIndexByKey.value.get(resolvedKey);
    if (songIndex !== undefined && songIndex >= 0 && songIndex < songs.value.length) {
      jumpToSongIndex(songIndex);
    }
  };

  const updateDragIndexFromPoint = (clientY: number) => {
    if (!indexBarRef.value) {
      return;
    }

    const rect = indexBarRef.value.getBoundingClientRect();
    const relativeY = Math.min(Math.max(clientY - rect.top, 0), rect.height);
    const slotHeight = rect.height / INDEX_KEYS.length;
    const slotIndex = Math.min(
      INDEX_KEYS.length - 1,
      Math.max(0, Math.floor(relativeY / Math.max(slotHeight, 1))),
    );

    const targetKey = INDEX_KEYS[slotIndex];
    dragIndexKey.value = targetKey;
    navigateToIndexKey(targetKey);
  };

  const handleGlobalIndexPointerMove = (event: PointerEvent) => {
    if (isIndexDragging.value) {
      updateDragIndexFromPoint(event.clientY);
    }
  };

  const stopIndexDrag = () => {
    if (!isIndexDragging.value) {
      return;
    }

    isIndexDragging.value = false;
    dragIndexKey.value = null;
    window.removeEventListener('pointermove', handleGlobalIndexPointerMove);
    window.removeEventListener('pointerup', stopIndexDrag);
    window.removeEventListener('pointercancel', stopIndexDrag);
    scheduleHideIndexBar();
  };

  const handleIndexPointerDown = (event: PointerEvent, key: AlphabetIndexKey) => {
    if (!showAlphabetIndex.value) {
      return;
    }

    isIndexDragging.value = true;
    showIndexBar();
    dragIndexKey.value = key;
    navigateToIndexKey(key);
    window.addEventListener('pointermove', handleGlobalIndexPointerMove);
    window.addEventListener('pointerup', stopIndexDrag);
    window.addEventListener('pointercancel', stopIndexDrag);
    (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  watch(
    showAlphabetIndex,
    (visible) => {
      clearHideIndexBarTimer();
      if (visible) {
        revealIndexBarTemporarily();
      } else {
        isIndexBarVisible.value = false;
        hoverIndexKey.value = null;
      }
    },
    { immediate: true },
  );

  onUnmounted(() => {
    stopIndexDrag();
    clearHideIndexBarTimer();
  });

  return {
    showAlphabetIndex,
    firstSongIndexByKey,
    activeIndexKey,
    indexBarRef,
    isIndexDragging,
    dragIndexKey,
    hoverIndexKey,
    isIndexBarVisible,
    canLocateCurrentSong,
    showLocateCurrentSongButton,
    showScrollToTopButton,
    handleIndexHotspotEnter,
    handleIndexHotspotMove,
    handleIndexHotspotLeave,
    handleRootMouseMove,
    handleRootMouseLeave,
    handleIndexPointerDown,
    showIndexBar,
    scrollToCurrentSong,
    scrollToTop,
  };
}
