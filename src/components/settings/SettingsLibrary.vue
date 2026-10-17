<template>
  <div class="settings-content">
    <div class="setting-item-group">
      <button
        type="button"
        class="drop-zone"
        :disabled="isScanning || scanSettingsBusy"
        @click="handleAddLibraryFolder"
      >
        <div class="drop-zone-inner">
          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="drop-zone-icon">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            <line x1="12" y1="11" x2="12" y2="17"/>
            <polyline points="9 14 12 11 15 14"/>
          </svg>

          <template v-if="libraryFolders.length === 0">
            <p class="drop-zone-text highlight">点击导入文件夹，或拖入音频文件/文件夹</p>
          </template>

          <template v-else>
            <p class="drop-zone-text">点击导入文件夹，或拖入音频文件/文件夹</p>
          </template>
        </div>
      </button>

      <div class="short-audio-filter">
        <div class="short-audio-copy">
          <div class="short-audio-title">排除短音频</div>
          <div class="short-audio-desc">低于指定秒数的音频不会加入音乐库，0 表示关闭。</div>
        </div>
        <label class="short-audio-input-wrap">
          <input
            v-model.number="libraryMinDurationSeconds"
            class="short-audio-input"
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
          />
          <span>秒</span>
        </label>
      </div>

      <div class="folder-scope-setting">
        <div class="folder-scope-copy">
          <div id="folder-scope-label" class="folder-scope-title">包含子文件夹歌曲</div>
          <div id="folder-scope-description" class="folder-scope-desc">浏览文件夹时，同时显示其所有子文件夹中的歌曲。顶部根目录不受影响。</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-labelledby="folder-scope-label"
          aria-describedby="folder-scope-description"
          :aria-checked="settings.folderIncludeSubfolders"
          @click="settings.folderIncludeSubfolders = !settings.folderIncludeSubfolders"
          class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#EC4141]"
          :class="settings.folderIncludeSubfolders ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
        >
          <span
            aria-hidden="true"
            class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
            :class="settings.folderIncludeSubfolders ? 'translate-x-6' : 'translate-x-1'"
          />
        </button>
      </div>

      <div v-if="libraryFolders.length > 0" class="library-list">
        <div v-for="folder in libraryFolders" :key="folder.path" class="library-item">
          <div class="folder-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <div class="folder-info">
            <div class="folder-path" :title="folder.path">{{ folder.path }}</div>
            <div v-if="folder.locked" class="folder-stats" title="目录或网络共享暂时不可访问，已有歌曲记录已保留">暂不可访问</div>
            <div v-else class="folder-stats">{{ folder.song_count }} 首歌曲</div>
          </div>
          <button type="button" class="scan-settings-trigger" :disabled="isScanning || scanSettingsBusy" @click="openScanSettings(folder.path)"><SlidersHorizontal :size="15" aria-hidden="true" /><span>扫描设置</span></button>
          <button type="button" class="remove-btn" title="移除文件夹" @click="requestRemove(folder.path)">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              <line x1="10" y1="11" x2="10" y2="17"/>
              <line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
          </button>
        </div>
      </div>

      <div v-if="isScanning && libraryScanProgress" class="scan-status-card">
        <div class="scan-status-header">
          <div class="scan-status-title">{{ scanStatusLabel }}</div>
          <div class="scan-status-count" v-if="libraryScanProgress.total > 0">
            {{ libraryScanProgress.current }}/{{ libraryScanProgress.total }}
          </div>
        </div>
        <div class="scan-status-bar">
          <div
            class="scan-status-bar-fill"
            :class="{ indeterminate: libraryScanProgress.total <= 0 }"
            :style="{ width: `${libraryScanProgress.total > 0 ? Math.min(100, Math.max(8, (libraryScanProgress.current / libraryScanProgress.total) * 100)) : 24}%` }"
          ></div>
        </div>
        <div v-if="libraryScanProgress.folder_path" class="scan-status-path" :title="libraryScanProgress.folder_path">
          {{ libraryScanProgress.folder_path }}
        </div>
      </div>

      <div v-else-if="lastLibraryScanError" class="scan-error-card">
        <div class="scan-error-title">上次扫描失败</div>
        <div class="scan-error-text">{{ lastLibraryScanError }}</div>
      </div>

      <div v-if="!isScanning && libraryScanProgress?.done && !libraryScanProgress.failed && libraryScanProgress.warnings?.length" class="scan-warning-card" role="status">
        <div class="scan-status-title">扫描已完成</div>
        <ul class="scan-warning-list"><li v-for="warning in libraryScanProgress.warnings" :key="warning">{{ warning }}</li></ul>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="scanSettingsPath" class="scan-dialog-backdrop" @click.self="closeScanSettings()">
        <section ref="scanDialog" role="dialog" aria-modal="true" :aria-labelledby="scanDialogTitleId" :aria-busy="scanSettingsBusy || scanSettingsLoading" class="scan-dialog">
          <header class="scan-dialog-heading"><h2 :id="scanDialogTitleId"><span aria-hidden="true"></span>扫描设置</h2><button ref="scanDialogCloseButton" type="button" :disabled="scanSettingsBusy" aria-label="关闭扫描设置" @click="closeScanSettings()"><X :size="18" aria-hidden="true" /></button></header>
          <div class="scan-dialog-scroll custom-scrollbar">
            <div class="scan-dialog-source"><Folder :size="23" aria-hidden="true" /><div><div class="scan-dialog-path" :title="scanSettingsPath">{{ scanSettingsPath }}</div><div class="scan-dialog-context">此音乐库的扫描范围</div></div></div>
            <div v-if="scanSettingsLoading" class="scan-dialog-loading" role="status"><LoaderCircle :size="18" class="animate-spin" aria-hidden="true" />加载中…</div>
            <LibraryScanOptions v-else-if="!scanSettingsLoadFailed" v-model="scanSettingsDraft" :source="{ kind: 'local', path: scanSettingsPath }" :root-path="scanSettingsPath" :disabled="scanSettingsBusy" />
            <p v-if="scanSettingsError" class="scan-dialog-error" role="alert">{{ scanSettingsError }}</p>
          </div>
          <footer class="scan-dialog-actions"><button type="button" class="scan-dialog-cancel" :disabled="scanSettingsBusy" @click="closeScanSettings()">取消</button><button type="button" class="scan-dialog-save" :disabled="scanSettingsBusy || scanSettingsLoading || scanSettingsLoadFailed || !hasLibraryScanFormats(scanSettingsDraft, 'local')" @click="saveScanSettings">{{ scanSettingsBusy ? '处理中…' : '保存并重新扫描' }}</button></footer>
        </section>
      </div>
    </Teleport>

    <ConfirmModal
      :visible="showConfirm"
      title="移除文件夹"
      :content="confirmContent"
      @confirm="confirmRemove"
      @cancel="showConfirm = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useId } from 'vue';
