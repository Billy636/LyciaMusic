<script setup lang="ts">
defineOptions({ name: 'Albums' });

import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { albumViewportCoverSnapshotCache } from '../caches/imageCaches';
import { dragSession } from '../composables/dragState';
import { useCoverCache } from '../composables/useCoverCache';
import { useHomeNavigation } from '../composables/useHomeNavigation';
import { useListScrollMemory } from '../composables/useListScrollMemory';
import SortModeIcon from '../components/common/SortModeIcon.vue';
import { useLibraryBrowse } from '../features/library/useLibraryBrowse';
import type { AlbumListItem } from '../features/library/playerLibraryViewShared';
import { getAlphabetIndexKey } from '../utils/alphabetIndex';

const { filteredAlbumList, albumSortMode, updateAlbumOrder, searchQuery } = useLibraryBrowse();
const router = useRouter();
const route = useRoute();
const { openHomeAlbum } = useHomeNavigation(router);
const isSearchActive = computed(() => searchQuery.value.trim().length > 0);
const { coverCache, loadCover, touchCoverPaths, isCoverLoading, preloadPriorityCovers } = useCoverCache();

const showSortMenu = ref(false);
const dragOverKey = ref<string | null>(null);
const containerRef = ref<HTMLElement | null>(null);
const containerScrollTop = ref(0);
const containerHeight = ref(720);
const containerWidth = ref(1200);
const measuredAlbumCardHeight = ref(0);
const displayedCoverUrls = reactive(new Map<string, string>());
let coverObserver: IntersectionObserver | null = null;
let containerResizeObserver: ResizeObserver | null = null;
let coverObserverRefreshFrame = 0;
let visibleCoverPaths = new Set<string>();
const VIEWPORT_SNAPSHOT_KEY = 'albums-current';
const VIEWPORT_SNAPSHOT_LIMIT = 72;
const ALBUM_GRID_GAP_X = 24;
const ALBUM_GRID_GAP_Y = 40;
const ALBUM_SECTION_GAP_Y = 8;
const ALBUM_CARD_EXTRA_HEIGHT = 108;
const ALBUM_SECTION_HEADER_HEIGHT = 24;
const ALBUM_OVERSCAN_ROWS = 2;

const handleAlbumClick = (albumKey: string) => {
  void openHomeAlbum(albumKey);
};

const handleSortChange = (mode: 'count' | 'name' | 'artist' | 'custom') => {
  albumSortMode.value = mode;
  showSortMenu.value = false;
};

const getAlbumGridColumns = () => {
  if (window.innerWidth >= 1536) {
    return 7;
  }

  if (window.innerWidth >= 1280) {
    return 6;
  }

  if (window.innerWidth >= 1024) {
    return 5;
  }

  if (window.innerWidth >= 768) {
    return 4;
  }

  if (window.innerWidth >= 640) {
    return 3;
  }

  return 2;
};

const albumGridColumns = ref(getAlbumGridColumns());

const estimatedAlbumRowSpan = computed(() => {
  const columns = albumGridColumns.value;
  const width = Math.max(0, containerWidth.value - ALBUM_GRID_GAP_X * (columns - 1));
  const itemWidth = columns > 0 ? width / columns : containerWidth.value;
  return itemWidth + ALBUM_CARD_EXTRA_HEIGHT + ALBUM_GRID_GAP_Y;
});

const albumRowSpan = computed(() =>
  measuredAlbumCardHeight.value > 0
    ? measuredAlbumCardHeight.value + ALBUM_GRID_GAP_Y
    : estimatedAlbumRowSpan.value,
);

const updateViewportMetrics = () => {
  if (containerRef.value) {
    containerHeight.value = containerRef.value.clientHeight;
    containerWidth.value = containerRef.value.clientWidth;
  }

  albumGridColumns.value = getAlbumGridColumns();
};

const measureAlbumCardHeight = async () => {
  await nextTick();

  const firstCard = containerRef.value?.querySelector<HTMLElement>('[data-album-card]');
  if (!firstCard) {
    return;
  }

  const nextHeight = firstCard.offsetHeight;
  if (nextHeight > 0 && nextHeight !== measuredAlbumCardHeight.value) {
    measuredAlbumCardHeight.value = nextHeight;
  }
};

const handleContainerScroll = (event: Event) => {
  containerScrollTop.value = (event.target as HTMLElement).scrollTop;
};

