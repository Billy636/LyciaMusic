<template>
  <div class="settings-content">
    <div class="setting-item-group">
      <button
        type="button"
        class="drop-zone"
        :disabled="isScanning"
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

      <div v-if="libraryFolders.length > 0" class="library-list">
        <div v-for="folder in libraryFolders" :key="folder.path" class="library-item">
          <div class="folder-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <div class="folder-info">
            <div class="folder-path" :title="folder.path">{{ folder.path }}</div>
            <div class="folder-stats">{{ folder.song_count }} 首歌曲</div>
          </div>
          <button class="remove-btn" title="移除文件夹" @click="requestRemove(folder.path)">
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
    </div>

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
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { open } from '@tauri-apps/plugin-dialog';
import { usePlayer } from '../../composables/player';
import { useLibraryStore } from '../../features/library/store';
import {
  normalizeLibraryMinDurationSeconds,
  useSettingsStore,
} from '../../features/settings/store';
import ConfirmModal from '../overlays/ConfirmModal.vue';

const { addLibraryFolderLinked, removeLibraryFolderLinked } = usePlayer();
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

const handleAddLibraryFolder = async () => {
  if (isScanning.value) return;

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

.library-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
}

.short-audio-filter {
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

.short-audio-copy {
  min-width: 0;
}

.short-audio-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 3px;
}

.short-audio-desc {
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
