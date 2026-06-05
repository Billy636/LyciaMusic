<script setup lang="ts">
import { computed, ref } from 'vue';

import { useGlobalShortcutStatus } from '../../composables/useKeyboardShortcuts';
import { useToast } from '../../composables/toast';
import { useSettings } from '../../features/settings/useSettings';
import {
  areShortcutBindingsEqual,
  createDefaultShortcutSettings,
  formatShortcutBinding,
  getShortcutBindingFromEvent,
  isSystemReservedShortcutEvent,
  shortcutActionLabels,
  shortcutActionOrder,
} from '../../features/settings/shortcuts';
import type { ShortcutActionId } from '../../types';

const { settings } = useSettings();
const { showToast } = useToast();
const { occupiedActionIdSet } = useGlobalShortcutStatus();

type ShortcutScope = 'local' | 'global';

interface CapturingTarget {
  actionId: ShortcutActionId;
  scope: ShortcutScope;
}

const capturingTarget = ref<CapturingTarget | null>(null);

const shortcutRows = computed(() => shortcutActionOrder.map((actionId) => ({
  actionId,
  label: shortcutActionLabels[actionId],
  localBinding: settings.value.shortcuts.local[actionId],
  globalBinding: settings.value.shortcuts.global[actionId],
})));

const hasOccupiedGlobalShortcuts = computed(() => occupiedActionIdSet.value.size > 0);

const isCapturing = (scope: ShortcutScope, actionId: ShortcutActionId) => (
  capturingTarget.value?.scope === scope && capturingTarget.value.actionId === actionId
);

const startCapture = (scope: ShortcutScope, actionId: ShortcutActionId) => {
  capturingTarget.value = { scope, actionId };
};

const stopCapture = () => {
  capturingTarget.value = null;
};

const restoreDefaults = () => {
  settings.value.shortcuts = createDefaultShortcutSettings();
  stopCapture();
};

const updateShortcut = (
  scope: ShortcutScope,
  actionId: ShortcutActionId,
  nextBinding: ReturnType<typeof getShortcutBindingFromEvent>,
) => {
  settings.value.shortcuts[scope][actionId] = nextBinding;
};

