<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { availableMonitors, getCurrentWindow, primaryMonitor } from '@tauri-apps/api/window';
import { Expand, Music, X } from 'lucide-vue-next';
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';

import {
  TASKBAR_PLAYER_ACTION_EVENT,
  TASKBAR_PLAYER_STATE_EVENT,
  TASKBAR_PLAYER_PLAYBACK_EVENT,
  TASKBAR_PLAYER_STATE_APPLIED_EVENT,
  TASKBAR_PLAYER_VISIBILITY_EVENT,
  TASKBAR_PLAYER_DRAG_EVENT,
  normalizeTaskbarTextColor,
  normalizeTaskbarContentMode,
  normalizeTaskbarCoverShape,
  normalizeTaskbarLyricEffect,
  normalizeTaskbarLyricHighlightColor,
  type TaskbarTrayGeometry,
  type TaskbarPlayerStatePayload,
  type TaskbarPlayerPlaybackPayload,
  type TaskbarPlayerAction,
  type TaskbarContentMode,
  type TaskbarCoverShape,
  type TaskbarLyricEffect,
} from '../../features/taskbarPlayer/shared';
import {
  clampTaskbarLeftOffset,
  resolveTaskbarHorizontalPosition,
  resolveTaskbarPositionScaleFactor,
  type TaskbarHorizontalPosition,
} from '../../features/taskbarPlayer/position';
import {
  createTaskbarLyricDisplayLines,
  projectTaskbarPlaybackTime,
  resolveTaskbarDoubleLyricLines,
  resolveTaskbarLyricInterlude,
  resolveTaskbarLyricLine,
} from '../../features/taskbarPlayer/lyrics';
import type { LyricLine, LyricsStatus } from '../../composables/lyrics/types';
import { useCoverRotation } from '../player/useCoverRotation';
import type { Song } from '../../types';
import TaskbarLyricLine from './TaskbarLyricLine.vue';

const appWindow = getCurrentWindow();

const currentSong = ref<Song | null>(null);
const localCoverUrl = ref('');
const isPlaying = ref(false);
const isVisible = ref(false);
const isDragging = ref(false);
const canDrag = ref(true);
const contentMode = ref<TaskbarContentMode>('title-lyrics');
const coverShape = ref<TaskbarCoverShape>('square');
const coverRotate = ref(false);
const artwork = ref<HTMLElement | null>(null);
const reflection = ref<HTMLElement | null>(null);
const isDocumentVisible = ref(!document.hidden);
useCoverRotation(artwork, reflection,
  () => coverShape.value === 'circle' && coverRotate.value,
  () => isPlaying.value && isVisible.value && isDocumentVisible.value);
const backgroundOpacity = ref(0);
const textColor = ref('#ffffff');
const lyricEffect = ref<TaskbarLyricEffect>('karaoke');
const lyricHighlightColor = ref<string | null>(null);
const translationKaraoke = ref(true);
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
const lyricTime = computed(() => playbackTime.value - (playbackAnchor.value?.audioDelay ?? 0));
const taskbarLyrics = computed(() => createTaskbarLyricDisplayLines(parsedLyrics.value));
const lyricInterlude = computed(() => currentSong.value && lyricsStatus.value === 'ready'
  ? resolveTaskbarLyricInterlude(parsedLyrics.value, lyricTime.value) : null);
const interludeDotProgress = (index: number) => {
  const gap = lyricInterlude.value;
  if (!gap) return 0;
  return Math.max(0, Math.min(1, (lyricTime.value - gap.start) / (gap.end - gap.start) * 3 - index));
};
const lyricRows = computed(() => {
  if (!currentSong.value || lyricsStatus.value !== 'ready' || lyricInterlude.value) return [];
  // Keep selection on source cues so finishing the highlight does not clear the line.
  const current = contentMode.value === 'double-line'
    ? null : resolveTaskbarLyricLine(parsedLyrics.value, lyricTime.value);
  const sourceLines = contentMode.value === 'double-line'
    ? resolveTaskbarDoubleLyricLines(parsedLyrics.value, lyricTime.value)
    : current ? [current] : [];
  return sourceLines.map(sourceLine => {
    const index = parsedLyrics.value.indexOf(sourceLine);
    return { key: `${currentSong.value?.path}:${index}:source`, line: taskbarLyrics.value[index] };
  });
});
const currentLyric = computed(() => lyricRows.value[0]?.line ?? null);
const isReversingLyrics = ref(false);
watch(() => currentLyric.value?.time, (time, previous) => {
  isReversingLyrics.value = time !== undefined && previous !== undefined && time < previous;
});
const songTitle = computed(() => currentSong.value
  ? currentSong.value.title || currentSong.value.name
  : 'Lycia Player');
