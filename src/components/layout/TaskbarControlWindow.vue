<script setup lang="ts">
import { LogicalPosition } from '@tauri-apps/api/dpi';
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';

import {
  TASKBAR_PLAYER_ACTION_EVENT,
  TASKBAR_PLAYER_STATE_EVENT,
  TASKBAR_PLAYER_PLAYBACK_EVENT,
  TASKBAR_PLAYER_STATE_APPLIED_EVENT,
  TASKBAR_PLAYER_VISIBILITY_EVENT,
  TASKBAR_PLAYER_DRAG_EVENT,
  TASKBAR_PLAYER_WINDOW_HEIGHT,
  normalizeTaskbarTextColor,
  writeSavedTaskbarPositionX,
  type TaskbarTrayGeometry,
  type TaskbarPlayerStatePayload,
  type TaskbarPlayerPlaybackPayload,
  type TaskbarPlayerAction,
} from '../../features/taskbarPlayer/shared';
import {
  createTaskbarLyricDisplayLines,
  getTaskbarLyricWordProgress,
  projectTaskbarPlaybackTime,
  resolveTaskbarLyricLine,
} from '../../features/taskbarPlayer/lyrics';
import type { LyricLine, LyricsStatus } from '../../composables/lyrics/types';
import { windowApi } from '../../services/tauri/windowApi';
import type { Song } from '../../types';

const appWindow = getCurrentWindow();

const currentSong = ref<Song | null>(null);
const localCoverUrl = ref('');
const isPlaying = ref(false);
const isVisible = ref(false);
const isDragging = ref(false);
const backgroundOpacity = ref(0);
const textColor = ref('#ffffff');
const backgroundStyle = computed(() => ({
  // A fully transparent WebView2 surface can pass native mouse hit testing through.
  // Keep an imperceptible painted surface even at the transparent setting.
  backgroundColor: `rgba(18, 18, 20, ${Math.max(1 / 255, backgroundOpacity.value / 100)})`,
  '--taskbar-text-rgb': [1, 3, 5].map(offset => parseInt(textColor.value.slice(offset, offset + 2), 16)).join(' '),
}));
const parsedLyrics = shallowRef<LyricLine[]>([]);
const lyricsStatus = ref<LyricsStatus>('idle');
const playbackTime = ref(0);
const playbackAnchor = shallowRef<TaskbarPlayerPlaybackPayload | null>(null);
const lyricViewport = ref<HTMLElement | null>(null);
const lyricContent = ref<HTMLElement | null>(null);
const lyricTime = computed(() => playbackTime.value - (playbackAnchor.value?.audioDelay ?? 0));
const taskbarLyrics = computed(() => createTaskbarLyricDisplayLines(parsedLyrics.value));
const currentLyric = computed(() => {
  if (!currentSong.value || lyricsStatus.value !== 'ready') return null;
  // Keep selection on source cues so finishing the highlight does not clear the line.
  const sourceLine = resolveTaskbarLyricLine(parsedLyrics.value, lyricTime.value);
  return sourceLine ? taskbarLyrics.value[parsedLyrics.value.indexOf(sourceLine)] : null;
});
const songTitle = computed(() => currentSong.value
  ? currentSong.value.title || currentSong.value.name
  : 'Lycia Player');
const fallbackText = computed(() => currentSong.value?.artist || (currentSong.value ? '暂无歌词' : '享受音乐时光'));
const songDetails = computed(() => [currentSong.value?.artist, currentSong.value?.album].filter(Boolean).join(' · ') || fallbackText.value);
let lyricFrame = 0;
let lastLyricFrameAt = 0;
const LYRIC_FRAME_INTERVAL_MS = 1000 / 30;
let dragSafetyTimer: ReturnType<typeof setTimeout> | null = null;
let cleanupDragListeners: (() => void) | null = null;
let dragFrame = 0;
let pendingDragPosition: LogicalPosition | null = null;
let isFinishingDrag = false;