const getDisplayedCoverUrl = (path: string | undefined) => {
  if (!path) {
    return '';
  }

  return displayedCoverUrls.get(path) ?? coverCache.get(path) ?? '';
};

const restoreViewportCoverSnapshot = () => {
  const snapshot = albumViewportCoverSnapshotCache.get(VIEWPORT_SNAPSHOT_KEY);
  if (!snapshot || snapshot.length === 0) {
    return;
  }

  preloadPriorityCovers(snapshot);
};

const saveViewportCoverSnapshot = () => {
  if (!containerRef.value) {
    return;
  }

  const containerRect = containerRef.value.getBoundingClientRect();
  const viewportBuffer = containerRef.value.clientHeight;
  const snapshotTop = containerRect.top - viewportBuffer;
  const snapshotBottom = containerRect.bottom + viewportBuffer;
  const snapshot: string[] = [];
  const seenPaths = new Set<string>();

  containerRef.value.querySelectorAll<HTMLElement>('[data-cover-path]').forEach((element) => {
    if (snapshot.length >= VIEWPORT_SNAPSHOT_LIMIT) {
      return;
    }

    const path = element.dataset.coverPath;
    if (!path || seenPaths.has(path)) {
      return;
    }

    const rect = element.getBoundingClientRect();
    if (rect.bottom < snapshotTop || rect.top > snapshotBottom) {
      return;
    }

    if (!getDisplayedCoverUrl(path)) {
      return;
    }

    seenPaths.add(path);
    snapshot.push(path);
  });

  if (snapshot.length > 0) {
    albumViewportCoverSnapshotCache.set(VIEWPORT_SNAPSHOT_KEY, snapshot);
    return;
  }

  albumViewportCoverSnapshotCache.delete(VIEWPORT_SNAPSHOT_KEY);
};

restoreViewportCoverSnapshot();

const syncVisibleCoverUrls = (paths: string[]) => {
  const nextVisiblePaths = new Set(paths.filter(Boolean));
  visibleCoverPaths = nextVisiblePaths;

  for (const path of Array.from(displayedCoverUrls.keys())) {
    if (!nextVisiblePaths.has(path)) {
      displayedCoverUrls.delete(path);
    }
  }

  const nextPaths = Array.from(nextVisiblePaths);
  touchCoverPaths(nextPaths);

  nextPaths.forEach((path) => {
    const cachedUrl = coverCache.get(path);
    if (cachedUrl) {
      displayedCoverUrls.set(path, cachedUrl);
      return;
    }

    if (displayedCoverUrls.has(path)) {
      return;
    }

    void loadCover(path).then((coverUrl) => {
      if (!coverUrl || !visibleCoverPaths.has(path)) {
        return;
      }

      displayedCoverUrls.set(path, coverUrl);
    });
  });
};

const albumSections = computed(() => {
  const sections: Array<{
    key: string;
    items: Array<{ album: AlbumListItem; index: number }>;
  }> = [];

  filteredAlbumList.value.forEach((album, index) => {
    const key = getAlphabetIndexKey(album.name);
    const lastSection = sections[sections.length - 1];

    if (!lastSection || lastSection.key !== key) {
      sections.push({
        key,
        items: [{ album, index }],
      });
      return;
    }

    lastSection.items.push({ album, index });
  });

  return sections;
});

type AlbumSectionEntry = { album: AlbumListItem; index: number };
type AlbumVirtualHeaderRow = { type: 'header'; key: string; title: string };
type AlbumVirtualItemsRow = { type: 'items'; key: string; items: AlbumSectionEntry[]; bottomGap: number };
type AlbumVirtualRow = AlbumVirtualHeaderRow | AlbumVirtualItemsRow;
type MeasuredAlbumVirtualHeaderRow = AlbumVirtualHeaderRow & { top: number; height: number };
type MeasuredAlbumVirtualItemsRow = AlbumVirtualItemsRow & { top: number; height: number };
type MeasuredAlbumVirtualRow = MeasuredAlbumVirtualHeaderRow | MeasuredAlbumVirtualItemsRow;

