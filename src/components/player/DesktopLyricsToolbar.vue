<script setup lang="ts">
import type { DesktopLyricsAction } from '../../features/desktopLyrics/shared';
import { emitSongSwitchSignal } from '../../features/songNotification/switchSignal';

const props = withDefaults(
  defineProps<{
    isPlaying: boolean;
    isLocked?: boolean;
    isHoveringLock?: boolean;
  }>(),
  {
    isLocked: false,
    isHoveringLock: false,
  }
);

const emit = defineEmits<{
  (e: 'action', action: DesktopLyricsAction): void;
}>();

function emitAction(action: DesktopLyricsAction) {
  emit('action', action);
}
</script>

<template>
  <div class="desktop-toolbar" @mousedown.stop>
    <div class="desktop-toolbar-track">
      <!-- 锁定状态下，只显示开锁按钮（且根据 isHoveringLock 决定 v-show 显隐） -->
      <button
        v-if="props.isLocked"
        v-show="props.isHoveringLock"
        class="desktop-toolbar-button"
        title="解锁桌面歌词"
        @click="emitAction({ type: 'update-settings', patch: { isLocked: false } })"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-[16px] w-[16px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 9.9-1" />
        </svg>
      </button>

      <template v-else>
        <!-- 闭锁按钮，表示“点击上锁” -->
        <button
          class="desktop-toolbar-button"
          title="锁定桌面歌词"
          @click="emitAction({ type: 'update-settings', patch: { isLocked: true } })"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-[16px] w-[16px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </button>

        <span class="desktop-toolbar-divider" aria-hidden="true"></span>

        <button
          class="desktop-toolbar-button"
          title="上一首"
          @pointerenter="emitSongSwitchSignal('desktopLyrics', 'hover', 'previous')"
          @pointerleave="emitSongSwitchSignal('desktopLyrics', 'leave', 'previous')"
          @click="emitAction({ type: 'prev-song' })"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-[16px] w-[16px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
            <path stroke-linecap="round" stroke-linejoin="round" d="M7 6v12" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M17 7 9.5 12 17 17V7Z" />
          </svg>
        </button>

        <button
          class="desktop-toolbar-button desktop-toolbar-button--primary"
          :title="props.isPlaying ? '暂停' : '播放'"
          @click="emitAction({ type: 'toggle-play' })"
        >
          <svg v-if="props.isPlaying" xmlns="http://www.w3.org/2000/svg" class="h-[16px] w-[16px]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 5h3v14H7zM14 5h3v14h-3z" />
          </svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-[16px] w-[16px]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5.5v13l10-6.5-10-6.5Z" />
          </svg>
        </button>

        <button
          class="desktop-toolbar-button"
          title="下一首"
          @pointerenter="emitSongSwitchSignal('desktopLyrics', 'hover', 'next')"
          @pointerleave="emitSongSwitchSignal('desktopLyrics', 'leave', 'next')"
          @click="emitAction({ type: 'next-song' })"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-[16px] w-[16px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
            <path stroke-linecap="round" stroke-linejoin="round" d="M17 6v12" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M7 7l7.5 5L7 17V7Z" />
          </svg>
        </button>

        <span class="desktop-toolbar-divider" aria-hidden="true"></span>

        <button class="desktop-toolbar-button" title="关闭桌面歌词" @click="emitAction({ type: 'close' })">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-[16px] w-[16px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.desktop-toolbar {
  display: flex;
  justify-content: center;
  color: rgba(255, 255, 255, 0.92);
  pointer-events: auto;
}

.desktop-toolbar-track {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 4px 8px;
  background: transparent;
  border: none;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.desktop-toolbar-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.85);
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.35)) drop-shadow(0 1px 8px rgba(0, 0, 0, 0.2));
  transition: color 160ms ease, background-color 160ms ease, transform 160ms ease;
}

.desktop-toolbar-button:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.14);
}

.desktop-toolbar-button--primary {
  width: 32px;
  height: 32px;
  color: #ffffff;
}

.desktop-toolbar-button--primary:hover {
  transform: scale(1.06);
}

.desktop-toolbar-divider {
  width: 1px;
  height: 16px;
  background: rgba(255, 255, 255, 0.3);
  opacity: 0.5;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35));
}
</style>