const fallbackText = computed(() => currentSong.value?.artist || (currentSong.value ? '暂无歌词' : '享受音乐时光'));
const lyricFallbackText = computed(() => {
  if (!currentSong.value) return '享受音乐时光';
  if (lyricsStatus.value === 'loading') return '歌词加载中…';
  if (lyricsStatus.value === 'error') return '歌词暂不可用';
  if (lyricsStatus.value === 'ready' && parsedLyrics.value.length) return '等待歌词';
  return '暂无歌词';
});
const hasTranslation = computed(() => contentMode.value === 'bilingual' && !!currentLyric.value?.translation?.trim());
const coverTitle = computed(() => `${songTitle.value}${currentSong.value?.artist ? ` · ${currentSong.value.artist}` : ''}\n显示/收起主窗口`);
let lyricFrame = 0;
let lastLyricFrameAt = 0;
const LYRIC_FRAME_INTERVAL_MS = 1000 / 30;
let isFinishingDrag = false;
let activeDragBounds: TaskbarHorizontalPosition | null = null;
let activeDragScaleFactor = 1;
let activeDragPromise: Promise<number> | null = null;
let activeNativeDragSessionId: number | null = null;
let nextNativeDragSessionId = Date.now() * 1000;
let cleanupDragListeners: (() => void) | null = null;
let dragSession = 0;

const finishDrag = async (finalPhysicalX?: number) => {
  if (!isDragging.value) return;
  isFinishingDrag = true;
  isDragging.value = false;
  dragSession++;
  cleanupDragListeners?.();
  cleanupDragListeners = null;
  let leftOffset: number | undefined;
  const operation = activeDragPromise;
  const nativeSessionId = activeNativeDragSessionId;
  const bounds = activeDragBounds;
  const scaleFactor = activeDragScaleFactor;
  try {
    if (operation) {
      await invoke('cancel_taskbar_player_drag', { sessionId: nativeSessionId }).catch(error => {
        console.warn('Failed to cancel taskbar drag:', error);
      });
      finalPhysicalX = await operation;
    }
    if (bounds) {
      const physicalX = finalPhysicalX ?? (await appWindow.outerPosition()).x;
      leftOffset = clampTaskbarLeftOffset(bounds.baseX - physicalX / scaleFactor, bounds);
    }
  } catch (error) {
    console.warn('Failed to save taskbar drag position:', error);
  } finally {
    activeDragBounds = null;
    activeDragPromise = null;
    activeNativeDragSessionId = null;
    // Carry the final offset with the end event so the main window saves it
    // before resuming automatic positioning with the previous offset.
    try {
      await emitTo('main', TASKBAR_PLAYER_DRAG_EVENT, { dragging: false, leftOffset });
    } catch (error) {
      console.warn('Failed to finish taskbar drag:', error);
    } finally {
      isFinishingDrag = false;
    }
  }
};

interface TaskbarDragBounds extends TaskbarHorizontalPosition {
  scaleFactor: number;
  windowScaleFactor: number;
}

const getTaskbarDragBounds = async (): Promise<TaskbarDragBounds | null> => {
  const geometry = await invoke<TaskbarTrayGeometry>('get_taskbar_tray_geometry').catch((error) => {
    console.warn('Failed to get taskbar drag bounds:', error);
    return null;
  });
  if (!geometry) return null;

  let monitor = await primaryMonitor().catch(() => null);
  if (!monitor) {
    const monitors = await availableMonitors().catch(() => []);
    monitor = monitors.find(candidate => candidate.position.x === 0 && candidate.position.y === 0) ?? monitors[0] ?? null;
  }
  const factor = resolveTaskbarPositionScaleFactor(geometry, monitor?.scaleFactor);
  const windowFactor = await appWindow.scaleFactor();
  const width = (await appWindow.innerSize()).toLogical(windowFactor).width;
  const bounds = resolveTaskbarHorizontalPosition(geometry, width, factor);
  return bounds ? { ...bounds, scaleFactor: factor, windowScaleFactor: windowFactor } : null;
};

