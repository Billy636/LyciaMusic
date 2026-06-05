<script setup lang="ts">
import { LogicalPosition } from '@tauri-apps/api/dpi';
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import {
  TASKBAR_PLAYER_ACTION_EVENT,
  TASKBAR_PLAYER_STATE_EVENT,
  TASKBAR_PLAYER_STATE_APPLIED_EVENT,
  TASKBAR_PLAYER_VISIBILITY_EVENT,
  TASKBAR_PLAYER_DRAG_EVENT,
  TASKBAR_PLAYER_WINDOW_HEIGHT,
  TASKBAR_PLAYER_WINDOW_WIDTH,
  type TaskbarPlayerStatePayload,
  type TaskbarPlayerAction,
} from '../../features/taskbarPlayer/shared';
import { writeSavedPositionX, type TaskbarTrayGeometry } from '../../composables/useTaskbarPlayerBridge';
import { windowApi } from '../../services/tauri/windowApi';
import type { Song } from '../../types';

const appWindow = getCurrentWindow();

const currentSong = ref<Song | null>(null);
const localCoverUrl = ref('');
const isPlaying = ref(false);
const isDarkTheme = ref(true); // 任务栏播控默认采用高质感暗色毛玻璃设计，适配大多数用户底色
const isVisible = ref(false);
const isDragging = ref(false);
let dragSafetyTimer: ReturnType<typeof setTimeout> | null = null;
let cleanupDragListeners: (() => void) | null = null;
let dragFrame = 0;
let pendingDragPosition: LogicalPosition | null = null;