interface DragBounds {
  minX: number;
  maxX: number;
  y: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const finishDrag = async () => {
  if (!isDragging.value) return;
  isFinishingDrag = true;
  isDragging.value = false;
  if (dragSafetyTimer) clearTimeout(dragSafetyTimer);
  dragSafetyTimer = null;
  cleanupDragListeners?.();
  cleanupDragListeners = null;
  if (dragFrame !== 0) window.cancelAnimationFrame(dragFrame);
  dragFrame = 0;
  const finalPosition = pendingDragPosition;
  pendingDragPosition = null;
  try {
    if (finalPosition) await appWindow.setPosition(finalPosition);
    const factor = await appWindow.scaleFactor();
    const position = (await appWindow.outerPosition()).toLogical(factor);
    writeSavedTaskbarPositionX(position.x);
  } catch (error) {
    console.warn('Failed to save taskbar drag position:', error);
  } finally {
    isFinishingDrag = false;
    void emitTo('main', TASKBAR_PLAYER_DRAG_EVENT, { dragging: false });
  }
};

const scheduleDragPosition = (position: LogicalPosition) => {
  pendingDragPosition = position;
  if (dragFrame !== 0) return;

  dragFrame = window.requestAnimationFrame(() => {
    dragFrame = 0;
    const nextPosition = pendingDragPosition;
    pendingDragPosition = null;
    if (nextPosition) {
      void appWindow.setPosition(nextPosition).catch(error => console.warn('Failed to move taskbar player:', error));
    }
  });
};

const getTaskbarDragBounds = async (): Promise<DragBounds | null> => {
  const geometry = await invoke<TaskbarTrayGeometry>('get_taskbar_tray_geometry').catch((error) => {
    console.warn('Failed to get taskbar drag bounds:', error);
    return null;
  });
  if (!geometry) return null;

  const factor = await appWindow.scaleFactor();
  const taskbarRect = {
    left: geometry.taskbar_rect_physical.left / factor,
    top: geometry.taskbar_rect_physical.top / factor,
    right: geometry.taskbar_rect_physical.right / factor,
    bottom: geometry.taskbar_rect_physical.bottom / factor,
  };
  const taskbarWidth = taskbarRect.right - taskbarRect.left;
  const taskbarHeight = taskbarRect.bottom - taskbarRect.top;
  if (taskbarWidth <= taskbarHeight) {
    return null;
  }

  return {
    minX: taskbarRect.left,
    maxX: Math.max(taskbarRect.left, taskbarRect.right - (await appWindow.innerSize()).toLogical(factor).width),
    y: Math.round(taskbarRect.top + (taskbarHeight - TASKBAR_PLAYER_WINDOW_HEIGHT) / 2),
  };
};

const startDrag = async (event: PointerEvent) => {
  if (event.button !== 0 || !event.isPrimary || isDragging.value || isFinishingDrag) return;
  // Capture the target and install release handlers before the first await.
  // currentTarget is cleared after dispatch; a quick release during IPC was lost.
  const target = event.currentTarget as HTMLElement;
  const pointerId = event.pointerId;
  const startScreenX = event.screenX;
  let startPosition: LogicalPosition | null = null;
  let dragBounds: DragBounds | null = null;

  isDragging.value = true;
  void emitTo('main', TASKBAR_PLAYER_DRAG_EVENT, { dragging: true });

  cleanupDragListeners?.();
  if (dragSafetyTimer) clearTimeout(dragSafetyTimer);
  dragSafetyTimer = setTimeout(() => {
    if (isDragging.value) {
      void finishDrag();
    }
  }, 30000);

  const handlePointerMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId || !isDragging.value) return;
    if (moveEvent.buttons === 0) { void finishDrag(); return; }
    if (!dragBounds || !startPosition) return;
    const nextX = clamp(
      startPosition.x + moveEvent.screenX - startScreenX,
      dragBounds.minX,
      dragBounds.maxX,
    );
    scheduleDragPosition(new LogicalPosition(Math.round(nextX), dragBounds.y));
  };

  const handleDragEnd = (endEvent: Event) => {
    if (endEvent instanceof PointerEvent && endEvent.pointerId !== pointerId) return;
    void finishDrag();
  };

  window.addEventListener('pointermove', handlePointerMove, true);
  window.addEventListener('pointerup', handleDragEnd, true);
  window.addEventListener('pointercancel', handleDragEnd, true);
  window.addEventListener('blur', handleDragEnd, true);
  target.addEventListener('lostpointercapture', handleDragEnd);
  cleanupDragListeners = () => {
    window.removeEventListener('pointermove', handlePointerMove, true);
    window.removeEventListener('pointerup', handleDragEnd, true);
    window.removeEventListener('pointercancel', handleDragEnd, true);
    window.removeEventListener('blur', handleDragEnd, true);
    target.removeEventListener('lostpointercapture', handleDragEnd);
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
  };
  const cleanup = cleanupDragListeners;
  try {
    target.setPointerCapture(pointerId);
    const factor = await appWindow.scaleFactor();
    const position = (await appWindow.outerPosition()).toLogical(factor);
    const bounds = await getTaskbarDragBounds();
    if (!isDragging.value || cleanupDragListeners !== cleanup) return;
    startPosition = position;
    dragBounds = bounds;
    if (!bounds) void finishDrag();
  } catch (error) {
    console.warn('Failed to start taskbar drag:', error);
    if (cleanupDragListeners === cleanup) void finishDrag();
  }
};

