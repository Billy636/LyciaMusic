<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watchEffect } from 'vue';
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Music2, X } from 'lucide-vue-next';
import { MAIN_WINDOW_LABEL } from '../../windowLabels';
import { buildSquircleMask } from '../layout/taskbarSquircle';
import { resolveCoverRadius, resolveFrameRadius, type FrameShape } from '../../features/shape/squircle';
import {
  SONG_NOTIFICATION_AUTO_RAMP_SECONDS,
  SONG_NOTIFICATION_AUTO_START_OPACITY,
  SONG_NOTIFICATION_DISMISSED_EVENT,
  SONG_NOTIFICATION_HOLD_MS,
  SONG_NOTIFICATION_PRESENTED_EVENT,
  SONG_NOTIFICATION_PREVIEW_OPACITY,
  SONG_NOTIFICATION_READY_EVENT,
  SONG_NOTIFICATION_STATE_EVENT,
  normalizeSongNotificationBackgroundColor,
  normalizeSongNotificationBackgroundMode,
  normalizeSongNotificationFrameShape,
  type SongNotificationStatePayload,
} from '../../features/songNotification/shared';

const FADE_DURATION_MS = 160;
const notification = shallowRef<SongNotificationStatePayload | null>(null);
const visible = ref(false);
const hovered = ref(false);
const coverFailed = ref(false);
// 尺寸口径与铃动窗一致：Tauri 物理窗口尺寸 ÷ 缩放系数。180% 这类非整数缩放
// 下 WebView 的 getBoundingClientRect 会被取整，蒙版与窗口物理边缘错位导致
// R 角曲率变形；物理换算可保证蒙版与窗口 1:1 对齐。
const cardSize = ref({ width: window.innerWidth, height: window.innerHeight });
// 原生窗口的真实物理尺寸与缩放：蒙版按这两个值 1:1 绘制，不再依赖 WebView 的 dpr。
const cardPhysical = ref({ width: 0, height: 0, factor: window.devicePixelRatio || 1 });
const appWindow = getCurrentWindow();
let unlistenResized: (() => void) | null = null;
const syncViewportSize = async () => {
  try {
    const [size, factor] = await Promise.all([appWindow.innerSize(), appWindow.scaleFactor()]);
    if (factor > 0 && size.width > 0 && size.height > 0) {
      cardSize.value = { width: size.width / factor, height: size.height / factor };
      cardPhysical.value = { width: size.width, height: size.height, factor };
      return;
    }
  } catch (error) {
    console.warn('Failed to query notification window physical size:', error);
  }
  cardSize.value = { width: window.innerWidth, height: window.innerHeight };
  cardPhysical.value = { width: 0, height: 0, factor: window.devicePixelRatio || 1 };
};
const shellMask = ref('');
let mounted = true;
let generation = 0;
let dismissedId: number | null = null;
let unlistenState: UnlistenFn | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;
let rafId = 0;

function clearTimers() {
  if (expiryTimer !== null) clearTimeout(expiryTimer);
  if (dismissTimer !== null) clearTimeout(dismissTimer);
  expiryTimer = null;
  dismissTimer = null;
}

function dismiss(id = notification.value?.id) {
  if (id === undefined || notification.value?.id !== id || dismissedId === id) return;
  clearTimers();
  const revision = ++generation;
  dismissedId = id;
  visible.value = false;
  dismissTimer = setTimeout(() => {
    dismissTimer = null;
    if (!mounted || revision !== generation || notification.value?.id !== id) return;
    void emitTo(MAIN_WINDOW_LABEL, SONG_NOTIFICATION_DISMISSED_EVENT, { id })
      .catch(error => console.error('Failed to dismiss song notification:', error));
  }, FADE_DURATION_MS);
}

const hexToRgbTriplet = (hex: string) => {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map(char => char + char).join('') : value;
  return [0, 2, 4].map(offset => parseInt(full.slice(offset, offset + 2), 16) || 0);
};

