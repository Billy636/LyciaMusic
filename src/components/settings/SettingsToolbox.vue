<script setup lang="ts">
import { onMounted } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { useToast } from '../../composables/toast';
import { useSettingsStore } from '../../features/settings/store';
import { useToolboxStore } from '../../features/toolbox/store';
import ToolboxActionBar from './ToolboxActionBar.vue';
import ToolboxFileTable from './ToolboxFileTable.vue';
import ToolboxRulesPanel from './ToolboxRulesPanel.vue';
import ToolboxTemplatePanel from './ToolboxTemplatePanel.vue';

const toast = useToast();
const settingsStore = useSettingsStore();
const store = useToolboxStore();

onMounted(() => {
  // 恢复上次会话：已有目标文件夹时立即刷新预览
  if (store.hasTarget) {
    void store.refreshPreview();
  }
});

const pathLeaf = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

const selectTargetFolder = async () => {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择要整理的目标文件夹',
    });

    if (selected && typeof selected === 'string') {
      store.setTargetPath(selected);
    }
  } catch (error) {
    console.error(error);
    toast.showToast(`选择文件夹失败: ${error}`, 'error');
  }
};

const launchMusicTag = async () => {
  const launched = await store.launchMusicTagForTarget();
  if (launched) {
    toast.showToast('MusicTag 已启动，获取标签并保存后回到这里重新扫描', 'success');
  }
};

const handleApply = async () => {
  const result = await store.applySelected(settingsStore.settings.libraryMinDurationSeconds);

  if (!result) {
    return;
  }

  if (result.failures.length > 0) {
    toast.showToast(`成功 ${result.success_count} 项，失败 ${result.failures.length} 项，详见列表标记`, 'error');
    return;
  }

  toast.showToast(`成功重命名 ${result.success_count} 个文件`, 'success');

  if (store.autoRefresh && !store.libraryRefreshed) {
    toast.showToast('音乐库刷新失败，可在音乐库设置中手动重新扫描', 'error');
  }
};

const handleReset = () => {
  store.resetWorkbench();
  toast.showToast('已重置，可以整理下一个文件夹', 'info');
};
</script>

<template>
  <div class="toolbox-enter w-full space-y-6 pb-10">
    <!-- 标题说明 -->
    <section class="w-full px-5 pt-1">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        歌曲文件整理
      </h2>
      <p class="mt-2 text-xs leading-6 text-gray-400 dark:text-white/50">
        选择下载目录，勾选清理规则和命名模板，预览确认后一键应用。缺标签的文件可以用 MusicTag 在线获取标签。
      </p>
    </section>

    <!-- 顶部配置：目标文件夹 + MusicTag -->
    <section class="mx-5">
      <div
        class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-white/40 py-4 dark:border-white/5"
      >
        <div class="min-w-0">
          <h3 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
            <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
            目标文件夹
          </h3>
          <p
            class="mt-1 truncate pl-3 text-xs text-gray-400 dark:text-white/50"
            :title="store.targetPath"
          >
            {{ store.hasTarget ? store.targetPath : '尚未选择，选择后自动扫描' }}
          </p>
        </div>
        <div class="flex items-center gap-3">
          <span
            v-if="store.hasTarget"
            class="rounded-full bg-black/5 px-2.5 py-1 text-xs text-gray-500 dark:bg-white/10 dark:text-gray-300"
          >
            {{ pathLeaf(store.targetPath) }}
          </span>
          <button
            type="button"
            class="rounded-lg border border-gray-200/80 bg-white/45 px-4 py-2 text-xs text-gray-600 transition hover:border-[#EC4141] hover:text-[#EC4141] dark:border-white/10 dark:bg-white/[0.06] dark:text-gray-300"
            @click="selectTargetFolder"
          >
            {{ store.hasTarget ? '更换文件夹' : '选择文件夹' }}
          </button>
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4">
        <div class="min-w-0">
          <h3 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
            <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
            MusicTag 获取标签
          </h3>
          <div class="mt-1 pl-3 text-xs text-gray-400 dark:text-white/50">
            <template v-if="store.missingTagCount > 0">
              {{ store.missingTagCount }} 个文件缺标签，重命名只能套用清理规则
            </template>
            <template v-else> 使用外部软件 MusicTag 获取标签信息，需自行下载。 </template>
          </div>
        </div>
        <button
          type="button"
          class="flex items-center gap-2 rounded-lg border border-gray-200/80 bg-white/45 px-4 py-2 text-xs text-gray-600 transition hover:border-[#EC4141] hover:text-[#EC4141] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.06] dark:text-gray-300"
          :disabled="!store.hasTarget"
          @click="launchMusicTag"
        >
          <span
            class="h-1.5 w-1.5 rounded-full"
            :class="store.musicTagConfigured ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-white/30'"
          ></span>
          {{
            store.missingTagCount > 0
              ? `用 MusicTag 获取标签 (${store.missingTagCount})`
              : '用 MusicTag 获取标签'
          }}
        </button>
      </div>
    </section>

    <!-- 工作台主体：左侧配置 / 右侧预览 -->
    <div class="grid items-start gap-x-8 gap-y-6 px-5 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div class="space-y-8 lg:sticky lg:top-4">
        <ToolboxRulesPanel />
        <ToolboxTemplatePanel />
      </div>

      <div class="min-w-0 space-y-4">
        <ToolboxFileTable />
        <ToolboxActionBar @apply="handleApply" @reset="handleReset" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbox-enter {
  animation: toolbox-enter 0.3s ease-out;
}

@keyframes toolbox-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