const startDrag = async (event: PointerEvent) => {
  if (!canDrag.value || event.button !== 0 || !event.isPrimary || isDragging.value || isFinishingDrag) return;
  const grabOffsetX = event.clientX;
  const session = ++dragSession;
  isDragging.value = true;
  const target = event.currentTarget as HTMLElement;
  const pointerId = event.pointerId;
  const handlePointerRelease = (release: PointerEvent) => {
    // A WebView capture cancellation must not stop native tracking. Keep the
    // actual release listener until completion so a queued command cannot pick
    // up the next mouse press after a quick release.
    if (release.type === 'pointercancel' && activeDragPromise) return;
    if (release.pointerId === pointerId && session === dragSession) void finishDrag();
  };
  window.addEventListener('pointerup', handlePointerRelease, true);
  window.addEventListener('pointercancel', handlePointerRelease, true);
  cleanupDragListeners = () => {
    window.removeEventListener('pointerup', handlePointerRelease, true);
    window.removeEventListener('pointercancel', handlePointerRelease, true);
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
  };
  try { target.setPointerCapture(pointerId); } catch {
    // Native movement and release tracking do not depend on DOM capture.
  }
  let operation: Promise<number> | null = null;
  try {
    // Suspend automatic positioning before native dragging starts. The native
    // loop tracks mouse movement and release even when the WebView loses capture.
    await emitTo('main', TASKBAR_PLAYER_DRAG_EVENT, { dragging: true });
    const bounds = await getTaskbarDragBounds();
    if (!isDragging.value || session !== dragSession) return;
    activeDragBounds = bounds;
    if (!bounds) { await finishDrag(); return; }
    activeDragScaleFactor = bounds.scaleFactor;
    activeNativeDragSessionId = ++nextNativeDragSessionId;
    operation = invoke<number>('drag_taskbar_player', {
      sessionId: activeNativeDragSessionId,
      minX: Math.ceil(bounds.minX * bounds.scaleFactor),
      maxX: Math.floor(bounds.maxX * bounds.scaleFactor),
      y: Math.round(bounds.y * bounds.scaleFactor),
      grabOffsetX: Math.round(grabOffsetX * bounds.windowScaleFactor),
    });
    activeDragPromise = operation;
    const physicalX = await operation;
    if (activeDragPromise === operation) activeDragPromise = null;
    if (isDragging.value && session === dragSession) await finishDrag(physicalX);
  } catch (error) {
    console.warn('Failed to start taskbar drag:', error);
    if (activeDragPromise === operation) activeDragPromise = null;
    if (isDragging.value && session === dragSession) await finishDrag();
  }
};

let unlistenState: (() => void) | null = null;
let unlistenPlayback: (() => void) | null = null;
let unlistenVisibility: (() => void) | null = null;
let unlistenMoved: (() => void) | null = null;

type TaskbarSimpleActionType = Exclude<TaskbarPlayerAction['type'], 'set-left-offset'>;
const sendAction = (actionType: TaskbarSimpleActionType) => {
  void emitTo<TaskbarPlayerAction>('main', TASKBAR_PLAYER_ACTION_EVENT, { type: actionType });
};

const refreshTaskbarWindowTopmost = async () => {
  try {
    const refreshed = await invoke<boolean>('refresh_taskbar_window_topmost');
    if (!refreshed) console.warn('Taskbar player topmost refresh could not find its window.');
  } catch (error) {
    console.warn('Failed to refresh taskbar player topmost state:', error);
  }
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
};

watch([isVisible, isPlaying, parsedLyrics], refreshLyricClock);
watch(canDrag, enabled => {
  if (!enabled && isDragging.value) void finishDrag();
});
const onDocumentVisibilityChange = () => {
  isDocumentVisible.value = !document.hidden;
  if (document.hidden && isDragging.value) void finishDrag();
  refreshLyricClock();
};

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
    lyricEffect.value = normalizeTaskbarLyricEffect(event.payload.lyricEffect);
    lyricHighlightColor.value = normalizeTaskbarLyricHighlightColor(event.payload.lyricHighlightColor);
    translationKaraoke.value = event.payload.translationKaraoke !== false;
    contentMode.value = normalizeTaskbarContentMode(event.payload.contentMode);
    coverShape.value = normalizeTaskbarCoverShape(event.payload.coverShape);
    coverRotate.value = event.payload.coverRotate === true;
    canDrag.value = event.payload.canDrag !== false;
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
  document.addEventListener('visibilitychange', onDocumentVisibilityChange);

  // 2. 监听可见性
  unlistenVisibility = await listen<{ visible: boolean }>(TASKBAR_PLAYER_VISIBILITY_EVENT, (event) => {
    isVisible.value = event.payload.visible;
    if (event.payload.visible) {
      void refreshTaskbarWindowTopmost();
    } else if (isDragging.value) void finishDrag();
  });

  // 3. 原生拖动结束时保存位置；这里只保留窗口生命周期清理句柄。
  unlistenMoved = await appWindow.onMoved(() => {});

  // 4. 发送 Ready 握手并请求一次最新状态
  void emitTo('main', 'taskbar-player:ready');
  void emitTo('main', 'taskbar-player:request-state');
});

