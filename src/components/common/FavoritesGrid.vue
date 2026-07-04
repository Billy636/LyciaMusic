<script setup lang="ts">
import { useLibraryBrowse } from '../../features/library/useLibraryBrowse';
import { usePlayerViewState } from '../../composables/usePlayerViewState';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useCoverCache } from '../../composables/useCoverCache';
import { convertFileSrc } from '@tauri-apps/api/core';
import ArtistAlbumContextMenu from '../overlays/ArtistAlbumContextMenu.vue';

const { favTab } = usePlayerViewState();
const { favArtistList, favAlbumList } = useLibraryBrowse();

const emit = defineEmits<{
  (e: 'enterDetail', type: 'artist' | 'album', name: string): void
}>();

const { coverCache, loadCover } = useCoverCache();
const rootRef = ref<HTMLElement | null>(null);
const itemRefs = ref<HTMLElement[]>([]);
const scrollParentRef = ref<HTMLElement | null>(null);
const containerHeight = ref(720);
const containerWidth = ref(1200);
const viewportWidth = ref(window.innerWidth);
const visibleTop = ref(0);
const visibleBottom = ref(720);
let observer: IntersectionObserver | null = null;
let resizeObserver: ResizeObserver | null = null;
let scrollFrame = 0;

const FAVORITES_OVERSCAN_ROWS = 2;
const FAVORITES_BASE_GAP = 20;
const FAVORITES_SM_GAP = 24;
const FAVORITE_ARTIST_CARD_EXTRA_HEIGHT = 56;
const FAVORITE_ALBUM_CARD_EXTRA_HEIGHT = 0;

type FavoriteArtistItem = (typeof favArtistList.value)[number];
type FavoriteAlbumItem = (typeof favAlbumList.value)[number];
type FavoriteGridItem =
  | {
      key: string;
      type: 'artist';
      name: string;
      count: number;
      firstSongPath: string;
      artist: FavoriteArtistItem;
    }
  | {
      key: string;
      type: 'album';
      name: string;
      count: number;
      firstSongPath: string;
      albumArtist: string;
      album: FavoriteAlbumItem;
    };

const ensureCoverLoaded = async (path: string) => {
  if (!path || coverCache.get(path)) return;
  try {
    await loadCover(path);
  } catch {}
};

const favoriteItems = computed<FavoriteGridItem[]>(() => {
  if (favTab.value === 'artists') {
    return favArtistList.value.map(artist => ({
      key: `artist::${artist.name}`,
      type: 'artist' as const,
      name: artist.name,
      count: artist.count,
      firstSongPath: artist.firstSongPath,
      artist,
    }));
  }

  return favAlbumList.value.map(album => ({
    key: `album::${album.name}::${album.artist}`,
    type: 'album' as const,
    name: album.name,
    count: album.count,
    firstSongPath: album.firstSongPath,
    albumArtist: album.artist,
    album,
  }));
});

const getGridColumns = () => {
  if (viewportWidth.value >= 1280) {
    return 6;
  }

  if (viewportWidth.value >= 1024) {
    return 5;
  }

  if (viewportWidth.value >= 640) {
    return 4;
  }

  return 3;
};

const gridColumns = ref(getGridColumns());

const gridGap = computed(() => (viewportWidth.value >= 640 ? FAVORITES_SM_GAP : FAVORITES_BASE_GAP));

const itemRowSpan = computed(() => {
  const columns = Math.max(1, gridColumns.value);
  const gap = gridGap.value;
  const width = Math.max(0, containerWidth.value - gap * (columns - 1));
  const itemWidth = width / columns;
  const extraHeight = favTab.value === 'artists'
    ? FAVORITE_ARTIST_CARD_EXTRA_HEIGHT
    : FAVORITE_ALBUM_CARD_EXTRA_HEIGHT;

  return itemWidth + extraHeight + gap;
});

const totalRows = computed(() => Math.ceil(favoriteItems.value.length / Math.max(1, gridColumns.value)));