let unlistenState: (() => void) | null = null;
let unlistenPlayback: (() => void) | null = null;
let unlistenVisibility: (() => void) | null = null;
let unlistenMoved: (() => void) | null = null;

const sendAction = (actionType: TaskbarPlayerAction['type']) => {
  void emitTo<TaskbarPlayerAction>('main', TASKBAR_PLAYER_ACTION_EVENT, { type: actionType });
};

const refreshTaskbarWindowTopmost = async () => {
  try {
    await appWindow.setAlwaysOnTop(true);
    await windowApi.refreshCurrentWindowTopmost(true);
  } catch (error) {
    console.warn('Failed to refresh taskbar player topmost state:', error);
  }
};

const updateLyricScroll = () => {
  const viewport = lyricViewport.value;
  const content = lyricContent.value;
  const line = currentLyric.value;
  if (!viewport || !content || !line) return;

  const overflow = Math.max(0, content.scrollWidth - viewport.clientWidth);
  let scrollLeft = 0;
  if (overflow > 0 && lyricTime.value > line.time) {
    const words = line.words ?? [];
    if (words.length > 0) {
      const nextIndex = words.findIndex(word => word.end > lyricTime.value);
      const wordIndex = nextIndex === -1 ? words.length - 1 : nextIndex;
      const element = content.children[wordIndex] as HTMLElement | undefined;
      if (element) {
        const progress = getTaskbarLyricWordProgress(words[wordIndex], lyricTime.value);
        scrollLeft = element.offsetLeft + element.offsetWidth * progress - viewport.clientWidth * 0.65;
      }
    } else {
      const duration = Math.max(1, line.endTime - line.time);
      scrollLeft = overflow * clamp((lyricTime.value - line.time) / duration, 0, 1);
    }
  }
  viewport.scrollLeft = Math.round(clamp(scrollLeft, 0, overflow));
};

const stopLyricClock = () => {
  if (lyricFrame !== 0) window.cancelAnimationFrame(lyricFrame);
  lyricFrame = 0;
  lastLyricFrameAt = 0;
};

const refreshLyricClock = () => {
  stopLyricClock();
  if (!isVisible.value || !isPlaying.value || document.hidden || !parsedLyrics.value.length) return;

  const tick = (now: number) => {
    if (now - lastLyricFrameAt >= LYRIC_FRAME_INTERVAL_MS && playbackAnchor.value) {
      lastLyricFrameAt = now;
      playbackTime.value = projectTaskbarPlaybackTime(playbackAnchor.value);
      updateLyricScroll();
    }
    lyricFrame = window.requestAnimationFrame(tick);
  };
  lyricFrame = window.requestAnimationFrame(tick);
};

const applyPlayback = (payload: TaskbarPlayerPlaybackPayload) => {
  // A queued tick from the previous song must never advance the new song's lyrics.
  if (payload.songPath !== (currentSong.value?.path ?? null)) return;
  playbackAnchor.value = payload;
  playbackTime.value = projectTaskbarPlaybackTime(payload);
  isPlaying.value = payload.isPlaying;
  void nextTick(updateLyricScroll);
};

