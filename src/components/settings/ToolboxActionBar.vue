<script setup lang="ts">
import AppCheckbox from '../common/AppCheckbox.vue';
import { useToolboxStore } from '../../features/toolbox/store';

const emit = defineEmits<{
  (e: 'apply'): void;
  (e: 'reset'): void;
}>();

const store = useToolboxStore();
</script>

<template>
  <div class="space-y-4">
    <!-- 应用结果横幅 -->
    <div
      v-if="store.lastApplyResult"
      class="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm"
      :class="
        store.lastApplyResult.failures.length > 0
          ? 'border-amber-200 bg-amber-50/80 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200'
          : 'border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
      "
    >
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span class="font-semibold">
          {{
            store.lastApplyResult.failures.length > 0
              ? `成功 ${store.lastApplyResult.success_count} 项，失败 ${store.lastApplyResult.failures.length} 项`
              : `成功重命名 ${store.lastApplyResult.success_count} 个文件`
          }}
        </span>
        <span v-if="store.isRefreshingLibrary" class="flex items-center gap-1.5 text-xs opacity-80">
          <svg class="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          正在刷新音乐库...
        </span>
        <span v-else-if="store.libraryRefreshed" class="text-xs opacity-80">音乐库已同步</span>
      </div>
      <button
        type="button"
        class="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium transition hover:bg-white/50 dark:border-white/20 dark:hover:bg-white/10"
        @click="emit('reset')"
      >
        处理另一个文件夹
      </button>
    </div>

    <!-- 冲突提示 -->
    <div
      v-if="store.conflictCount > 0"
      class="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs leading-6 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200"
    >
      有 {{ store.conflictCount }} 个文件的目标名与其他文件重名，或已被文件夹里的现有文件占用，这些行已排除。可开启上方的
      「重名自动加序号」自动区分（追加 (2)、(3) 后缀），或在 MusicTag 中获取标签后重新扫描。
    </div>

    <!-- 底部操作条 -->
    <div
      class="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-white/40 pt-4 dark:border-white/5"
    >
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span class="text-sm text-gray-600 dark:text-white/70">
          已选
          <span class="font-semibold text-gray-900 dark:text-white">{{ store.selectionSummary.selectedCount }}</span>
          / {{ store.selectionSummary.selectableCount }} 个可整理文件
        </span>
        <label class="flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-white/70">
          <AppCheckbox :checked="store.autoRefresh" @change="store.autoRefresh = $event" />
          应用后自动刷新音乐库
        </label>
      </div>

      <button
        type="button"
        class="flex items-center justify-center gap-2 rounded-xl bg-[#EC4141] px-6 py-2.5 text-sm font-semibold text-white shadow-[0_12px_24px_-12px_rgba(236,65,65,0.6)] transition hover:bg-[#d63a3a] disabled:cursor-not-allowed disabled:opacity-45"
        :disabled="!store.canApply"
        @click="emit('apply')"
      >
        <svg v-if="store.isApplying" class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        {{ store.isApplying ? '正在应用...' : `应用所选 (${store.selectionSummary.selectedCount})` }}
      </button>
    </div>
  </div>
</template>
