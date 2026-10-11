<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { CircleAlert } from 'lucide-vue-next';
import { useSettings } from '../../features/settings/useSettings';
import { usePlayer } from '../../composables/player';
import { useToast } from '../../composables/toast';
import { useCoverCache } from '../../composables/useCoverCache';
import { clearPaletteCache } from '../../composables/colorExtraction';
import { clearImageCaches } from '../../caches/imageCaches';
import { appApi } from '../../services/tauri/appApi';
import ConfirmModal from '../overlays/ConfirmModal.vue';

const { settings } = useSettings();
const {
  pauseSong,
  libraryScanProgress,
} = usePlayer();
const { showToast } = useToast();

const launchOnStartup = ref(false);
const isLoadingLaunchOnStartup = ref(true);
const isChangingLaunchOnStartup = ref(false);
const launchOnStartupError = ref(false);

async function loadLaunchOnStartup() {
  isLoadingLaunchOnStartup.value = true;
  launchOnStartupError.value = false;

  try {
    launchOnStartup.value = await appApi.getLaunchOnStartup();
  } catch (error) {
    launchOnStartupError.value = true;
    console.error('Failed to read launch on startup setting:', error);
  } finally {
    isLoadingLaunchOnStartup.value = false;
  }
}

async function handleLaunchOnStartupChange() {
  if (isLoadingLaunchOnStartup.value || isChangingLaunchOnStartup.value || launchOnStartupError.value) return;

  isChangingLaunchOnStartup.value = true;

  try {
    launchOnStartup.value = await appApi.setLaunchOnStartup(!launchOnStartup.value);
  } catch (error) {
    try {
      launchOnStartup.value = await appApi.getLaunchOnStartup();
    } catch (readError) {
      launchOnStartupError.value = true;
      console.error('Failed to refresh launch on startup setting:', readError);
    }
    showToast('开机自动运行设置保存失败，请重试', 'error');
    console.error('Failed to update launch on startup setting:', error);
  } finally {
    isChangingLaunchOnStartup.value = false;
  }
}

onMounted(loadLaunchOnStartup);

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
const showClearAllDataConfirm = ref(false);
const isClearingAllData = ref(false);
const isClearingCache = ref(false);
const autoScanLibraryOnStartupTip = '每次启动时会自动扫描音乐库变化，会增加启动短时内的CPU占用，若启动卡顿建议关闭，若经常歌曲变动且cpu较好则可开启。';
const writeArtistAvatarToTagsTip = '开启后，手动修改歌手头像时会同步修改本地音频文件（注意：多歌手合作歌曲、远程歌曲、CUE分轨、只读文件会被自动跳过）';
const { clearCoverCaches } = useCoverCache();

const isLibraryScanActive = computed(
  () => !!libraryScanProgress.value && !libraryScanProgress.value.done
);

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

</script>

<template>
  <div class="w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
    
    <!-- Startup & Behavior -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        常规与启动
      </h2>
      <div class="flex flex-col rounded-xl">
        <div class="p-4 flex items-center justify-between border-b border-[var(--settings-divider)] last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">开机自动运行</div>
            <div v-if="launchOnStartupError" class="mt-1 flex items-center gap-2 text-xs app-text-secondary">
              <span>读取开机启动状态失败</span>
              <button type="button" class="text-[#EC4141] hover:underline" @click="loadLaunchOnStartup">重试</button>
            </div>
            <div v-else-if="isLoadingLaunchOnStartup" class="mt-1 text-xs app-text-secondary">正在读取设置…</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="开机自动运行"
            :aria-checked="launchOnStartup"
            :aria-busy="isLoadingLaunchOnStartup || isChangingLaunchOnStartup"
            :disabled="isLoadingLaunchOnStartup || isChangingLaunchOnStartup || launchOnStartupError"
            @click="handleLaunchOnStartupChange"
            class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#EC4141]"
            :class="launchOnStartup ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
          >
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="launchOnStartup ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-[var(--settings-divider)] last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">GPU 加速</div>
          </div>
          <button @click="handleGpuAccelerationChange" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0" :class="settings.gpuAcceleration ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.gpuAcceleration ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-[var(--settings-divider)] last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">启动时自动扫描音乐库</div>
          </div>
          <div class="flex items-center gap-3">
            <span
              class="settings-side-effect-tip"
              :aria-label="autoScanLibraryOnStartupTip"
              tabindex="0"
            >
              <CircleAlert class="h-4 w-4" aria-hidden="true" />
              <span class="settings-side-effect-tip-popover" role="tooltip">{{ autoScanLibraryOnStartupTip }}</span>
            </span>
            <button
              @click="settings.autoScanLibraryOnStartup = !settings.autoScanLibraryOnStartup"
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0"
              :class="settings.autoScanLibraryOnStartup ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
            >
              <span
                class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
                :class="settings.autoScanLibraryOnStartup ? 'translate-x-6' : 'translate-x-1'"
              />
            </button>
          </div>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-[var(--settings-divider)] last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">启动时检查更新</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="启动时检查更新"
            :aria-checked="settings.autoCheckUpdatesOnStartup"
            @click="settings.autoCheckUpdatesOnStartup = !settings.autoCheckUpdatesOnStartup"
            class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#EC4141]"
            :class="settings.autoCheckUpdatesOnStartup ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
          >
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.autoCheckUpdatesOnStartup ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-[var(--settings-divider)] last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">关闭时最小化至托盘</div>
          </div>
          <button @click="settings.closeToTray = !settings.closeToTray" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.closeToTray ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.closeToTray ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-[var(--settings-divider)] last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">修改歌手头像时同步写回音频标签</div>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <span
              class="settings-side-effect-tip"
              :aria-label="writeArtistAvatarToTagsTip"
              tabindex="0"
            >
              <CircleAlert class="h-4 w-4" aria-hidden="true" />
              <span class="settings-side-effect-tip-popover" role="tooltip">{{ writeArtistAvatarToTagsTip }}</span>
            </span>
            <button @click="settings.writeArtistAvatarToTags = !settings.writeArtistAvatarToTags" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0" :class="settings.writeArtistAvatarToTags ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
              <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.writeArtistAvatarToTags ? 'translate-x-6' : 'translate-x-1'" />
            </button>
          </div>
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
         <div class="p-4 flex items-center justify-between border-b border-[var(--settings-divider)] hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
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
.settings-side-effect-tip {
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

.settings-side-effect-tip-popover {
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

.settings-side-effect-tip:hover .settings-side-effect-tip-popover,
.settings-side-effect-tip:focus-visible .settings-side-effect-tip-popover {
  opacity: 1;
  transform: translateY(0);
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

.dark .settings-side-effect-tip {
  color: #fcd34d;
}

.dark .settings-side-effect-tip-popover {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(31, 31, 31, 0.96);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.28);
  color: rgba(255, 255, 255, 0.92);
}

.dark .settings-action-button--disabled {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.45);
}
</style>