watch([isVisible, isPlaying, parsedLyrics], refreshLyricClock);
watch(currentLyric, () => {
  void nextTick(() => {
    if (lyricViewport.value) lyricViewport.value.scrollLeft = 0;
    updateLyricScroll();
  });
});

onMounted(async () => {
  try {
    await appWindow.setBackgroundColor([0, 0, 0, 0]);
  } catch (error) {
    console.warn('Failed to set transparent window background:', error);
  }

  void refreshTaskbarWindowTopmost();

  // 1. 监听状态更新
  unlistenState = await listen<TaskbarPlayerStatePayload>(TASKBAR_PLAYER_STATE_EVENT, (event) => {
    currentSong.value = event.payload.currentSong;
    const opacity = event.payload.backgroundOpacity;
    textColor.value = normalizeTaskbarTextColor(event.payload.textColor);
    backgroundOpacity.value = typeof opacity === 'number' && Number.isFinite(opacity)
      ? Math.min(100, Math.max(0, opacity)) : 0;
    localCoverUrl.value = event.payload.coverUrl;
    parsedLyrics.value = event.payload.parsedLyrics;
    lyricsStatus.value = event.payload.lyricsStatus;
    applyPlayback(event.payload);
    void nextTick(() => {
      void emitTo('main', TASKBAR_PLAYER_STATE_APPLIED_EVENT);
    });
  });
  unlistenPlayback = await listen<TaskbarPlayerPlaybackPayload>(TASKBAR_PLAYER_PLAYBACK_EVENT, event => {
    applyPlayback(event.payload);
  });
  document.addEventListener('visibilitychange', refreshLyricClock);

  // 2. 监听可见性
  unlistenVisibility = await listen<{ visible: boolean }>(TASKBAR_PLAYER_VISIBILITY_EVENT, (event) => {
    isVisible.value = event.payload.visible;
    if (event.payload.visible) {
      void refreshTaskbarWindowTopmost();
    }
  });

  // 3. 监听位置移动：拖动结束时由 pointerup 保存位置，这里只保留窗口生命周期清理句柄
  unlistenMoved = await appWindow.onMoved(() => {});

  // 4. 发送 Ready 握手并请求一次最新状态
  void emitTo('main', 'taskbar-player:ready');
  void emitTo('main', 'taskbar-player:request-state');
});

onUnmounted(() => {
  if (isDragging.value) {
    isDragging.value = false;
    void emitTo('main', TASKBAR_PLAYER_DRAG_EVENT, { dragging: false });
  }
  unlistenState?.();
  unlistenPlayback?.();
  unlistenVisibility?.();
  unlistenMoved?.();
  stopLyricClock();
  document.removeEventListener('visibilitychange', refreshLyricClock);
  if (dragSafetyTimer) clearTimeout(dragSafetyTimer);
  cleanupDragListeners?.();
  cleanupDragListeners = null;
  pendingDragPosition = null;
  if (dragFrame !== 0) {
    window.cancelAnimationFrame(dragFrame);
    dragFrame = 0;
  }
});
</script>

