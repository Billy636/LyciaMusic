<script setup lang="ts">
import { computed, onMounted, onScopeDispose, reactive, ref } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useToast } from '../../composables/toast';
import { remoteLibraryApi } from '../../services/tauri/remoteLibraryApi';
import type { RemoteCacheUsage, RemoteFileEntry, RemoteSource, RemoteSyncProgress } from '../../types';
import { useLibraryRuntimeActions } from '../../features/library/useLibraryRuntimeActions';
import ConfirmModal from '../overlays/ConfirmModal.vue';

const { showToast } = useToast();
const { loadLibrarySongsFromCache } = useLibraryRuntimeActions();
const remoteSources = ref<RemoteSource[]>([]);
const isLoading = ref(false);
const isSaving = ref(false);
const testing = ref(false);
const syncingSourceId = ref<string | null>(null);
const sourceToRemove = ref<RemoteSource | null>(null);
const syncProgress = ref<RemoteSyncProgress | null>(null);
const cacheUsage = ref<RemoteCacheUsage | null>(null);
const isClearingCache = ref(false);
const browsingSourceId = ref<string | null>(null);
const browsingPath = ref('/');
const browserEntries = ref<RemoteFileEntry[]>([]);
const isBrowsing = ref(false);
const currentView = ref<'list' | 'form'>('list');
let unlistenRemoteSync: UnlistenFn | null = null;

const form = reactive({
  id: '',
  name: '',
  baseUrl: '',
  username: '',
  password: '',
  rootPath: '/',
});

const resetForm = () => {
  form.id = '';
  form.name = '';
  form.baseUrl = '';
  form.username = '';
  form.password = '';
  form.rootPath = '/';
};

const openAddForm = () => {
  resetForm();
  currentView.value = 'form';
};

const closeForm = () => {
  resetForm();
  currentView.value = 'list';
};

const buildPayload = () => ({
  id: form.id || undefined,
  name: form.name.trim(),
  provider: 'webdav' as const,
  baseUrl: form.baseUrl.trim(),
  username: form.username.trim() || null,
  password: form.password || null,
  rootPath: form.rootPath.trim() || '/',
});

const syncPercent = computed(() => {
  const progress = syncProgress.value;
  if (!progress || progress.total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((progress.current / progress.total) * 100)));
});

const syncProgressText = computed(() => {
  const progress = syncProgress.value;
  if (!progress) return '';
  if (progress.total <= 0) return progress.message;
  return `${progress.message} ${progress.current}/${progress.total}`;
});

const cacheUsageText = computed(() => {
  const usage = cacheUsage.value;
  if (!usage) return '0 MB';
  return `${(usage.bytes / 1024 / 1024).toFixed(1)} MB / ${(usage.limitBytes / 1024 / 1024 / 1024).toFixed(0)} GB`;
});

const sortedBrowserEntries = computed(() =>
  [...browserEntries.value].sort((left, right) => {
    if (left.isDir !== right.isDir) return left.isDir ? -1 : 1;
    return left.name.localeCompare(right.name, 'zh-Hans-CN');
  }),
);

const loadSources = async () => {
  isLoading.value = true;
  try {
    remoteSources.value = await remoteLibraryApi.getRemoteSources();
  } catch (error) {
    console.error('Failed to load remote sources:', error);
    showToast('加载远程音乐库失败', 'error');
  } finally {
    isLoading.value = false;
  }
};

const loadCacheUsage = async () => {
  cacheUsage.value = await remoteLibraryApi.getRemoteCacheUsage();
};

const clearRemoteCache = async () => {
  isClearingCache.value = true;
  try {
    cacheUsage.value = await remoteLibraryApi.clearRemoteCache();
    showToast('远程缓存已清理', 'success');
  } catch (error) {
    console.error('Failed to clear remote cache:', error);
    showToast('清理远程缓存失败', 'error');
  } finally {
    isClearingCache.value = false;
  }
};

const browseSource = async (source: RemoteSource, path = source.rootPath || '/') => {
  browsingSourceId.value = source.id;
  browsingPath.value = path;
  isBrowsing.value = true;
  try {
    browserEntries.value = await remoteLibraryApi.listRemoteDirectory(source.id, path);
  } catch (error) {
    console.error('Failed to browse remote source:', error);
    browserEntries.value = [];
    showToast('读取远程目录失败', 'error');
  } finally {
    isBrowsing.value = false;
  }
};