/** 自定义浅色背景上用深色字，深色背景上用白字。 */
const foregroundColor = computed(() => {
  const [r, g, b] = hexToRgbTriplet(normalizeSongNotificationBackgroundColor(notification.value?.backgroundColor ?? ''));
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#1f2937' : '#ffffff';
});

const frameShape = computed(() => normalizeSongNotificationFrameShape(notification.value?.frameShape));
const backgroundMode = computed(() => normalizeSongNotificationBackgroundMode(notification.value?.backgroundMode));
const coverUrl = computed(() => notification.value?.coverUrl ?? '');

// 外框弧度与铃动窗完全同款：圆角矩形 16px、胶囊取小条半高、方形 0；
// 曲率均由 buildSquircleMask（figma-squircle, smoothing 0.6）给出，R 角观感一致。
// 与铃动窗共用同一套半径规则与绘制方案：只有尺寸不同，曲率完全一致。
const frameRadiusPx = computed(() => resolveFrameRadius(
  frameShape.value as FrameShape, cardSize.value.height,
));
const cardRadius = computed(() => frameShape.value === 'pill' ? '999px'
  : frameShape.value === 'square' ? '0px' : `${frameRadiusPx.value}px`);
/** 封面与外框同比例同曲率（铃动窗同规则）。 */
const COVER_SIZE = 44;
const coverRadiusPx = computed(() => resolveCoverRadius(
  frameShape.value as FrameShape, COVER_SIZE, cardSize.value.height,
));
const coverMask = ref('');
watchEffect(() => {
  const r = coverRadiusPx.value;
  coverMask.value = r > 0
    ? buildSquircleMask({
      width: COVER_SIZE, height: COVER_SIZE, radius: r,
      scaleFactor: cardPhysical.value.factor,
    }) ?? ''
    : '';
});

watchEffect(() => {
  const { width, height } = cardSize.value;
  if (!width || !height || frameShape.value === 'square') {
    shellMask.value = '';
    return;
  }
  shellMask.value = buildSquircleMask({
    width,
    height,
    radius: frameRadiusPx.value,
    scaleFactor: cardPhysical.value.factor,
    physicalWidth: cardPhysical.value.width || undefined,
    physicalHeight: cardPhysical.value.height || undefined,
  }) ?? '';
});

const cardStyle = computed(() => ({
  '--card-radius': cardRadius.value,
  '--shell-mask': shellMask.value ? `url("${shellMask.value}")` : 'none',
  '--cover-image': coverUrl.value ? `url("${coverUrl.value}")` : 'none',
  '--cover-mask': coverMask.value ? `url("${coverMask.value}")` : 'none',
  '--bg-rgb': hexToRgbTriplet(normalizeSongNotificationBackgroundColor(notification.value?.backgroundColor ?? '')).join(' '),
  '--fg': backgroundMode.value === 'live' ? '#ffffff' : foregroundColor.value,
}));

/** 不透明度由 reveal 阶段 + 时间戳驱动，跨窗口延迟也不会打乱节奏。 */
const displayOpacity = ref(0);
const revealMode = computed(() => notification.value?.reveal.mode ?? 'confirmed');
function updateOpacity() {
  if (!mounted || !visible.value) { displayOpacity.value = 0; return; }
  const reveal = notification.value?.reveal;
  if (!reveal) { displayOpacity.value = 0; return; }
  if (reveal.mode === 'preview') {
    displayOpacity.value = SONG_NOTIFICATION_PREVIEW_OPACITY;
  } else if (reveal.mode === 'confirmed') {
    displayOpacity.value = 1;
  } else {
    const elapsed = Math.max(0, Date.now() - reveal.startedAt);
    const progress = Math.min(1, elapsed / (SONG_NOTIFICATION_AUTO_RAMP_SECONDS * 1000));
    displayOpacity.value = SONG_NOTIFICATION_AUTO_START_OPACITY
      + (1 - SONG_NOTIFICATION_AUTO_START_OPACITY) * progress;
  }
  rafId = requestAnimationFrame(updateOpacity);
}

