<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { availableMonitors, getCurrentWindow, primaryMonitor } from '@tauri-apps/api/window';
import {
  ChevronUp, Expand, ListMusic, Lock, Music, Unlock, Volume2, VolumeX, X,
} from 'lucide-vue-next';
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch, watchEffect } from 'vue';

import {
  TASKBAR_PLAYER_ACTION_EVENT,
  TASKBAR_PLAYER_STATE_EVENT,
  TASKBAR_PLAYER_PLAYBACK_EVENT,
  TASKBAR_PLAYER_STATE_APPLIED_EVENT,
  TASKBAR_PLAYER_VISIBILITY_EVENT,
  TASKBAR_PLAYER_DRAG_EVENT,
  TASKBAR_PLAYER_PANEL_EVENT,
  TASKBAR_PLAYER_QUEUE_EVENT,
  TASKBAR_PLAYER_PANEL_HEIGHT,
  TASKBAR_PLAYER_DEFAULT_BACKGROUND_OPACITY,
  normalizeTaskbarTextColor,
  normalizeTaskbarContentMode,
  normalizeTaskbarCoverShape,
  normalizeTaskbarBackgroundMode,
  normalizeTaskbarBackgroundColor,
  normalizeTaskbarFrameShape,
  normalizeTaskbarLyricEffect,
  normalizeTaskbarLyricHighlightColor,
  type TaskbarTrayGeometry,
  type TaskbarPlayerStatePayload,
  type TaskbarPlayerPlaybackPayload,
  type TaskbarPlayerAction,
  type TaskbarContentMode,
  type TaskbarCoverShape,
  type TaskbarLyricEffect,
  type TaskbarBackgroundMode,
  type TaskbarFrameShape,
  type TaskbarPlayerPanelPayload,
  type TaskbarPlayerQueuePayload,
} from '../../features/taskbarPlayer/shared';
import {
  clampTaskbarLeftOffset,
  resolveTaskbarHorizontalPosition,
  resolveTaskbarPositionScaleFactor,
} from '../../features/taskbarPlayer/position';
import { emitSongSwitchSignal } from '../../features/songNotification/switchSignal';
import { getNextWheelVolume } from '../../utils/volume';
import {
  createTaskbarLyricDisplayLines,
  projectTaskbarPlaybackTime,
  resolveTaskbarDoubleLyricLines,
  resolveTaskbarLyricInterlude,
  resolveTaskbarLyricLine,
} from '../../features/taskbarPlayer/lyrics';
import type { LyricLine, LyricsStatus } from '../../composables/lyrics/types';
import { useCoverRotation } from '../player/useCoverRotation';
import { useLibrarySongWindowCache } from '../../composables/useLibrarySongWindowCache';
import type { Song } from '../../types';
import TaskbarLyricLine from './TaskbarLyricLine.vue';
import { buildSquircleMask } from './taskbarSquircle';
import { resolveCoverRadius, resolveFrameRadius, type FrameShape } from '../../features/shape/squircle';


const appWindow = getCurrentWindow();

const currentSong = ref<Song | null>(null);
const localCoverUrl = ref('');
const isPlaying = ref(false);
const isVisible = ref(false);
const isDragging = ref(false);
const canDrag = ref(true);
// 「双击当前歌曲暂停 / 继续」由主窗口经 state 事件同步过来。
const doubleClickToPause = ref(false);
const contentMode = ref<TaskbarContentMode>('adaptive');
const coverShape = ref<TaskbarCoverShape>('rounded');
const coverRotate = ref(false);
const artwork = ref<HTMLElement | null>(null);
const reflection = ref<HTMLElement | null>(null);
const isDocumentVisible = ref(!document.hidden);
useCoverRotation(artwork, reflection,
  () => coverShape.value === 'circle' && coverRotate.value,
  () => isPlaying.value && isVisible.value && isDocumentVisible.value);
const backgroundOpacity = ref(TASKBAR_PLAYER_DEFAULT_BACKGROUND_OPACITY);
const textColor = ref('#ffffff');
const lyricEffect = ref<TaskbarLyricEffect>('karaoke');
const lyricHighlightColor = ref<string | null>(null);
const translationKaraoke = ref(true);
const frameShape = ref<TaskbarFrameShape>('rounded');
// 外框弧度：圆角矩形 16px、圆形取小条半高 22px（44px 高即正半圆）、方形 0。
// 外框基准始终是 44px 小条，展开面板时高度变化不改变圆角半径。
const frameRadiusPx = computed(() => resolveFrameRadius(frameShape.value as FrameShape, 44));
const frameRadius = computed(() => `${frameRadiusPx.value}px`);
// 视口尺寸改用 Tauri 物理窗口尺寸换算：180% 这类非整数缩放下 WebView 报告的
// innerWidth 会被取整（271 CSS = 488.3 物理 > 窗口实际 487 物理），壳层右端
// 半圆极点会被窗口边缘垂直切掉 1~2 物理像素（用户看到的"右侧割直/左右不对称"）。
// 物理尺寸 ÷ 缩放系数换算回 CSS 尺寸，可保证渲染宽度与窗口物理宽度一致。
const viewportSize = ref({ width: window.innerWidth, height: window.innerHeight });
const syncViewportSize = async () => {
  try {
    const [size, factor] = await Promise.all([appWindow.innerSize(), appWindow.scaleFactor()]);
    if (factor > 0 && size.width > 0 && size.height > 0) {
      viewportSize.value = { width: size.width / factor, height: size.height / factor };
      return;
    }
  } catch (error) {
    console.warn('Failed to query physical window size:', error);
  }
  viewportSize.value = { width: window.innerWidth, height: window.innerHeight };
};
let unlistenResized: (() => void) | null = null;
// 圆角交给物理像素级 canvas 蒙版（iOS 连续曲率）：蒙版与窗口物理像素 1:1 对齐，
// 彻底规避非整数缩放下 border-radius 光栅化的右端割角；border-radius 仅作降级兜底。
const shellMask = ref('');
watchEffect(() => {
  const mask = buildSquircleMask({
    width: viewportSize.value.width,
    height: viewportSize.value.height,
    radius: frameRadiusPx.value,
  });
  shellMask.value = mask ?? '';
});
// 封面与外框同比例、同曲率（共享规则）；方形外框下保留 10px 兜底。
const COVER_SIZE = 32;
const coverRadiusPx = computed(() => {
  if (coverShape.value !== 'rounded') return 0;
  if (frameShape.value === 'square') return 10;
  return resolveCoverRadius('rounded', COVER_SIZE, 44);
});
const coverMask = computed(() => {
  const r = coverRadiusPx.value;
  return r > 0
    ? buildSquircleMask({ width: COVER_SIZE, height: COVER_SIZE, radius: r }) ?? ''
    : '';
});
const coverStyle = computed(() => {
  if (coverShape.value !== 'rounded') return undefined;
  const mask = coverMask.value ? `url("${coverMask.value}")` : 'none';
  return {
    borderRadius: `${coverRadiusPx.value}px`,
    maskImage: mask,
    WebkitMaskImage: mask,
    maskSize: '100% 100%',
    WebkitMaskSize: '100% 100%',
  };
});


