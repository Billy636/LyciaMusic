<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

import { useSongHighlights } from '../../features/highlights/useSongHighlights';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { useToast } from '../../composables/toast';
import type { SongHighlightMarker } from '../../types';

defineProps<{
  hidden: boolean;
}>();

const { currentSong } = usePlaybackController();
const {
  markers,
  notice,
  noticeMarker,
  formatMarkerTime,
  errorMessage,
  playMarker,
  moveMarker,
  adjustRecentMarker,
  undoRecentMutation,
  makePrimary,
  deleteMarker,
  pauseNoticeTimer,
  resumeNoticeTimer,
} = useSongHighlights();
const { showToast } = useToast();

const contextMarker = ref<SongHighlightMarker | null>(null);
const contextX = ref(0);
const contextY = ref(0);
const draggingMarkerId = ref<string | null>(null);
const dragPositionMs = ref(0);
const dragStartX = ref(0);
const dragMoved = ref(false);
let suppressClick = false;

const durationMs = computed(() => Math.max(0, Math.round((currentSong.value?.duration ?? 0) * 1000)));

const markerPosition = (marker: SongHighlightMarker) => (
  draggingMarkerId.value === marker.id ? dragPositionMs.value : marker.positionMs
);

const markerLeft = (marker: SongHighlightMarker) => {
  if (durationMs.value <= 0) return '0%';
  return `${Math.max(0, Math.min(100, markerPosition(marker) / durationMs.value * 100))}%`;
};

const isLegalDragPosition = (markerId: string, positionMs: number) => {
  if (durationMs.value < 1_000 || positionMs > durationMs.value - 1_000) return false;
  return !markers.value.some(marker => (
    marker.id !== markerId && Math.abs(marker.positionMs - positionMs) < 2_000
  ));
};

const startMarkerDrag = (event: PointerEvent, marker: SongHighlightMarker) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  draggingMarkerId.value = marker.id;
  dragPositionMs.value = marker.positionMs;
  dragStartX.value = event.clientX;
  dragMoved.value = false;
};

const handlePointerMove = (event: PointerEvent) => {
  if (!draggingMarkerId.value || durationMs.value <= 0) return;
  const progress = document.querySelector<HTMLElement>('[data-player-progress]');
  if (!progress) return;
  const rect = progress.getBoundingClientRect();
  if (Math.abs(event.clientX - dragStartX.value) >= 3) {
    dragMoved.value = true;
  }
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const candidate = Math.round(ratio * durationMs.value);
  if (isLegalDragPosition(draggingMarkerId.value, candidate)) {
    dragPositionMs.value = candidate;
  }
};

const finishMarkerDrag = async () => {
  const markerId = draggingMarkerId.value;
  if (!markerId) return;
  const moved = dragMoved.value;
  const positionMs = dragPositionMs.value;
  draggingMarkerId.value = null;
  dragMoved.value = false;
  if (!moved) return;

  suppressClick = true;
  window.setTimeout(() => { suppressClick = false; }, 0);
  try {
    await moveMarker(markerId, positionMs, true);
  } catch (error) {
    showToast(errorMessage(error), 'error');
  }
};

const cancelMarkerDrag = () => {
  draggingMarkerId.value = null;
  dragMoved.value = false;
};

const handleMarkerClick = async (marker: SongHighlightMarker) => {
  if (suppressClick) return;
  try {
    await playMarker(marker);
  } catch (error) {
    showToast(errorMessage(error), 'error');
  }
};

const openMarkerMenu = (event: MouseEvent, marker: SongHighlightMarker) => {
  event.preventDefault();
  event.stopPropagation();
  contextMarker.value = marker;
  contextX.value = event.clientX;
  contextY.value = event.clientY;
};

const runMenuAction = async (action: 'play' | 'primary' | 'delete') => {
  const marker = contextMarker.value;
  contextMarker.value = null;
  if (!marker) return;
  try {
    if (action === 'play') await playMarker(marker);
    if (action === 'primary') await makePrimary(marker.id);
    if (action === 'delete') await deleteMarker(marker.id);
  } catch (error) {
    showToast(errorMessage(error), 'error');
  }
};

const handleAdjustment = async (deltaMs: number) => {
  try {
    await adjustRecentMarker(deltaMs);
  } catch (error) {
    showToast(errorMessage(error), 'error');
  }
};

const handleUndo = async () => {
  try {
    await undoRecentMutation();
  } catch (error) {
    showToast(errorMessage(error), 'error');
  }
};