function scheduleDismiss(payload: SongNotificationStatePayload) {
  clearTimers();
  if (payload.reveal.mode === 'confirmed') {
    const remaining = Math.max(0, SONG_NOTIFICATION_HOLD_MS - (Date.now() - payload.reveal.startedAt));
    dismissTimer = setTimeout(() => { dismissTimer = null; dismiss(payload.id); }, remaining);
  } else {
    expiryTimer = setTimeout(() => {
      expiryTimer = null;
      dismiss(payload.id);
    }, Math.max(80, payload.expiresAt - Date.now()));
  }
}

async function present(payload: SongNotificationStatePayload) {
  const previous = notification.value;
  if (!mounted || (previous && payload.id < previous.id)) return;

  document.documentElement.classList.toggle('dark', payload.isDarkTheme);
  if (previous?.coverUrl !== payload.coverUrl) coverFailed.value = false;
  if (previous?.id === payload.id) {
    const modeChanged = previous.reveal.mode !== payload.reveal.mode;
    notification.value = { ...payload, expiresAt: previous.expiresAt };
    if (modeChanged) scheduleDismiss(notification.value);
    return;
  }

  const revision = ++generation;
  dismissedId = null;
  notification.value = payload;
  visible.value = true;
  hovered.value = false;
  updateOpacity();
  scheduleDismiss(payload);

  await nextTick();
  // Hidden native windows can pause animation frames, so preparation stays bounded.
  await new Promise<void>(resolve => {
    const fallback = setTimeout(resolve, 48);
    requestAnimationFrame(() => {
      clearTimeout(fallback);
      resolve();
    });
  });
  if (!mounted || revision !== generation || !visible.value) return;
  await emitTo(MAIN_WINDOW_LABEL, SONG_NOTIFICATION_PRESENTED_EVENT, { id: payload.id });
}

function onCoverError(event: Event) {
  if ((event.currentTarget as HTMLImageElement).getAttribute('src') === coverUrl.value) {
    coverFailed.value = true;
  }
}

onMounted(async () => {
  void syncViewportSize();
  unlistenResized = await appWindow.onResized(() => {
    void syncViewportSize();
  });
  try {
    const unlisten = await listen<SongNotificationStatePayload>(SONG_NOTIFICATION_STATE_EVENT, event => {
      void present(event.payload).catch(error => console.error('Failed to present song notification:', error));
    });
    if (!mounted) {
      unlisten();
      return;
    }
    unlistenState = unlisten;
    await emitTo(MAIN_WINDOW_LABEL, SONG_NOTIFICATION_READY_EVENT);
  } catch (error) {
    console.error('Failed to initialize song notification:', error);
  }
});

onBeforeUnmount(() => {
  mounted = false;
  generation++;
  clearTimers();
  if (rafId) cancelAnimationFrame(rafId);
  unlistenResized?.();
  unlistenState?.();
});
</script>