import { storeToRefs } from 'pinia';
import { open } from '@tauri-apps/plugin-dialog';
import { Folder, LoaderCircle, SlidersHorizontal, X } from 'lucide-vue-next';
import { usePlayer } from '../../composables/player';
import { useLibraryStore } from '../../features/library/store';
import { useLibraryRuntimeActions } from '../../features/library/useLibraryRuntimeActions';
import { libraryApi } from '../../services/tauri/libraryApi';
import type { LibraryScanSettings } from '../../types';
import { useToast } from '../../composables/toast';
import {
  normalizeLibraryMinDurationSeconds,
  useSettingsStore,
} from '../../features/settings/store';
import ConfirmModal from '../overlays/ConfirmModal.vue';
import LibraryScanOptions from './LibraryScanOptions.vue';
import { copyLibraryScanSettings, defaultLibraryScanSettings, hasLibraryScanFormats } from './libraryScanOptions';

const { addLibraryFolderLinked, removeLibraryFolderLinked } = usePlayer();
const { scanLibrary } = useLibraryRuntimeActions();
const { showToast } = useToast();
const libraryStore = useLibraryStore();
const settingsStore = useSettingsStore();
const { libraryFolders, libraryScanProgress, lastLibraryScanError } = storeToRefs(libraryStore);
const { settings } = storeToRefs(settingsStore);
const isScanning = computed(() =>
  !!libraryScanProgress.value && !libraryScanProgress.value.done && !libraryScanProgress.value.failed
);
const libraryMinDurationSeconds = computed({
  get: () => settings.value.libraryMinDurationSeconds,
  set: value => {
    settings.value.libraryMinDurationSeconds = normalizeLibraryMinDurationSeconds(value);
  },
});
const scanStatusLabel = computed(() => {
  switch (libraryScanProgress.value?.phase) {
    case 'collecting':
      return '正在扫描文件';
    case 'parsing':
      return '正在解析歌曲信息';
    case 'writing':
      return '正在写入音乐库';
    case 'complete':
      return '扫描完成';
    case 'error':
      return '扫描失败';
    default:
      return '等待扫描';
  }
});
const showConfirm = ref(false);
const folderToRemove = ref('');
const confirmContent = ref('');
const scanSettingsPath = ref('');
const scanSettingsDraft = ref<LibraryScanSettings>(defaultLibraryScanSettings('local'));
const scanSettingsLoading = ref(false);
const scanSettingsLoadFailed = ref(false);
const scanSettingsBusy = ref(false);
const scanSettingsError = ref('');
const scanDialog = ref<HTMLElement | null>(null);
const scanDialogCloseButton = ref<HTMLButtonElement | null>(null);
const scanDialogTitleId = useId();
let scanSettingsRequest = 0;
let scanReturnFocus: HTMLElement | null = null;

