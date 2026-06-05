<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { Check, ChevronDown, CircleAlert } from 'lucide-vue-next';
import { useSettings } from '../../features/settings/useSettings';
import { usePlayer } from '../../composables/player';
import { useToast } from '../../composables/toast';
import { useCoverCache } from '../../composables/useCoverCache';
import { clearPaletteCache } from '../../composables/colorExtraction';
import { clearImageCaches } from '../../caches/imageCaches';
import { appApi } from '../../services/tauri/appApi';
import { playbackApi } from '../../services/tauri/playbackApi';
import type { AudioOutputStatus } from '../../services/tauri/contracts';
import type { AudioDevice } from '../../services/tauri/contracts';
import { playerStorage, playerStorageKeys } from '../../services/storage/playerStorage';
import {
  buildAudioOutputDeviceOptions,
  getSelectedOutputDeviceLabel,
} from './audioOutputDeviceLabels';
import ConfirmModal from '../overlays/ConfirmModal.vue';

const { settings } = useSettings();
const {
  pauseSong,
  libraryScanProgress,
} = usePlayer();
const { showToast } = useToast();

const launchOnStartup = ref(false);
const autoPlay = ref(true);

async function handleGpuAccelerationChange() {
  const previous = settings.value.gpuAcceleration;
  const next = !previous;

  settings.value.gpuAcceleration = next;

  try {
    await invoke('set_gpu_acceleration', { enabled: next });
    showToast('GPU 加速设置已更新，重启软件后生效', 'success');
  } catch (error) {
    settings.value.gpuAcceleration = previous;
    showToast('GPU 加速设置保存失败', 'error');
    console.error('Failed to update GPU acceleration setting:', error);
  }
}
const showLyricsSyncOffsetPanel = ref(false);
const showClearAllDataConfirm = ref(false);
const isClearingAllData = ref(false);
const isClearingCache = ref(false);
const audioOutputStatus = ref<AudioOutputStatus | null>(null);
const audioOutputDevices = ref<AudioDevice[]>([]);
const selectedOutputDeviceId = ref<string>('');
const outputDeviceSelectRef = ref<HTMLElement | null>(null);
const isOutputDeviceMenuOpen = ref(false);
const isChangingOutputDevice = ref(false);
const wasapiExclusiveSideEffectTip = '开启后会独占播放设备：其他软件可能无声；设备断开或被占用时会自动回退默认播放。';
let unlistenAudioOutput: UnlistenFn | null = null;
const { clearCoverCaches } = useCoverCache();

const isLibraryScanActive = computed(
  () => !!libraryScanProgress.value && !libraryScanProgress.value.done
);

const lyricsSyncOffsetMs = computed({
  get: () => Math.round(settings.value.lyricsSyncOffset * 1000),
  set: (value: number | string) => {
    const numericValue = typeof value === 'string' ? parseFloat(value) : value;
    const next = Number.isFinite(numericValue) ? Math.max(-1000, Math.min(1000, numericValue)) : 0;
    settings.value.lyricsSyncOffset = next / 1000;
  }
});

const lyricsSyncOffsetLabel = computed(() => {
  const offset = lyricsSyncOffsetMs.value;
  if (offset === 0) return '0 ms';
  return `${offset > 0 ? '+' : ''}${offset} ms`;
});

const isWasapiExclusiveEnabled = computed(
  () => settings.value.audio.outputMode === 'wasapiExclusive',
);

const outputDeviceOptions = computed(() => buildAudioOutputDeviceOptions(audioOutputDevices.value));

const selectedOutputDeviceLabel = computed(() => (
  getSelectedOutputDeviceLabel(
    outputDeviceOptions.value,
    selectedOutputDeviceId.value,
    audioOutputStatus.value,
  )
));

const loadAudioOutputDevices = async () => {
  const [devices, status] = await Promise.all([
    playbackApi.getOutputDevices(),
    playbackApi.getCurrentOutputDevice(),
  ]);

  audioOutputDevices.value = devices;
  audioOutputStatus.value = status;
  selectedOutputDeviceId.value = status.selected_device_id ?? '';
};