onUnmounted(() => {
  if (isDragging.value) {
    dragSession++;
    isDragging.value = false;
    cleanupDragListeners?.();
    cleanupDragListeners = null;
    if (activeNativeDragSessionId !== null) {
      void invoke('cancel_taskbar_player_drag', { sessionId: activeNativeDragSessionId }).catch(error => {
        console.warn('Failed to cancel taskbar drag on unmount:', error);
      });
    }
    void emitTo('main', TASKBAR_PLAYER_DRAG_EVENT, { dragging: false });
  }
  unlistenState?.();
  unlistenPlayback?.();
  unlistenVisibility?.();
  unlistenMoved?.();
  stopLyricClock();
  document.removeEventListener('visibilitychange', onDocumentVisibilityChange);
});
</script>

<template>
  <div
    class="taskbar-player group"
    :class="{ 'is-locked': !canDrag, 'is-dragging': isDragging, 'has-translation': hasTranslation }"
    :style="backgroundStyle"
  >
    <div
      v-if="canDrag"
      class="taskbar-drag-handle"
      title="按住拖拽调整播控条位置"
      @pointerdown.prevent.stop="startDrag"
    >
      <span class="taskbar-drag-grip" aria-hidden="true"><span></span><span></span><span></span></span>
    </div>

    <div class="taskbar-content">
      <button
        type="button"
        class="taskbar-cover group/cover"
        :class="{ 'is-circle': coverShape === 'circle' }"
        :title="coverTitle"
        aria-label="显示或收起主窗口"
        @mousedown.stop.prevent
        @click.stop="sendAction('toggle-main-window')"
      >
        <div ref="artwork" class="taskbar-artwork">
          <img v-if="localCoverUrl" :src="localCoverUrl" alt="歌曲封面" draggable="false" />
          <Music v-else :size="18" />
        </div>
        <span class="taskbar-cover-overlay"><Expand :size="16" :stroke-width="2.5" /></span>
      </button>

      <div class="taskbar-song-info">
        <div v-if="contentMode === 'title-lyrics'" class="taskbar-song-title" :title="songTitle">{{ songTitle }}</div>
        <div
          v-if="lyricInterlude"
          class="taskbar-interlude"
          role="img"
          aria-label="等待下一句歌词"
          title="等待下一句歌词"
          :style="{ color: lyricHighlightColor ?? undefined }"
        >
          <span v-for="index in 3" :key="index" class="taskbar-interlude-dot" aria-hidden="true"
            :style="{ '--dot-progress': interludeDotProgress(index - 1) }" />
        </div>
        <TransitionGroup
          v-else-if="contentMode === 'double-line' && currentLyric"
          tag="div"
          name="taskbar-lyric-stack"
          class="taskbar-double-lyrics"
          :class="{ 'is-reversing': isReversingLyrics }"
        >
          <div
            v-for="(row, index) in lyricRows"
            :key="row.key"
            class="taskbar-double-row"
            :class="{ 'is-upcoming': index > 0 }"
          >
            <TaskbarLyricLine
              :text="row.line.text"
              :words="row.line.words"
              :time="row.line.time"
              :end-time="row.line.endTime"
              :playback-time="lyricTime"
              :effect="lyricEffect"
              :highlight-color="lyricHighlightColor"
            />
          </div>
        </TransitionGroup>
        <template v-else-if="currentLyric">
          <TaskbarLyricLine
            :key="lyricRows[0].key"
            :text="currentLyric.text"
            :words="currentLyric.words"
            :time="currentLyric.time"
            :end-time="currentLyric.endTime"
            :playback-time="lyricTime"
            :effect="lyricEffect"
            :highlight-color="lyricHighlightColor"
          />
          <TaskbarLyricLine
            v-if="hasTranslation"
            :key="`${currentSong?.path}:${currentLyric.time}:translation`"
            :text="currentLyric.translation"
            :words="currentLyric.translationWords"
            :time="currentLyric.time"
            :end-time="currentLyric.endTime"
            :playback-time="lyricTime"
            :effect="translationKaraoke ? lyricEffect : 'none'"
            :highlight-color="lyricHighlightColor"
            translation
          />
        </template>
        <div v-else class="taskbar-fallback">{{ contentMode === 'title-lyrics' ? fallbackText : lyricFallbackText }}</div>
      </div>
    </div>

    <div class="taskbar-controls">
      <button
        type="button"
        class="taskbar-control"
        title="上一首"
        aria-label="上一首"
        @mousedown.prevent
        @click.stop="sendAction('prev-song')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" />
        </svg>
      </button>
      <button
        type="button"
        class="taskbar-play"
        :title="isPlaying ? '暂停' : '播放'"
        :aria-label="isPlaying ? '暂停' : '播放'"
        @mousedown.prevent
        @click.stop="sendAction('toggle-play')"
      >
        <svg v-if="isPlaying" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
        </svg>
        <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="currentColor" class="ml-0.5" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
      </button>
      <button
        type="button"
        class="taskbar-control"
        title="下一首"
        aria-label="下一首"
        @mousedown.prevent
        @click.stop="sendAction('next-song')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
        </svg>
      </button>
    </div>
    <div class="taskbar-close">
      <button
        type="button"
        title="退出播控"
        aria-label="退出播控"
        @mousedown.prevent
        @click.stop="sendAction('close')"
      ><X :size="10" :stroke-width="3.5" /></button>
    </div>
  </div>