<template>
  <div
    class="taskbar-player group w-full h-[40px] relative flex items-center justify-between select-none overflow-hidden rounded-xl pl-2 pr-3.5 transition-colors duration-200"
    :style="backgroundStyle"
  >
    <!-- 极简白色竖条拉手（采用外层 22px 宽的隐形热区, 并在悬停时 group 联动触发内层竖条呼吸显隐与高亮） -->
    <div 
      class="group w-[22px] h-[34px] -ml-1.5 mr-1 shrink-0 flex items-center justify-center cursor-move"
      title="按住拖拽调整播控条位置"
      @pointerdown.prevent.stop="startDrag"
    >
      <div 
        class="w-[4px] h-[16px] rounded-full bg-white/50 opacity-0 group-hover:opacity-100 group-active:bg-white transition-all duration-300 pointer-events-none group-hover:scale-x-125 group-hover:shadow-[0_0_8px_rgba(255,255,255,0.6)]"
        :class="[isDragging ? 'opacity-100 bg-white scale-x-125 shadow-[0_0_8px_rgba(255,255,255,0.6)]' : '']"
      ></div>
    </div>

    <!-- 左侧：封面与歌曲信息 -->
    <div class="taskbar-content flex items-center gap-2.5 min-w-0 flex-1 mr-1">
      <!-- 封面 -->
      <button
        type="button"
        class="group/cover w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-white/5 border border-white/5 flex items-center justify-center text-white/40 relative cursor-pointer pointer-events-auto"
        @mousedown.stop.prevent
        title="显示/收起主窗口"
        @click.stop="sendAction('toggle-main-window')"
      >
        <img 
          v-if="localCoverUrl" 
          :src="localCoverUrl" 
          alt="歌曲封面"
          class="w-full h-full object-cover transition-all duration-200 group-hover/cover:scale-[0.96] group-hover/cover:brightness-[0.75]" 
          draggable="false"
        />
        <svg 
          v-else 
          xmlns="http://www.w3.org/2000/svg" 
          class="h-[18px] w-[18px] transition-all duration-200 group-hover/cover:scale-[0.96] group-hover/cover:brightness-[0.75]" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          stroke-width="2" 
          stroke-linecap="round" 
          stroke-linejoin="round"
        >
          <path d="M9 18V5l12-2v13"></path>
          <circle cx="6" cy="18" r="3"></circle>
          <circle cx="18" cy="16" r="3"></circle>
        </svg>

        <!-- 精美、轻量对角双向箭头覆盖层 -->
        <div 
          class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 group-hover/cover:opacity-100 transition-opacity duration-200 ease-out"
        >
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            class="h-4 w-4 text-white stroke-[2.5]" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            stroke-linecap="round" 
            stroke-linejoin="round"
          >
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </div>
      </button>

      <!-- 默认展示歌词；宽窗口悬停保留歌名和歌手，窄窗口优先播控。 -->
      <div class="taskbar-song-info flex flex-col min-w-0 flex-1 leading-tight">
        <div class="taskbar-song-title text-[11px] leading-[14px] font-semibold truncate" :title="songTitle">
          {{ songTitle }}
        </div>

        <div class="taskbar-hover-details text-[11px] leading-[17px] truncate" :title="songDetails">{{ songDetails }}</div>
        <div
          ref="lyricViewport"
          class="taskbar-lyric-viewport text-[13px] leading-[17px] font-semibold"
          :title="currentLyric?.text || fallbackText"
        >
          <div v-if="currentLyric" ref="lyricContent" class="taskbar-lyric-content" role="group" :aria-label="currentLyric.text">
            <template v-if="currentLyric.words?.length">
              <span
                v-for="(word, index) in currentLyric.words"
                :key="index"
                class="taskbar-lyric-word"
                aria-hidden="true"
                :data-text="word.text"
                :style="{ '--word-progress': `${getTaskbarLyricWordProgress(word, lyricTime) * 100}%` }"
              >{{ word.text }}</span>
            </template>
            <span v-else aria-hidden="true" class="taskbar-line" :class="{ 'is-played': lyricTime >= currentLyric.time }">
              {{ currentLyric.text }}
            </span>
          </div>
          <div v-else class="taskbar-fallback truncate">{{ fallbackText }}</div>
        </div>
      </div>
    </div>

    <!-- 播控悬停显现，不占用常态歌词宽度。 -->
    <div class="taskbar-controls absolute inset-y-0 right-6 flex items-center gap-5 z-20">
      <!-- 上一首 -->
      <button 
        @mousedown.prevent
        @click.stop="sendAction('prev-song')" 
        class="text-white/60 hover:text-white transition-colors duration-200 active:scale-90"
        title="上一首"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5 fill-current" viewBox="0 0 24 24">
          <path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" />
        </svg>
      </button>

      <!-- 播放/暂停（经典汽水胶囊药丸宽圆角背景） -->
      <button 
        @mousedown.prevent
        @click.stop="sendAction('toggle-play')" 
        class="w-11 h-7 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all duration-200 active:scale-95 border border-white/5"
        title="播放/暂停"
      >
        <svg v-if="isPlaying" xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 fill-current ml-0.5" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      </button>

      <!-- 下一首 -->
      <button 
        @mousedown.prevent
        @click.stop="sendAction('next-song')" 
        class="text-white/60 hover:text-white transition-colors duration-200 active:scale-90"
        title="下一首"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5 fill-current" viewBox="0 0 24 24">
          <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
        </svg>
      </button>
    </div>

    <!-- 右上角 x 退出按钮定位容器（跟随主面板悬停阴影同步显隐） -->
    <div 
      class="taskbar-close absolute top-0 right-0 w-7 h-7 flex items-start justify-end pt-1 pr-1.5 pointer-events-none z-30 transition-opacity duration-300"
      :class="[isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100']"
    >
      <button
        type="button"
        class="text-white/30 hover:text-white/90 cursor-pointer pointer-events-auto transition-colors duration-200 active:scale-95"
        @click.stop="sendAction('close')"
        title="退出播控"
        aria-label="退出播控"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-2.5 w-2.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="3.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.taskbar-player { pointer-events: auto; }