const handleOutputDeviceSelect = async (deviceId: string) => {
  if (isChangingOutputDevice.value) {
    return;
  }

  isOutputDeviceMenuOpen.value = false;

  if (deviceId === selectedOutputDeviceId.value) {
    return;
  }

  isChangingOutputDevice.value = true;

  try {
    const nextDeviceId = deviceId || null;
    await playbackApi.setOutputDevice(nextDeviceId);

    if (nextDeviceId) {
      playerStorage.setString(playerStorageKeys.outputDevice, nextDeviceId);
      playerStorage.setString(playerStorageKeys.outputDeviceMode, 'manual');
    } else {
      playerStorage.remove(playerStorageKeys.outputDevice);
      playerStorage.setString(playerStorageKeys.outputDeviceMode, 'default');
    }

    selectedOutputDeviceId.value = deviceId;
    audioOutputStatus.value = await playbackApi.getCurrentOutputDevice();
  } catch (error) {
    console.error('Failed to update audio output device:', error);
    showToast('切换播放设备失败', 'error');
    selectedOutputDeviceId.value = audioOutputStatus.value?.selected_device_id ?? '';
  } finally {
    isChangingOutputDevice.value = false;
  }
};

const toggleOutputDeviceMenu = () => {
  if (isChangingOutputDevice.value) {
    return;
  }

  isOutputDeviceMenuOpen.value = !isOutputDeviceMenuOpen.value;
};

const handleDocumentPointerDown = (event: PointerEvent) => {
  if (!isOutputDeviceMenuOpen.value) {
    return;
  }

  const target = event.target as Node | null;
  if (target && outputDeviceSelectRef.value?.contains(target)) {
    return;
  }

  isOutputDeviceMenuOpen.value = false;
};

const handleDocumentKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    isOutputDeviceMenuOpen.value = false;
  }
};

const toggleWasapiExclusive = async () => {
  const outputMode = isWasapiExclusiveEnabled.value ? 'shared' : 'wasapiExclusive';
  settings.value.audio.outputMode = outputMode;

  try {
    await playbackApi.setAudioOutputMode(outputMode);
    audioOutputStatus.value = await playbackApi.getCurrentOutputDevice();
  } catch (error) {
    console.error('Failed to update audio output mode:', error);
    showToast('切换音频输出模式失败', 'error');
  }
};

const resetLyricsSyncOffset = () => {
  lyricsSyncOffsetMs.value = 0;
};

const openClearAllDataConfirm = () => {
  if (isClearingAllData.value || isLibraryScanActive.value) {
    return;
  }

  showClearAllDataConfirm.value = true;
};

const handleClearAllData = async () => {
  if (isClearingAllData.value) {
    return;
  }

  isClearingAllData.value = true;

  try {
    await pauseSong().catch(() => {});
    await appApi.clearAllAppData();
    localStorage.clear();
    sessionStorage.clear();
    window.location.reload();
  } catch (error) {
    console.error('Failed to clear all app data:', error);
    showToast('清除所有数据失败，请重试', 'error');
    showClearAllDataConfirm.value = false;
    isClearingAllData.value = false;
  }
};

const handleClearCaches = async () => {
  if (isClearingCache.value) {
    return;
  }

  isClearingCache.value = true;

  try {
    await appApi.clearCoverCache();
    clearCoverCaches();
    clearImageCaches();
    clearPaletteCache();
    showToast('封面缓存已清除', 'success');
  } catch (error) {
    console.error('Failed to clear cover caches:', error);
    showToast('清除缓存失败，请重试', 'error');
  } finally {
    isClearingCache.value = false;
  }
};

onMounted(async () => {
  await loadAudioOutputDevices().catch(error => {
    console.warn('Failed to load audio output devices:', error);
  });
  unlistenAudioOutput = await listen<AudioOutputStatus>('audio-output-device-changed', event => {
    audioOutputStatus.value = event.payload;
    selectedOutputDeviceId.value = event.payload.selected_device_id ?? '';
  });
  window.addEventListener('pointerdown', handleDocumentPointerDown);
  window.addEventListener('keydown', handleDocumentKeydown);
});

onScopeDispose(() => {
  unlistenAudioOutput?.();
  unlistenAudioOutput = null;
  window.removeEventListener('pointerdown', handleDocumentPointerDown);
  window.removeEventListener('keydown', handleDocumentKeydown);
});
</script>