const hexToRgbTriplet = (hex: string) => {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map(char => char + char).join('') : value;
  return [0, 2, 4].map(offset => parseInt(full.slice(offset, offset + 2), 16) || 0).join(' ');
};
// 整张卡片的背景统一画在 shell 上：只有一处圆角与裁切，避免子层盖掉边角。
const shellStyle = computed(() => ({
  '--panel-cover-image': localCoverUrl.value ? `url("${localCoverUrl.value}")` : 'none',
  '--card-rgb': hexToRgbTriplet(backgroundColor.value),
  '--card-alpha': String(Math.max(0.2, backgroundOpacity.value / 100)),
  '--card-radius': frameRadius.value,
  '--shell-mask': shellMask.value ? `url("${shellMask.value}")` : 'none',
  '--bar-scrim-a': String(0.12 + (backgroundOpacity.value / 100) * 0.5),
  '--bar-scrim-b': String(0.3 + (backgroundOpacity.value / 100) * 0.5),
}));
const backgroundStyle = computed(() => ({
  '--taskbar-text-rgb': [1, 3, 5].map(offset => parseInt(textColor.value.slice(offset, offset + 2), 16)).join(' '),
}));
const parsedLyrics = shallowRef<LyricLine[]>([]);
const lyricsStatus = ref<LyricsStatus>('idle');
const volume = ref(100);
const showVolume = ref(false);
// 只有指针真正进入功能按钮区域（或键盘聚焦到其中）才从歌词呈现切换为按钮呈现；
// 单纯在条上移动或在边缘拖拽都不切换。
const controlsHovered = ref(false);
// 功能按钮区与右上角关闭按钮是两个相邻的 DOM 区域，指针从其中一个移到另一个
// 时会先后触发 leave/enter。延迟清除让这段过渡不出现「X 消失只剩文字」的闪断。
let controlsHideTimer: number | undefined;
const showControls = () => {
  if (controlsHideTimer !== undefined) {
    window.clearTimeout(controlsHideTimer);
    controlsHideTimer = undefined;
  }
  controlsHovered.value = true;
};
const hideControlsSoon = () => {
  if (controlsHideTimer !== undefined) window.clearTimeout(controlsHideTimer);
  controlsHideTimer = window.setTimeout(() => {
    controlsHideTimer = undefined;
    controlsHovered.value = false;
  }, 160);
};
const backgroundMode = ref<TaskbarBackgroundMode>('live');
const backgroundColor = ref('#1b1b20');
const queueOpen = ref(false);
const panelTab = ref<'lyrics' | 'queue'>('lyrics');
const queuePaths = shallowRef<string[]>([]);
const queueScrollTop = ref(0);
const queueViewportRef = ref<HTMLElement | null>(null);
const lyricScrollRef = ref<HTMLElement | null>(null);
const lyricAutoFollow = ref(true);
const QUEUE_ROW_HEIGHT = 44;
const QUEUE_OVERSCAN = 6;
const LYRIC_ROW_HEIGHT = 52;
const { ensureWindow: ensureQueueWindow, getSongAt: getQueueSongAt } = useLibrarySongWindowCache();
const volumeTrackRef = ref<HTMLElement | null>(null);
const isAdjustingVolume = ref(false);
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
const sourceLyric = computed(() => currentSong.value && lyricsStatus.value === 'ready'
  ? resolveTaskbarLyricLine(parsedLyrics.value, lyricTime.value) : null);
const resolvedContentMode = computed(() => {
  if (contentMode.value !== 'adaptive') return contentMode.value;
  return sourceLyric.value?.translation?.trim() ? 'bilingual' : 'double-line';
});
const lyricRows = computed(() => {
  if (!currentSong.value || lyricsStatus.value !== 'ready' || lyricInterlude.value) return [];
  // Keep selection on source cues so finishing the highlight does not clear the line.
  const sourceLines = resolvedContentMode.value === 'double-line'
    ? resolveTaskbarDoubleLyricLines(parsedLyrics.value, lyricTime.value)
    : sourceLyric.value ? [sourceLyric.value] : [];
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
  if (lyricsStatus.value === 'ready' && parsedLyrics.value.length) return '';
  return '暂无歌词';
});
const hasTranslation = computed(() => resolvedContentMode.value === 'bilingual' && !!currentLyric.value?.translation?.trim());
const formatDuration = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const coverTitle = computed(() => `${songTitle.value}${currentSong.value?.artist ? ` · ${currentSong.value.artist}` : ''}\n显示/收起主窗口`);
interface DockDragBounds {
  minX: number;
  maxX: number;
  baseX: number;
  y: number;
  width: number;
  scaleFactor: number;
  windowScaleFactor: number;
}

/** 拖出屏幕边缘时至少保留的可见宽度（逻辑像素）。 */
const MIN_VISIBLE = 18;

let lyricFrame = 0;
let isFinishingDrag = false;
let activeDragBounds: DockDragBounds | null = null;
let activeDragPromise: Promise<{ x: number; y: number }> | null = null;
let activeNativeDragSessionId: number | null = null;
let nextNativeDragSessionId = Date.now() * 1000;
let cleanupDragListeners: (() => void) | null = null;
let dragSession = 0;

const getDockDragBounds = async (): Promise<DockDragBounds | null> => {
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
  return bounds ? { ...bounds, width, scaleFactor: factor, windowScaleFactor: windowFactor } : null;
};

const finishDrag = async (finalPhysicalPosition?: { x: number; y: number }) => {
  if (!isDragging.value) return;
  isFinishingDrag = true;
  isDragging.value = false;
  controlsHovered.value = false;
  dragSession++;
  cleanupDragListeners?.();
  cleanupDragListeners = null;
  let leftOffset: number | undefined;
  let position: { x: number; y: number } | undefined;
  const operation = activeDragPromise;
  const nativeSessionId = activeNativeDragSessionId;
  const bounds = activeDragBounds;
  try {
    if (operation) {
      await invoke('cancel_taskbar_player_drag', { sessionId: nativeSessionId }).catch(error => {
        console.warn('Failed to cancel taskbar drag:', error);
      });
      finalPhysicalPosition = await operation;
    }
    if (finalPhysicalPosition) {
      if (bounds) {
        // 锁定状态：只保存相对底栏最左端的横向偏移。
        leftOffset = clampTaskbarLeftOffset(
          Math.round(finalPhysicalPosition.x / bounds.scaleFactor) - bounds.minX,
          bounds,
          Math.max(0, bounds.width - MIN_VISIBLE),
        );
      } else {
        // 解锁状态：保存逻辑坐标，跨 DPI 时沿用同一套换算。
        const scaleFactor = await appWindow.scaleFactor();
        if (Number.isFinite(scaleFactor) && scaleFactor > 0) {
          // 播控条位于窗口顶部，窗口左上角即播控条锚点；面板在其下方展开。
          // 展开态下窗口顶边虽经过边界感知平移，但拖到哪就记哪，收起时回到该锚点。
          position = {
            x: Math.round(finalPhysicalPosition.x / scaleFactor),
            y: Math.round(finalPhysicalPosition.y / scaleFactor),
          };
        }
      }
    }
  } catch (error) {
    console.warn('Failed to save taskbar drag position:', error);
  } finally {
    activeDragBounds = null;
    activeDragPromise = null;
    activeNativeDragSessionId = null;
    // Carry the final coordinates with the end event so the main window saves
    // them before automatic positioning resumes with the previous values.
    try {
      await emitTo('main', TASKBAR_PLAYER_DRAG_EVENT, { dragging: false, leftOffset, position });
    } catch (error) {
      console.warn('Failed to finish taskbar drag:', error);
    } finally {
      isFinishingDrag = false;
    }
  }
};

