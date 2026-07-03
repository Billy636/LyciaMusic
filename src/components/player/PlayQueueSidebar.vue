<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { usePlayer } from '../../composables/player';
import { useThemeSettings } from '../../composables/useThemeSettings';
import { isRemoteSong } from '../../utils/remoteSong';
import ModernModal from '../common/ModernModal.vue';
import { useLibrarySongWindowCache } from '../../composables/useLibrarySongWindowCache';
import { useLibrarySongResolver } from '../../composables/useLibrarySongResolver';

const {
  playQueuePaths,
  currentSong,
  showPlaylist,
  togglePlaylist,
  playSong,
  formatDuration,
  clearQueue,
  removeSongFromQueue,
} = usePlayer();
const { theme } = useThemeSettings();
const { ensureWindow, getSongAt } = useLibrarySongWindowCache();
const { loadSong } = useLibrarySongResolver();

const showClearModal = ref(false);
const queueContainerRef = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const containerHeight = ref(600);
const QUEUE_ROW_HEIGHT = 69;
const QUEUE_OVERSCAN = 10;

const handleClearClick = () => {
  showClearModal.value = true;
};

const confirmClear = () => {
  clearQueue();
  showClearModal.value = false;
};

const handleRemove = (song: any, e: Event) => {
  e.stopPropagation();
  removeSongFromQueue(song);
};

const createPlaceholderSong = (path: string) => ({
  path,
  name: path.split(/[\\/]/).pop() ?? path,
  title: '',
  artist: '',
  artist_names: [],
  effective_artist_names: [],
  album: '',
  album_artist: '',
  album_key: '',
  is_various_artists_album: false,
  collapse_artist_credits: false,
  duration: 0,
});

const virtualQueue = computed(() => {
  const total = playQueuePaths.value.length;
  const start = Math.floor(scrollTop.value / QUEUE_ROW_HEIGHT);
  const visibleCount = Math.ceil(containerHeight.value / QUEUE_ROW_HEIGHT);
  const renderStart = Math.max(0, start - QUEUE_OVERSCAN);
  const renderEnd = Math.min(total, start + visibleCount + QUEUE_OVERSCAN);
  return {
    paddingTop: renderStart * QUEUE_ROW_HEIGHT,
    paddingBottom: (total - renderEnd) * QUEUE_ROW_HEIGHT,
    items: playQueuePaths.value.slice(renderStart, renderEnd).map((path, relativeIndex) => ({
      ...(getSongAt(renderStart + relativeIndex)
        ?? (currentSong.value?.path === path ? currentSong.value : null)
        ?? createPlaceholderSong(path)),
      virtualIndex: renderStart + relativeIndex,
    })),
  };
});

const ensureVisibleQueue = () => {
  const firstVisible = Math.floor(scrollTop.value / QUEUE_ROW_HEIGHT);
  const visibleCount = Math.ceil(containerHeight.value / QUEUE_ROW_HEIGHT);
  void ensureWindow({
    paths: playQueuePaths.value,
    start: Math.max(0, firstVisible - QUEUE_OVERSCAN),
    end: Math.min(playQueuePaths.value.length, firstVisible + visibleCount + QUEUE_OVERSCAN),
    viewportHeight: containerHeight.value,
    rowHeight: QUEUE_ROW_HEIGHT,
  });
};

const handleQueueScroll = (event: Event) => {
  scrollTop.value = (event.target as HTMLElement).scrollTop;
  ensureVisibleQueue();
};

const handlePlayPath = async (path: string) => {
  const song = await loadSong(path);
  if (song) {
    await playSong(song, { preserveQueue: true });
  }
};

const scrollToCurrentSong = async (behavior: ScrollBehavior = 'auto') => {
  if (!currentSong.value) return;

  await nextTick();

  const currentIndex = playQueuePaths.value.indexOf(currentSong.value.path);
  if (currentIndex === -1) return;
  queueContainerRef.value?.scrollTo({
    top: Math.max(0, currentIndex * QUEUE_ROW_HEIGHT - containerHeight.value / 2),
    behavior,
  });
  ensureVisibleQueue();
};