const virtualGridState = computed(() => {
  const rowSpan = Math.max(1, itemRowSpan.value);
  const startRow = Math.max(0, Math.floor(visibleTop.value / rowSpan) - FAVORITES_OVERSCAN_ROWS);
  const endRow = Math.min(
    totalRows.value,
    Math.ceil(visibleBottom.value / rowSpan) + FAVORITES_OVERSCAN_ROWS,
  );
  const startIndex = startRow * gridColumns.value;
  const endIndex = Math.min(favoriteItems.value.length, endRow * gridColumns.value);

  return {
    items: favoriteItems.value.slice(startIndex, endIndex),
    paddingTop: `${startRow * rowSpan}px`,
    paddingBottom: `${Math.max(0, (totalRows.value - endRow) * rowSpan)}px`,
  };
});

const setItemRef = (target: Element | { $el?: Element | null } | null, index: number) => {
  const el = target instanceof HTMLElement
    ? target
    : target && '$el' in target && target.$el instanceof HTMLElement
      ? target.$el
      : null;

  if (!el) {
    delete itemRefs.value[index];
    return;
  }

  itemRefs.value[index] = el;
};

const findScrollParent = (element: HTMLElement | null) => {
  let current = element?.parentElement ?? null;

  while (current) {
    const style = window.getComputedStyle(current);
    if (/(auto|scroll)/.test(style.overflowY)) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
};

const updateLayoutMetrics = () => {
  if (!rootRef.value) {
    return;
  }

  viewportWidth.value = window.innerWidth;
  gridColumns.value = getGridColumns();
  const style = window.getComputedStyle(rootRef.value);
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(style.paddingRight) || 0;
  containerWidth.value = Math.max(0, rootRef.value.clientWidth - paddingLeft - paddingRight);
};

const updateViewportRange = () => {
  if (!rootRef.value) {
    return;
  }

  const rootRect = rootRef.value.getBoundingClientRect();

  if (scrollParentRef.value) {
    const parentRect = scrollParentRef.value.getBoundingClientRect();
    containerHeight.value = scrollParentRef.value.clientHeight;
    visibleTop.value = Math.max(0, parentRect.top - rootRect.top);
    visibleBottom.value = Math.min(rootRect.height, parentRect.bottom - rootRect.top);
    return;
  }

  containerHeight.value = window.innerHeight;
  visibleTop.value = Math.max(0, -rootRect.top);
  visibleBottom.value = Math.min(rootRect.height, window.innerHeight - rootRect.top);
};

const requestViewportUpdate = () => {
  if (scrollFrame) {
    cancelAnimationFrame(scrollFrame);
  }

  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    updateViewportRange();
  });
};

const initObserver = () => {
  if (observer) observer.disconnect();

  observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const target = entry.target as HTMLElement;
        const path = target.dataset.path;
        if (path) {
          void ensureCoverLoaded(path);
          observer?.unobserve(target);
        }
      }
    });
  }, {
    root: scrollParentRef.value,
    rootMargin: '120px 0px',
  });

  itemRefs.value.forEach(el => {
    if (el) observer?.observe(el);
  });
};

watch([virtualGridState, favTab], async () => {
  await nextTick();
  initObserver();
}, { immediate: true });

const showContextMenu = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuTargetKey = ref('');
const contextMenuTargetName = ref('');
const contextMenuType = ref<'artist' | 'album'>('artist');

const handleContextMenu = (event: MouseEvent, item: FavoriteGridItem) => {
  contextMenuX.value = event.clientX;
  contextMenuY.value = event.clientY;
  contextMenuType.value = item.type;
  if (item.type === 'artist') {
    contextMenuTargetKey.value = item.name;
  } else {
    contextMenuTargetKey.value = item.album.key;
  }
  contextMenuTargetName.value = item.name;
  showContextMenu.value = true;
};

onMounted(() => {
  scrollParentRef.value = findScrollParent(rootRef.value);
  updateLayoutMetrics();
  updateViewportRange();

  const scrollTarget = scrollParentRef.value ?? window;
  scrollTarget.addEventListener('scroll', requestViewportUpdate, { passive: true });
  window.addEventListener('resize', updateLayoutMetrics);
  window.addEventListener('resize', requestViewportUpdate);

  if (rootRef.value) {
    resizeObserver = new ResizeObserver(() => {
      updateLayoutMetrics();
      requestViewportUpdate();
    });
    resizeObserver.observe(rootRef.value);
  }
});

onUnmounted(() => {
  if (observer) observer.disconnect();
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  const scrollTarget = scrollParentRef.value ?? window;
  scrollTarget.removeEventListener('scroll', requestViewportUpdate);
  window.removeEventListener('resize', updateLayoutMetrics);
  window.removeEventListener('resize', requestViewportUpdate);
  if (scrollFrame) {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
  }
});
</script>