const startDrag = async (event: PointerEvent) => {
  if (event.button !== 0 || !event.isPrimary || isDragging.value || isFinishingDrag) return;
  // 面板在播控条下方，指针相对条内的坐标就是窗口内的纵向偏移。
  const grabOffsetX = event.clientX;
  const grabOffsetY = event.clientY;
  const session = ++dragSession;
  isDragging.value = true;
  showVolume.value = false;
  controlsHovered.value = false;
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
  let operation: Promise<{ x: number; y: number }> | null = null;
  try {
    // Suspend automatic positioning before native dragging starts. The native
    // loop tracks mouse movement and release even when the WebView loses capture.
    await emitTo('main', TASKBAR_PLAYER_DRAG_EVENT, { dragging: true });
    const windowFactor = await appWindow.scaleFactor();
    if (!isDragging.value || session !== dragSession) return;
    if (!Number.isFinite(windowFactor) || windowFactor <= 0) { await finishDrag(); return; }

    if (!canDrag.value) {
      // 锁定：只在底栏横向区间内移动。
      const bounds = await getDockDragBounds();
      if (!isDragging.value || session !== dragSession) return;
      if (!bounds) { await finishDrag(); return; }
      activeDragBounds = bounds;
      const nativeSessionId = ++nextNativeDragSessionId;
      activeNativeDragSessionId = nativeSessionId;
      const margin = Math.max(0, bounds.width - MIN_VISIBLE) * bounds.scaleFactor;
      operation = invoke<{ x: number; y: number }>('drag_taskbar_player', {
        sessionId: nativeSessionId,
        minX: Math.ceil(bounds.minX * bounds.scaleFactor - margin),
        maxX: Math.floor(bounds.maxX * bounds.scaleFactor + margin),
        y: Math.round((bounds.y - panelOffset.value) * bounds.scaleFactor),
        grabOffsetX: Math.round(grabOffsetX * bounds.windowScaleFactor),
      });
    } else {
      // 解锁：整块虚拟桌面自由拖动。
      const nativeSessionId = ++nextNativeDragSessionId;
      activeNativeDragSessionId = nativeSessionId;
      operation = invoke<{ x: number; y: number }>('drag_taskbar_player_free', {
        sessionId: nativeSessionId,
        grabOffsetX: Math.round(grabOffsetX * windowFactor),
        grabOffsetY: Math.round(grabOffsetY * windowFactor),
      });
    }
    activeDragPromise = operation;
    const physicalPosition = await operation;
    if (activeDragPromise === operation) activeDragPromise = null;
    if (isDragging.value && session === dragSession) await finishDrag(physicalPosition);
  } catch (error) {
    console.warn('Failed to start taskbar drag:', error);
    if (activeDragPromise === operation) activeDragPromise = null;
    if (isDragging.value && session === dragSession) await finishDrag();
  }
};

const volumeFromPointer = (event: PointerEvent): number | null => {
  const track = volumeTrackRef.value;
  if (!track) return null;
  const rect = track.getBoundingClientRect();
  if (rect.width <= 0) return null;
  const ratio = (event.clientX - rect.left) / rect.width;
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
};

const applyVolume = (next: number) => {
  volume.value = next;
  void emitTo<TaskbarPlayerAction>('main', TASKBAR_PLAYER_ACTION_EVENT, { type: 'set-volume', volume: next });
};

const startVolumeDrag = (event: PointerEvent) => {
  const next = volumeFromPointer(event);
  if (next === null) return;
  isAdjustingVolume.value = true;
  applyVolume(next);
  const handleMove = (moveEvent: PointerEvent) => {
    const value = volumeFromPointer(moveEvent);
    if (value !== null && value !== volume.value) applyVolume(value);
  };
  const handleUp = () => {
    isAdjustingVolume.value = false;
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', handleUp);
    window.removeEventListener('pointercancel', handleUp);
  };
  window.addEventListener('pointermove', handleMove);
  window.addEventListener('pointerup', handleUp);
  window.addEventListener('pointercancel', handleUp);
};

const onBarExpandDrag = (event: PointerEvent) => {
  // 收起态与展开态一致：除功能按钮外整块小条都能按住拖动；不再需要两侧小白条。
  const target = event.target as HTMLElement | null;
  if (target?.closest('button, input, [data-taskbar-no-drag], .taskbar-resize-edge')) return;
  // 滚动条贴着歌词/队列容器右边缘（约 8px），拖动它应滚动内容而非移动窗口。
  const scrollHost = target?.closest('.taskbar-panel-lyrics, .taskbar-panel-queue');
  if (scrollHost) {
    const rect = scrollHost.getBoundingClientRect();
    if (event.clientX >= rect.right - 10) return;
  }
  void startDrag(event);
};

// 小条左右边缘直接拉伸长度。宽度由主窗口统一落位（tao 的 min/max 锁定），
// 这里只按指针位移计算目标宽度并发给主窗口。
const startResize = (event: PointerEvent, edge: 'left' | 'right') => {
  if (event.button !== 0 || !event.isPrimary) return;
  event.stopPropagation();
  event.preventDefault();
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startWidth = viewportSize.value.width;
  const target = event.currentTarget as HTMLElement;
  try { target.setPointerCapture(pointerId); } catch { /* DOM 捕获失败不影响监听 */ }
  let latestWidth = startWidth;
  const onMove = (move: PointerEvent) => {
    if (move.pointerId !== pointerId) return;
    const delta = move.clientX - startX;
    const next = Math.round(edge === 'right' ? startWidth + delta : startWidth - delta);
    if (next === latestWidth) return;
    latestWidth = next;
    void emitTo<TaskbarPlayerAction>('main', TASKBAR_PLAYER_ACTION_EVENT, {
      type: 'set-width', width: next, anchor: edge,
    });
  };
  const onUp = (up: PointerEvent) => {
    if (up.pointerId !== pointerId) return;
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
  };
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onUp, true);
};

const onBarPointerLeave = () => {
  // 拖音量时允许指针离开播控条，避免面板在手势中途消失。
  if (!isAdjustingVolume.value) showVolume.value = false;
};

const onVolumeWheel = (event: WheelEvent) => {
  const next = getNextWheelVolume(volume.value, event.deltaY);
  if (next !== volume.value) applyVolume(next);
};

const panelOffset = computed(() => (queueOpen.value ? TASKBAR_PLAYER_PANEL_HEIGHT : 0));