const openScanSettings = async (path: string) => {
  if (isScanning.value || scanSettingsBusy.value) return;
  const request = ++scanSettingsRequest;
  scanReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  scanSettingsPath.value = path;
  scanSettingsDraft.value = defaultLibraryScanSettings('local');
  scanSettingsError.value = '';
  scanSettingsLoadFailed.value = false;
  scanSettingsLoading.value = true;
  await nextTick();
  scanDialogCloseButton.value?.focus();
  try {
    const result = await libraryApi.getLibraryScanSettings({ kind: 'local', path });
    if (request === scanSettingsRequest) scanSettingsDraft.value = copyLibraryScanSettings(result);
  } catch (error) {
    if (request === scanSettingsRequest) {
      scanSettingsLoadFailed.value = true;
      scanSettingsError.value = `加载扫描设置失败：${String(error)}`;
    }
  } finally {
    if (request === scanSettingsRequest) scanSettingsLoading.value = false;
  }
};

const closeScanSettings = (force = false) => {
  if (scanSettingsBusy.value && !force) return;
  scanSettingsRequest++;
  scanSettingsPath.value = '';
  if (scanReturnFocus?.isConnected) scanReturnFocus.focus();
  scanReturnFocus = null;
};

const saveScanSettings = async () => {
  const path = scanSettingsPath.value;
  if (!path || scanSettingsBusy.value || !hasLibraryScanFormats(scanSettingsDraft.value, 'local')) return;
  scanSettingsBusy.value = true;
  scanSettingsError.value = '';
  try {
    await libraryApi.setLibraryScanSettings({ kind: 'local', path }, copyLibraryScanSettings(scanSettingsDraft.value));
    closeScanSettings(true);
    await scanLibrary({ trigger: 'manual-rescan', visibility: 'inline', sourcePath: path });
    if (libraryStore.lastLibraryScanError || libraryStore.libraryScanProgress?.failed) {
      throw new Error(libraryStore.lastLibraryScanError || '扫描失败，请重新扫描');
    }
    showToast('扫描设置已保存', 'success');
  } catch (error) {
    const message = `保存或扫描失败：${String(error)}`;
    if (scanSettingsPath.value) scanSettingsError.value = message;
    else showToast(message, 'error');
  }
  finally { scanSettingsBusy.value = false; }
};

const handleScanSettingsKeydown = (event: KeyboardEvent) => {
  if (!scanSettingsPath.value) return;
  event.stopPropagation();
  if (event.key === 'Escape') { event.preventDefault(); closeScanSettings(); return; }
  if (event.key !== 'Tab') return;
  const controls = [...(scanDialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])]
    .filter(element => element.getClientRects().length > 0 && !element.closest('[inert]'));
  const first = controls[0], last = controls[controls.length - 1];
  if (!first || !last) { event.preventDefault(); return; }
  if (event.shiftKey && (document.activeElement === first || !scanDialog.value?.contains(document.activeElement))) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !scanDialog.value?.contains(document.activeElement))) {
    event.preventDefault(); first.focus();
  }
};
onMounted(() => window.addEventListener('keydown', handleScanSettingsKeydown, true));
onUnmounted(() => {
  scanSettingsRequest++;
  window.removeEventListener('keydown', handleScanSettingsKeydown, true);
  if (scanReturnFocus?.isConnected) scanReturnFocus.focus();
});