const handleKeydown = (event: KeyboardEvent) => {
  if (!notice.value || event.defaultPrevented || event.repeat) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return;
  if (event.code !== 'BracketLeft' && event.code !== 'BracketRight') return;
  event.preventDefault();
  void handleAdjustment(event.code === 'BracketLeft' ? -100 : 100);
};

const closeContextMenu = () => {
  contextMarker.value = null;
};

onMounted(() => {
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', finishMarkerDrag);
  window.addEventListener('pointercancel', cancelMarkerDrag);
  window.addEventListener('click', closeContextMenu);
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('pointermove', handlePointerMove);
  window.removeEventListener('pointerup', finishMarkerDrag);
  window.removeEventListener('pointercancel', cancelMarkerDrag);
  window.removeEventListener('click', closeContextMenu);
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div v-if="!hidden" class="pointer-events-none absolute inset-0 z-[55]">
    <button
      v-for="marker in markers"
      :key="marker.id"
      type="button"
      class="pointer-events-auto absolute top-1/2 h-[22px] w-5 -translate-x-1/2 -translate-y-1/2 cursor-pointer group/marker [touch-action:none]"
      :style="{ left: markerLeft(marker) }"
      :title="`${marker.isPrimary ? '主高潮' : '普通标记'} · ${formatMarkerTime(markerPosition(marker))}`"
      @pointerdown="startMarkerDrag($event, marker)"
      @click.stop="handleMarkerClick(marker)"
      @contextmenu="openMarkerMenu($event, marker)"
    >
      <span
        class="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-[#EC4141] shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform group-hover/marker:scale-125"
        :class="marker.isPrimary ? 'bg-[#EC4141]' : 'bg-white/90 dark:bg-[#202020]/90'"
      ></span>
      <span
        v-if="draggingMarkerId === marker.id"
        class="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-md border border-white/10 bg-zinc-900/95 px-2 py-0.5 font-mono text-[10px] font-semibold text-white shadow-lg"
      >
        {{ formatMarkerTime(dragPositionMs) }}
      </span>
    </button>
  </div>

  <div
    v-if="contextMarker"
    class="fixed z-[9999] min-w-[150px] overflow-hidden rounded-lg border border-black/10 bg-white/95 py-1 text-sm text-gray-800 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-[#252525]/95 dark:text-white"
    :style="{ left: `${contextX}px`, top: `${contextY}px` }"
    @pointerdown.stop
    @click.stop
    @contextmenu.prevent
  >
    <button class="block w-full px-3 py-2 text-left hover:bg-black/5 dark:hover:bg-white/10" @click="runMenuAction('play')">
      播放此标记
    </button>
    <button
      v-if="!contextMarker.isPrimary"
      class="block w-full px-3 py-2 text-left hover:bg-black/5 dark:hover:bg-white/10"
      @click="runMenuAction('primary')"
    >
      设为主高潮
    </button>
    <button class="block w-full px-3 py-2 text-left text-[#EC4141] hover:bg-[#EC4141]/10" @click="runMenuAction('delete')">
      删除标记
    </button>
  </div>

  <transition name="highlight-notice">
    <div
      v-if="notice && noticeMarker"
      class="fixed bottom-[92px] left-1/2 z-[9998] flex -translate-x-1/2 items-center gap-1 rounded-xl border border-white/10 bg-zinc-900/95 px-3 py-2 text-xs font-medium text-white shadow-2xl backdrop-blur-xl"
      @mouseenter="pauseNoticeTimer"
      @mouseleave="resumeNoticeTimer"
      @pointerdown.stop
      @click.stop
    >
      <span class="mr-2 whitespace-nowrap">{{ notice.label }} {{ formatMarkerTime(noticeMarker.positionMs) }}</span>
      <button class="rounded-md px-2 py-1 hover:bg-white/15" @click="handleAdjustment(-100)">−0.1 秒</button>
      <button class="rounded-md px-2 py-1 hover:bg-white/15" @click="handleAdjustment(100)">+0.1 秒</button>
      <button class="rounded-md px-2 py-1 text-[#ff8585] hover:bg-white/15" @click="handleUndo">撤销</button>
    </div>
  </transition>
</template>

<style scoped>
.highlight-notice-enter-active,
.highlight-notice-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.highlight-notice-enter-from,
.highlight-notice-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px) scale(0.97);
}
</style>