<template>
  <div
    ref="rootRef"
    class="favorites-grid p-4"
    :style="{ paddingTop: virtualGridState.paddingTop, paddingBottom: virtualGridState.paddingBottom }"
  >
    <template v-if="favTab === 'artists'">
      <div
        v-for="(item, index) in virtualGridState.items"
        v-show="item.type === 'artist'"
        :key="item.key"
        @click="item.type === 'artist' && emit('enterDetail', 'artist', item.name)"
        @contextmenu.prevent="handleContextMenu($event, item)"
        class="group cursor-pointer"
      >
        <div
          :ref="(el) => setItemRef(el, index)"
          :data-path="item.firstSongPath"
          class="relative aspect-square rounded-full overflow-hidden shadow-md
                 group-hover:shadow-xl transition-all duration-300 ease-out group-hover:scale-[1.03]"
        >
          <img
            v-if="item.type === 'artist' && (item.artist.avatarPath || coverCache.get(item.firstSongPath))"
            :src="item.type === 'artist' && item.artist.avatarPath ? convertFileSrc(item.artist.avatarPath) : coverCache.get(item.firstSongPath)"
            class="w-full h-full object-cover"
            alt="Artist"
            loading="lazy"
            decoding="async"
          />

          <div v-else class="w-full h-full bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center">
            <span class="text-xl font-semibold text-indigo-300">艺人</span>
          </div>

          <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

          <div class="absolute inset-0 flex flex-col items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-all duration-300">
            <span class="font-bold text-sm truncate max-w-[80%] text-center drop-shadow-md">{{ item.name }}</span>
            <span class="text-xs opacity-80 mt-1">{{ item.count }} 首</span>
          </div>
        </div>

        <div class="mt-2 text-center">
          <span class="font-bold text-gray-800 dark:text-gray-200 text-sm truncate block group-hover:text-[#EC4141] transition-colors">{{ item.name }}</span>
          <span class="text-xs text-gray-400">{{ item.count }} 首</span>
        </div>
      </div>
    </template>

    <template v-if="favTab === 'albums'">
      <div
        v-for="(item, index) in virtualGridState.items"
        v-show="item.type === 'album'"
        :key="item.key"
        @click="item.type === 'album' && emit('enterDetail', 'album', item.name)"
        @contextmenu.prevent="handleContextMenu($event, item)"
        class="group cursor-pointer"
      >
        <div
          :ref="(el) => setItemRef(el, index)"
          :data-path="item.firstSongPath"
          class="relative aspect-square rounded-lg overflow-hidden shadow-md
                 group-hover:shadow-xl transition-all duration-300 ease-out group-hover:scale-[1.03]"
        >
          <img
            v-if="coverCache.get(item.firstSongPath)"
            :src="coverCache.get(item.firstSongPath)"
            class="w-full h-full object-cover"
            alt="Album"
            loading="lazy"
            decoding="async"
          />

          <div v-else class="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
            <span class="text-xl font-semibold text-gray-300">专辑</span>
          </div>

          <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

          <div class="absolute inset-x-0 bottom-0 p-3 text-white">
            <span class="font-bold text-sm truncate block drop-shadow-md">{{ item.name }}</span>
            <span class="text-xs opacity-80 truncate block">{{ item.type === 'album' ? item.albumArtist : '' }}</span>
          </div>
        </div>
      </div>
    </template>

    <ArtistAlbumContextMenu
      :visible="showContextMenu"
      :x="contextMenuX"
      :y="contextMenuY"
      :type="contextMenuType"
      :targetKey="contextMenuTargetKey"
      :targetName="contextMenuTargetName"
      @close="showContextMenu = false"
    />
  </div>
</template>

<style scoped>
.favorites-grid {
  display: grid;
  gap: 1.25rem;
  grid-template-columns: repeat(3, 1fr);
}

@media (min-width: 640px) {
  .favorites-grid {
    grid-template-columns: repeat(4, 1fr);
    gap: 1.5rem;
  }
}

@media (min-width: 1024px) {
  .favorites-grid {
    grid-template-columns: repeat(5, 1fr);
  }
}

@media (min-width: 1280px) {
  .favorites-grid {
    grid-template-columns: repeat(6, 1fr);
  }
}
</style>
