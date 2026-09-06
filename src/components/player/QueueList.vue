<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { storeToRefs } from 'pinia';

import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { useLibraryStore } from '../../features/library/store';
import { usePlaybackStore } from '../../features/playback/store';
import { useLibrarySongWindowCache } from '../../composables/useLibrarySongWindowCache';
import { useLibrarySongResolver } from '../../composables/useLibrarySongResolver';

const libraryStore = useLibraryStore();
const playbackStore = usePlaybackStore();
const { sourceSongPaths } = storeToRefs(libraryStore);
const { playQueuePaths } = storeToRefs(playbackStore);
const { currentSong, playSong, formatDuration } = usePlaybackController();
const { ensureWindow, getSongAt } = useLibrarySongWindowCache();
const { loadSong } = useLibrarySongResolver();

const queuePaths = computed(() => playQueuePaths.value.length > 0 ? playQueuePaths.value : sourceSongPaths.value);
const containerRef = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const containerHeight = ref(600);
const ROW_HEIGHT = 68;
const OVERSCAN = 10;

const virtualQueue = computed(() => {
  const start = Math.floor(scrollTop.value / ROW_HEIGHT);
  const visibleCount = Math.ceil(containerHeight.value / ROW_HEIGHT);
  const renderStart = Math.max(0, start - OVERSCAN);
  const renderEnd = Math.min(queuePaths.value.length, start + visibleCount + OVERSCAN);
  return {
    paddingTop: renderStart * ROW_HEIGHT,
    paddingBottom: (queuePaths.value.length - renderEnd) * ROW_HEIGHT,
    items: queuePaths.value.slice(renderStart, renderEnd).map((path, relativeIndex) => {
      const song = getSongAt(renderStart + relativeIndex);
      return {
        path,
        name: song?.name ?? path.split(/[\\/]/).pop() ?? path,
        title: song?.title ?? '',
        artist: song?.artist ?? '',
        duration: song?.duration ?? 0,
        virtualIndex: renderStart + relativeIndex,
      };
    }),
  };
});

const ensureVisibleQueue = () => {
  const start = Math.floor(scrollTop.value / ROW_HEIGHT);
  const visibleCount = Math.ceil(containerHeight.value / ROW_HEIGHT);
  void ensureWindow({
    paths: queuePaths.value,
    start: Math.max(0, start - OVERSCAN),
    end: Math.min(queuePaths.value.length, start + visibleCount + OVERSCAN),
    viewportHeight: containerHeight.value,
    rowHeight: ROW_HEIGHT,
  });
};

const handleScroll = (event: Event) => {
  const element = event.target as HTMLElement;
  scrollTop.value = element.scrollTop;
  containerHeight.value = element.clientHeight || containerHeight.value;
  ensureVisibleQueue();
};

const handlePlayPath = async (path: string) => {
  const song = await loadSong(path);
  if (song) {
    await playSong(song, { preserveQueue: true });
  }
};

// 自动滚动到当前播放歌曲
watch(currentSong, async () => {
  await nextTick();
  scrollToCurrent();
}, { immediate: true });

const scrollToCurrent = () => {
  if (!currentSong.value) return;
  const index = queuePaths.value.indexOf(currentSong.value.path);
  if (index !== -1 && containerRef.value) {
    containerRef.value.scrollTo({
      top: Math.max(0, index * ROW_HEIGHT - containerHeight.value / 2),
      behavior: 'smooth',
    });
    ensureVisibleQueue();
  }
};

watch(queuePaths, ensureVisibleQueue, { immediate: true });
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex items-center justify-between mb-4 px-2">
      <h2 class="text-xl font-bold text-white">待播清单</h2>
      <span class="text-sm text-white/40">{{ queuePaths.length }} 首歌曲</span>
    </div>
    
    <div ref="containerRef" class="flex-1 overflow-y-auto custom-scrollbar -mr-4 pr-4" @scroll="handleScroll">
       <div :style="{ height: `${virtualQueue.paddingTop}px` }"></div>
       <div v-for="song in virtualQueue.items" :key="song.path + song.virtualIndex"
            class="flex items-center gap-3 p-3 rounded-lg hover:bg-white/10 cursor-pointer group transition-colors duration-200"
            :style="{ height: `${ROW_HEIGHT}px` }"
            :class="currentSong?.path === song.path ? 'bg-white/15' : ''"
            @dblclick="handlePlayPath(song.path)"
       >
          <!-- Playing Indicator or Index -->
          <div class="w-8 flex justify-center text-white/40 text-sm font-medium">
               <div v-if="currentSong?.path === song.path" class="text-white animate-pulse">
                 <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
               </div>
               <span v-else class="group-hover:hidden">{{ song.virtualIndex + 1 }}</span>
               <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 hidden group-hover:block text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </div>
          
          <div class="flex-1 min-w-0">
              <div class="text-sm font-medium truncate mb-0.5" :class="currentSong?.path === song.path ? 'text-white' : 'text-white/90'">{{ song.title || song.name }}</div>
              <div class="text-xs truncate" :class="currentSong?.path === song.path ? 'text-white/60' : 'text-white/40'">{{ song.artist || 'Unknown' }}</div>
          </div>
          
          <div class="text-xs tabular-nums" :class="currentSong?.path === song.path ? 'text-white/60' : 'text-white/30'">
              {{ formatDuration(song.duration) }}
          </div>
       </div>
       <div :style="{ height: `${virtualQueue.paddingBottom}px` }"></div>
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background-color: rgba(255, 255, 255, 0.2);
}
</style>
