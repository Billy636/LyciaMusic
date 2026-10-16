<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Music2, X } from 'lucide-vue-next';
import { MAIN_WINDOW_LABEL } from '../../windowLabels';
import {
  SONG_NOTIFICATION_DISMISSED_EVENT,
  SONG_NOTIFICATION_PRESENTED_EVENT,
  SONG_NOTIFICATION_READY_EVENT,
  SONG_NOTIFICATION_STATE_EVENT,
  type SongNotificationStatePayload,
} from '../../features/songNotification/shared';

const FADE_DURATION_MS = 160;
const notification = shallowRef<SongNotificationStatePayload | null>(null);
const visible = ref(false);
const coverFailed = ref(false);
let mounted = true;
let generation = 0;
let dismissedId: number | null = null;
let unlistenState: UnlistenFn | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

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

async function present(payload: SongNotificationStatePayload) {
  const previous = notification.value;
  if (!mounted || (previous && payload.id < previous.id)) return;

  document.documentElement.classList.toggle('dark', payload.isDarkTheme);
  if (previous?.coverUrl !== payload.coverUrl) coverFailed.value = false;
  if (previous?.id === payload.id) {
    notification.value = { ...payload, expiresAt: previous.expiresAt };
    return;
  }

  clearTimers();
  const revision = ++generation;
  dismissedId = null;
  notification.value = payload;
  visible.value = true;
  expiryTimer = setTimeout(() => dismiss(payload.id), Math.max(0, payload.expiresAt - Date.now()));

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
  if ((event.currentTarget as HTMLImageElement).getAttribute('src') === notification.value?.coverUrl) {
    coverFailed.value = true;
  }
}

onMounted(async () => {
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
  unlistenState?.();
});
</script>

<template>
  <div class="notification-window">
    <div
      class="song-notification"
      :class="{ 'is-visible': visible, 'is-dark': notification?.isDarkTheme }"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      :aria-hidden="!visible"
    >
      <div class="notification-cover">
        <img
          v-if="notification?.coverUrl && !coverFailed"
          :key="notification.coverUrl"
          :src="notification.coverUrl"
          alt=""
          draggable="false"
          @error="onCoverError"
        />
        <Music2 v-else :size="23" :stroke-width="1.5" aria-hidden="true" />
      </div>
      <div class="notification-text">
        <p class="notification-title" :title="notification?.title">{{ notification?.title }}</p>
        <p class="notification-artist" :title="notification?.artist">{{ notification?.artist }}</p>
      </div>
      <button
        type="button"
        class="notification-close"
        aria-label="关闭"
        :tabindex="visible ? 0 : -1"
        @click="dismiss()"
      >
        <X :size="15" :stroke-width="1.7" aria-hidden="true" />
      </button>
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
  padding: 12px;
  box-sizing: border-box;
}

.song-notification {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  height: 100%;
  max-height: 88px;
  min-height: 0;
  padding: 15px;
  box-sizing: border-box;
  border: 1px solid rgba(0, 0, 0, 0.055);
  border-radius: 18px;
  background: #fafafa;
  color: #1f2937;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.12);
  opacity: 0;
  transform: translateY(5px);
  transition: opacity 160ms ease, transform 160ms ease;
  pointer-events: none;
}

.song-notification.is-visible {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

.song-notification.is-dark {
  border-color: rgba(255, 255, 255, 0.09);
  background: #202020;
  color: #f3f4f6;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.25);
}

.notification-cover {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 56px;
  height: 56px;
  overflow: hidden;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.045);
  color: #9ca3af;
}

.is-dark .notification-cover {
  background: rgba(255, 255, 255, 0.06);
  color: #6b7280;
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
  font-size: 14px;
  font-weight: 600;
  line-height: 21px;
}

.notification-artist {
  margin-top: 3px;
  color: #6b7280;
  font-size: 12px;
  line-height: 18px;
}

.is-dark .notification-artist {
  color: #9ca3af;
}

.notification-close {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 24px;
  height: 24px;
  margin-left: -4px;
  margin-right: -4px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #6b7280;
  opacity: 0;
  cursor: pointer;
  transition: opacity 120ms ease, background-color 120ms ease;
}

.song-notification:hover .notification-close,
.notification-close:focus-visible {
  opacity: 1;
}

.notification-close:hover,
.notification-close:focus-visible {
  background: rgba(0, 0, 0, 0.06);
}

.is-dark .notification-close {
  color: #9ca3af;
}

.is-dark .notification-close:hover,
.is-dark .notification-close:focus-visible {
  background: rgba(255, 255, 255, 0.09);
}

@media (max-width: 300px) {
  .song-notification {
    gap: 10px;
    padding: 12px;
  }

  .notification-cover {
    flex-basis: 44px;
    height: 44px;
  }
}

@media (max-height: 95px) {
  .notification-window {
    padding-block: 8px;
  }

  .song-notification {
    padding-block: 8px;
  }

  .notification-cover {
    flex-basis: 44px;
    height: 44px;
  }
}

@media (max-width: 180px) {
  .notification-window { padding-inline: 6px; }
  .song-notification { gap: 6px; padding-inline: 8px; }
  .notification-cover { display: none; }
}

@media (max-height: 80px) {
  .notification-window { padding-block: 4px; }
  .song-notification { padding-block: 4px; }
  .notification-cover,
  .notification-artist { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .song-notification {
    transform: none;
    transition: opacity 80ms ease;
  }
}
</style>