<template>
  <div class="notification-window">
    <div
      class="song-notification"
      :class="{
        'is-visible': visible,
        'is-live': backgroundMode === 'live',
        'is-custom': backgroundMode === 'color',
      }"
      :style="[cardStyle, { opacity: displayOpacity, transitionDuration: revealMode === 'auto' ? '0ms' : `${FADE_DURATION_MS}ms` }]"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      :aria-hidden="!visible"
      @mouseenter="hovered = true"
      @mouseleave="hovered = false"
    >
      <div class="notification-cover" :style="{ borderRadius: `${coverRadiusPx}px`, maskImage: 'var(--cover-mask, none)', WebkitMaskImage: 'var(--cover-mask, none)', maskSize: '100% 100%', WebkitMaskSize: '100% 100%' }">
        <img
          v-if="coverUrl && !coverFailed"
          :key="coverUrl"
          :src="coverUrl"
          alt=""
          draggable="false"
          @error="onCoverError"
        />
        <Music2 v-else :size="22" :stroke-width="1.5" aria-hidden="true" />
      </div>
      <div class="notification-text">
        <p class="notification-title" :title="notification?.title">{{ notification?.title }}</p>
        <p class="notification-artist" :title="notification?.artist">{{ notification?.artist }}</p>
      </div>
      <button
        type="button"
        class="notification-close"
        aria-label="关闭切歌提示"
        :tabindex="visible ? 0 : -1"
        @click="dismiss()"
      >
        <X :size="14" :stroke-width="1.7" aria-hidden="true" />
      </button>
      <Transition name="hint">
        <span v-if="hovered && visible" class="notification-hint" role="tooltip">可到设置关闭提示</span>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.notification-window {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  /* 卡片铺满整个窗口：方形模式下不能再留出透明边，否则叠在任务栏上像两层方框。 */
  padding: 0;
  box-sizing: border-box;
}

.song-notification {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 8px 10px;
  box-sizing: border-box;
  border: 1px solid rgb(255 255 255 / 8%);
  border-radius: var(--card-radius, 14px);
  color: var(--fg, #ffffff);
  box-shadow: 0 4px 18px rgb(0 0 0 / 18%);
  /* 物理像素级连续曲率蒙版，左右对称且无割角；border-radius 为降级兜底。 */
  -webkit-mask-image: var(--shell-mask, none);
  mask-image: var(--shell-mask, none);
  -webkit-mask-size: 100% 100%;
  mask-size: 100% 100%;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  opacity: 0;
  transform: translateY(3px);
  transition: opacity 160ms ease, transform 160ms ease;
  pointer-events: none;
  isolation: isolate;
}

.song-notification.is-visible {
  transform: translateY(0);
  pointer-events: auto;
}

.song-notification.is-live::before {
  content: '';
  position: absolute;
  inset: -40px;
  z-index: -2;
  background-image: var(--cover-image, none);
  background-size: cover;
  background-position: center;
  filter: blur(34px) saturate(1.35) brightness(0.78);
  opacity: 0.95;
  pointer-events: none;
}

.song-notification.is-live::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  background: linear-gradient(180deg, rgb(18 15 14 / 34%), rgb(8 7 7 / 52%));
  pointer-events: none;
}

.song-notification.is-custom {
  background: rgb(var(--bg-rgb, 236 65 65) / 0.94);
}

.notification-cover {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 44px;
  height: 44px;
  overflow: hidden;
  border-radius: 8px;
  background: rgb(255 255 255 / 12%);
  color: currentColor;
  opacity: 0.95;
}

.notification-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.notification-text {
  flex: 1;
  min-width: 0;
}

.notification-title,
.notification-artist {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  margin: 0;
}

.notification-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 19px;
}

.notification-artist {
  margin-top: 2px;
  color: currentColor;
  opacity: 0.72;
  font-size: 11px;
  line-height: 16px;
}

.notification-close {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: currentColor;
  opacity: 0;
  cursor: pointer;
  transition: opacity 120ms ease, background-color 120ms ease;
}

.song-notification:hover .notification-close,
.notification-close:focus-visible {
  opacity: 0.85;
}

.notification-close:hover {
  background: rgb(255 255 255 / 14%);
}

.notification-hint {
  position: absolute;
  left: 50%;
  bottom: 3px;
  transform: translateX(-50%);
  padding: 2px 7px;
  border-radius: 999px;
  background: rgb(0 0 0 / 52%);
  color: #ffffff;
  font-size: 9px;
  line-height: 13px;
  white-space: nowrap;
  pointer-events: none;
}

.hint-enter-active,
.hint-leave-active { transition: opacity 120ms ease; }
.hint-enter-from,
.hint-leave-to { opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .song-notification { transform: none; transition: opacity 80ms ease; }
}
</style>