const groupedAlbumRows = computed<AlbumVirtualRow[]>(() => {
  const rows: AlbumVirtualRow[] = [];

  albumSections.value.forEach((section) => {
    rows.push({
      type: 'header',
      key: `header::${section.key}`,
      title: section.key,
    });

    for (let start = 0; start < section.items.length; start += albumGridColumns.value) {
      const isLastRowInSection = start + albumGridColumns.value >= section.items.length;
      rows.push({
        type: 'items',
        key: `items::${section.key}::${start}`,
        items: section.items.slice(start, start + albumGridColumns.value),
        bottomGap: isLastRowInSection ? ALBUM_SECTION_GAP_Y : ALBUM_GRID_GAP_Y,
      });
    }
  });

  return rows;
});

const measuredGroupedAlbumRows = computed<MeasuredAlbumVirtualRow[]>(() => {
  let totalHeight = 0;

  return groupedAlbumRows.value.map((row) => {
    const height = row.type === 'header'
      ? ALBUM_SECTION_HEADER_HEIGHT
      : measuredAlbumCardHeight.value > 0
        ? measuredAlbumCardHeight.value + row.bottomGap
        : estimatedAlbumRowSpan.value - ALBUM_GRID_GAP_Y + row.bottomGap;
    const measuredRow = {
      ...row,
      top: totalHeight,
      height,
    };
    totalHeight += height;
    return measuredRow;
  });
});

const groupedAlbumVirtualState = computed(() => {
  const overscanPx = albumRowSpan.value * ALBUM_OVERSCAN_ROWS;
  const startBoundary = Math.max(0, containerScrollTop.value - overscanPx);
  const endBoundary = containerScrollTop.value + containerHeight.value + overscanPx;

  let totalHeight = 0;
  let startIndex = 0;
  let endIndex = groupedAlbumRows.value.length;
  const measuredRows = measuredGroupedAlbumRows.value;
  totalHeight = measuredRows.reduce((sum, row) => sum + row.height, 0);

  while (
    startIndex < measuredRows.length
    && measuredRows[startIndex].top + measuredRows[startIndex].height <= startBoundary
  ) {
    startIndex += 1;
  }

  endIndex = startIndex;
  while (endIndex < measuredRows.length && measuredRows[endIndex].top < endBoundary) {
    endIndex += 1;
  }

  const visibleRows = measuredRows.slice(startIndex, endIndex);
  const firstTop = visibleRows[0]?.top ?? 0;
  const lastBottom = visibleRows.length > 0
    ? visibleRows[visibleRows.length - 1].top + visibleRows[visibleRows.length - 1].height
    : 0;

  return {
    rows: visibleRows,
    paddingTop: `${firstTop}px`,
    paddingBottom: `${Math.max(0, totalHeight - lastBottom)}px`,
  };
});

const stickyAlbumHeader = computed(() => {
  if (albumSortMode.value !== 'name') {
    return null;
  }

  const headerRows = measuredGroupedAlbumRows.value.filter(
    (row): row is MeasuredAlbumVirtualHeaderRow => row.type === 'header',
  );

  if (headerRows.length === 0) {
    return null;
  }

  const scrollTop = containerScrollTop.value;
  let activeIndex = 0;

  for (let index = 0; index < headerRows.length; index += 1) {
    if (headerRows[index].top <= scrollTop) {
      activeIndex = index;
      continue;
    }
    break;
  }

  const activeHeader = headerRows[activeIndex];
  const nextHeader = headerRows[activeIndex + 1];
  const offset = nextHeader
    ? Math.min(0, nextHeader.top - scrollTop - activeHeader.height)
    : 0;

  return {
    key: activeHeader.key,
    title: activeHeader.title,
    offset: `${offset}px`,
    shouldHideSourceRow: activeHeader.top <= scrollTop,
  };
});

const isStickyAlbumHeaderRow = (rowKey: string, rowTop: number) => {
  const stickyHeader = stickyAlbumHeader.value;
  if (!stickyHeader) {
    return false;
  }

  return stickyHeader.key === rowKey && stickyHeader.shouldHideSourceRow && rowTop <= containerScrollTop.value;
};

const flatAlbumVirtualState = computed(() => {
  const totalRows = Math.ceil(filteredAlbumList.value.length / albumGridColumns.value);
  const startRow = Math.max(0, Math.floor(containerScrollTop.value / albumRowSpan.value) - ALBUM_OVERSCAN_ROWS);
  const endRow = Math.min(
    totalRows,
    Math.ceil((containerScrollTop.value + containerHeight.value) / albumRowSpan.value) + ALBUM_OVERSCAN_ROWS,
  );
  const startIndex = startRow * albumGridColumns.value;
  const endIndex = Math.min(filteredAlbumList.value.length, endRow * albumGridColumns.value);

  return {
    items: filteredAlbumList.value.slice(startIndex, endIndex).map((album, offset) => ({
      album,
      index: startIndex + offset,
    })),
    paddingTop: `${startRow * albumRowSpan.value}px`,
    paddingBottom: `${Math.max(0, (totalRows - endRow) * albumRowSpan.value)}px`,
  };
});