const browseParent = async () => {
  const source = remoteSources.value.find(item => item.id === browsingSourceId.value);
  if (!source) return;
  const parent = browsingPath.value.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/';
  await browseSource(source, parent);
};

const testConnection = async () => {
  testing.value = true;
  try {
    const result = await remoteLibraryApi.testRemoteSource(buildPayload());
    showToast(result.message, result.ok ? 'success' : 'error');
  } catch (error) {
    console.error('Failed to test remote source:', error);
    showToast('连接测试失败', 'error');
  } finally {
    testing.value = false;
  }
};

const saveSource = async () => {
  if (!form.name.trim() || !form.baseUrl.trim()) {
    showToast('名称和服务器地址不能为空', 'error');
    return;
  }

  isSaving.value = true;
  try {
    if (form.id) {
      await remoteLibraryApi.updateRemoteSource(buildPayload());
    } else {
      await remoteLibraryApi.addRemoteSource(buildPayload());
    }
    resetForm();
    await loadSources();
    showToast('远程音乐库已保存', 'success');
    currentView.value = 'list';
  } catch (error) {
    console.error('Failed to save remote source:', error);
    showToast('保存远程音乐库失败', 'error');
  } finally {
    isSaving.value = false;
  }
};

const editSource = (source: RemoteSource) => {
  form.id = source.id;
  form.name = source.name;
  form.baseUrl = source.baseUrl;
  form.username = source.username ?? '';
  form.password = '';
  form.rootPath = source.rootPath || '/';
  currentView.value = 'form';
};

const syncSource = async (source: RemoteSource) => {
  syncingSourceId.value = source.id;
  syncProgress.value = {
    sourceId: source.id,
    phase: 'scanning',
    current: 0,
    total: 0,
    message: '正在读取远程目录',
    done: false,
    failed: false,
  };
  try {
    const result = await remoteLibraryApi.syncRemoteSource(source.id);
    await loadLibrarySongsFromCache();
    await loadSources();
    showToast(`已同步 ${result.audioFiles} 首远程歌曲`, 'success');
  } catch (error) {
    console.error('Failed to sync remote source:', error);
    await loadSources();
    showToast('同步远程音乐库失败', 'error');
  } finally {
    syncingSourceId.value = null;
  }
};

const confirmRemoveSource = async () => {
  if (!sourceToRemove.value) return;

  try {
    await remoteLibraryApi.removeRemoteSource(sourceToRemove.value.id);
    sourceToRemove.value = null;
    await loadSources();
    showToast('远程音乐库已删除', 'success');
  } catch (error) {
    console.error('Failed to remove remote source:', error);
    showToast('删除远程音乐库失败', 'error');
  }
};

onMounted(async () => {
  await Promise.all([loadSources(), loadCacheUsage()]);
  unlistenRemoteSync = await listen<RemoteSyncProgress>('remote-sync-progress', event => {
    syncProgress.value = event.payload;
    if (event.payload.done) {
      syncingSourceId.value = null;
    }
  });
});

onScopeDispose(() => {
  unlistenRemoteSync?.();
  unlistenRemoteSync = null;
});
</script>

