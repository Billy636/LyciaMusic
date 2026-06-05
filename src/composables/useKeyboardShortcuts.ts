import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { register, unregister, unregisterAll } from '@tauri-apps/plugin-global-shortcut';

import { useLibraryCollections } from '../features/collections/useLibraryCollections';
import { usePlaybackController } from '../features/playback/usePlaybackController';
import { useSettings } from '../features/settings/useSettings';
import {
  matchesShortcutEvent,
  shortcutActionOrder,
  toGlobalShortcutAccelerator,
} from '../features/settings/shortcuts';
import type { ShortcutActionId, ShortcutSettings } from '../types';
import { useLyrics } from './lyrics';
import { useUiStore } from '../shared/stores/ui';
import { useToast } from './toast';

const INTERACTIVE_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[role="textbox"]',
  '[data-shortcut-capture="true"]',
].join(', ');

const occupiedGlobalShortcutActionIds = ref<ShortcutActionId[]>([]);

const isTypingTarget = (target: EventTarget | null) => (
  target instanceof HTMLElement && !!target.closest(INTERACTIVE_SELECTOR)
);

const isGlobalShortcutOccupiedError = (error: unknown) => {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes('already registered')
    || message.includes('hotkey')
    || message.includes('already');
};

export function useGlobalShortcutStatus() {
  const occupiedActionIdSet = computed(() => new Set(occupiedGlobalShortcutActionIds.value));

  return {
    occupiedGlobalShortcutActionIds,
    occupiedActionIdSet,
  };
}

export function createGlobalShortcutSyncKey(shortcuts: ShortcutSettings) {
  const parts = [shortcuts.globalEnabled ? 'enabled' : 'disabled'];

  for (const actionId of shortcutActionOrder) {
    parts.push(`${actionId}:${toGlobalShortcutAccelerator(shortcuts.global[actionId]) ?? ''}`);
  }

  return parts.join('\u001F');
}

export function useKeyboardShortcuts() {
  const { settings } = useSettings();
  const { currentSong, volume, togglePlay, nextSong, prevSong, handleVolume } = usePlaybackController();
  const { toggleFavorite } = useLibraryCollections();
  const { showDesktopLyrics, desktopLyricsSettings } = useLyrics();
  const uiStore = useUiStore();
  const { showToast } = useToast();

  const updateVolume = async (delta: number) => {
    const nextVolume = Math.max(0, Math.min(100, volume.value + delta));
    if (nextVolume === volume.value) {
      return;
    }

    await handleVolume({ target: { value: nextVolume.toString() } } as unknown as Event);
  };

  const actionHandlers: Record<ShortcutActionId, () => void | Promise<void>> = {
    togglePlay: () => togglePlay(),
    prevSong: () => prevSong(),
    nextSong: () => nextSong(),
    volumeUp: () => updateVolume(5),
    volumeDown: () => updateVolume(-5),
    toggleMiniMode: () => {
      uiStore.isMiniMode = !uiStore.isMiniMode;
    },
    toggleFavorite: () => {
      if (currentSong.value) {
        toggleFavorite(currentSong.value);
      }
    },
    toggleDesktopLyrics: () => {
      showDesktopLyrics.value = !showDesktopLyrics.value;
    },
    toggleDesktopLyricsLock: () => {
      desktopLyricsSettings.isLocked = !desktopLyricsSettings.isLocked;
    },
  };

  const globalActionByShortcut = new Map<string, ShortcutActionId>();
  let isUnmounted = false;
  let syncTaskId = 0;

  const handleKeydown = (event: KeyboardEvent) => {
    if (!settings.value.shortcuts.enabled || event.defaultPrevented || event.repeat) {
      return;
    }

    if (isTypingTarget(event.target)) {
      return;
    }

    for (const actionId of shortcutActionOrder) {
      if (!matchesShortcutEvent(settings.value.shortcuts.local[actionId], event)) {
        continue;
      }

      event.preventDefault();
      event.stopPropagation();
      void actionHandlers[actionId]();
      return;
    }
  };

  const syncGlobalShortcuts = async () => {
    const taskId = ++syncTaskId;
    await unregisterAll();

    if (taskId !== syncTaskId) {
      return;
    }

    globalActionByShortcut.clear();
    occupiedGlobalShortcutActionIds.value = [];

    if (!settings.value.shortcuts.globalEnabled) {
      return;
    }

    const shortcuts = shortcutActionOrder.flatMap((actionId) => {
      const accelerator = toGlobalShortcutAccelerator(settings.value.shortcuts.global[actionId]);
      if (!accelerator) {
        return [];
      }

      return [{ actionId, accelerator }];
    });

    if (shortcuts.length === 0) {
      return;
    }

    const occupiedActionIds: ShortcutActionId[] = [];

    for (const { actionId, accelerator } of shortcuts) {
      try {
        await register(accelerator, (event) => {
          if (event.state !== 'Pressed') {
            return;
          }

          const currentActionId = globalActionByShortcut.get(event.shortcut);
          if (!currentActionId) {
            return;
          }

          void actionHandlers[currentActionId]();
        });

        globalActionByShortcut.set(accelerator, actionId);
      } catch (error) {
        if (isUnmounted || taskId !== syncTaskId) {
          return;
        }

        if (isGlobalShortcutOccupiedError(error)) {
          occupiedActionIds.push(actionId);
          await unregister(accelerator).catch(() => undefined);
          continue;
        }

        globalActionByShortcut.clear();
        occupiedGlobalShortcutActionIds.value = [];
        await unregisterAll().catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        showToast(`全局快捷键注册失败：${message}`, 'error');
        return;
      }
    }

    occupiedGlobalShortcutActionIds.value = occupiedActionIds;

    if (taskId !== syncTaskId) {
      await unregisterAll().catch(() => undefined);
      globalActionByShortcut.clear();
      occupiedGlobalShortcutActionIds.value = [];
    }
  };

  onMounted(() => {
    window.addEventListener('keydown', handleKeydown);
    void syncGlobalShortcuts();
  });

  onUnmounted(() => {
    isUnmounted = true;
    occupiedGlobalShortcutActionIds.value = [];
    window.removeEventListener('keydown', handleKeydown);
    void unregisterAll().catch(() => undefined);
  });

  watch(
    () => createGlobalShortcutSyncKey(settings.value.shortcuts),
    () => {
      void syncGlobalShortcuts();
    },
  );
}
