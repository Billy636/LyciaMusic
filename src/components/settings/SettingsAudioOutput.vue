<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Check, ChevronDown, CircleAlert } from 'lucide-vue-next';
import { useSettings } from '../../features/settings/useSettings';
import { useToast } from '../../composables/toast';
import { playbackApi } from '../../services/tauri/playbackApi';
import type { AudioDevice, AudioOutputStatus } from '../../services/tauri/contracts';
import { playerStorage, playerStorageKeys } from '../../services/storage/playerStorage';
import {
  buildAudioOutputDeviceOptions,
  getSelectedOutputDeviceLabel,
} from './audioOutputDeviceLabels';
import EqualizerPanel from '../player/EqualizerPanel.vue';

const { settings, patchSettings } = useSettings();
const { showToast } = useToast();

const audioOutputStatus = ref<AudioOutputStatus | null>(null);
const audioOutputDevices = ref<AudioDevice[]>([]);
const selectedOutputDeviceId = ref<string>('');
const outputDeviceSelectRef = ref<HTMLElement | null>(null);
const isOutputDeviceMenuOpen = ref(false);
const isChangingOutputDevice = ref(false);
const wasapiExclusiveSideEffectTip = '开启后会独占播放设备：其他软件可能无声；设备断开或被占用时会自动回退默认播放。';
let unlistenAudioOutput: UnlistenFn | null = null;
let isDisposed = false;

const volumeBalanceTip = '音量平衡会读取歌曲内置 ReplayGain 标签，在切歌时自动平衡音量。默认完全按标签播放，不改变歌曲内部动态。不存在标签时则无变化。';

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

// 规范更新：启用/禁用均衡器
const toggleEqualizer = () => {
  const currentEq = settings.value.audio.equalizer;
  patchSettings({
    audio: {
      ...settings.value.audio, // 展开以保护其他 audio 状态不受非深合并影响
      equalizer: {
        ...currentEq,
        enabled: !currentEq.enabled,
      },
    },
  });
};

onMounted(async () => {
  window.addEventListener('pointerdown', handleDocumentPointerDown);
  window.addEventListener('keydown', handleDocumentKeydown);

  await loadAudioOutputDevices().catch(error => {
    console.warn('Failed to load audio output devices:', error);
  });
  if (isDisposed) {
    return;
  }

  try {
    const unlisten = await listen<AudioOutputStatus>('audio-output-device-changed', event => {
      audioOutputStatus.value = event.payload;
      selectedOutputDeviceId.value = event.payload.selected_device_id ?? '';
    });
    if (isDisposed) {
      unlisten();
      return;
    }
    unlistenAudioOutput = unlisten;
  } catch (error) {
    console.warn('Failed to listen for audio output device changes:', error);
  }
});

onScopeDispose(() => {
  isDisposed = true;
  unlistenAudioOutput?.();
  unlistenAudioOutput = null;
  window.removeEventListener('pointerdown', handleDocumentPointerDown);
  window.removeEventListener('keydown', handleDocumentKeydown);
});
</script>