.taskbar-hover-details { display: none; color: rgb(var(--taskbar-text-rgb, 255 255 255) / 65%); }
.taskbar-controls button:focus-visible,
.taskbar-close button:focus-visible { box-shadow: 0 0 0 2px rgb(255 255 255 / 65%); }

.taskbar-song-info,
.taskbar-controls {
  transition: opacity 150ms ease;
}

.taskbar-controls {
  opacity: 0;
  pointer-events: none;
}

.taskbar-player:hover .taskbar-song-info,
.taskbar-player:focus-within .taskbar-song-info {
  opacity: 0;
}

.taskbar-player:hover .taskbar-controls,
.taskbar-player:focus-within .taskbar-controls {
  opacity: 1;
  pointer-events: auto;
}

/* 68px cover/handle + 160px controls/spacing + at least 132px metadata. */
@media (min-width: 360px) {
  .taskbar-player:hover .taskbar-content,
  .taskbar-player:focus-within .taskbar-content { padding-right: 150px; }
  .taskbar-player:hover .taskbar-song-info,
  .taskbar-player:focus-within .taskbar-song-info { opacity: 1; }
  .taskbar-player:hover .taskbar-lyric-viewport,
  .taskbar-player:focus-within .taskbar-lyric-viewport { display: none; }
  .taskbar-player:hover .taskbar-hover-details,
  .taskbar-player:focus-within .taskbar-hover-details { display: block; }
}

.taskbar-lyric-viewport {
  overflow: hidden;
  white-space: nowrap;
  scrollbar-width: none;
}

.taskbar-lyric-content {
  position: relative;
  width: max-content;
  min-width: 100%;
  white-space: pre;
}

.taskbar-lyric-word {
  position: relative;
  display: inline-block;
  color: rgb(var(--taskbar-text-rgb, 255 255 255) / 50%);
}

.taskbar-lyric-word::after {
  content: attr(data-text);
  position: absolute;
  inset: 0;
  color: rgb(var(--taskbar-text-rgb, 255 255 255) / 95%);
  clip-path: inset(0 calc(100% - var(--word-progress, 0%)) 0 0);
}

.taskbar-song-title { color: rgb(var(--taskbar-text-rgb, 255 255 255) / 80%); }
.taskbar-line { color: rgb(var(--taskbar-text-rgb, 255 255 255) / 50%); }
.taskbar-line.is-played { color: rgb(var(--taskbar-text-rgb, 255 255 255) / 95%); }
.taskbar-fallback { color: rgb(var(--taskbar-text-rgb, 255 255 255) / 85%); }

@media (prefers-reduced-motion: reduce) {
  .taskbar-song-info,
  .taskbar-controls {
    transition: none;
  }
}
</style>

<style>
/* 强制窗口背景绝对透明，彻底去除圆角外多余的拐角黑色边缘 */
html, body, #app {
  background: transparent !important;
  background-color: transparent !important;
  overflow: hidden !important;
}
</style>
