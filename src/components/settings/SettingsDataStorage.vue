<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { appApi } from '../../services/tauri/appApi';
import type { DataStorageInfo } from '../../services/tauri/contracts';
import { useToast } from '../../composables/toast';
import ConfirmModal from '../overlays/ConfirmModal.vue';

defineProps<{ busy: boolean }>();
const { showToast } = useToast();
const info = ref<DataStorageInfo | null>(null);
const loading = ref(false);
const saving = ref(false);
const restarting = ref(false);
const error = ref('');
const selectedPath = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    info.value = await appApi.getDataStorageInfo();
  } catch (cause) {
    error.value = `读取数据目录失败：${String(cause)}`;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function chooseDirectory() {
  try {
    const path = await open({ directory: true, multiple: false, title: '选择空文件夹存放应用数据' });
    if (typeof path === 'string') selectedPath.value = path;
  } catch (cause) {
    showToast(`选择目录失败：${String(cause)}`, 'error');
  }
}

async function save() {
  if (saving.value || !selectedPath.value) return;
  saving.value = true;
  try {
    info.value = await appApi.setDataStorageDirectory(selectedPath.value);
    selectedPath.value = '';
    showToast('数据目录已设置，下次启动时将迁移现有数据', 'success');
  } catch (cause) {
    selectedPath.value = '';
    showToast(`设置数据目录失败：${String(cause)}`, 'error');
  } finally {
    saving.value = false;
  }
}

async function cancelMigration() {
  saving.value = true;
  try {
    info.value = await appApi.cancelDataStorageMigration();
    showToast('已取消迁移，继续使用当前数据目录', 'info');
  } catch (cause) {
    showToast(`取消迁移失败：${String(cause)}`, 'error');
  } finally {
    saving.value = false;
  }
}

async function restart() {
  if (restarting.value) return;
  restarting.value = true;
  try {
    await appApi.restartApp();
  } catch (cause) {
    restarting.value = false;
    showToast(`重启失败，请手动退出后重新打开：${String(cause)}`, 'error');
  }
}
</script>

<template>
  <div class="border-b border-[var(--settings-divider)] p-4 space-y-3">
    <div class="flex items-center justify-between gap-4">
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium text-gray-800 dark:text-gray-200">数据存放位置</div>
        <p v-if="loading" class="mt-1 text-xs app-text-secondary">正在读取数据目录…</p>
        <p v-else-if="info" class="mt-1 break-all text-xs app-text-secondary select-text">{{ info.path }}</p>
      </div>
      <button
        type="button"
        class="storage-button shrink-0"
        :disabled="!info || loading || saving || restarting || busy"
        @click="chooseDirectory"
      >更改目录</button>
    </div>
    <div v-if="error" role="alert" class="text-xs text-red-500">
      {{ error }} <button type="button" class="ml-2 underline" @click="load">重试</button>
    </div>
    <p v-if="info?.warning" role="alert" class="text-xs leading-relaxed text-amber-600 dark:text-amber-400">{{ info.warning }}</p>
    <div v-if="info?.pendingPath" class="rounded-lg bg-black/[0.03] p-3 space-y-2 dark:bg-white/5" aria-live="polite">
      <p class="text-xs app-text-secondary">下次启动时迁移到：</p>
      <p class="break-all text-xs app-text-secondary select-text">{{ info.pendingPath }}</p>
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" class="storage-button" :disabled="saving || restarting || busy" @click="restart">{{ restarting ? '正在重启…' : '立即重启并迁移' }}</button>
        <button type="button" class="storage-button" :disabled="saving || restarting" @click="cancelMigration">取消迁移</button>
        <span v-if="busy" class="text-xs app-text-secondary">请等待扫描或数据操作完成后重启</span>
      </div>
    </div>
    <ConfirmModal
      :visible="!!selectedPath"
      title="更改数据存放位置"
      :content="`将数据迁移到 ${selectedPath}，重启后生效。迁移成功后会清理原目录，是否继续？`"
      @cancel="!saving && (selectedPath = '')"
      @confirm="save"
    />
  </div>
</template>

<style scoped>
.storage-button {
  min-height: 38px;
  padding: 0 16px;
  border: 1px solid rgba(236, 65, 65, 0.14);
  border-radius: 999px;
  background: rgba(236, 65, 65, 0.06);
  color: #ec4141;
  font-size: 12px;
  font-weight: 600;
}
.storage-button:hover:not(:disabled) { background: rgba(236, 65, 65, 0.1); }
.storage-button:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