<template>
  <div class="w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
    
    <!-- Startup & Behavior -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        常规与启动
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden">
        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">开机自动运行</div>
          </div>
          <button @click="launchOnStartup = !launchOnStartup" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="launchOnStartup ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="launchOnStartup ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">GPU 加速</div>
          </div>
          <button @click="handleGpuAccelerationChange" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0" :class="settings.gpuAcceleration ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.gpuAcceleration ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">关闭时最小化至托盘</div>
          </div>
          <button @click="settings.closeToTray = !settings.closeToTray" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.closeToTray ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.closeToTray ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">显示音质标识</div>
          </div>
          <button @click="settings.showQualityBadges = !settings.showQualityBadges" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.showQualityBadges ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.showQualityBadges ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">显示歌曲注释</div>
          </div>
          <button @click="settings.showSongComments = !settings.showSongComments" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.showSongComments ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.showSongComments ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">打开一键回顶按钮</div>
          </div>
          <button @click="settings.enableScrollToTopButton = !settings.enableScrollToTopButton" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.enableScrollToTopButton ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.enableScrollToTopButton ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">启用任务栏快捷播控</div>
          </div>
          <button @click="settings.showTaskbarPlayer = !settings.showTaskbarPlayer" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.showTaskbarPlayer ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.showTaskbarPlayer ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>
      </div>
    </section>

    <!-- Playback -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        播放设置
      </h2>
      <div class="settings-playback-group flex flex-col rounded-xl">
        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">自动播放</div>
          </div>
           <button @click="autoPlay = !autoPlay" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="autoPlay ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="autoPlay ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>
        <div class="p-4 flex items-center justify-between gap-4 border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">播放设备</div>
          </div>
          <div
            ref="outputDeviceSelectRef"
            class="settings-device-select-stack"
          >
            <div class="settings-device-select">
              <button
                type="button"
                class="settings-device-select__trigger"
                :class="{
                  'settings-device-select__trigger--open': isOutputDeviceMenuOpen,
                  'settings-device-select__trigger--disabled': isChangingOutputDevice,
                }"
                :aria-expanded="isOutputDeviceMenuOpen"
                :disabled="isChangingOutputDevice"
                aria-haspopup="listbox"
                @click="toggleOutputDeviceMenu"
              >
                <span class="settings-device-select__label">{{ selectedOutputDeviceLabel }}</span>
                <ChevronDown
                  class="settings-device-select__icon"
                  :class="{ 'settings-device-select__icon--open': isOutputDeviceMenuOpen }"
                  aria-hidden="true"
                />
              </button>
              <transition name="settings-device-menu">
                <div
                  v-if="isOutputDeviceMenuOpen"
                  class="settings-device-select__menu"
                  role="listbox"
                  aria-label="播放设备"
                >
                  <button
                    v-for="device in outputDeviceOptions"
                    :key="device.id || 'default'"
                    type="button"
                    class="settings-device-select__option"
                    :class="{ 'settings-device-select__option--selected': selectedOutputDeviceId === device.id }"
                    role="option"
                    :aria-selected="selectedOutputDeviceId === device.id"
                    @click="handleOutputDeviceSelect(device.id)"
                  >
                    <span class="settings-device-select__option-text">{{ device.name }}</span>
                    <Check
                      v-if="selectedOutputDeviceId === device.id"
                      class="settings-device-select__check"
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </transition>
            </div>
          </div>
        </div>
        <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">WASAPI 独占模式</div>
          </div>
          <div class="flex items-center gap-3">
            <span
              class="wasapi-tip"
              :aria-label="wasapiExclusiveSideEffectTip"
              tabindex="0"
            >
              <CircleAlert class="h-4 w-4" aria-hidden="true" />
              <span class="wasapi-tip-popover" role="tooltip">{{ wasapiExclusiveSideEffectTip }}</span>
            </span>
            <button @click="toggleWasapiExclusive" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="isWasapiExclusiveEnabled ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
              <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="isWasapiExclusiveEnabled ? 'translate-x-6' : 'translate-x-1'" />
            </button>
          </div>
        </div>
        <div class="border-t border-white/30 dark:border-white/5">
          <button
            type="button"
            @click="showLyricsSyncOffsetPanel = !showLyricsSyncOffsetPanel"
            class="w-full p-4 flex items-center justify-between gap-4 hover:bg-white/40 dark:hover:bg-white/10 transition-colors text-left"
          >
            <div class="min-w-0">
              <div class="text-sm font-medium text-gray-800 dark:text-gray-200">歌词同步补偿</div>
            </div>
            <div class="flex items-center gap-3 shrink-0">
              <div class="text-xs font-medium text-gray-600 dark:text-gray-300 tabular-nums">
                {{ lyricsSyncOffsetLabel }}
              </div>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4 text-gray-400 transition-transform duration-200"
                :class="showLyricsSyncOffsetPanel ? 'rotate-180' : ''"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
              </svg>
            </div>
          </button>
          <transition name="settings-pop-panel">
            <div v-if="showLyricsSyncOffsetPanel" class="px-4 pb-4">
              <div class="settings-expand-panel">
                <div class="text-xs leading-6 text-gray-600 dark:text-white/60">
                  正值让歌词更晚显示，负值让歌词更早显示。用于修正不同输出设备的播放缓冲差异，默认值为 0 ms。
                </div>

                <div class="mt-4 flex flex-col gap-4 md:flex-row md:items-center">
                  <input
                    v-model="lyricsSyncOffsetMs"
                    type="range"
                    min="-1000"
                    max="1000"
                    step="10"
                    class="settings-slider flex-1"
                  />
                  <div class="flex items-center gap-3">
                    <input
                      v-model="lyricsSyncOffsetMs"
                      type="number"
                      min="-1000"
                      max="1000"
                      step="10"
                      class="settings-number-input"
                    />
                    <button
                      type="button"
                      @click="resetLyricsSyncOffset"
                      class="settings-action-button settings-action-button--soft"
                    >
                      恢复默认
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </transition>
        </div>
      </div>
    </section>



    <!-- Storage -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        存储空间
      </h2>
      <div class="flex flex-col rounded-xl overflow-hidden">
         <div class="p-4 flex items-center justify-between border-b border-white/30 dark:border-white/5 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">清除缓存</div>
          </div>
          <button
            type="button"
            :disabled="isClearingCache"
            @click="handleClearCaches"
            class="settings-action-button"
            :class="isClearingCache
              ? 'settings-action-button--disabled'
              : 'settings-action-button--soft'"
          >
            {{ isClearingCache ? '清除中...' : '清除' }}
          </button>
        </div>
        <div class="p-4 flex items-center justify-between gap-4 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div class="min-w-0">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">重置数据</div>
          </div>
          <button
            type="button"
            :disabled="isClearingAllData || isLibraryScanActive"
            @click="openClearAllDataConfirm"
            class="settings-action-button shrink-0"
            :class="isClearingAllData || isLibraryScanActive
              ? 'settings-action-button--disabled'
              : 'settings-action-button--soft'"
          >
            {{ isClearingAllData ? '重置中...' : isLibraryScanActive ? '扫描中不可用' : '重置' }}
          </button>
        </div>
      </div>
    </section>

    <ConfirmModal
      :visible="showClearAllDataConfirm"
      title="重置数据"
      content="此操作会清空媒体库、播放记录、收藏和设置，并恢复初始状态，但不会删除你的音乐文件。确定继续吗？"
      @cancel="!isClearingAllData && (showClearAllDataConfirm = false)"
      @confirm="handleClearAllData"
    />
  </div>