watch(
  () => showPlaylist.value,
  visible => {
    if (!visible) return;
    void scrollToCurrentSong();
  },
);

watch([playQueuePaths, showPlaylist], () => {
  if (showPlaylist.value) {
    ensureVisibleQueue();
  }
}, { immediate: true });

const updateContainerHeight = () => {
  containerHeight.value = queueContainerRef.value?.clientHeight || 600;
  ensureVisibleQueue();
};

onMounted(() => window.addEventListener('resize', updateContainerHeight));
onUnmounted(() => window.removeEventListener('resize', updateContainerHeight));

watch(
  () => currentSong.value?.path,
  () => {
    if (!showPlaylist.value) return;
    void scrollToCurrentSong('smooth');
  },
);
</script>

<template>
  <Teleport to="body">
    <transition name="fade">
      <div v-if="showPlaylist" class="fixed inset-0 z-[90] bg-black/20 backdrop-blur-[2px]" @click="togglePlaylist"></div>
    </transition>

    <transition name="slide-right">
      <div
        v-if="showPlaylist"
        class="fixed right-0 rounded-l-2xl shadow-[0_18px_50px_rgba(15,23,42,0.22)] border-l border-t border-b border-white/70 dark:border-white/10 z-[100] flex flex-col overflow-hidden font-sans select-none bg-[#f7f9fc]/90 dark:bg-[#101827]/90 transition-all duration-300 ring-1 ring-black/5 dark:ring-white/5"
        :class="[
          (theme.dynamicBgType === 'none' && theme.mode === 'custom') ? '' : 'backdrop-blur-2xl',
          playQueuePaths.length > 0 ? 'bottom-24 w-[340px]' : 'bottom-5 w-[340px]'
        ]"
        :style="{ height: playQueuePaths.length > 0 ? 'calc(100vh - 180px)' : 'calc(100vh - 40px)', 'min-height': '200px' }"
        @click.stop
      >
        <div
          class="px-5 py-4 border-b border-[#d9e0ea] dark:border-white/10 flex justify-between items-center bg-[#f8fafc]/95 dark:bg-[#0c1320]/95 z-10 shadow-sm"
          :class="[(theme.dynamicBgType === 'none' && theme.mode === 'custom') ? '' : 'backdrop-blur-sm']"
        >
          <div class="flex items-center gap-3">
            <h3 class="font-bold text-[#172033] dark:text-white text-lg tracking-tight">播放队列</h3>
            <span class="text-xs text-[#34445c] dark:text-white font-semibold bg-[#e7edf5] dark:bg-white/12 px-2 py-0.5 rounded-full">{{ playQueuePaths.length }}</span>
          </div>
          <button
            @click="handleClearClick"
            class="text-[#34445c] dark:text-white/90 hover:text-[#EC4141] text-sm hover:bg-[#EC4141]/10 dark:hover:bg-red-500/15 px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 active:scale-95"
            title="清空队列"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            <span>清空</span>
          </button>
        </div>

        <div ref="queueContainerRef" class="flex-1 overflow-y-auto custom-scrollbar p-3 bg-[#eef3f8]/45 dark:bg-[#0b1220]/35" @scroll="handleQueueScroll">
          <div v-if="playQueuePaths.length === 0" class="h-full flex flex-col items-center justify-center text-[#34445c] dark:text-white/90 space-y-4 py-20">
            <div class="w-20 h-20 rounded-full bg-white/70 dark:bg-white/10 flex items-center justify-center shadow-inner">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-[#42526a] dark:text-white/80" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
            </div>
            <span class="text-sm font-medium">播放队列为空</span>
          </div>

          <div :style="{ height: `${virtualQueue.paddingTop}px` }"></div>
          <div
            v-for="song in virtualQueue.items"
            :key="song.path + song.virtualIndex"
            @click="handlePlayPath(song.path)"
            class="group relative p-2.5 rounded-xl flex justify-between items-center cursor-pointer transition-all duration-200 border"
            :style="{ height: `${QUEUE_ROW_HEIGHT}px` }"
            :class="[
              currentSong?.path === song.path
                ? 'bg-[#fff1f1]/95 dark:bg-[#EC4141]/18 text-[#EC4141] border-[#EC4141]/18 shadow-[0_10px_26px_rgba(15,23,42,0.14)]'
                : 'bg-white/25 dark:bg-white/[0.03] text-[#172033] dark:text-white hover:bg-white/70 dark:hover:bg-white/10 border-transparent hover:border-white/80 dark:hover:border-white/12'
            ]"
          >
            <div class="w-8 flex justify-center items-center shrink-0">
              <div v-if="currentSong?.path === song.path" class="flex items-end gap-[2px] h-3">
                <div class="w-[3px] bg-[#EC4141] animate-music-bar-1"></div>
                <div class="w-[3px] bg-[#EC4141] animate-music-bar-2"></div>
                <div class="w-[3px] bg-[#EC4141] animate-music-bar-3"></div>
              </div>
              <template v-else>
                <span class="text-xs text-[#52647d] dark:text-white/75 group-hover:hidden font-mono">{{ song.virtualIndex + 1 }}</span>
                <svg xmlns="http://www.w3.org/2000/svg" class="hidden group-hover:block h-3 w-3 text-[#34445c] dark:text-white" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" /></svg>
              </template>
            </div>

            <div class="flex-1 min-w-0 pr-4 flex flex-col">
              <div class="flex min-w-0 items-center gap-1.5">
                <span class="min-w-0 truncate text-sm font-medium leading-tight">{{ song.title || song.name.replace(/\.[^/.]+$/, "") }}</span>
                <span
                  v-if="isRemoteSong(song)"
                  class="shrink-0 rounded-full border border-[#EC4141]/20 bg-[#EC4141]/10 px-1.5 py-[1px] text-[10px] font-bold text-[#EC4141]"
                >远程</span>
              </div>
              <span
                class="text-[11px] truncate mt-1 font-medium"
                :class="currentSong?.path === song.path ? 'text-[#EC4141]' : 'text-[#42526a] dark:text-white/80'"
              >{{ song.artist || 'Unknown Artist' }}</span>
            </div>

            <div class="flex items-center gap-3">
              <div class="text-xs font-mono shrink-0 group-hover:hidden" :class="currentSong?.path === song.path ? 'text-[#EC4141]' : 'text-[#34445c] dark:text-white/85'">
                {{ formatDuration(song.duration) }}
              </div>
              <button
                @click="handleRemove(song, $event)"
                class="hidden group-hover:flex w-6 h-6 items-center justify-center text-[#42526a] dark:text-white/80 hover:text-red-500 transition-colors rounded-full hover:bg-black/5 dark:hover:bg-white/10 active:scale-90"
                title="移出队列"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
          <div :style="{ height: `${virtualQueue.paddingBottom}px` }"></div>
        </div>
      </div>
    </transition>

    <ModernModal
      v-model:visible="showClearModal"
      title="清空播放队列"
      content="确定要清空当前播放队列吗？此操作不会影响本地文件。"
      type="danger"
      confirm-text="清空"
      @confirm="confirmClear"
    />
  </Teleport>
</template>

<style scoped>
.slide-right-enter-active,
.slide-right-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@keyframes music-bar {
  0%, 100% { height: 4px; }
  50% { height: 12px; }
}

.animate-music-bar-1 { animation: music-bar 0.6s ease-in-out infinite; }
.animate-music-bar-2 { animation: music-bar 0.8s ease-in-out infinite 0.1s; }
.animate-music-bar-3 { animation: music-bar 0.7s ease-in-out infinite 0.2s; }
</style>