const visibleAlbumCoverPaths = computed(() => {
  if (albumSortMode.value === 'name') {
    return groupedAlbumVirtualState.value.rows.flatMap((row) => {
      if (row.type !== 'items') {
        return [];
      }

      return row.items
        .map(item => item.album.firstSongPath)
        .filter((path): path is string => !!path);
    });
  }

  return flatAlbumVirtualState.value.items
    .map(item => item.album.firstSongPath)
    .filter((path): path is string => !!path);
});

const initCoverObserver = async () => {
  await nextTick();

  if (!containerRef.value) {
    return;
  }

  if (!coverObserver) {
    coverObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }

          const target = entry.target as HTMLElement;
          const path = target.dataset.coverPath;
          if (path) {
            preloadPriorityCovers([path]);
          }
          coverObserver?.unobserve(target);
        });
      },
      {
        root: containerRef.value,
        rootMargin: '200px 0px',
      },
    );
  } else {
    coverObserver.disconnect();
  }

  containerRef.value.querySelectorAll<HTMLElement>('[data-cover-path]').forEach((element) => {
    coverObserver?.observe(element);
  });
};

const scheduleCoverObserverRefresh = () => {
  if (coverObserverRefreshFrame) {
    cancelAnimationFrame(coverObserverRefreshFrame);
  }

  coverObserverRefreshFrame = requestAnimationFrame(() => {
    coverObserverRefreshFrame = 0;
    void initCoverObserver();
  });
};

const scrollMemoryKey = computed(
  () => ['albums-view', route.path, albumSortMode.value, searchQuery.value.trim()].join('::'),
);

useListScrollMemory(scrollMemoryKey, containerRef);

watch(
  [visibleAlbumCoverPaths, albumSortMode],
  ([paths]) => {
    syncVisibleCoverUrls(paths);
    preloadPriorityCovers(paths);
    scheduleCoverObserverRefresh();
  },
  { immediate: true, flush: 'post' },
);

watch(
  [albumSortMode, albumGridColumns, filteredAlbumList],
  () => {
    void measureAlbumCardHeight();
  },
  { immediate: true, flush: 'post' },
);

let pointerDownInfo: { x: number; y: number; index: number; album: AlbumListItem } | null = null;

const handlePointerDown = (event: PointerEvent, index: number, album: AlbumListItem) => {
  if (isSearchActive.value || (event.pointerType === 'mouse' && event.button !== 0)) {
    return;
  }

  pointerDownInfo = { x: event.clientX, y: event.clientY, index, album };
};

const handleGlobalPointerMove = (event: PointerEvent) => {
  if (!pointerDownInfo || dragSession.active) {
    return;
  }

  if (event.pointerType !== 'mouse') {
    event.preventDefault();
  }

  const dist = Math.hypot(event.clientX - pointerDownInfo.x, event.clientY - pointerDownInfo.y);
  if (dist <= 5) {
    return;
  }

  dragSession.active = true;
  dragSession.type = 'album';
  dragSession.data = { index: pointerDownInfo.index, key: pointerDownInfo.album.key };
};

const resetAlbumDrag = () => {
  pointerDownInfo = null;
  if (dragSession.type === 'album') {
    dragSession.active = false;
    dragSession.type = 'song';
    dragSession.data = null;
    dragOverKey.value = null;
  }
};

const handleGlobalPointerEnd = (cancelled = false) => {
  if (!cancelled && dragSession.active && dragSession.type === 'album' && dragOverKey.value && pointerDownInfo) {
    const fromIndex = pointerDownInfo.index;
    const toIndex = filteredAlbumList.value.findIndex((album) => album.key === dragOverKey.value);

    if (toIndex !== -1 && fromIndex !== toIndex) {
      const list = [...filteredAlbumList.value];
      const [removed] = list.splice(fromIndex, 1);
      if (removed) {
        list.splice(toIndex, 0, removed);
        updateAlbumOrder(list.map((album) => album.key));
      }
    }
  }

  resetAlbumDrag();
};