</template>

<style scoped>
.taskbar-player {
  width: 100%;
  height: 40px;
  position: relative;
  display: flex;
  align-items: center;
  border-radius: 12px;
  padding: 0 14px 0 8px;
  overflow: hidden;
  user-select: none;
  pointer-events: auto;
  transition: background-color 200ms ease;
}
.taskbar-player.is-locked { padding-left: 0; }
.taskbar-drag-handle {
  width: 22px;
  height: 34px;
  margin-left: -6px;
  margin-right: 4px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: move;
}
.taskbar-drag-grip {
  width: 4px;
  height: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  color: rgb(255 255 255 / 50%);
  opacity: 0;
  transition: opacity 200ms ease, transform 200ms ease, color 200ms ease;
}
.taskbar-drag-grip > span { width: 4px; height: 4px; border-radius: 50%; background: currentColor; }
.taskbar-player:hover .taskbar-drag-grip,
.taskbar-player.is-dragging .taskbar-drag-grip { opacity: 1; }
.taskbar-drag-handle:hover .taskbar-drag-grip,
.taskbar-player.is-dragging .taskbar-drag-grip { transform: scaleX(1.25); color: white; }
.taskbar-content {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-right: 4px;
  min-width: 0;
  flex: 1;
}
.taskbar-cover {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  position: relative;
  background: rgb(255 255 255 / 5%);
  border: 1px solid rgb(255 255 255 / 5%);
  color: rgb(255 255 255 / 40%);
  cursor: pointer;
}
.taskbar-cover.is-circle { border-radius: 50%; }
.taskbar-artwork { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
.taskbar-artwork img { width: 100%; height: 100%; object-fit: cover; }
.taskbar-cover-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 45%);
  color: white;
  opacity: 0;
  pointer-events: none;
  transition: opacity 200ms ease;
}
.taskbar-cover:hover .taskbar-cover-overlay,
.taskbar-cover:focus-visible .taskbar-cover-overlay { opacity: 1; }
.taskbar-song-info {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  flex: 1;
  transition: opacity 150ms ease;
}
.taskbar-double-lyrics {
  position: relative;
  height: 32px;
  overflow: hidden;
  --lyric-enter-offset: 16px;
  --lyric-leave-offset: -16px;
}
.taskbar-double-lyrics.is-reversing {
  --lyric-enter-offset: -16px;
  --lyric-leave-offset: 16px;
}
.taskbar-double-row {
  height: 16px;
  min-width: 0;
  transition: opacity 240ms ease;
}
.taskbar-double-row.is-upcoming { opacity: 0.62; }
.taskbar-double-row :deep(.taskbar-lyric-viewport) {
  font-size: 12px;
  line-height: 16px;
}
.taskbar-lyric-stack-move,
.taskbar-lyric-stack-enter-active,
.taskbar-lyric-stack-leave-active {
  transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 240ms ease;
}
.taskbar-lyric-stack-leave-active { position: absolute; left: 0; right: 0; }
.taskbar-lyric-stack-enter-from { opacity: 0; transform: translateY(var(--lyric-enter-offset)); }
.taskbar-lyric-stack-leave-to { opacity: 0; transform: translateY(var(--lyric-leave-offset)); }
.taskbar-song-title {
  font-size: 11px;
  line-height: 14px;
  font-weight: 600;
  color: rgb(var(--taskbar-text-rgb, 255 255 255) / 80%);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.taskbar-interlude {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 17px;
  color: rgb(var(--taskbar-text-rgb, 255 255 255) / 95%);
}
.taskbar-interlude-dot {
  position: relative;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgb(var(--taskbar-text-rgb, 255 255 255) / 30%);
  transform: scale(calc(0.8 + var(--dot-progress) * 0.2));
}
.taskbar-interlude-dot::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: currentColor;
  opacity: var(--dot-progress);
}
.taskbar-fallback {
  color: rgb(var(--taskbar-text-rgb, 255 255 255) / 85%);
  font-size: 13px;
  line-height: 17px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.taskbar-controls {
  position: absolute;
  inset-block: 0;
  right: 24px;
  display: flex;
  align-items: center;
  gap: 20px;
  z-index: 20;
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease;
}
.taskbar-player:hover .taskbar-song-info,
.taskbar-player:focus-within .taskbar-song-info,
.taskbar-player.is-dragging .taskbar-song-info { opacity: 0; }
.taskbar-player:hover .taskbar-controls,
.taskbar-player:focus-within .taskbar-controls,
.taskbar-player.is-dragging .taskbar-controls { opacity: 1; pointer-events: auto; }
.taskbar-control {
  width: 18px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgb(255 255 255 / 60%);
  transition: color 200ms ease, transform 150ms ease;
}
.taskbar-control:hover { color: white; }
.taskbar-control:active { transform: scale(0.9); }
.taskbar-play {
  width: 44px;
  height: 28px;
  border-radius: 999px;
  background: rgb(255 255 255 / 10%);
  border: 1px solid rgb(255 255 255 / 5%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 200ms ease, transform 150ms ease;
}
.taskbar-play:hover { background: rgb(255 255 255 / 20%); }
.taskbar-play:active { transform: scale(0.95); }
.taskbar-close {
  position: absolute;
  top: 0;
  right: 0;
  width: 28px;
  height: 28px;
  padding: 4px 6px 0 0;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  z-index: 30;
  opacity: 0;
  pointer-events: none;
  transition: opacity 200ms ease;
}
.taskbar-player:hover .taskbar-close,
.taskbar-player:focus-within .taskbar-close,
.taskbar-player.is-dragging .taskbar-close { opacity: 1; }
.taskbar-close button { color: rgb(255 255 255 / 30%); pointer-events: auto; transition: color 200ms ease, transform 150ms ease; }
.taskbar-close button:hover { color: rgb(255 255 255 / 90%); }
.taskbar-close button:active { transform: scale(0.95); }
.taskbar-player button { cursor: pointer; }
.taskbar-player button:focus-visible { outline: 2px solid rgb(255 255 255 / 65%); outline-offset: -2px; }
@media (min-width: 360px) {
  .taskbar-player:hover .taskbar-content,
  .taskbar-player:focus-within .taskbar-content,
  .taskbar-player.is-dragging .taskbar-content { padding-right: 150px; }
  .taskbar-player:hover .taskbar-song-info,
  .taskbar-player:focus-within .taskbar-song-info,
  .taskbar-player.is-dragging .taskbar-song-info { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .taskbar-player, .taskbar-drag-grip, .taskbar-cover-overlay,
  .taskbar-song-info, .taskbar-controls, .taskbar-control, .taskbar-play, .taskbar-close,
  .taskbar-close button, .taskbar-double-row, .taskbar-lyric-stack-move,
  .taskbar-lyric-stack-enter-active, .taskbar-lyric-stack-leave-active { transition: none; }
  .taskbar-interlude-dot { transform: none; }
}
</style>

<style>
/* The standalone taskbar window must retain a transparent WebView surface. */
html, body, #app {
  background: transparent !important;
  background-color: transparent !important;
  overflow: hidden !important;
}
</style>