<template>
  <div class="w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <template v-if="currentView === 'list'">
      <section class="space-y-3">
        <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
          <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
          添加远程音乐库
        </h2>
        <button
          type="button"
          class="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600/50 bg-transparent py-5 text-sm font-bold app-text-secondary hover:border-[#EC4141] hover:text-[#EC4141] hover:bg-[#EC4141]/5 transition-all duration-200"
          @click="openAddForm"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          添加 WebDAV 音乐库
        </button>
      </section>

      <section class="space-y-3">
        <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
          <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
          已添加
        </h2>

        <div class="remote-source-list">
          <div v-if="isLoading" class="remote-empty">加载中...</div>
          <div v-else-if="remoteSources.length === 0" class="remote-empty">还没有远程音乐库</div>
          <template v-else>
            <div v-for="source in remoteSources" :key="source.id" class="remote-source-row">
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-semibold text-gray-900 dark:text-white">{{ source.name }}</div>
                <div class="mt-1 truncate text-xs text-gray-600 dark:text-white/55">{{ source.baseUrl }}{{ source.rootPath }}</div>
                <div v-if="source.lastSyncError" class="mt-1 text-xs text-[#EC4141]">{{ source.lastSyncError }}</div>
                <div v-if="syncProgress?.sourceId === source.id && !syncProgress.done" class="remote-progress">
                  <div class="remote-progress__top">
                    <span>{{ syncProgressText }}</span>
                    <span v-if="syncProgress.total > 0">{{ syncPercent }}%</span>
                  </div>
                  <div class="remote-progress__track">
                    <div class="remote-progress__fill" :style="{ width: `${syncPercent}%` }"></div>
                  </div>
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <button type="button" class="remote-icon-action" title="编辑" @click="editSource(source)">
                  编辑
                </button>
                <button
                  type="button"
                  class="remote-icon-action"
                  :disabled="syncingSourceId === source.id"
                  title="同步"
                  @click="syncSource(source)"
                >
                  {{ syncingSourceId === source.id ? '同步中' : '同步' }}
                </button>
                <button type="button" class="remote-icon-action" title="浏览" @click="browseSource(source)">
                  浏览
                </button>
                <button type="button" class="remote-icon-action remote-icon-action--danger" title="删除" @click="sourceToRemove = source">
                  删除
                </button>
              </div>
            </div>
          </template>
        </div>
      </section>

      <section class="space-y-3">
        <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
          <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
          远程缓存
        </h2>
        <div class="remote-cache-row">
          <span>{{ cacheUsageText }}</span>
          <button type="button" class="remote-action remote-action--soft" :disabled="isClearingCache" @click="clearRemoteCache">
            {{ isClearingCache ? '清理中...' : '清理缓存' }}
          </button>
        </div>
      </section>

      <section v-if="browsingSourceId" class="space-y-3">
        <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
          <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
          远程目录
        </h2>
        <div class="remote-browser">
          <div class="remote-browser__bar">
            <button type="button" class="remote-icon-action" :disabled="browsingPath === '/' || isBrowsing" @click="browseParent">上级</button>
            <span class="truncate">{{ browsingPath }}</span>
          </div>
          <div v-if="isBrowsing" class="remote-empty">读取中...</div>
          <div v-else-if="sortedBrowserEntries.length === 0" class="remote-empty">当前目录为空</div>
          <template v-else>
            <button
              v-for="entry in sortedBrowserEntries"
              :key="entry.remotePath"
              type="button"
              class="remote-browser__entry"
              :disabled="!entry.isDir"
              @click="entry.isDir && browseSource(remoteSources.find(item => item.id === browsingSourceId)!, entry.remotePath)"
            >
              <span>{{ entry.isDir ? '文件夹' : '音频' }}</span>
              <strong class="truncate">{{ entry.name }}</strong>
            </button>
          </template>
        </div>
      </section>
    </template>

    <template v-else>
      <section class="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
        <div class="flex items-center gap-3 mb-2">
          <button type="button" class="p-2 -ml-2 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 rounded-full transition-colors" @click="closeForm">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
          </button>
          <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200">
            {{ form.id ? '编辑 WebDAV 音乐库' : '添加 WebDAV 音乐库' }}
          </h2>
        </div>

        <div class="remote-panel">
          <div class="remote-form-grid">
            <label class="remote-field">
              <span>名称</span>
              <input v-model="form.name" type="text" class="remote-input" placeholder="我的 WebDAV" />
            </label>
            <label class="remote-field">
              <span>服务器地址</span>
              <input v-model="form.baseUrl" type="url" class="remote-input" placeholder="https://example.com/dav" />
            </label>
            <label class="remote-field">
              <span>用户名</span>
              <input v-model="form.username" type="text" class="remote-input" autocomplete="username" />
            </label>
            <label class="remote-field">
              <span>密码</span>
              <input v-model="form.password" type="password" class="remote-input" autocomplete="current-password" />
            </label>
            <label class="remote-field">
              <span>根目录</span>
              <input v-model="form.rootPath" type="text" class="remote-input" placeholder="/" />
            </label>
          </div>

          <div class="mt-6 flex flex-wrap items-center justify-end gap-3">
            <button type="button" class="remote-action remote-action--soft" @click="closeForm">
              取消
            </button>
            <button type="button" class="remote-action remote-action--soft" :disabled="testing" @click="testConnection">
              {{ testing ? '测试中...' : '测试连接' }}
            </button>
            <button type="button" class="remote-action" :disabled="isSaving" @click="saveSource">
              {{ isSaving ? '保存中...' : '保存' }}
            </button>
          </div>
        </div>
      </section>
    </template>

    <ConfirmModal
      :visible="!!sourceToRemove"
      title="删除远程音乐库"
      :content="`确定要删除“${sourceToRemove?.name ?? ''}”吗？远程歌曲索引会从音乐库中移除。`"
      @confirm="confirmRemoveSource"
      @cancel="sourceToRemove = null"
    />
  </div>
