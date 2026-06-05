<script setup lang="ts">
import { ref, watch } from 'vue';
import { useToast } from '../../composables/toast';
import { useSettingsStore } from '../../features/settings/store';
import { libraryApi } from '../../services/tauri/libraryApi';

const toast = useToast();
const settingsStore = useSettingsStore();

const props = defineProps<{
  targetPath: string;
}>();

const emit = defineEmits<{
  (e: 'back'): void;
  (e: 'restart'): void;
  (e: 'close'): void;
  (e: 'preview-change', payload: {
    targetPath: string;
    isRefreshing: boolean;
    refreshed: boolean;
  }): void;
}>();

const isRefreshing = ref(false);
const refreshed = ref(false);

watch(
  [() => props.targetPath, isRefreshing, refreshed],
  () => {
    emit('preview-change', {
      targetPath: props.targetPath,
      isRefreshing: isRefreshing.value,
      refreshed: refreshed.value,
    });
  },
  { immediate: true },
);

const handleRefresh = async () => {
  if (!props.targetPath) {
    toast.showToast('没有目标文件夹', 'error');
    return;
  }

  isRefreshing.value = true;

  try {
    await libraryApi.refreshFolderSongs(
      props.targetPath,
      settingsStore.settings.libraryMinDurationSeconds,
    );
    toast.showToast('歌曲信息已刷新', 'success');
    refreshed.value = true;
  } catch (error) {
    console.error(error);
    toast.showToast(`刷新失败: ${error}`, 'error');
  } finally {
    isRefreshing.value = false;
  }
};
</script>

<template>
  <div class="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <div v-if="refreshed" class="space-y-6">
      <div class="text-center py-6">
        <div class="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-4xl dark:bg-emerald-500/20">
          ✓
        </div>
        <h3 class="text-2xl font-bold text-slate-900 dark:text-white">流程已完成</h3>
        <p class="mt-2 text-sm text-slate-600 dark:text-white/60">当前目标文件夹已经完成刷新，可以直接开始下一轮整理。</p>
      </div>

      <div class="flex gap-3 border-t border-slate-100 pt-4 dark:border-white/5">
        <button
          @click="emit('restart')"
          class="flex-1 rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-transparent dark:text-slate-200 dark:hover:bg-white/5"
        >
          处理另一个文件夹
        </button>
        <button
          @click="emit('close')"
          class="flex-1 rounded-2xl bg-[#EC4141] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#d63a3a]"
        >
          完成
        </button>
      </div>
    </div>

    <div v-else class="space-y-6">
      <section class="rounded-3xl border border-amber-200/80 bg-amber-50/80 p-5 dark:border-amber-500/20 dark:bg-amber-500/10">
        <div class="flex items-start gap-4">
          <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500 text-xl text-white shadow-sm">4</div>
          <div>
            <h3 class="text-lg font-semibold text-amber-950 dark:text-amber-200">完成前刷新音乐库</h3>
            <p class="mt-2 text-sm leading-7 text-amber-800/80 dark:text-amber-300">
              这一步会重新扫描目标文件夹，让工具箱刚刚处理过的结果立即反映到软件音乐库中。
            </p>
          </div>
        </div>
      </section>

      <section class="rounded-3xl border border-slate-200/70 bg-slate-50/75 p-5 dark:border-white/10 dark:bg-white/5">
        <div class="text-sm font-semibold text-slate-900 dark:text-white">当前目标文件夹</div>
        <div class="mt-3 rounded-2xl border border-dashed border-slate-300 bg-white/85 px-4 py-3 text-sm text-slate-600 dark:border-white/10 dark:bg-black/20 dark:text-slate-300">
          <span class="break-all">{{ targetPath }}</span>
        </div>
      </section>

      <button
        @click="handleRefresh"
        :disabled="!targetPath || isRefreshing"
        class="flex w-full items-center justify-center gap-3 rounded-2xl bg-slate-900 px-6 py-4 text-base font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/10 dark:hover:bg-white/20"
      >
        <svg v-if="isRefreshing" class="h-5 w-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        {{ isRefreshing ? '刷新中...' : '刷新歌曲信息' }}
      </button>

      <div class="flex gap-3 border-t border-slate-100 pt-4 dark:border-white/5">
        <button
          @click="emit('back')"
          class="flex-1 rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-transparent dark:text-slate-200 dark:hover:bg-white/5"
        >
          返回上一步
        </button>
      </div>
    </div>
  </div>
</template>