</template>

<style scoped>
.settings-expand-panel {
  margin-top: 2px;
  border-top: 1px solid rgba(255, 255, 255, 0.3);
  padding: 18px 16px 0;
}

.settings-playback-group {
  overflow: visible;
}

.wasapi-tip {
  position: relative;
  display: inline-flex;
  height: 20px;
  width: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: #f59e0b;
  outline: none;
}

.wasapi-tip-popover {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 30;
  width: min(280px, calc(100vw - 48px));
  max-width: calc(100vw - 48px);
  pointer-events: none;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.16);
  color: rgb(31 41 55);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.55;
  opacity: 0;
  padding: 10px 12px;
  transform: translateY(-4px);
  transition: opacity 160ms ease, transform 160ms ease;
  white-space: normal;
}

.wasapi-tip:hover .wasapi-tip-popover,
.wasapi-tip:focus-visible .wasapi-tip-popover {
  opacity: 1;
  transform: translateY(0);
}

.settings-slider {
  height: 6px;
  cursor: pointer;
  accent-color: #ec4141;
}

.settings-number-input {
  width: 98px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.72);
  padding: 10px 12px;
  color: rgb(55 65 81);
  font-size: 13px;
  outline: none;
  transition: border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease;
}

.settings-number-input:focus {
  border-color: rgba(236, 65, 65, 0.3);
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.08);
}

.settings-action-button {
  min-height: 38px;
  padding: 0 16px;
  border: 1px solid rgba(236, 65, 65, 0.14);
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;
}

.settings-action-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 10px 20px rgba(236, 65, 65, 0.08);
}

.settings-action-button--soft {
  background: rgba(236, 65, 65, 0.06);
  color: #ec4141;
}

.settings-action-button--soft:hover:not(:disabled) {
  border-color: rgba(236, 65, 65, 0.34);
  background: rgba(236, 65, 65, 0.1);
}

.settings-action-button--disabled {
  border-color: rgba(148, 163, 184, 0.12);
  background: rgba(255, 255, 255, 0.36);
  color: rgba(100, 116, 139, 0.8);
  cursor: not-allowed;
  box-shadow: none;
}