const handleGlobalPointerUp = () => handleGlobalPointerEnd(false);
const handleGlobalPointerCancel = () => handleGlobalPointerEnd(true);

const handleItemPointerMove = (_event: PointerEvent, albumKey: string) => {
  if (dragSession.active && dragSession.type === 'album') {
    dragOverKey.value = albumKey;
  }
};

const closeMenu = (event: MouseEvent) => {
  const target = event.target as HTMLElement;
  if (!target.closest('.relative.z-50')) {
    showSortMenu.value = false;
  }
};

onMounted(() => {
  updateViewportMetrics();
  window.addEventListener('pointermove', handleGlobalPointerMove);
  window.addEventListener('pointerup', handleGlobalPointerUp);
  window.addEventListener('pointercancel', handleGlobalPointerCancel);
  window.addEventListener('click', closeMenu);
  window.addEventListener('resize', updateViewportMetrics);
  if (containerRef.value) {
    containerResizeObserver = new ResizeObserver(() => {
      updateViewportMetrics();
      void measureAlbumCardHeight();
    });
    containerResizeObserver.observe(containerRef.value);
  }
  requestAnimationFrame(() => {
    void measureAlbumCardHeight();
    scheduleCoverObserverRefresh();
  });
});

onBeforeUnmount(() => {
  saveViewportCoverSnapshot();
});

onUnmounted(() => {
  window.removeEventListener('pointermove', handleGlobalPointerMove);
  window.removeEventListener('pointerup', handleGlobalPointerUp);
  window.removeEventListener('pointercancel', handleGlobalPointerCancel);
  window.removeEventListener('click', closeMenu);
  window.removeEventListener('resize', updateViewportMetrics);
  if (containerResizeObserver) {
    containerResizeObserver.disconnect();
    containerResizeObserver = null;
  }
  if (coverObserver) {
    coverObserver.disconnect();
    coverObserver = null;
  }
  if (coverObserverRefreshFrame) {
    cancelAnimationFrame(coverObserverRefreshFrame);
    coverObserverRefreshFrame = 0;
  }
  displayedCoverUrls.clear();
  visibleCoverPaths = new Set<string>();
});
</script>