const handleShortcutCapture = (scope: ShortcutScope, actionId: ShortcutActionId, event: KeyboardEvent) => {
  if (!isCapturing(scope, actionId)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  if (event.key === 'Escape') {
    stopCapture();
    return;
  }

  if (event.key === 'Backspace' || event.key === 'Delete') {
    updateShortcut(scope, actionId, null);
    stopCapture();
    return;
  }

  if (isSystemReservedShortcutEvent(event)) {
    showToast('Win 组合键由系统保留，不能作为快捷键', 'error');
    return;
  }

  const nextBinding = getShortcutBindingFromEvent(event);
  if (!nextBinding) {
    return;
  }

  const conflictActionId = shortcutActionOrder.find(candidateActionId => (
    candidateActionId !== actionId
    && areShortcutBindingsEqual(settings.value.shortcuts[scope][candidateActionId], nextBinding)
  ));

  if (conflictActionId) {
    showToast(
      `${shortcutActionLabels[conflictActionId]} 已使用 ${formatShortcutBinding(nextBinding)}`,
      'error',
    );
    return;
  }

  updateShortcut(scope, actionId, nextBinding);
  stopCapture();
};
</script>

<template>
  <div class="w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        快捷键
      </h2>

      <div class="flex flex-col rounded-xl overflow-hidden">
        <div class="p-4 border-b border-white/30 dark:border-white/5">
          <div class="text-sm font-medium text-gray-800 dark:text-gray-200">窗口内快捷键</div>
          <div class="mt-1 text-xs text-gray-600 dark:text-white/60">
            软件打开且窗口处于焦点时生效。默认支持按下 Space 播放/暂停。
          </div>
          <div class="mt-3 text-[11px] text-gray-500 dark:text-white/45">
            点击快捷键按钮后直接按键录入，按 Esc 取消，按 Backspace 或 Delete 清空当前绑定。
          </div>
        </div>

        <div class="px-4 py-3 grid grid-cols-[minmax(0,1.1fr)_minmax(180px,1fr)_minmax(180px,1fr)] gap-4 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-white/45 border-b border-white/30 dark:border-white/5">
          <div>功能说明</div>
          <div>快捷键</div>
          <div>全局快捷键</div>
        </div>

        <div
          v-for="row in shortcutRows"
          :key="row.actionId"
          class="px-4 py-3 border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors grid grid-cols-[minmax(0,1.1fr)_minmax(180px,1fr)_minmax(180px,1fr)] gap-4 items-center"
        >
          <div class="min-w-0">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">
              {{ row.label }}
            </div>
          </div>

          <button
            type="button"
            data-shortcut-capture="true"
            @click="startCapture('local', row.actionId)"
            @blur="isCapturing('local', row.actionId) && stopCapture()"
            @keydown="handleShortcutCapture('local', row.actionId, $event)"
            class="w-full rounded-full border px-4 py-3 text-left text-sm transition-all backdrop-blur-md"
            :class="isCapturing('local', row.actionId)
              ? 'border-[#EC4141] bg-red-500/10 text-[#EC4141] dark:bg-red-500/20 shadow-[0_0_12px_rgba(236,65,65,0.2)]'
              : 'border-white/30 bg-white/40 text-gray-800 shadow-sm hover:border-[#EC4141] hover:text-[#EC4141] hover:bg-white/50 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20 dark:hover:border-[#EC4141]'"
          >
            {{ isCapturing('local', row.actionId) ? '按下新的快捷键' : formatShortcutBinding(row.localBinding) }}
          </button>

          <button
            type="button"
            data-shortcut-capture="true"
            @click="startCapture('global', row.actionId)"
            @blur="isCapturing('global', row.actionId) && stopCapture()"
            @keydown="handleShortcutCapture('global', row.actionId, $event)"
            class="w-full rounded-full border px-4 py-3 text-left text-sm transition-all backdrop-blur-md"
            :class="isCapturing('global', row.actionId)
              ? 'border-[#EC4141] bg-red-500/10 text-[#EC4141] dark:bg-red-500/20 shadow-[0_0_12px_rgba(236,65,65,0.2)]'
              : occupiedActionIdSet.has(row.actionId)
                ? 'border-[#f3b0b0] bg-[#f9ecec] text-[#b14c4c] shadow-sm hover:border-[#e78f8f] hover:bg-[#f7e4e4] dark:border-[#6a3030] dark:bg-[#3a1f1f]/80 dark:text-[#f2b1b1] dark:hover:border-[#874444] dark:hover:bg-[#472525]/80'
              : 'border-white/30 bg-white/40 text-gray-800 shadow-sm hover:border-[#EC4141] hover:text-[#EC4141] hover:bg-white/50 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20 dark:hover:border-[#EC4141]'"
          >
            {{ isCapturing('global', row.actionId) ? '按下新的快捷键' : formatShortcutBinding(row.globalBinding) }}
          </button>
        </div>

        <div
          v-if="settings.shortcuts.globalEnabled && hasOccupiedGlobalShortcuts"
          class="px-4 py-3 border-t border-white/30 dark:border-white/5 bg-[#fff5f5] text-[#c65a5a] text-xs dark:bg-[#3b2020]/70 dark:text-[#f0abab]"
        >
          淡红色背景代表热键被其他软件占用，暂时无法启用。
        </div>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        选项
      </h2>

      <div class="flex flex-col rounded-xl overflow-hidden">
        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">启用窗口内快捷键</div>
            <div class="text-xs text-gray-600 dark:text-white/60 mt-0.5">关闭后将不再响应当前窗口内的所有快捷键</div>
          </div>
          <button
            @click="settings.shortcuts.enabled = !settings.shortcuts.enabled"
            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"
            :class="settings.shortcuts.enabled ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
          >
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
              :class="settings.shortcuts.enabled ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">启用全局快捷键</div>
            <div class="text-xs text-gray-600 dark:text-white/60 mt-0.5">开启后在后台也可响应上方设置的全局快捷键，默认关闭</div>
          </div>
          <button
            @click="settings.shortcuts.globalEnabled = !settings.shortcuts.globalEnabled"
            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"
            :class="settings.shortcuts.globalEnabled ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
          >
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
              :class="settings.shortcuts.globalEnabled ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/10 transition-colors opacity-70 cursor-not-allowed">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">使用系统媒体快捷键</div>
            <div class="text-xs text-gray-600 dark:text-white/60 mt-0.5">播放/暂停、上一首、下一首等系统级媒体键入口已预留</div>
          </div>
          <div class="relative inline-flex h-6 w-11 items-center rounded-full bg-gray-300 dark:bg-gray-700">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white translate-x-1 shadow-sm" />
          </div>
        </div>
      </div>

      <div class="flex justify-end">
        <button
          type="button"
          @click="restoreDefaults"
          class="text-xs px-4 py-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-full text-gray-600 dark:text-gray-300 hover:text-[#EC4141] hover:border-[#EC4141] transition"
        >
          恢复默认
        </button>
      </div>
    </section>
  </div>
</template>