const closeQueuePanel = () => {
  if (!queueOpen.value) return;
  queueOpen.value = false;
  void emitTo<TaskbarPlayerAction>('main', TASKBAR_PLAYER_ACTION_EVENT, {
    type: 'set-queue-panel', open: false,
  } as TaskbarPlayerAction);
};

const openQueuePanel = (tab: 'lyrics' | 'queue') => {
  panelTab.value = tab;
  if (queueOpen.value) return;
  queueOpen.value = true;
  void emitTo<TaskbarPlayerAction>('main', TASKBAR_PLAYER_ACTION_EVENT, {
    type: 'set-queue-panel', open: true,
  } as TaskbarPlayerAction);
};

// 与 aria-expanded 一致的单按钮语义：点开、再点收起。
const toggleQueuePanel = () => {
  if (!queueOpen.value) { openQueuePanel('queue'); return; }
  closeQueuePanel();
};

const displayQueue = computed(() => {
  const viewportHeight = queueViewportRef.value?.clientHeight
    || (TASKBAR_PLAYER_PANEL_HEIGHT - 40);
  const start = Math.floor(queueScrollTop.value / QUEUE_ROW_HEIGHT);
  const visibleCount = Math.ceil(viewportHeight / QUEUE_ROW_HEIGHT);
  const renderStart = Math.max(0, start - QUEUE_OVERSCAN);
  const renderEnd = Math.min(queuePaths.value.length, start + visibleCount + QUEUE_OVERSCAN);
  return {
    paddingTop: renderStart * QUEUE_ROW_HEIGHT,
    paddingBottom: (queuePaths.value.length - renderEnd) * QUEUE_ROW_HEIGHT,
    items: queuePaths.value.slice(renderStart, renderEnd).map((path, relativeIndex) => {
      const index = renderStart + relativeIndex;
      const song = getQueueSongAt(index);
      return {
        index,
        path,
        name: song?.name ?? path.split(/[\\/]/).pop() ?? path,
        title: song?.title ?? '',
        artist: song?.artist ?? '',
        duration: song?.duration ?? 0,
      };
    }),
  };
});

const refreshQueueWindow = () => {
  const viewportHeight = queueViewportRef.value?.clientHeight
    || (TASKBAR_PLAYER_PANEL_HEIGHT - 40);
  const start = Math.floor(queueScrollTop.value / QUEUE_ROW_HEIGHT);
  const visibleCount = Math.ceil(viewportHeight / QUEUE_ROW_HEIGHT);
  void ensureQueueWindow({
    paths: queuePaths.value,
    start: Math.max(0, start - QUEUE_OVERSCAN),
    end: Math.min(queuePaths.value.length, start + visibleCount + QUEUE_OVERSCAN),
    viewportHeight,
    rowHeight: QUEUE_ROW_HEIGHT,
  });
};

const handleQueueScroll = (event: Event) => {
  queueScrollTop.value = (event.target as HTMLElement).scrollTop;
  refreshQueueWindow();
};

const playQueueItem = (path: string) => {
  void emitTo<TaskbarPlayerAction>('main', TASKBAR_PLAYER_ACTION_EVENT, {
    type: 'play-queue-path', path,
  } as TaskbarPlayerAction);
};

// 「双击当前歌曲暂停 / 继续」：队列行单击即播，双击必须拦下前两次 click，
// 否则当前行会被重播两次再收到 toggle。仅对当前行做 260ms 去抖，
// 其他行保持即时播放（双击其他歌曲始终从头播放，与设置语义一致）。
const QUEUE_DOUBLE_CLICK_MS = 260;
let queueClickTimer: ReturnType<typeof setTimeout> | null = null;
const clearQueueClickTimer = () => {
  if (queueClickTimer !== null) {
    clearTimeout(queueClickTimer);
    queueClickTimer = null;
  }
};
const onQueueRowClick = (path: string) => {
  if (doubleClickToPause.value && currentSong.value?.path === path) {
    if (queueClickTimer !== null) {
      // 第二次点击落在去抖窗口内：按双击处理，暂停 / 继续。
      clearQueueClickTimer();
      sendAction('toggle-play');
      return;
    }
    queueClickTimer = setTimeout(() => {
      queueClickTimer = null;
      playQueueItem(path);
    }, QUEUE_DOUBLE_CLICK_MS);
    return;
  }
  clearQueueClickTimer();
  playQueueItem(path);
};

const activeLyricIndex = computed(() => {
  const lines = parsedLyrics.value;
  if (!lines.length) return -1;
  const time = lyricTime.value;
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].time <= time) { found = mid; low = mid + 1; } else { high = mid - 1; }
  }
  return found;
});

// 面板歌词只渲染真正有内容的行：LRC 里常夹着空文本/纯空行，直接渲染会撑出
// 一整行 52px 的空白，看起来就是「某几句之间行距特别大」。
interface PanelLyricRow { line: LyricLine; index: number }
const panelLyrics = computed<PanelLyricRow[]>(() => {
  const rows: PanelLyricRow[] = [];
  parsedLyrics.value.forEach((line, index) => {
    const hasText = Boolean(line.text && line.text.trim());
    const hasTranslation = Boolean(line.translation && line.translation.trim());
    if (!hasText && !hasTranslation) return;
    rows.push({ line, index });
  });
  return rows;
});

// 当前句在面板列表中的行号（当前句正好是空行时，取它前面最近的可显示行）。
const activePanelRow = computed(() => {
  const rows = panelLyrics.value;
  if (!rows.length) return -1;
  const index = activeLyricIndex.value;
  let row = -1;
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].index <= index) row = i;
    else break;
  }
  return row;
});

let lyricScrollTimer: number | null = null;
let suppressLyricScroll = false;

const scrollLyricToActive = (behavior: ScrollBehavior = 'smooth') => {
  const el = lyricScrollRef.value;
  const row = activePanelRow.value;
  if (!el || row < 0) return;
  const paddingTop = Number.parseFloat(getComputedStyle(el).paddingTop) || 0;
  const top = Math.max(0, Math.min(
    paddingTop + row * LYRIC_ROW_HEIGHT - (el.clientHeight - LYRIC_ROW_HEIGHT) / 2,
    el.scrollHeight - el.clientHeight,
  ));
  if (Math.abs(el.scrollTop - top) < 1) return;
  suppressLyricScroll = true;
  el.scrollTo({ top, behavior });
  window.setTimeout(() => { suppressLyricScroll = false; }, 420);
};

const onLyricScroll = () => {
  if (suppressLyricScroll) return;
  // 用户手动滚动时暂停跟随，停手 4 秒后回到当前句。
  lyricAutoFollow.value = false;
  if (lyricScrollTimer !== null) window.clearTimeout(lyricScrollTimer);
  lyricScrollTimer = window.setTimeout(() => {
    lyricScrollTimer = null;
    lyricAutoFollow.value = true;
    scrollLyricToActive();
  }, 4000);
};

watch(activeLyricIndex, () => {
  if (lyricAutoFollow.value) scrollLyricToActive();
});

