<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { usePlayer } from '../../composables/player';
import { isRemoteSong } from '../../utils/remoteSong';
import ModernModal from '../common/ModernModal.vue';
import { useLibrarySongWindowCache } from '../../composables/useLibrarySongWindowCache';
import { useLibrarySongResolver } from '../../composables/useLibrarySongResolver';
import './playerSidePanel.css';

const {
  playQueuePaths,
  currentSong,
  showPlaylist,
  showPlayerDetail,
  togglePlaylist,
  playSong,
  formatDuration,
  clearQueue,
  removeSongFromQueue,
} = usePlayer();
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

const handleQueueKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || event.defaultPrevented || !showPlaylist.value || showClearModal.value) return;
  event.preventDefault();
  togglePlaylist();
};

onMounted(() => {
  window.addEventListener('resize', updateContainerHeight);
  window.addEventListener('keydown', handleQueueKeydown);
});
onUnmounted(() => {
  window.removeEventListener('resize', updateContainerHeight);
  window.removeEventListener('keydown', handleQueueKeydown);
});

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
      <div v-if="showPlaylist" class="fixed inset-x-0 top-0 bottom-24 z-[90] bg-black/15" aria-hidden="true" @click="togglePlaylist"></div>
    </transition>

    <transition name="player-side-panel">
      <div
        v-if="showPlaylist"
        class="player-side-panel player-side-panel--right"
        :class="{ 'player-side-panel--solid-backdrop': !showPlayerDetail }"
        role="dialog"
        aria-modal="false"
        aria-labelledby="play-queue-sidebar-title"
        data-shortcut-capture="true"
        @click.stop
      >
        <header class="player-side-panel__header">
          <div class="min-w-0">
            <div class="player-side-panel__eyebrow">QUEUE</div>
            <div class="mt-1 flex items-center gap-2">
              <h3 id="play-queue-sidebar-title" class="player-side-panel__title">播放队列</h3>
              <span class="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium tabular-nums text-white/55" :aria-label="`队列中共 ${playQueuePaths.length} 首歌曲`">{{ playQueuePaths.length }}</span>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <button
              type="button"
              @click="handleClearClick"
              class="player-side-panel__action flex items-center gap-1.5"
              title="清空队列"
              aria-label="清空播放队列"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              <span>清空</span>
            </button>
            <button type="button" class="player-side-panel__icon-button" title="关闭播放队列" aria-label="关闭播放队列" @click="togglePlaylist">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </header>

        <div ref="queueContainerRef" class="player-side-panel__scroll custom-scrollbar p-3" @scroll="handleQueueScroll">
          <div v-if="playQueuePaths.length === 0" class="flex h-full flex-col items-center justify-center space-y-4 py-20 text-white/50">
            <div class="flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-white/[0.04]">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-9 w-9 text-white/40" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
            </div>
            <span class="text-sm font-medium">播放队列为空</span>
          </div>

          <div :style="{ height: `${virtualQueue.paddingTop}px` }"></div>
          <div
            v-for="song in virtualQueue.items"
            :key="song.path + song.virtualIndex"
            @click="handlePlayPath(song.path)"
            class="group relative flex cursor-pointer items-center justify-between rounded-xl border p-2.5 transition-colors duration-200"
            :style="{ height: `${QUEUE_ROW_HEIGHT}px` }"
            :class="[
              currentSong?.path === song.path
                ? 'border-white/25 bg-white/14 text-white'
                : 'border-white/[0.04] bg-white/[0.02] text-white/80 hover:border-white/12 hover:bg-white/[0.07]'
            ]"
          >
            <div class="w-8 flex justify-center items-center shrink-0">
              <div v-if="currentSong?.path === song.path" class="flex items-end gap-[2px] h-3">
                <div class="w-[3px] bg-[#EC4141] animate-music-bar-1"></div>
                <div class="w-[3px] bg-[#EC4141] animate-music-bar-2"></div>
                <div class="w-[3px] bg-[#EC4141] animate-music-bar-3"></div>
              </div>
              <template v-else>
                <span class="font-mono text-xs text-white/40 group-hover:hidden">{{ song.virtualIndex + 1 }}</span>
                <svg xmlns="http://www.w3.org/2000/svg" class="hidden h-3 w-3 text-white/80 group-hover:block" aria-hidden="true" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" /></svg>
              </template>
            </div>

            <div class="flex-1 min-w-0 pr-4 flex flex-col">
              <div class="flex min-w-0 items-center gap-1.5">
                <span class="min-w-0 truncate text-sm font-medium leading-tight">{{ song.title || song.name.replace(/\.[^/.]+$/, "") }}</span>
                <span
                  v-if="isRemoteSong(song)"
                  class="shrink-0 rounded-full border border-white/15 bg-white/[0.06] px-1.5 py-[1px] text-[10px] font-medium text-white/60"
                >远程</span>
              </div>
              <span
                class="text-[11px] truncate mt-1 font-medium"
                :class="currentSong?.path === song.path ? 'text-white/70' : 'text-white/45'"
              >{{ song.artist || 'Unknown Artist' }}</span>
            </div>

            <div class="flex items-center gap-3">
              <div class="shrink-0 font-mono text-xs group-hover:hidden" :class="currentSong?.path === song.path ? 'text-white/70' : 'text-white/40'">
                {{ formatDuration(song.duration) }}
              </div>
              <button
                type="button"
                @click="handleRemove(song, $event)"
                class="hidden h-6 w-6 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white active:scale-90 group-hover:flex"
                title="移出队列"
                aria-label="移出队列"
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