</template>

<style scoped>
.remote-source-list,
.remote-cache-row,
.remote-browser,
.remote-panel {
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.28);
  padding: 16px;
}

.remote-cache-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  color: rgb(31 41 55);
  font-size: 13px;
  font-weight: 700;
}

.remote-form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
}

.remote-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
  font-size: 12px;
  font-weight: 600;
  color: rgb(55 65 81);
}

.remote-input {
  min-height: 40px;
  border: 1px solid rgba(255, 255, 255, 0.34);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.36);
  padding: 9px 12px;
  color: rgb(31 41 55);
  font-size: 13px;
  font-weight: 500;
  outline: none;
}

.remote-input:focus {
  border-color: rgba(236, 65, 65, 0.34);
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.08);
}

.remote-action,
.remote-icon-action {
  min-height: 36px;
  border: 1px solid rgba(236, 65, 65, 0.18);
  border-radius: 999px;
  background: rgba(236, 65, 65, 0.95);
  color: white;
  font-size: 12px;
  font-weight: 700;
  padding: 0 15px;
}

.remote-action--soft,
.remote-icon-action {
  background: rgba(236, 65, 65, 0.07);
  color: #ec4141;
}

.remote-action:disabled,
.remote-icon-action:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.remote-source-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.remote-source-row {
  display: flex;
  align-items: center;
  gap: 16px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.06);
  padding: 14px 16px;
}

.remote-icon-action--danger {
  border-color: rgba(236, 65, 65, 0.18);
  color: #ec4141;
}

.remote-progress {
  margin-top: 10px;
  max-width: 460px;
}

.remote-progress__top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: rgb(75 85 99);
  font-size: 12px;
  font-weight: 600;
}

.remote-progress__track {
  margin-top: 6px;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.28);
}

.remote-progress__fill {
  height: 100%;
  border-radius: inherit;
  background: #ec4141;
  transition: width 160ms ease;
}

.remote-empty {
  border-radius: 12px;
  padding: 24px;
  text-align: center;
  color: rgb(100 116 139);
  font-size: 13px;
}

.remote-browser {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.remote-browser__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  color: rgb(55 65 81);
  font-size: 12px;
  font-weight: 700;
}

.remote-browser__entry {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  border-radius: 10px;
  padding: 10px 12px;
  text-align: left;
  color: rgb(31 41 55);
  background: rgba(0, 0, 0, 0.05);
}

.remote-browser__entry:disabled {
  cursor: default;
  opacity: 0.72;
}

.remote-browser__entry span {
  color: #ec4141;
  font-size: 11px;
  font-weight: 800;
}

.remote-browser__entry strong {
  font-size: 13px;
  font-weight: 700;
}

.dark .remote-source-list,
.dark .remote-cache-row,
.dark .remote-browser,
.dark .remote-panel {
  background: rgba(255, 255, 255, 0.04);
}

.dark .remote-field {
  color: rgba(255, 255, 255, 0.72);
}

.dark .remote-input {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.92);
}

.dark .remote-source-row {
  background: rgba(255, 255, 255, 0.06);
}

.dark .remote-cache-row,
.dark .remote-browser__bar,
.dark .remote-browser__entry {
  color: rgba(255, 255, 255, 0.86);
}

.dark .remote-browser__entry {
  background: rgba(255, 255, 255, 0.06);
}

.dark .remote-progress__top {
  color: rgba(255, 255, 255, 0.7);
}
</style>