watch(() => currentSong.value?.path, () => {
  lyricAutoFollow.value = true;
});

const seekPlayLyric = (time: number) => {
  void emitTo<TaskbarPlayerAction>('main', TASKBAR_PLAYER_ACTION_EVENT, {
    type: 'seek-play-lyric', time,
  } as TaskbarPlayerAction);
};

const seekToLyric = (time: number) => {
  void emitTo<TaskbarPlayerAction>('main', TASKBAR_PLAYER_ACTION_EVENT, {
    type: 'seek-lyric', time,
  } as TaskbarPlayerAction);
};

watch(canDrag, (unlocked) => {
  if (unlocked) return;
  // 锁定到底栏时只保留基础播放控制。
  showVolume.value = false;
  closeQueuePanel();
});

watch([queueOpen, panelTab], () => {
  if (!queueOpen.value) return;
  if (panelTab.value === 'lyrics') {
    lyricAutoFollow.value = true;
    void nextTick(() => scrollLyricToActive('auto'));
    return;
  }
  void nextTick(() => refreshQueueWindow());
});
watch(queuePaths, () => {
  queueScrollTop.value = 0;
  if (queueOpen.value && panelTab.value === 'queue') void nextTick(() => refreshQueueWindow());
});

let unlistenState: (() => void) | null = null;
let unlistenPlayback: (() => void) | null = null;
let unlistenVisibility: (() => void) | null = null;
let unlistenMoved: (() => void) | null = null;
let unlistenPanel: (() => void) | null = null;
let unlistenQueue: (() => void) | null = null;

type TaskbarSimpleActionType = Exclude<TaskbarPlayerAction['type'], 'set-left-offset' | 'set-volume'>;
const sendAction = (actionType: TaskbarSimpleActionType) => {
  void emitTo<TaskbarPlayerAction>('main', TASKBAR_PLAYER_ACTION_EVENT, { type: actionType } as TaskbarPlayerAction);
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
};

const refreshLyricClock = () => {
  stopLyricClock();
  if (!isVisible.value || !isPlaying.value || document.hidden || !parsedLyrics.value.length) return;

  const tick = () => {
    if (playbackAnchor.value) {
      playbackTime.value = projectTaskbarPlaybackTime(playbackAnchor.value);
    }
    lyricFrame = window.requestAnimationFrame(tick);
  };
  lyricFrame = window.requestAnimationFrame(tick);
};

const applyPlayback = (payload: TaskbarPlayerPlaybackPayload) => {
  if (typeof payload.volume === 'number' && Number.isFinite(payload.volume)) {
    volume.value = Math.round(Math.min(100, Math.max(0, payload.volume)));
  }
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
  window.addEventListener('resize', syncViewportSize);
  void syncViewportSize();
  unlistenResized = await appWindow.onResized(() => { void syncViewportSize(); });
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
    doubleClickToPause.value = event.payload.doubleClickToPause === true;
    backgroundMode.value = normalizeTaskbarBackgroundMode(event.payload.backgroundMode);
    backgroundColor.value = normalizeTaskbarBackgroundColor(event.payload.backgroundColor);
    frameShape.value = normalizeTaskbarFrameShape(event.payload.frameShape);
    backgroundOpacity.value = typeof opacity === 'number' && Number.isFinite(opacity)
      ? Math.min(100, Math.max(0, opacity)) : TASKBAR_PLAYER_DEFAULT_BACKGROUND_OPACITY;
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
    } else {
      showVolume.value = false;
      queueOpen.value = false;
      if (isDragging.value) void finishDrag();
    }
  });

  // 3. 原生拖动结束时保存位置；这里只保留窗口生命周期清理句柄。
  unlistenMoved = await appWindow.onMoved(() => {});

  // 3.1 面板开合确认（主窗口会同步窗口高度）与队列数据
  unlistenPanel = await listen<TaskbarPlayerPanelPayload>(TASKBAR_PLAYER_PANEL_EVENT, (event) => {
    if (!event.payload.open) queueOpen.value = false;
  });
  unlistenQueue = await listen<TaskbarPlayerQueuePayload>(TASKBAR_PLAYER_QUEUE_EVENT, (event) => {
    queuePaths.value = event.payload.paths;
  });

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
  unlistenPanel?.();
  unlistenQueue?.();
  unlistenResized?.();
  clearQueueClickTimer();
  window.removeEventListener('resize', syncViewportSize);
  stopLyricClock();
  document.removeEventListener('visibilitychange', onDocumentVisibilityChange);
  if (controlsHideTimer !== undefined) window.clearTimeout(controlsHideTimer);
});
</script>