interface DragBounds {
  minX: number;
  maxX: number;
  y: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const finishDrag = async () => {
  if (!isDragging.value) return;
  isDragging.value = false;
  if (dragSafetyTimer) clearTimeout(dragSafetyTimer);
  cleanupDragListeners?.();
  cleanupDragListeners = null;
  void emitTo('main', TASKBAR_PLAYER_DRAG_EVENT, { dragging: false });
  const factor = await appWindow.scaleFactor();
  const position = (await appWindow.outerPosition()).toLogical(factor);
  writeSavedPositionX(position.x);
};

const scheduleDragPosition = (position: LogicalPosition) => {
  pendingDragPosition = position;
  if (dragFrame !== 0) return;

  dragFrame = window.requestAnimationFrame(() => {
    dragFrame = 0;
    const nextPosition = pendingDragPosition;
    pendingDragPosition = null;
    if (nextPosition) {
      void appWindow.setPosition(nextPosition);
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
    maxX: Math.max(taskbarRect.left, taskbarRect.right - TASKBAR_PLAYER_WINDOW_WIDTH),
    y: Math.round(taskbarRect.top + (taskbarHeight - TASKBAR_PLAYER_WINDOW_HEIGHT) / 2),
  };
};

const startDrag = async (event: PointerEvent) => {
  if (event.button !== 0) return;

  isDragging.value = true;
  void emitTo('main', TASKBAR_PLAYER_DRAG_EVENT, { dragging: true });

  cleanupDragListeners?.();
  if (dragSafetyTimer) clearTimeout(dragSafetyTimer);
  dragSafetyTimer = setTimeout(() => {
    if (isDragging.value) {
      void finishDrag();
    }
  }, 30000);

  const factor = await appWindow.scaleFactor();
  const startPosition = (await appWindow.outerPosition()).toLogical(factor);
  const dragBounds = await getTaskbarDragBounds();
  const startScreenX = event.screenX;

  const handlePointerMove = (moveEvent: PointerEvent) => {
    if (!isDragging.value || !dragBounds) return;
    const nextX = clamp(
      startPosition.x + moveEvent.screenX - startScreenX,
      dragBounds.minX,
      dragBounds.maxX,
    );
    scheduleDragPosition(new LogicalPosition(Math.round(nextX), dragBounds.y));
  };

  const handleDragEnd = () => {
    void finishDrag();
  };

  (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
  window.addEventListener('pointermove', handlePointerMove, true);
  window.addEventListener('pointerup', handleDragEnd, true);
  window.addEventListener('pointercancel', handleDragEnd, true);
  window.addEventListener('blur', handleDragEnd, true);
  cleanupDragListeners = () => {
    window.removeEventListener('pointermove', handlePointerMove, true);
    window.removeEventListener('pointerup', handleDragEnd, true);
    window.removeEventListener('pointercancel', handleDragEnd, true);
    window.removeEventListener('blur', handleDragEnd, true);
  };
};

const restoreMainWindow = async () => {
  try {
    const mainWin = await WebviewWindow.getByLabel('main');
    if (!mainWin) {
      console.warn('[TaskbarPlayer] Main window not found');
      return;
    }
    await mainWin.show();
    const minimized = await mainWin.isMinimized();
    if (minimized) {
      await mainWin.unminimize();
    }
    await mainWin.setFocus();
  } catch (error) {
    console.error('[TaskbarPlayer] Failed to restore main window:', error);
  }
};

const titleElement = ref<HTMLElement | null>(null);
const titleWrapperElement = ref<HTMLElement | null>(null);
const shouldScroll = ref(false);

let unlistenState: (() => void) | null = null;
let unlistenVisibility: (() => void) | null = null;
let unlistenMoved: (() => void) | null = null;

const sendAction = (actionType: 'prev-song' | 'next-song' | 'toggle-play' | 'close') => {
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

const checkTitleScroll = () => {
  void nextTick(() => {
    if (titleElement.value && titleWrapperElement.value) {
      const scrollWidth = titleElement.value.scrollWidth;
      const clientWidth = titleWrapperElement.value.clientWidth;
      shouldScroll.value = scrollWidth > clientWidth;
    } else {
      shouldScroll.value = false;
    }
  });
};

watch(currentSong, () => {
  checkTitleScroll();
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
    localCoverUrl.value = event.payload.coverUrl;
    isPlaying.value = event.payload.isPlaying;
    isDarkTheme.value = event.payload.isDarkTheme;
    void nextTick(() => {
      void emitTo('main', TASKBAR_PLAYER_STATE_APPLIED_EVENT);
      checkTitleScroll();
    });
  });

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
  unlistenState?.();
  unlistenVisibility?.();
  unlistenMoved?.();
  if (dragSafetyTimer) clearTimeout(dragSafetyTimer);
  cleanupDragListeners?.();
  if (dragFrame !== 0) {
    window.cancelAnimationFrame(dragFrame);
    dragFrame = 0;
  }
});
</script>

<template>
  <div
    class="w-[320px] h-[40px] relative flex items-center justify-between select-none overflow-hidden rounded-xl border pl-2 pr-3.5 transition-all duration-300 bg-transparent"
    :class="[
      isDragging 
        ? 'bg-[#121214]/65 border-white/5 shadow-2xl backdrop-blur-md' 
        : 'border-transparent shadow-none hover:bg-[#121214]/65 hover:border-white/5 hover:shadow-2xl hover:backdrop-blur-md'
    ]"
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
    <div class="flex items-center gap-2.5 min-w-0 flex-1 mr-4 pointer-events-none">
      <!-- 封面 -->
      <div 
        class="group/cover w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-white/5 border border-white/5 flex items-center justify-center text-white/40 relative cursor-pointer pointer-events-auto"
        @mousedown.stop.prevent
        @click.stop="restoreMainWindow"
      >
        <img 
          v-if="localCoverUrl" 
          :src="localCoverUrl" 
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
      </div>

      <!-- 文字信息（歌名/歌手） -->
      <div class="flex flex-col min-w-0 leading-tight">
        <!-- 歌曲标题（带跑马灯逻辑） -->
        <div 
          ref="titleWrapperElement" 
          class="text-xs text-white/95 font-semibold truncate max-w-[110px] w-full overflow-hidden relative"
        >
          <div
            ref="titleElement"
            class="inline-block whitespace-nowrap"
            :class="{ 'marquee-scroll': shouldScroll }"
          >
            {{ currentSong ? (currentSong.title || currentSong.name) : 'Lycia Player' }}
          </div>
        </div>

        <!-- 歌手名 -->
        <div class="text-[10px] text-white/50 truncate max-w-[110px] w-full">
          {{ currentSong ? currentSong.artist : '享受音乐时光' }}
        </div>
      </div>
    </div>

    <!-- 右侧：上一首、播放/暂停、下一首控制 -->
    <div class="flex items-center gap-2.5 shrink-0 z-20 mr-3">
      <!-- 上一首 -->
      <button 
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
        @click.stop="sendAction('next-song')" 
        class="text-white/60 hover:text-white transition-colors duration-200 active:scale-90"
        title="下一首"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5 fill-current" viewBox="0 0 24 24">
          <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
        </svg>
      </button>
    </div>

    <!-- 右上角 x 退出按钮外层隐形大热区（28px x 28px，完美契合 40px 高度容器的右上角，保证优秀的盲操防滑体验） -->
    <div 
      class="group/exit absolute top-0 right-0 w-7 h-7 flex items-center justify-center cursor-pointer z-30"
      @click.stop="sendAction('close')"
      title="退出播控"
    >
      <!-- 内层精致小巧的 x 按钮 -->
      <div 
        class="w-4 h-4 rounded-full flex items-center justify-center text-white/30 bg-white/5 opacity-0 group-hover/exit:opacity-100 hover:!text-white/90 hover:!bg-white/15 transition-all duration-300 active:scale-90"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-2 w-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </div>
    </div>
  </div>
</template>

<style scoped>
.marquee-scroll {
  display: inline-block;
  animation: marquee-anim 8s linear infinite;
  padding-left: 20px;
}

@keyframes marquee-anim {
  0% {
    transform: translate3d(0, 0, 0);
  }
  50% {
    transform: translate3d(-35%, 0, 0);
  }
  100% {
    transform: translate3d(0, 0, 0);
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