.settings-pop-panel-enter-active,
.settings-pop-panel-leave-active {
  transition:
    opacity 220ms ease,
    transform 240ms ease,
    max-height 240ms ease;
  transform-origin: top center;
  overflow: hidden;
}

.settings-pop-panel-enter-from,
.settings-pop-panel-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.97);
  max-height: 0;
}

.settings-pop-panel-enter-to,
.settings-pop-panel-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
  max-height: 240px;
}

.settings-device-select-stack {
  display: flex;
  min-width: 220px;
  width: min(360px, 56vw);
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}

.settings-device-select {
  position: relative;
  width: 100%;
}

.settings-device-select__trigger {
  display: flex;
  min-height: 40px;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.72);
  padding: 8px 12px 8px 14px;
  color: rgb(55 65 81);
  font-size: 13px;
  font-weight: 500;
  outline: none;
  transition: border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease;
}

.settings-device-select__trigger:hover:not(:disabled),
.settings-device-select__trigger--open {
  border-color: rgba(236, 65, 65, 0.28);
  background: rgba(255, 255, 255, 0.86);
}

.settings-device-select__trigger:focus-visible,
.settings-device-select__trigger--open {
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.08);
}

.settings-device-select__trigger--disabled {
  cursor: not-allowed;
  opacity: 0.68;
}

.settings-device-select__label {
  min-width: 0;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-device-select__icon {
  height: 16px;
  width: 16px;
  flex: 0 0 auto;
  color: rgba(55, 65, 81, 0.72);
  transition: transform 160ms ease;
}

.settings-device-select__icon--open {
  transform: rotate(180deg);
}

.settings-device-select__menu {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 40;
  width: min(520px, calc(100vw - 48px));
  max-height: 252px;
  overflow-y: auto;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.16);
  padding: 6px;
  backdrop-filter: blur(18px);
}

.settings-device-select__option {
  display: flex;
  min-height: 38px;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-radius: 10px;
  padding: 8px 10px;
  color: rgb(31 41 55);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.35;
  text-align: left;
  transition: background-color 140ms ease, color 140ms ease;
}

.settings-device-select__option:hover,
.settings-device-select__option:focus-visible {
  background: rgba(236, 65, 65, 0.08);
  color: #ec4141;
  outline: none;
}

.settings-device-select__option--selected {
  background: rgba(236, 65, 65, 0.12);
  color: #ec4141;
}

.settings-device-select__option-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-device-select__check {
  height: 15px;
  width: 15px;
  flex: 0 0 auto;
}

.settings-device-menu-enter-active,
.settings-device-menu-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
  transform-origin: top right;
}

.settings-device-menu-enter-from,
.settings-device-menu-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}

.settings-device-menu-enter-to,
.settings-device-menu-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
}

:global(.dark) .settings-expand-panel {
  border-top-color: rgba(255, 255, 255, 0.08);
}

:global(.dark) .wasapi-tip {
  color: #fcd34d;
}

:global(.dark) .wasapi-tip-popover {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(31, 31, 31, 0.96);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.28);
  color: rgba(255, 255, 255, 0.92);
}

:global(.dark) .settings-number-input {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.92);
}

:global(.dark) .settings-number-input:focus {
  border-color: rgba(236, 65, 65, 0.34);
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.12);
}

:global(.dark) .settings-device-select__trigger {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.92);
}

:global(.dark) .settings-device-select__trigger:hover:not(:disabled),
:global(.dark) .settings-device-select__trigger--open {
  border-color: rgba(236, 65, 65, 0.34);
  background: rgba(255, 255, 255, 0.08);
}

:global(.dark) .settings-device-select__trigger:focus-visible,
:global(.dark) .settings-device-select__trigger--open {
  border-color: rgba(236, 65, 65, 0.34);
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.12);
}

:global(.dark) .settings-device-select__icon {
  color: rgba(255, 255, 255, 0.72);
}

:global(.dark) .settings-device-select__menu {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(31, 31, 31, 0.94);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.3);
}

:global(.dark) .settings-device-select__option {
  color: rgba(255, 255, 255, 0.88);
}

:global(.dark) .settings-device-select__option:hover,
:global(.dark) .settings-device-select__option:focus-visible {
  background: rgba(236, 65, 65, 0.16);
  color: rgba(255, 255, 255, 0.96);
}

:global(.dark) .settings-device-select__option--selected {
  background: rgba(236, 65, 65, 0.22);
  color: #fff;
}

:global(.dark) .settings-action-button--disabled {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.45);
}
</style>