<template>
  <div
    ref="shellRef"
    class="taskbar-shell"
    :class="{
      'is-expanded': queueOpen,
      'is-color': backgroundMode === 'color',
      'is-live': backgroundMode === 'live',
    }"
    :style="[shellStyle, { width: `${viewportSize.width}px`, height: `${viewportSize.height}px` }]"
  >
    <div
      class="taskbar-player group"
      :class="{
        'is-locked': !canDrag,
        'is-unlocked': canDrag,
        'is-dragging': isDragging,
        'controls-hovered': controlsHovered,
        'has-translation': hasTranslation,
        'has-volume': showVolume,
        'is-live-bg': backgroundMode === 'live',
      }"
      :style="backgroundStyle"
      @pointerleave="onBarPointerLeave"
      @pointerdown="onBarExpandDrag"
    >
    <span class="taskbar-resize-edge taskbar-resize-edge--left" title="拖动调整小条长度"
      @pointerdown="startResize($event, 'left')"></span>
    <span class="taskbar-resize-edge taskbar-resize-edge--right" title="拖动调整小条长度"
      @pointerdown="startResize($event, 'right')"></span>

    <div class="taskbar-content">
      <button
        type="button"
        class="taskbar-cover group/cover"
        :class="{ 'is-circle': coverShape === 'circle', 'is-square': coverShape === 'square' }"
        :style="coverStyle"
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

      <div v-show="!showVolume && !queueOpen" class="taskbar-song-info">
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
          v-else-if="resolvedContentMode === 'double-line' && currentLyric"
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
            :style="{ '--lyric-row-index': index }"
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

      <div v-if="queueOpen && !showVolume" class="taskbar-expanded-title" :title="songTitle">
        {{ songTitle }}
      </div>

      <div
        v-if="showVolume"
        class="taskbar-volume"
        data-taskbar-no-drag
        @wheel.prevent.stop="onVolumeWheel"
      >
        <button
          type="button"
          class="taskbar-volume-mute"
          :title="volume === 0 ? '取消静音' : '静音'"
          :aria-label="volume === 0 ? '取消静音' : '静音'"
          @mousedown.prevent
          @click.stop="sendAction('toggle-mute')"
        >
          <VolumeX v-if="volume === 0" :size="12" :stroke-width="2.2" />
          <Volume2 v-else :size="12" :stroke-width="2.2" />
        </button>
        <div
          ref="volumeTrackRef"
          class="taskbar-volume-track"
          role="slider"
          aria-label="音量"
          :aria-valuenow="volume"
          aria-valuemin="0"
          aria-valuemax="100"
          @pointerdown.stop.prevent="startVolumeDrag"
        >
          <span class="taskbar-volume-fill" :style="{ width: `${volume}%` }" />
          <span class="taskbar-volume-thumb" :style="{ left: `${volume}%` }" />
        </div>
        <span class="taskbar-volume-value">{{ volume }}%</span>
      </div>
    </div>

    <div class="taskbar-controls-zone"
      :class="{ 'is-volume-shown': showVolume }">
    <div class="taskbar-controls"
      @pointerenter="showControls" @pointerleave="hideControlsSoon"
      @focusin="showControls" @focusout="hideControlsSoon">
      <button
        v-show="!showVolume"
        type="button"
        class="taskbar-control taskbar-lock"
        :title="canDrag ? '锁定到底栏' : '解锁后可随意拖动'"
        :aria-label="canDrag ? '锁定到底栏' : '解锁后可随意拖动'"
        :aria-pressed="canDrag"
        @mousedown.prevent
        @click.stop="sendAction('toggle-position-lock')"
      >
        <Unlock v-if="canDrag" :size="14" :stroke-width="2.2" />
        <Lock v-else :size="14" :stroke-width="2.2" />
      </button>
      <button
        v-show="!showVolume"
        type="button"
        class="taskbar-control"
        title="上一首"
        aria-label="上一首"
        @mousedown.prevent
        @click.stop="sendAction('prev-song')"
        @pointerenter="emitSongSwitchSignal('taskbar', 'hover', 'previous')"
        @pointerleave="emitSongSwitchSignal('taskbar', 'leave', 'previous')"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" />
        </svg>
      </button>
      <button
        v-show="!showVolume"
        type="button"
        class="taskbar-play"
        :title="isPlaying ? '暂停' : '播放'"
        :aria-label="isPlaying ? '暂停' : '播放'"
        @mousedown.prevent
        @click.stop="sendAction('toggle-play')"
      >
        <svg v-if="isPlaying" width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
        </svg>
        <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="currentColor" class="ml-0.5" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
      </button>
      <button
        v-show="!showVolume"
        type="button"
        class="taskbar-control"
        title="下一首"
        aria-label="下一首"
        @mousedown.prevent
        @click.stop="sendAction('next-song')"
        @pointerenter="emitSongSwitchSignal('taskbar', 'hover', 'next')"
        @pointerleave="emitSongSwitchSignal('taskbar', 'leave', 'next')"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
        </svg>
      </button>
      <button
        type="button"
        v-show="canDrag"
        class="taskbar-control taskbar-volume-button"
        :class="{ 'is-active': showVolume }"
        title="音量"
        aria-label="音量"
        @mousedown.prevent
        @click.stop="showVolume = !showVolume"
      >
        <VolumeX v-if="volume === 0" :size="14" :stroke-width="2.2" />
        <Volume2 v-else :size="14" :stroke-width="2.2" />
      </button>
      <button
        v-show="canDrag"
        type="button"
        class="taskbar-control taskbar-queue"
        :title="queueOpen ? '收起面板' : '展开面板/播放队列'"
        :aria-label="queueOpen ? '收起面板' : '展开面板/播放队列'"
        :aria-expanded="queueOpen"
        @mousedown.prevent
        @click.stop="toggleQueuePanel"
      >
        <ListMusic :size="14" :stroke-width="2.2" />
      </button>
    </div>
    </div>
    <div class="taskbar-close">
      <button
        type="button"
        title="关闭铃动窗"
        aria-label="关闭铃动窗"
        @pointerenter="showControls"
        @pointerleave="hideControlsSoon"
        @focusin="showControls"
        @focusout="hideControlsSoon"
        @mousedown.prevent
        @click.stop="sendAction('close')"
      ><X :size="10" :stroke-width="3.5" /></button>
    </div>
    </div>
    <transition name="taskbar-panel">
      <section
        v-if="queueOpen"
        class="taskbar-panel"
        :style="{ height: `${TASKBAR_PLAYER_PANEL_HEIGHT}px` }"
        @pointerdown="onBarExpandDrag"
      >
        <header class="taskbar-panel-head">
          <div class="taskbar-panel-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              class="taskbar-panel-tab"
              :class="{ 'is-active': panelTab === 'lyrics' }"
              :aria-selected="panelTab === 'lyrics'"
              @click.stop="panelTab = 'lyrics'"
            >歌词</button>
            <button
              type="button"
              role="tab"
              class="taskbar-panel-tab"
              :class="{ 'is-active': panelTab === 'queue' }"
              :aria-selected="panelTab === 'queue'"
              @click.stop="panelTab = 'queue'"
            >队列<span class="taskbar-panel-count">{{ queuePaths.length }}</span></button>
          </div>
          <div class="taskbar-panel-actions">
            <button type="button" class="taskbar-panel-action" title="收起面板" @click.stop="closeQueuePanel">
              <ChevronUp :size="15" :stroke-width="2.4" />
            </button>
          </div>
        </header>

        <div class="taskbar-panel-body">
          <div
            v-if="panelTab === 'lyrics'"
            ref="lyricScrollRef"
            class="taskbar-panel-lyrics"
            @scroll="onLyricScroll"
          >
            <div class="taskbar-panel-lyrics-track">
              <div
                v-for="(row, rowIndex) in panelLyrics"
                :key="`${row.index}:${row.line.time}`"
                class="taskbar-panel-lyric"
                data-taskbar-no-drag
                :class="{
                  'is-active': row.index === activeLyricIndex,
                  'is-near': Math.abs(rowIndex - activePanelRow) === 1,
                }"
                @click.stop="seekToLyric(row.line.time)"
                @dblclick.stop="seekPlayLyric(row.line.time)"
              >
                <TaskbarLyricLine
                  v-if="row.index === activeLyricIndex"
                  :text="row.line.text"
                  :words="row.line.words"
                  :time="row.line.time"
                  :end-time="row.line.endTime"
                  :playback-time="lyricTime"
                  :effect="lyricEffect"
                  :highlight-color="lyricHighlightColor"
                />
                <span v-else class="taskbar-panel-lyric-text">{{ row.line.text }}</span>
                <span v-if="row.line.translation" class="taskbar-panel-lyric-translation">{{ row.line.translation }}</span>
              </div>
            </div>
            <div v-if="!parsedLyrics.length" class="taskbar-panel-empty">
              {{ !currentSong ? '享受音乐时光' : lyricsStatus === 'loading' ? '歌词加载中…' : '暂无歌词' }}
            </div>
          </div>

          <div v-else ref="queueViewportRef" class="taskbar-panel-queue" @scroll="handleQueueScroll">
            <div v-if="!queuePaths.length" class="taskbar-panel-empty">队列为空</div>
            <div :style="{ height: `${displayQueue.paddingTop}px` }"></div>
            <button
              v-for="item in displayQueue.items"
              :key="`${item.path}:${item.index}`"
              type="button"
              class="taskbar-queue-row"
              :class="{ 'is-current': currentSong?.path === item.path }"
              @click.stop="onQueueRowClick(item.path)"
            >
              <span class="taskbar-queue-index">
                <svg v-if="currentSong?.path === item.path" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
                <template v-else>{{ item.index + 1 }}</template>
              </span>
              <span class="taskbar-queue-text">
                <span class="taskbar-queue-title">{{ item.title || item.name }}</span>
                <span class="taskbar-queue-artist">{{ item.artist || '未知艺术家' }}</span>
              </span>
              <span class="taskbar-queue-duration">{{ formatDuration(item.duration) }}</span>
            </button>
            <div :style="{ height: `${displayQueue.paddingBottom}px` }"></div>
          </div>
        </div>
      </section>
    </transition>

  </div>