<template>
  <div class="flex-1 flex flex-col overflow-hidden bg-transparent h-full min-h-0" @click="showSortMenu = false">
    <header class="h-auto px-6 pt-2 pb-3 shrink-0 select-none flex flex-col justify-center z-10 relative">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 pb-1">
          <h2 class="text-xl font-bold text-gray-900 dark:text-white">专辑列表</h2>
        </div>

        <div class="relative z-50 flex items-center gap-2">
          <button
            title="排序方式"
            class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
            @click.stop="showSortMenu = !showSortMenu"
          >
            <SortModeIcon class="h-4 w-4" />
          </button>

          <div v-if="showSortMenu" class="absolute right-0 top-full mt-2 w-48 bg-white/90 dark:bg-gray-800/90 backdrop-blur-md rounded-xl shadow-xl border border-gray-100 dark:border-white/10 overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-top-right">
            <div class="py-1">
              <button
                class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-between"
                :class="albumSortMode === 'artist' ? 'text-[#EC4141] font-medium' : 'text-gray-700 dark:text-gray-200'"
                @click="handleSortChange('artist')"
              >
                <span>按专辑艺人排序</span>
                <svg v-if="albumSortMode === 'artist'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
              </button>
              <button
                class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-between"
                :class="albumSortMode === 'name' ? 'text-[#EC4141] font-medium' : 'text-gray-700 dark:text-gray-200'"
                @click="handleSortChange('name')"
              >
                <span>按名称排序 (A-Z)</span>
                <svg v-if="albumSortMode === 'name'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
              </button>
              <button
                class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-between"
                :class="albumSortMode === 'count' ? 'text-[#EC4141] font-medium' : 'text-gray-700 dark:text-gray-200'"
                @click="handleSortChange('count')"
              >
                <span>按数量排序 (多->少)</span>
                <svg v-if="albumSortMode === 'count'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
              </button>
              <button
                class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-between cursor-default"
                :class="albumSortMode === 'custom' ? 'text-[#EC4141] font-medium' : 'text-gray-700 dark:text-gray-200'"
              >
                <span>自定义排序 (拖拽触发)</span>
                <svg v-if="albumSortMode === 'custom'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>

    <section ref="containerRef" class="albums-scroll-container flex-1 overflow-y-auto px-4 pb-4 pt-2 md:px-6 md:pb-6 md:pt-3 lg:px-8 lg:pb-8 lg:pt-3 custom-scrollbar relative z-0" @scroll="handleContainerScroll">
      <div
        v-if="stickyAlbumHeader"
        class="pointer-events-none sticky top-0 z-20"
        :style="{ height: `${ALBUM_SECTION_HEADER_HEIGHT}px`, marginBottom: `-${ALBUM_SECTION_HEADER_HEIGHT}px` }"
        aria-hidden="true"
      >
        <div
          class="h-6 flex items-end gap-3 pb-0"
          :style="{ transform: `translateY(${stickyAlbumHeader.offset})`, willChange: 'transform' }"
        >
          <div class="text-xl md:text-2xl font-black tracking-[0.2em] text-gray-900 dark:text-white/90">
            {{ stickyAlbumHeader.title }}
          </div>
        </div>
      </div>

      <div
        v-if="albumSortMode === 'name'"
        :style="{ paddingTop: groupedAlbumVirtualState.paddingTop, paddingBottom: groupedAlbumVirtualState.paddingBottom }"
      >
        <template v-for="row in groupedAlbumVirtualState.rows" :key="row.key">
          <div
            v-if="row.type === 'header'"
            class="h-6 flex items-end gap-3 pb-0 transition-opacity duration-150"
            :class="{ 'opacity-0': isStickyAlbumHeaderRow(row.key, row.top) }"
          >
            <div class="text-xl md:text-2xl font-black tracking-[0.2em] text-gray-900 dark:text-white/90">
              {{ row.title }}
            </div>
          </div>

          <div
            v-else
            class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-6"
            :style="{ paddingBottom: `${row.bottomGap}px` }"
          >
            <div
              v-for="item in row.items"
              :key="item.album.key"
              data-album-card
              class="group cursor-pointer rounded-xl p-2 md:p-3 transition-all duration-300 flex flex-col relative select-none hover:bg-white/40 dark:hover:bg-white/5 [touch-action:none]"
              :class="[
                dragSession.active && dragSession.type === 'album' && dragSession.data?.key === item.album.key ? 'opacity-50' : '',
                { 'ring-2 ring-[#EC4141] bg-red-50 dark:bg-red-900/20': dragSession.active && dragSession.type === 'album' && dragOverKey === item.album.key && dragSession.data?.key !== item.album.key },
              ]"
              @pointerdown="handlePointerDown($event, item.index, item.album)"
              @pointermove="handleItemPointerMove($event, item.album.key)"
              @click="handleAlbumClick(item.album.key)"
            >
              <div class="relative w-full aspect-square mb-3 mt-1" :data-cover-path="item.album.firstSongPath">
                <div class="absolute inset-x-2 top-0 bottom-1/2 bg-[#1c1c1c] rounded-t-full shadow-inner origin-bottom translate-y-[-10%] group-hover:translate-y-[-24%] transition-transform duration-500 ease-out z-0 flex items-center justify-center overflow-hidden border border-[#333]">
                  <div class="absolute inset-0 rounded-t-full border border-white/5 scale-90"></div>
                  <div class="absolute inset-0 rounded-t-full border border-white/5 scale-75"></div>
                  <div class="absolute inset-0 rounded-t-full border border-white/5 scale-50"></div>
                </div>

                <div class="absolute inset-0 z-10 bg-white dark:bg-gray-800 rounded-md shadow-md border border-gray-100 dark:border-white/10 p-1 flex items-center justify-center overflow-hidden group-hover:shadow-xl transition-shadow duration-300">
                  <img
                    v-if="getDisplayedCoverUrl(item.album.firstSongPath)"
                    :src="getDisplayedCoverUrl(item.album.firstSongPath)"
                    :alt="item.album.name"
                    loading="lazy"
                    decoding="async"
                    draggable="false"
                    class="w-full h-full rounded-sm object-cover select-none"
                  />

                  <div
                    v-else
                    class="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-white/5 dark:to-white/10 rounded-sm flex items-center justify-center text-4xl font-bold text-gray-300 dark:text-gray-600 shadow-inner"
                    :class="{ 'animate-pulse': isCoverLoading(item.album.firstSongPath) }"
                  >
                    {{ item.album.name ? item.album.name.substring(0, 1).toUpperCase() : 'A' }}
                  </div>
                </div>
              </div>

              <div class="flex flex-col items-start px-1 z-20">
                <h3 class="font-bold text-sm md:text-base text-gray-800 dark:text-gray-200 truncate w-full group-hover:text-[#EC4141] transition-colors leading-tight">
                  {{ item.album.name }}
                </h3>
                <p class="text-xs text-gray-500 dark:text-gray-400 truncate w-full mt-1.5 flex items-center gap-1.5 opacity-80">
                  <span class="font-medium">{{ item.album.count }}首</span>
                  <span class="w-0.5 h-0.5 rounded-full bg-gray-400"></span>
                  <span>{{ item.album.artist }}</span>
                </p>
              </div>
            </div>
          </div>
        </template>
      </div>

      <div
        v-else
        class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-6 gap-y-10"
        :style="{ paddingTop: flatAlbumVirtualState.paddingTop, paddingBottom: flatAlbumVirtualState.paddingBottom }"
      >
        <div
          v-for="item in flatAlbumVirtualState.items"
          :key="item.album.key"
          data-album-card
          class="group cursor-pointer rounded-xl p-2 md:p-3 transition-all duration-300 flex flex-col relative select-none hover:bg-white/40 dark:hover:bg-white/5 [touch-action:none]"
          :class="[
            dragSession.active && dragSession.type === 'album' && dragSession.data?.key === item.album.key ? 'opacity-50' : '',
            { 'ring-2 ring-[#EC4141] bg-red-50 dark:bg-red-900/20': dragSession.active && dragSession.type === 'album' && dragOverKey === item.album.key && dragSession.data?.key !== item.album.key },
          ]"
          @pointerdown="handlePointerDown($event, item.index, item.album)"
          @pointermove="handleItemPointerMove($event, item.album.key)"
          @click="handleAlbumClick(item.album.key)"
        >
          <div class="relative w-full aspect-square mb-3 mt-1" :data-cover-path="item.album.firstSongPath">
            <div class="absolute inset-x-2 top-0 bottom-1/2 bg-[#1c1c1c] rounded-t-full shadow-inner origin-bottom translate-y-[-10%] group-hover:translate-y-[-24%] transition-transform duration-500 ease-out z-0 flex items-center justify-center overflow-hidden border border-[#333]">
              <div class="absolute inset-0 rounded-t-full border border-white/5 scale-90"></div>
              <div class="absolute inset-0 rounded-t-full border border-white/5 scale-75"></div>
              <div class="absolute inset-0 rounded-t-full border border-white/5 scale-50"></div>
            </div>

            <div class="absolute inset-0 z-10 bg-white dark:bg-gray-800 rounded-md shadow-md border border-gray-100 dark:border-white/10 p-1 flex items-center justify-center overflow-hidden group-hover:shadow-xl transition-shadow duration-300">
              <img
                v-if="getDisplayedCoverUrl(item.album.firstSongPath)"
                :src="getDisplayedCoverUrl(item.album.firstSongPath)"
                :alt="item.album.name"
                loading="lazy"
                decoding="async"
                draggable="false"
                class="w-full h-full rounded-sm object-cover select-none"
              />

              <div
                v-else
                class="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-white/5 dark:to-white/10 rounded-sm flex items-center justify-center text-4xl font-bold text-gray-300 dark:text-gray-600 shadow-inner"
                :class="{ 'animate-pulse': isCoverLoading(item.album.firstSongPath) }"
              >
                {{ item.album.name ? item.album.name.substring(0, 1).toUpperCase() : 'A' }}
              </div>
            </div>
          </div>

          <div class="flex flex-col items-start px-1 z-20">
            <h3 class="font-bold text-sm md:text-base text-gray-800 dark:text-gray-200 truncate w-full group-hover:text-[#EC4141] transition-colors leading-tight">
              {{ item.album.name }}
            </h3>
            <p class="text-xs text-gray-500 dark:text-gray-400 truncate w-full mt-1.5 flex items-center gap-1.5 opacity-80">
              <span class="font-medium">{{ item.album.count }}首</span>
              <span class="w-0.5 h-0.5 rounded-full bg-gray-400"></span>
              <span>{{ item.album.artist }}</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.albums-scroll-container {
  overflow-anchor: none;
}
</style>
