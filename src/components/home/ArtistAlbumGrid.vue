<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, watch } from 'vue';
import { useVisibleCoverUrls } from '../../composables/useVisibleCoverUrls';
import HomeEmptyState from './HomeEmptyState.vue';

interface ArtistAlbumItem {
  key: string;
  name: string;
  count: number;
  artist: string;
  firstSongPath: string;
}

interface Props {
  albums: ArtistAlbumItem[];
}

const props = defineProps<Props>();
const containerRef = shallowRef<HTMLElement | null>(null);
const visibleCoverPaths = shallowRef<string[]>([]);
const { getDisplayedCoverUrl, isCoverLoading } = useVisibleCoverUrls(visibleCoverPaths, 'card');
let coverObserver: IntersectionObserver | null = null;
let observerRevision = 0;
let observedElements = new Map<HTMLElement, string>();
const intersectingElements = new Set<HTMLElement>();

const syncVisibleCoverPaths = () => {
  const paths = new Set<string>();
  for (const element of intersectingElements) {
    const path = observedElements.get(element);
    if (path) paths.add(path);
  }
  visibleCoverPaths.value = [...paths];
};

const refreshCoverObserver = () => {
  const container = containerRef.value;
  if (!container) return;

  const revision = ++observerRevision;
  coverObserver?.disconnect();
  coverObserver = null;

  if (typeof IntersectionObserver !== 'function') {
    observedElements.clear();
    intersectingElements.clear();
    visibleCoverPaths.value = props.albums.map(album => album.firstSongPath);
    return;
  }

  const nextElements = new Map<HTMLElement, string>();
  container.querySelectorAll<HTMLElement>('[data-cover-path]').forEach(element => {
    const path = element.dataset.coverPath;
    if (path) nextElements.set(element, path);
  });

  // Keep unchanged cards painted while a changed album list is re-observed.
  for (const element of intersectingElements) {
    if (!nextElements.has(element) || nextElements.get(element) !== observedElements.get(element)) {
      intersectingElements.delete(element);
    }
  }
  observedElements = nextElements;
  syncVisibleCoverPaths();

  coverObserver = new IntersectionObserver(entries => {
    if (revision !== observerRevision) return;
    for (const entry of entries) {
      const element = entry.target as HTMLElement;
      if (!observedElements.has(element)) continue;
      if (entry.isIntersecting) {
        intersectingElements.add(element);
      } else {
        intersectingElements.delete(element);
      }
    }
    // Multiple albums can share one song path; retain it until all leave.
    syncVisibleCoverPaths();
  }, { root: container, rootMargin: '200px 0px' });
  observedElements.forEach((_path, element) => coverObserver?.observe(element));
};

onMounted(refreshCoverObserver);
watch(
  () => props.albums.map(album => [album.key, album.firstSongPath]),
  refreshCoverObserver,
  { flush: 'post' },
);
onBeforeUnmount(() => {
  observerRevision += 1;
  coverObserver?.disconnect();
  coverObserver = null;
  observedElements.clear();
  intersectingElements.clear();
  visibleCoverPaths.value = [];
});

defineEmits<{
  (event: 'openAlbum', albumKey: string): void;
}>();
</script>

<template>
  <section ref="containerRef" class="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 custom-scrollbar relative z-0">
    <div
      v-if="albums.length > 0"
      class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-6 gap-y-10"
    >
      <div
        v-for="album in albums"
        :key="album.key"
        :data-cover-path="album.firstSongPath"
        @click="$emit('openAlbum', album.key)"
        class="group cursor-pointer rounded-xl p-2 md:p-3 transition-all duration-300 flex flex-col relative select-none hover:bg-white/40 dark:hover:bg-white/5"
      >
        <div class="relative w-full aspect-square mb-3 mt-4">
          <div class="absolute inset-x-2 top-0 bottom-1/2 bg-[#1c1c1c] rounded-t-full shadow-inner origin-bottom translate-y-[-10%] group-hover:translate-y-[-24%] transition-transform duration-500 ease-out z-0 flex items-center justify-center overflow-hidden border border-[#333]">
            <div class="absolute inset-0 rounded-t-full border border-white/5 scale-90"></div>
            <div class="absolute inset-0 rounded-t-full border border-white/5 scale-75"></div>
            <div class="absolute inset-0 rounded-t-full border border-white/5 scale-50"></div>
          </div>

          <div class="absolute inset-0 z-10 bg-white dark:bg-gray-800 rounded-md shadow-md border border-gray-100 dark:border-white/10 p-1 flex items-center justify-center overflow-hidden group-hover:shadow-xl transition-shadow duration-300">
            <div
              v-if="getDisplayedCoverUrl(album.firstSongPath)"
              class="w-full h-full bg-cover bg-center rounded-sm"
              :style="{ backgroundImage: `url(${getDisplayedCoverUrl(album.firstSongPath)})` }"
            ></div>

            <div
              v-else
              class="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-white/5 dark:to-white/10 rounded-sm flex items-center justify-center text-4xl font-bold text-gray-300 dark:text-gray-600 shadow-inner"
              :class="{ 'animate-pulse': isCoverLoading(album.firstSongPath) }"
            >
              {{ album.name ? album.name.substring(0, 1).toUpperCase() : 'A' }}
            </div>
          </div>
        </div>

        <div class="flex flex-col items-start px-1 z-20">
          <h3 class="font-bold text-sm md:text-base text-gray-800 dark:text-gray-200 truncate w-full group-hover:text-[#EC4141] transition-colors leading-tight">
            {{ album.name }}
          </h3>
          <p class="text-xs text-gray-500 dark:text-gray-400 truncate w-full mt-1.5 flex items-center gap-1.5 opacity-80">
            <span class="font-medium">{{ album.count }}</span>
            <span class="w-0.5 h-0.5 rounded-full bg-gray-400"></span>
            <span>{{ album.artist }}</span>
          </p>
        </div>
      </div>
    </div>

    <HomeEmptyState
      v-else
      message="No albums found"
      icon-path="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
    />
  </section>
</template>
