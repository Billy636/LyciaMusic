<script setup lang="ts">
defineOptions({ name: 'Artists' });

import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { artistHeaderCache, artistViewportCoverSnapshotCache } from '../caches/imageCaches';
import { dragSession } from '../composables/dragState';
import { useCoverCache } from '../composables/useCoverCache';
import { useHomeNavigation } from '../composables/useHomeNavigation';
import { useListScrollMemory } from '../composables/useListScrollMemory';
import SortModeIcon from '../components/common/SortModeIcon.vue';
import { useLibraryBrowse } from '../features/library/useLibraryBrowse';
import type { ArtistListItem } from '../features/library/playerLibraryViewShared';
import { getAlphabetIndexKey } from '../utils/alphabetIndex';

const { filteredArtistList, artistSortMode, updateArtistOrder, searchQuery } = useLibraryBrowse();
const router = useRouter();
const route = useRoute();
const { openHomeArtist } = useHomeNavigation(router);
const isSearchActive = computed(() => searchQuery.value.trim().length > 0);
const { coverCache, loadCover, touchCoverPaths, isCoverLoading, preloadPriorityCovers } = useCoverCache();

const showSortMenu = ref(false);
const dragOverName = ref<string | null>(null);
const containerRef = ref<HTMLElement | null>(null);
const containerScrollTop = ref(0);
const containerHeight = ref(720);
const displayedCoverUrls = reactive(new Map<string, string>());
let coverObserver: IntersectionObserver | null = null;
let containerResizeObserver: ResizeObserver | null = null;
let visibleCoverPaths = new Set<string>();
const VIEWPORT_SNAPSHOT_KEY = 'artists-current';
const VIEWPORT_SNAPSHOT_LIMIT = 72;
const ARTIST_GRID_GAP_Y = 16;
const ARTIST_SECTION_GAP_Y = 8;
const ARTIST_ITEM_HEIGHT = 72;
const ARTIST_ROW_SPAN = ARTIST_ITEM_HEIGHT + ARTIST_GRID_GAP_Y;
const ARTIST_SECTION_HEADER_HEIGHT = 24;
const ARTIST_OVERSCAN_ROWS = 2;

const handleArtistClick = (artistName: string, firstSongPath?: string) => {
  const cachedCover = getDisplayedCoverUrl(firstSongPath);
  if (cachedCover) {
    artistHeaderCache.set(artistName, cachedCover);
  }
  void openHomeArtist(artistName);
};

const handleSortChange = (mode: 'count' | 'name' | 'custom') => {
  artistSortMode.value = mode;
  showSortMenu.value = false;
};

const getArtistGridColumns = () => {
  if (window.innerWidth >= 1536) {
    return 5;
  }

  if (window.innerWidth >= 1280) {
    return 4;
  }

  if (window.innerWidth >= 1024) {
    return 3;
  }

  return 2;
};

const artistGridColumns = ref(getArtistGridColumns());

const updateViewportMetrics = () => {
  if (containerRef.value) {
    containerHeight.value = containerRef.value.clientHeight;
  }

  artistGridColumns.value = getArtistGridColumns();
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
  const snapshot = artistViewportCoverSnapshotCache.get(VIEWPORT_SNAPSHOT_KEY);
  if (!snapshot || snapshot.length === 0) {
    return;
  }

  displayedCoverUrls.clear();
  snapshot
    .filter(entry => !!entry.path && !!entry.url)
    .forEach((entry) => {
      displayedCoverUrls.set(entry.path, entry.url);
    });
  preloadPriorityCovers(snapshot.map(entry => entry.path));
};

const saveViewportCoverSnapshot = () => {
  if (!containerRef.value) {
    return;
  }

  const containerRect = containerRef.value.getBoundingClientRect();
  const viewportBuffer = containerRef.value.clientHeight;
  const snapshotTop = containerRect.top - viewportBuffer;
  const snapshotBottom = containerRect.bottom + viewportBuffer;
  const snapshot: Array<{ path: string; url: string }> = [];
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

    const url = getDisplayedCoverUrl(path);
    if (!url) {
      return;
    }

    seenPaths.add(path);
    snapshot.push({ path, url });
  });

  if (snapshot.length > 0) {
    artistViewportCoverSnapshotCache.set(VIEWPORT_SNAPSHOT_KEY, snapshot);
    return;
  }

  artistViewportCoverSnapshotCache.delete(VIEWPORT_SNAPSHOT_KEY);
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