</template>

<style scoped>
.taskbar-shell {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  /* 物理像素级连续曲率蒙版（苹果 R 角）；border-radius 作为蒙版不可用时的降级形状。 */
  border-radius: var(--card-radius, 16px);
  -webkit-mask-image: var(--shell-mask, none);
  mask-image: var(--shell-mask, none);
  -webkit-mask-size: 100% 100%;
  mask-size: 100% 100%;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  overflow: hidden;
  isolation: isolate;
}
/* 整卡只有这一处绘制背景与圆角，子元素不会再盖掉边角。 */
.taskbar-shell.is-live::before {
  content: '';
  position: absolute;
  inset: -60px;
  z-index: 0;
  background-image: var(--panel-cover-image, none);
  background-size: cover;
  background-position: center;
  filter: blur(52px) saturate(1.3) brightness(0.9);
  opacity: 0.9;
  pointer-events: none;
}
.taskbar-shell.is-live::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  background: linear-gradient(
    180deg,
    rgb(24 20 18 / var(--bar-scrim-a, 0.2)),
    rgb(12 9 9 / var(--bar-scrim-b, 0.4))
  );
  pointer-events: none;
}
.taskbar-shell.is-color { background: rgb(var(--card-rgb, 27 27 32) / var(--card-alpha, 0.85)); }
.taskbar-shell > * { position: relative; z-index: 1; }
.taskbar-panel {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: transparent;
  color: rgb(var(--taskbar-text-rgb, 255 255 255) / 88%);
}
.taskbar-shell.is-expanded .taskbar-player {
  border-bottom: 1px solid rgb(255 255 255 / 7%);
}
.taskbar-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 40px;
  padding: 0 8px 0 12px;
  flex-shrink: 0;
  border-bottom: 1px solid rgb(255 255 255 / 6%);
}
.taskbar-panel-tabs { display: flex; align-items: center; gap: 4px; }
.taskbar-panel-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: rgb(255 255 255 / 55%);
  transition: color 160ms ease, background-color 160ms ease;
}
.taskbar-panel-tab:hover { color: rgb(255 255 255 / 85%); }
.taskbar-panel-tab.is-active { color: #fff; background: rgb(255 255 255 / 12%); }
.taskbar-panel-count { font-size: 10px; opacity: .6; font-variant-numeric: tabular-nums; }
.taskbar-panel-actions { display: flex; align-items: center; gap: 2px; }
.taskbar-panel-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  color: rgb(255 255 255 / 55%);
  transition: color 160ms ease, background-color 160ms ease;
}
.taskbar-panel-action:hover { color: #fff; background: rgb(255 255 255 / 10%); }
.taskbar-panel-action.is-active { color: #ec4141; }
.taskbar-panel-body { position: relative; flex: 1; min-height: 0; }
.taskbar-panel-lyrics {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  /* 上下留白让首行与末行也能滚到中线 */
  padding-block: 10px;
}
.taskbar-panel-lyrics::-webkit-scrollbar { width: 8px; }
.taskbar-panel-lyrics::-webkit-scrollbar-track { background: transparent; }
.taskbar-panel-lyrics::-webkit-scrollbar-button { display: none; height: 0; width: 0; }
.taskbar-panel-lyrics::-webkit-scrollbar-thumb {
  background: rgb(255 255 255 / 14%);
  border: 2px solid transparent;
  background-clip: padding-box;
  border-radius: 8px;
}
.taskbar-panel-lyrics:hover::-webkit-scrollbar-thumb { background: rgb(255 255 255 / 26%); background-clip: padding-box; }
.taskbar-panel-lyrics-track { display: block; }
.taskbar-panel-lyric {
  height: 52px;
  padding: 0 16px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  opacity: 0.26;
  cursor: pointer;
  transition: opacity 220ms ease;
}
.taskbar-panel-lyric.is-near { opacity: 0.5; }
.taskbar-panel-lyric.is-active { opacity: 1; }
.taskbar-panel-lyric:hover { opacity: 0.85; }
.taskbar-panel-lyric :deep(.taskbar-lyric-viewport) { font-size: 14px; line-height: 19px; }
.taskbar-panel-lyric :deep(.taskbar-lyric-viewport.is-translation) { font-size: 11px; line-height: 15px; }
.taskbar-panel-lyric-text {
  font-size: 13px;
  line-height: 19px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.taskbar-panel-lyric-translation {
  font-size: 11px;
  line-height: 15px;
  color: rgb(255 255 255 / 55%);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.taskbar-expanded-title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--taskbar-text-rgb, 255 255 255) / 88%);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: opacity 150ms ease;
}
.taskbar-panel-queue {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 4px 6px;
}
.taskbar-panel-queue::-webkit-scrollbar { width: 8px; }
.taskbar-panel-queue::-webkit-scrollbar-track { background: transparent; }
.taskbar-panel-queue::-webkit-scrollbar-button { display: none; height: 0; width: 0; }
.taskbar-panel-queue::-webkit-scrollbar-thumb {
  background: rgb(255 255 255 / 14%);
  border: 2px solid transparent;
  background-clip: padding-box;
  border-radius: 8px;
}
.taskbar-panel-queue:hover::-webkit-scrollbar-thumb { background: rgb(255 255 255 / 26%); background-clip: padding-box; }
.taskbar-queue-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 44px;
  padding: 0 8px;
  border-radius: 8px;
  text-align: left;
  color: rgb(255 255 255 / 78%);
  transition: background-color 140ms ease, color 140ms ease;
}
.taskbar-queue-row:hover { background: rgb(255 255 255 / 7%); }
.taskbar-queue-row.is-current { color: #ff7b7b; background: rgb(236 65 65 / 12%); }
.taskbar-queue-index {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  flex-shrink: 0;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  opacity: 0.6;
}
.taskbar-queue-text { display: flex; flex-direction: column; min-width: 0; flex: 1; gap: 1px; }
.taskbar-queue-title {
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.taskbar-queue-artist {
  font-size: 10px;
  color: rgb(255 255 255 / 45%);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.taskbar-queue-row.is-current .taskbar-queue-artist { color: rgb(255 123 123 / 70%); }
.taskbar-queue-duration {
  flex-shrink: 0;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: rgb(255 255 255 / 40%);
}
.taskbar-panel-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: rgb(255 255 255 / 40%);
}
.taskbar-panel-enter-active,
.taskbar-panel-leave-active { transition: opacity 200ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1); }
.taskbar-panel-enter-from,
.taskbar-panel-leave-to { opacity: 0; transform: translateY(-10px); }
.taskbar-player {
  width: 100%;
  height: 44px;
  position: relative;
  display: flex;
  align-items: center;
  padding: 0 14px 0 6px;
  overflow: hidden;
  user-select: none;
  pointer-events: auto;
  transition: background-color 200ms ease;
}
/* 整块小条都可拖动（排除按钮），两侧只保留不可见的宽度拉伸热区。 */
.taskbar-player { cursor: grab; }
.taskbar-player.is-dragging { cursor: grabbing; }
.taskbar-resize-edge {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 5px;
  z-index: 26;
  cursor: ew-resize;
}
.taskbar-resize-edge--left { left: 0; }
.taskbar-resize-edge--right { right: 0; }
.taskbar-content {
  position: relative;
  z-index: 1;
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
  border-radius: 10px;
  overflow: hidden;
  flex-shrink: 0;
  position: relative;
  background: rgb(255 255 255 / 5%);
  border: 1px solid rgb(255 255 255 / 5%);
  color: rgb(255 255 255 / 40%);
  cursor: pointer;
}
.taskbar-cover.is-circle { border-radius: 50%; }
.taskbar-cover.is-square { border-radius: 0; }
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
  --lyric-row-height: 16px;
  --lyric-transition: 280ms cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  height: calc(var(--lyric-row-height) * 2);
  overflow: hidden;
  --lyric-enter-offset: var(--lyric-row-height);
  --lyric-leave-offset: calc(var(--lyric-row-height) * -1);
}
.taskbar-double-lyrics.is-reversing {
  --lyric-enter-offset: calc(var(--lyric-row-height) * -1);
  --lyric-leave-offset: var(--lyric-row-height);
}
.taskbar-double-row {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: var(--lyric-row-height);
  min-width: 0;
  transform: translateY(calc(var(--lyric-row-index) * var(--lyric-row-height)));
  transition: transform var(--lyric-transition), opacity var(--lyric-transition);
  will-change: transform;
}
.taskbar-double-row.is-upcoming { opacity: 0.62; }
.taskbar-double-row :deep(.taskbar-lyric-viewport) {
  font-size: 12px;
  line-height: var(--lyric-row-height);
}
/* Row offsets own the movement; per-frame lyric updates must not restart FLIP. */
.taskbar-lyric-stack-move { transition: none; }
.taskbar-double-row.taskbar-lyric-stack-enter-from {
  opacity: 0;
  transform: translateY(calc(var(--lyric-row-index) * var(--lyric-row-height) + var(--lyric-enter-offset)));
}
.taskbar-double-row.taskbar-lyric-stack-leave-to {
  opacity: 0;
  transform: translateY(calc(var(--lyric-row-index) * var(--lyric-row-height) + var(--lyric-leave-offset)));
}
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
/* 功能按钮热区严格贴合按钮本身：拖拽区（小条其余部分）不再触发显现。 */
.taskbar-controls-zone {
  position: absolute;
  inset-block: 0;
  right: 0;
  /* 只在按钮行内生效，空白拖拽区不吃指针事件 */
  pointer-events: none;
}
.taskbar-controls-zone.is-volume-shown,
.taskbar-controls-zone.is-volume-shown .taskbar-controls { pointer-events: none; opacity: 0; }
.taskbar-controls {
  position: absolute;
  inset-block: 0;
  right: 18px;
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 20;
  opacity: 0;
  /* 隐藏时仍接收指针，否则无法感知「进入按钮区」；缺口的透明区域由父级冒出的
     拖拽逻辑排除（onBarExpandDrag 只放行非按钮热区），不会误触按钮。 */
  pointer-events: auto;
  transition: opacity 150ms ease;
}
/* 展开面板与收起态一致：功能按钮显现时，小条上不显示歌曲文字信息。 */
.taskbar-player.controls-hovered .taskbar-song-info,
.taskbar-player.controls-hovered .taskbar-expanded-title { opacity: 0; }
.taskbar-player.controls-hovered .taskbar-controls { opacity: 1; pointer-events: auto; }
.taskbar-control {
  width: 16px;
  height: 25px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgb(255 255 255 / 60%);
  transition: color 200ms ease, transform 150ms ease;
}
.taskbar-control:hover { color: white; }
.taskbar-lock { width: 15px; }
.taskbar-lock[aria-pressed='true'] { color: rgb(255 255 255 / 88%); }
.taskbar-volume-button, .taskbar-queue { width: 15px; }
.taskbar-volume-button.is-active { color: white; }
.taskbar-volume {
  /* 直接绝对定位到右端：v-if 挂载瞬间即为最终位置，避免先按 flex 中间布局再跳右的闪现 */
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  width: 112px;
}
.taskbar-volume-mute {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 24px;
  flex-shrink: 0;
  color: rgb(255 255 255 / 70%);
  transition: color 160ms ease;
}
.taskbar-volume-mute:hover { color: white; }
.taskbar-volume-track {
  position: relative;
  flex: 1;
  min-width: 44px;
  height: 3px;
  border-radius: 999px;
  background: rgb(255 255 255 / 20%);
  cursor: pointer;
  touch-action: none;
}
/* 视觉上仍是 3px 细轨，但指针命中范围上下各扩 7px，便于点按与拖动。 */
.taskbar-volume-track::before {
  content: '';
  position: absolute;
  inset: -7px 0;
}
.taskbar-volume-fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: rgb(255 255 255 / 85%);
}
.taskbar-volume-thumb {
  position: absolute;
  top: 50%;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: white;
  transform: translate(-50%, -50%);
  box-shadow: 0 1px 3px rgb(0 0 0 / 35%);
}
.taskbar-volume-value {
  flex-shrink: 0;
  min-width: 30px;
  text-align: right;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--taskbar-text-rgb, 255 255 255) / 78%);
}
.taskbar-control:active { transform: scale(0.9); }
.taskbar-play {
  width: 25px;
  height: 25px;
  border-radius: 50%;
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
.taskbar-player.controls-hovered .taskbar-close { opacity: 1; }
.taskbar-close button { color: rgb(255 255 255 / 30%); pointer-events: auto; transition: color 200ms ease, transform 150ms ease; }
.taskbar-close button:hover { color: rgb(255 255 255 / 90%); }
.taskbar-close button:active { transform: scale(0.95); }
.taskbar-player button { cursor: pointer; }
.taskbar-player button:focus-visible { outline: 2px solid rgb(255 255 255 / 65%); outline-offset: -2px; }
@media (max-width: 280px) {
  /* 窄条也同时保留音量与「展开面板/播放队列」两个入口，只收紧间距。 */
  .taskbar-controls { gap: 6px; right: 12px; }
  .taskbar-control, .taskbar-volume-button, .taskbar-queue, .taskbar-lock { width: 15px; }
}
@media (min-width: 360px) {
  .taskbar-player.controls-hovered .taskbar-content { padding-right: 190px; }
  .taskbar-player.controls-hovered .taskbar-song-info { opacity: 1; }
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