const handleAddLibraryFolder = async () => {
  if (isScanning.value || scanSettingsBusy.value) return;

  const selected = await open({ directory: true, multiple: false, title: '选择音乐文件夹' });
  if (selected && typeof selected === 'string') {
    const isFirstImport = libraryFolders.value.length === 0;
    await addLibraryFolderLinked(selected, {
      showToast: !isFirstImport,
      scanOptions: {
        trigger: isFirstImport ? 'first-import' : 'folder-add',
        visibility: isFirstImport ? 'hero' : 'silent',
        sourcePath: selected,
      },
    });
  }
};

const requestRemove = (path: string) => {
  folderToRemove.value = path;
  confirmContent.value = `确定要从音乐库中移除 "${path}" 吗？\n歌曲会从“本地音乐”视图中消失。`;
  showConfirm.value = true;
};

const confirmRemove = async () => {
  showConfirm.value = false;
  if (!folderToRemove.value) return;

  await removeLibraryFolderLinked(folderToRemove.value);
  folderToRemove.value = '';
};

</script>

<style scoped>
.settings-content {
  padding: 0 10px;
}

.setting-item-group {
  border-radius: 12px;
}

.drop-zone {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 20px;
  border: none;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.04);
  color: inherit;
  cursor: pointer;
  font: inherit;
  margin-bottom: 16px;
  transition: background 0.2s ease, transform 0.2s ease;
}

.drop-zone:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.07);
  transform: translateY(-1px);
}

.drop-zone:disabled {
  cursor: not-allowed;
  opacity: 0.62;
  transform: none;
}

.drop-zone-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 30px 0 20px;
}

.drop-zone-icon {
  color: var(--text-secondary);
  opacity: 0.5;
  margin-bottom: 12px;
}

.drop-zone-text {
  font-size: 0.95rem;
  color: var(--text-secondary);
  margin: 0;
  text-align: center;
}

.drop-zone-text.highlight {
  color: #ec4141;
  font-weight: 600;
  font-size: 1rem;
}