const artistSections = computed(() => {
  const sections: Array<{
    key: string;
    items: Array<{ artist: ArtistListItem; index: number }>;
  }> = [];

  filteredArtistList.value.forEach((artist, index) => {
    const key = getAlphabetIndexKey(artist.name);
    const lastSection = sections[sections.length - 1];

    if (!lastSection || lastSection.key !== key) {
      sections.push({
        key,
        items: [{ artist, index }],
      });
      return;
    }

    lastSection.items.push({ artist, index });
  });

  return sections;
});

type ArtistSectionEntry = { artist: ArtistListItem; index: number };
type ArtistVirtualHeaderRow = { type: 'header'; key: string; title: string };
type ArtistVirtualItemsRow = { type: 'items'; key: string; items: ArtistSectionEntry[]; bottomGap: number };
type ArtistVirtualRow = ArtistVirtualHeaderRow | ArtistVirtualItemsRow;
type MeasuredArtistVirtualHeaderRow = ArtistVirtualHeaderRow & { top: number; height: number };
type MeasuredArtistVirtualItemsRow = ArtistVirtualItemsRow & { top: number; height: number };
type MeasuredArtistVirtualRow = MeasuredArtistVirtualHeaderRow | MeasuredArtistVirtualItemsRow;

const groupedArtistRows = computed<ArtistVirtualRow[]>(() => {
  const rows: ArtistVirtualRow[] = [];

  artistSections.value.forEach((section) => {
    rows.push({
      type: 'header',
      key: `header::${section.key}`,
      title: section.key,
    });

    for (let start = 0; start < section.items.length; start += artistGridColumns.value) {
      const isLastRowInSection = start + artistGridColumns.value >= section.items.length;
      rows.push({
        type: 'items',
        key: `items::${section.key}::${start}`,
        items: section.items.slice(start, start + artistGridColumns.value),
        bottomGap: isLastRowInSection ? ARTIST_SECTION_GAP_Y : ARTIST_GRID_GAP_Y,
      });
    }
  });

  return rows;
});

const measuredGroupedArtistRows = computed<MeasuredArtistVirtualRow[]>(() => {
  let totalHeight = 0;

  return groupedArtistRows.value.map((row) => {
    const height = row.type === 'header' ? ARTIST_SECTION_HEADER_HEIGHT : ARTIST_ITEM_HEIGHT + row.bottomGap;
    const measuredRow = {
      ...row,
      top: totalHeight,
      height,
    };
    totalHeight += height;
    return measuredRow;
  });
});