<template>
  <div class="w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        播放设备
      </h2>
      <div class="flex flex-col">
        <div class="desktop-setting-row">
          <div class="text-sm font-medium text-gray-800 dark:text-gray-200">播放设备</div>
          <div ref="outputDeviceSelectRef" class="settings-device-select-stack">
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
                aria-label="播放设备"
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
        <div class="desktop-setting-row">
          <div class="text-sm font-medium text-gray-800 dark:text-gray-200">WASAPI 独占模式</div>
          <div class="flex items-center gap-3">
            <span class="audio-tip" :aria-label="wasapiExclusiveSideEffectTip" tabindex="0">
              <CircleAlert class="h-4 w-4" aria-hidden="true" />
              <span class="audio-tip-popover" role="tooltip">{{ wasapiExclusiveSideEffectTip }}</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-label="WASAPI 独占模式"
              :aria-checked="isWasapiExclusiveEnabled"
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"
              :class="isWasapiExclusiveEnabled ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
              @click="toggleWasapiExclusive"
            >
              <span
                class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
                :class="isWasapiExclusiveEnabled ? 'translate-x-6' : 'translate-x-1'"
              />
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        音频处理
      </h2>
      <div class="flex flex-col">
        <div class="desktop-setting-row">
          <div class="flex-1 space-y-1">
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">播放淡入淡出</div>
            <div class="text-xs app-text-secondary max-w-xl">
              播放和继续播放时缓缓响起，暂停时逐渐安静，约 0.3 秒完成过渡。
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="播放淡入淡出"
            :aria-checked="settings.audio.playbackFadeEnabled !== false"
            class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#EC4141]"
            :class="settings.audio.playbackFadeEnabled !== false ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
            @click="settings.audio.playbackFadeEnabled = settings.audio.playbackFadeEnabled === false"
          >
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
              :class="settings.audio.playbackFadeEnabled !== false ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>
        <!-- 音量平衡主开关行 -->
        <div class="desktop-setting-row">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">音量平衡</div>
          </div>
          <div class="flex items-center gap-3">
            <span
              class="audio-tip"
              :aria-label="volumeBalanceTip"
              tabindex="0"
            >
              <CircleAlert class="h-4 w-4" aria-hidden="true" />
              <span class="audio-tip-popover" role="tooltip">{{ volumeBalanceTip }}</span>
            </span>
            <button
              type="button"
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"
              :class="settings.audio.volumeBalance.enabled ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
              @click="settings.audio.volumeBalance.enabled = !settings.audio.volumeBalance.enabled"
            >
              <span
                class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
                :class="settings.audio.volumeBalance.enabled ? 'translate-x-6' : 'translate-x-1'"
              />
            </button>
          </div>
        </div>

        <!-- 高级音量平衡配置子区域 -->
        <div
          v-if="settings.audio.volumeBalance.enabled"
          class="flex flex-col transition-all duration-300 animate-in fade-in"
        >
          <!-- 整体增益偏移设置 -->
          <div class="desktop-setting-row pl-8">
            <div class="flex-1 space-y-1">
              <div class="text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-2">
                整体增益偏移
                <span class="text-xs font-semibold px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                  {{ settings.audio.volumeBalance.gainOffsetDb > 0 ? '+' : '' }}{{ settings.audio.volumeBalance.gainOffsetDb }} dB
                </span>
              </div>
              <div class="text-xs app-text-secondary max-w-xl">
                默认 0 dB，表示完全按 ReplayGain 标签播放。调高会整体更响，调低会保留更多余量。
              </div>
            </div>
            <div class="flex items-center gap-3">
              <input
                type="range"
                min="-12"
                max="6"
                step="1"
                v-model.number="settings.audio.volumeBalance.gainOffsetDb"
                class="w-36 h-1 rounded-lg bg-gray-200 dark:bg-gray-700 appearance-none cursor-pointer accent-[#EC4141]"
              />
            </div>
          </div>

          <!-- 防削波保护开关 -->
          <div class="desktop-setting-row pl-8">
            <div class="flex-1 space-y-1">
              <div class="text-sm font-medium text-gray-800 dark:text-gray-200">
                防削波破音保护
              </div>
              <div class="text-xs app-text-secondary max-w-xl">
                当音量增益过大可能超出 0 dB 极限时自动降低音频信号。无峰值标签曲目会降级为不应用任何正增益。
              </div>
            </div>
            <div class="flex items-center gap-3">
              <button
                type="button"
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"
                :class="settings.audio.volumeBalance.preventClipping ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
                @click="settings.audio.volumeBalance.preventClipping = !settings.audio.volumeBalance.preventClipping"
              >
                <span
                  class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
                  :class="settings.audio.volumeBalance.preventClipping ? 'translate-x-6' : 'translate-x-1'"
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 均衡器配置区 -->
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        均衡器 (EQ)
      </h2>
      <div class="flex flex-col">
        <!-- 启用均衡器主开关行 -->
        <div class="desktop-setting-row">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">启用均衡器</div>
          </div>
          <div class="flex items-center gap-3">
            <button
              type="button"
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"
              :class="settings.audio.equalizer.enabled ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
              @click="toggleEqualizer"
            >
              <span
                class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
                :class="settings.audio.equalizer.enabled ? 'translate-x-6' : 'translate-x-1'"
              />
            </button>
          </div>
        </div>

        <!-- 均衡器调节板高级配置子区域 -->
        <div
          v-if="settings.audio.equalizer.enabled"
          class="flex flex-col transition-all duration-300 animate-in fade-in p-6"
        >
          <EqualizerPanel :embedded="true" />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.desktop-setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border-bottom: 1px solid var(--settings-divider);
  text-align: left;
}

.desktop-setting-row:last-child {
  border-bottom: 0;
}

.dark .desktop-setting-row {
  border-bottom-color: var(--settings-divider);
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

.audio-tip {
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

.audio-tip-popover {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 30;
  width: min(300px, calc(100vw - 48px));
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

.audio-tip:hover .audio-tip-popover,
.audio-tip:focus-visible .audio-tip-popover {
  opacity: 1;
  transform: translateY(0);
}

.dark .audio-tip {
  color: #fcd34d;
}

.dark .audio-tip-popover {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(31, 31, 31, 0.96);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.28);
  color: rgba(255, 255, 255, 0.92);
}

.dark .settings-device-select__trigger {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.92);
}

.dark .settings-device-select__trigger:hover:not(:disabled),
.dark .settings-device-select__trigger--open {
  border-color: rgba(236, 65, 65, 0.34);
  background: rgba(255, 255, 255, 0.08);
}

.dark .settings-device-select__trigger:focus-visible,
.dark .settings-device-select__trigger--open {
  border-color: rgba(236, 65, 65, 0.34);
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.12);
}

.dark .settings-device-select__icon {
  color: rgba(255, 255, 255, 0.72);
}

.dark .settings-device-select__menu {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(31, 31, 31, 0.94);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.3);
}

.dark .settings-device-select__option {
  color: rgba(255, 255, 255, 0.88);
}

.dark .settings-device-select__option:hover,
.dark .settings-device-select__option:focus-visible {
  background: rgba(236, 65, 65, 0.16);
  color: rgba(255, 255, 255, 0.96);
}

.dark .settings-device-select__option--selected {
  background: rgba(236, 65, 65, 0.22);
  color: #fff;
}
</style>