.scan-settings-trigger { display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0; border: 0; border-radius: 8px; background: transparent; color: var(--app-text-secondary); padding: 8px; font: inherit; font-size: 12px; cursor: pointer; }
.scan-settings-trigger:hover { background: rgb(236 65 65 / .07); color: #ec4141; }
.scan-settings-trigger:disabled { opacity: .5; cursor: not-allowed; }
.scan-warning-card { margin-top: 14px; border-radius: 12px; padding: 14px 16px; background: rgb(236 65 65 / .055); border: 1px solid rgb(236 65 65 / .14); }
.scan-warning-list { margin: 8px 0 0; padding-left: 18px; color: var(--app-text-secondary); font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
.scan-dialog-backdrop { position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgb(0 0 0 / .3); backdrop-filter: blur(6px); }
.scan-dialog { --app-text-secondary: #5b6473; --settings-divider: #e3e7ee; display: flex; flex-direction: column; width: min(100%, 600px); max-height: 85vh; overflow: hidden; border: 1px solid #e3e7ee; border-radius: 12px; background: #fafbfc; color: #29292f; color-scheme: light; box-shadow: 0 18px 60px rgb(0 0 0 / .2); }
.scan-dialog-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 25px 16px; }
.scan-dialog-heading h2 { display: flex; align-items: center; gap: 9px; margin: 0; font-size: 17px; font-weight: 500; }
.scan-dialog-heading h2 span { width: 4px; height: 16px; border-radius: 10px; background: #ec4141; }
.scan-dialog-heading button { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 5px; border: 0; border-radius: 6px; background: transparent; color: var(--app-text-secondary); cursor: pointer; }
.scan-dialog-heading button:hover { background: rgb(0 0 0 / .05); }
.scan-dialog-scroll { min-height: 0; overflow-y: auto; padding: 0 25px; }
.scan-dialog-source { display: flex; align-items: center; gap: 12px; margin-bottom: 19px; padding: 13px 15px; border-radius: 10px; background: rgb(0 0 0 / .035); }
.scan-dialog-source > svg { flex-shrink: 0; color: var(--app-text-secondary); }
.scan-dialog-source > div { min-width: 0; }
.scan-dialog-path { font-size: 14px; font-weight: 500; overflow-wrap: anywhere; }
.scan-dialog-context { color: var(--app-text-secondary); font-size: 12px; line-height: 1.65; }
.scan-dialog-loading { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 40px; color: var(--app-text-secondary); font-size: 13px; }
.scan-dialog-error { margin: 0 0 16px; color: #ec4141; font-size: 12px; overflow-wrap: anywhere; }
.scan-dialog-actions { display: flex; justify-content: flex-end; gap: 9px; border-top: 1px solid var(--settings-divider); padding: 15px 25px 21px; }
.scan-dialog-actions button { min-height: 35px; padding: 7px 17px; border: 1px solid rgb(148 163 184 / .24); border-radius: 8px; font: inherit; font-size: 12px; cursor: pointer; }
.scan-dialog-cancel { background: transparent; color: inherit; }
.scan-dialog-actions .scan-dialog-save { background: #ec4141; border-color: #ec4141; color: white; }
.scan-dialog button:disabled { opacity: .5; cursor: not-allowed; }
.scan-dialog button:focus-visible, .scan-settings-trigger:focus-visible { outline: 2px solid rgb(236 65 65 / .65); outline-offset: 3px; }
.dark .scan-dialog { --app-text-secondary: #b5bfce; --settings-divider: #3a3e48; border-color: #3a3e48; background: #24262d; color: #eeeeef; color-scheme: dark; }
.dark .scan-dialog-source { background: rgb(255 255 255 / .05); }
.dark .scan-dialog-heading button:hover { background: rgb(255 255 255 / .08); }
@media (max-width: 420px) { .scan-dialog-backdrop { padding: 12px; } .scan-dialog-heading { padding: 18px 17px; } .scan-dialog-scroll { padding: 0 17px; } .scan-dialog-actions { padding: 14px 17px 18px; } .library-item { flex-wrap: wrap; } }

.library-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
}

.short-audio-filter,
.folder-scope-setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 16px;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.short-audio-copy,
.folder-scope-copy {
  min-width: 0;
}

.short-audio-title,
.folder-scope-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 3px;
}

.short-audio-desc,
.folder-scope-desc {
  font-size: 0.78rem;
  color: var(--text-secondary);
  line-height: 1.4;
}

.short-audio-input-wrap {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.short-audio-input {
  width: 76px;
  height: 34px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.18);
  color: var(--text-primary);
  font: inherit;
  text-align: right;
  padding: 0 10px;
  outline: none;
}

.short-audio-input:focus {
  border-color: rgba(236, 65, 65, 0.62);
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.14);
}

.short-audio-input::-webkit-outer-spin-button,
.short-audio-input::-webkit-inner-spin-button {
  margin: 0;
  appearance: none;
}

.short-audio-input[type="number"] {
  appearance: textfield;
}

.library-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  transition: all 0.2s;
}

.library-item:hover {
  background: rgba(0, 0, 0, 0.3);
  border-color: rgba(255, 255, 255, 0.12);
}

.folder-icon {
  color: var(--text-secondary);
  opacity: 0.6;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.folder-info {
  flex: 1;
  min-width: 0;
}

.folder-path {
  font-size: 0.95rem;
  color: var(--text-primary);
  margin-bottom: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.folder-stats {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.remove-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 8px;
  border-radius: 8px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.remove-btn:hover {
  background: rgba(255, 0, 0, 0.12);
  color: #ff4d4f;
}

.scan-status-card,
.scan-error-card {
  margin-top: 14px;
  border-radius: 12px;
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.scan-status-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.scan-status-title,
.scan-error-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
}

.scan-status-count {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.scan-status-bar {
  margin-top: 10px;
  height: 8px;
  overflow: hidden;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.08);
}

.scan-status-bar-fill {
  height: 100%;
  border-radius: 9999px;
  background: linear-gradient(90deg, #ec4141, #ff7b63, #f7b267);
  transition: width 0.25s ease;
}

.scan-status-bar-fill.indeterminate {
  min-width: 24%;
  animation: scan-status-indeterminate 1.1s ease-in-out infinite alternate;
}

.scan-status-path,
.scan-error-text {
  margin-top: 10px;
  font-size: 0.82rem;
  color: var(--text-secondary);
  opacity: 0.82;
  word-break: break-all;
}

.scan-error-card {
  border-color: rgba(236, 65, 65, 0.22);
  background: rgba(236, 65, 65, 0.08);
}

@keyframes scan-status-indeterminate {
  from {
    transform: translateX(-16%);
  }

  to {
    transform: translateX(16%);
  }
}
</style>