const groupedArtistVirtualState = computed(() => {
  const overscanPx = ARTIST_ROW_SPAN * ARTIST_OVERSCAN_ROWS;
  const startBoundary = Math.max(0, containerScrollTop.value - overscanPx);
  const endBoundary = containerScrollTop.value + containerHeight.value + overscanPx;

  let totalHeight = 0;
  let startIndex = 0;
  let endIndex = groupedArtistRows.value.length;
  const measuredRows = measuredGroupedArtistRows.value;
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

const stickyArtistHeader = computed(() => {
  if (artistSortMode.value !== 'name') {
    return null;
  }

  const headerRows = measuredGroupedArtistRows.value.filter(
    (row): row is MeasuredArtistVirtualHeaderRow => row.type === 'header',
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

const isStickyArtistHeaderRow = (rowKey: string, rowTop: number) => {
  const stickyHeader = stickyArtistHeader.value;
  if (!stickyHeader) {
    return false;
  }

  return stickyHeader.key === rowKey && stickyHeader.shouldHideSourceRow && rowTop <= containerScrollTop.value;
};

const flatArtistVirtualState = computed(() => {
  const totalRows = Math.ceil(filteredArtistList.value.length / artistGridColumns.value);
  const startRow = Math.max(0, Math.floor(containerScrollTop.value / ARTIST_ROW_SPAN) - ARTIST_OVERSCAN_ROWS);
  const endRow = Math.min(
    totalRows,
    Math.ceil((containerScrollTop.value + containerHeight.value) / ARTIST_ROW_SPAN) + ARTIST_OVERSCAN_ROWS,
  );
  const startIndex = startRow * artistGridColumns.value;
  const endIndex = Math.min(filteredArtistList.value.length, endRow * artistGridColumns.value);

  return {
    items: filteredArtistList.value.slice(startIndex, endIndex).map((artist, offset) => ({
      artist,
      index: startIndex + offset,
    })),
    paddingTop: `${startRow * ARTIST_ROW_SPAN}px`,
    paddingBottom: `${Math.max(0, (totalRows - endRow) * ARTIST_ROW_SPAN)}px`,
  };
});

const visibleArtistCoverPaths = computed(() => {
  if (artistSortMode.value === 'name') {
    return groupedArtistVirtualState.value.rows.flatMap((row) => {
      if (row.type !== 'items') {
        return [];
      }

      return row.items
        .map(item => item.artist.firstSongPath)
        .filter((path): path is string => !!path);
    });
  }

  return flatArtistVirtualState.value.items
    .map(item => item.artist.firstSongPath)
    .filter((path): path is string => !!path);
});

const initCoverObserver = async () => {
  await nextTick();

  if (coverObserver) {
    coverObserver.disconnect();
  }

  if (!containerRef.value) {
    return;
  }

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

  containerRef.value.querySelectorAll<HTMLElement>('[data-cover-path]').forEach((element) => {
    coverObserver?.observe(element);
  });
};

const scrollMemoryKey = computed(
  () => ['artists-view', route.path, artistSortMode.value, searchQuery.value.trim()].join('::'),
);

useListScrollMemory(scrollMemoryKey, containerRef);

watch(
  [visibleArtistCoverPaths, artistSortMode],
  ([paths]) => {
    syncVisibleCoverUrls(paths);
    preloadPriorityCovers(paths);
    void initCoverObserver();
  },
  { immediate: true, flush: 'post' },
);

const gradients = [
  'from-pink-500 to-rose-500',
  'from-purple-500 to-indigo-500',
  'from-cyan-500 to-blue-500',
  'from-emerald-400 to-teal-500',
  'from-amber-400 to-orange-500',
  'from-fuchsia-500 to-pink-500',
  'from-blue-400 to-indigo-500',
  'from-violet-500 to-purple-500',
];

const getGradientForArtist = (name: string) => {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = name.charCodeAt(index) + ((hash << 5) - hash);
  }

  return gradients[Math.abs(hash) % gradients.length];
};

let pointerDownInfo: { x: number; y: number; index: number; artist: ArtistListItem } | null = null;

const handlePointerDown = (event: PointerEvent, index: number, artist: ArtistListItem) => {
  if (isSearchActive.value || (event.pointerType === 'mouse' && event.button !== 0)) {
    return;
  }

  pointerDownInfo = { x: event.clientX, y: event.clientY, index, artist };
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
  dragSession.type = 'artist';
  dragSession.data = { index: pointerDownInfo.index, name: pointerDownInfo.artist.name };
};

const resetArtistDrag = () => {
  pointerDownInfo = null;
  if (dragSession.type === 'artist') {
    dragSession.active = false;
    dragSession.type = 'song';
    dragSession.data = null;
    dragOverName.value = null;
  }
};

const handleGlobalPointerEnd = (cancelled = false) => {
  if (!cancelled && dragSession.active && dragSession.type === 'artist' && dragOverName.value && pointerDownInfo) {
    const fromIndex = pointerDownInfo.index;
    const toIndex = filteredArtistList.value.findIndex((artist) => artist.name === dragOverName.value);

    if (toIndex !== -1 && fromIndex !== toIndex) {
      const list = [...filteredArtistList.value];
      const [removed] = list.splice(fromIndex, 1);
      if (removed) {
        list.splice(toIndex, 0, removed);
        updateArtistOrder(list.map((artist) => artist.name));
      }
    }
  }

  resetArtistDrag();
};

const handleGlobalPointerUp = () => handleGlobalPointerEnd(false);
const handleGlobalPointerCancel = () => handleGlobalPointerEnd(true);

const handleItemPointerMove = (_event: PointerEvent, artistName: string) => {
  if (dragSession.active && dragSession.type === 'artist') {
    dragOverName.value = artistName;
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
    });
    containerResizeObserver.observe(containerRef.value);
  }
  requestAnimationFrame(() => {
    void initCoverObserver();
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
  displayedCoverUrls.clear();
  visibleCoverPaths = new Set<string>();
});
</script>

<template>
  <div class="flex-1 flex flex-col overflow-hidden bg-transparent h-full min-h-0" @click="showSortMenu = false">
    <header class="h-auto px-6 pt-2 pb-3 shrink-0 select-none flex flex-col justify-center z-10 relative">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 pb-1">
          <h2 class="text-xl font-bold text-gray-900 dark:text-white">歌手列表</h2>
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
                :class="artistSortMode === 'name' ? 'text-[#EC4141] font-medium' : 'text-gray-700 dark:text-gray-200'"
                @click="handleSortChange('name')"
              >
                <span>按名称排序 (A-Z)</span>
                <svg v-if="artistSortMode === 'name'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
              </button>
              <button
                class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-between"
                :class="artistSortMode === 'count' ? 'text-[#EC4141] font-medium' : 'text-gray-700 dark:text-gray-200'"
                @click="handleSortChange('count')"
              >
                <span>按数量排序 (多->少)</span>
                <svg v-if="artistSortMode === 'count'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
              </button>
              <button
                class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-between cursor-default"
                :class="artistSortMode === 'custom' ? 'text-[#EC4141] font-medium' : 'text-gray-700 dark:text-gray-200'"
              >
                <span>自定义排序 (拖拽触发)</span>
                <svg v-if="artistSortMode === 'custom'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>

    <section ref="containerRef" class="artists-scroll-container flex-1 overflow-y-auto px-4 pb-4 pt-2 md:px-6 md:pb-6 md:pt-3 lg:px-8 lg:pb-8 lg:pt-3 custom-scrollbar relative z-0" @scroll="handleContainerScroll">
      <div
        v-if="stickyArtistHeader"
        class="pointer-events-none sticky top-0 z-20"
        :style="{ height: `${ARTIST_SECTION_HEADER_HEIGHT}px`, marginBottom: `-${ARTIST_SECTION_HEADER_HEIGHT}px` }"
        aria-hidden="true"
      >
        <div
          class="h-6 flex items-end gap-3 pb-0"
          :style="{ transform: `translateY(${stickyArtistHeader.offset})`, willChange: 'transform' }"
        >
          <div class="text-xl md:text-2xl font-black tracking-[0.2em] text-gray-900 dark:text-white/90">
            {{ stickyArtistHeader.title }}
          </div>
        </div>
      </div>

      <div
        v-if="artistSortMode === 'name'"
        :style="{ paddingTop: groupedArtistVirtualState.paddingTop, paddingBottom: groupedArtistVirtualState.paddingBottom }"
      >
        <template v-for="row in groupedArtistVirtualState.rows" :key="row.key">
          <div
            v-if="row.type === 'header'"
            class="h-6 flex items-end gap-3 pb-0 transition-opacity duration-150"
            :class="{ 'opacity-0': isStickyArtistHeaderRow(row.key, row.top) }"
          >
            <div class="text-xl md:text-2xl font-black tracking-[0.2em] text-gray-900 dark:text-white/90">
              {{ row.title }}
            </div>
          </div>

          <div
            v-else
            class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-6"
            :style="{ paddingBottom: `${row.bottomGap}px` }"
          >
            <div
              v-for="item in row.items"
              :key="item.artist.name"
              class="group cursor-pointer flex items-center gap-4 hover:bg-black/5 dark:hover:bg-white/5 p-2 rounded-lg transition-colors relative select-none [touch-action:none]"
              :class="[
                dragSession.active && dragSession.type === 'artist' && dragSession.data?.name === item.artist.name ? 'opacity-50' : '',
              ]"
              @pointerdown="handlePointerDown($event, item.index, item.artist)"
              @pointermove="handleItemPointerMove($event, item.artist.name)"
              @click="handleArtistClick(item.artist.name, item.artist.firstSongPath)"
            >
              <div
                class="relative w-12 h-12 md:w-14 md:h-14 shrink-0"
                :data-cover-path="item.artist.firstSongPath"
                :class="{ 'ring-2 ring-[#EC4141] ring-offset-2 ring-offset-gray-50 dark:ring-offset-[#222222] rounded-full': dragSession.active && dragSession.type === 'artist' && dragOverName === item.artist.name && dragSession.data?.name !== item.artist.name }"
              >
                <div class="w-full h-full rounded-full overflow-hidden shadow-sm group-hover:shadow transition-shadow duration-300 relative bg-gray-100 dark:bg-white/5 flex items-center justify-center">
                  <img v-if="getDisplayedCoverUrl(item.artist.firstSongPath)" :src="getDisplayedCoverUrl(item.artist.firstSongPath)" class="w-full h-full object-cover select-none animate-in fade-in duration-300" draggable="false" :alt="item.artist.name">
                  <div v-else class="w-full h-full flex items-center justify-center text-lg md:text-xl font-bold text-white bg-gradient-to-br animate-in fade-in duration-300" :class="[getGradientForArtist(item.artist.name), { 'animate-pulse': isCoverLoading(item.artist.firstSongPath) }]">
                    {{ item.artist.name.charAt(0).toUpperCase() }}
                  </div>
                  <div class="absolute inset-0 bg-white/0 group-hover:bg-white/10 dark:bg-black/5 dark:group-hover:bg-transparent transition-colors duration-300"></div>
                </div>
              </div>

              <div class="flex-1 min-w-0">
                <h3 class="font-medium text-sm md:text-base text-gray-800 dark:text-gray-200 truncate w-full group-hover:text-[#EC4141] transition-colors leading-snug">
                  {{ item.artist.name }}
                </h3>
              </div>
            </div>
          </div>
        </template>
      </div>

      <div
        v-else
        class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-6 gap-y-4"
        :style="{ paddingTop: flatArtistVirtualState.paddingTop, paddingBottom: flatArtistVirtualState.paddingBottom }"
      >
        <div
          v-for="item in flatArtistVirtualState.items"
          :key="item.artist.name"
          class="group cursor-pointer flex items-center gap-4 hover:bg-black/5 dark:hover:bg-white/5 p-2 rounded-lg transition-colors relative select-none [touch-action:none]"
          :class="[
            dragSession.active && dragSession.type === 'artist' && dragSession.data?.name === item.artist.name ? 'opacity-50' : '',
          ]"
          @pointerdown="handlePointerDown($event, item.index, item.artist)"
          @pointermove="handleItemPointerMove($event, item.artist.name)"
          @click="handleArtistClick(item.artist.name, item.artist.firstSongPath)"
        >
          <div
            class="relative w-12 h-12 md:w-14 md:h-14 shrink-0"
            :data-cover-path="item.artist.firstSongPath"
            :class="{ 'ring-2 ring-[#EC4141] ring-offset-2 ring-offset-gray-50 dark:ring-offset-[#222222] rounded-full': dragSession.active && dragSession.type === 'artist' && dragOverName === item.artist.name && dragSession.data?.name !== item.artist.name }"
          >
            <div class="w-full h-full rounded-full overflow-hidden shadow-sm group-hover:shadow transition-shadow duration-300 relative bg-gray-100 dark:bg-white/5 flex items-center justify-center">
              <img v-if="getDisplayedCoverUrl(item.artist.firstSongPath)" :src="getDisplayedCoverUrl(item.artist.firstSongPath)" class="w-full h-full object-cover select-none animate-in fade-in duration-300" draggable="false" :alt="item.artist.name">
              <div v-else class="w-full h-full flex items-center justify-center text-lg md:text-xl font-bold text-white bg-gradient-to-br animate-in fade-in duration-300" :class="[getGradientForArtist(item.artist.name), { 'animate-pulse': isCoverLoading(item.artist.firstSongPath) }]">
                {{ item.artist.name.charAt(0).toUpperCase() }}
              </div>
              <div class="absolute inset-0 bg-white/0 group-hover:bg-white/10 dark:bg-black/5 dark:group-hover:bg-transparent transition-colors duration-300"></div>
            </div>
          </div>

          <div class="flex-1 min-w-0">
            <h3 class="font-medium text-sm md:text-base text-gray-800 dark:text-gray-200 truncate w-full group-hover:text-[#EC4141] transition-colors leading-snug">
              {{ item.artist.name }}
            </h3>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.artists-scroll-container {
  overflow-anchor: none;
}
</style>
