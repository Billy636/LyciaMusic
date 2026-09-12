<script setup lang="ts">
import { RefreshCw } from 'lucide-vue-next';
import AppCheckbox from '../common/AppCheckbox.vue';
import { useToolboxStore } from '../../features/toolbox/store';

const store = useToolboxStore();

const isRowSelected = (path: string) => store.selectedPaths.has(path);
const isRowSelectable = (path: string) => {
  const item = store.previewItems.find((candidate) => candidate.original_path === path);
  return Boolean(item && item.will_change && !item.conflict);
};

const rowError = (path: string) => store.applyFailures[path] ?? '';
</script>

<template>
  <div>
    <!-- 工具行：全选 + 统计 + 重新扫描 -->
    <div
      class="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-white/40 pb-3 dark:border-white/5"
    >
      <div class="flex items-center gap-3">
        <AppCheckbox
          :checked="store.selectionSummary.allSelected"
          :indeterminate="store.selectionSummary.indeterminate"
          :disabled="store.selectionSummary.selectableCount === 0"
          @change="store.toggleMasterSelection()"
        />
        <span class="text-sm font-semibold text-gray-800 dark:text-gray-200">文件预览</span>
        <div class="flex flex-wrap items-center gap-1.5 text-xs">
          <span
            class="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-white/10 dark:text-slate-300"
          >
            共 {{ store.previewItems.length }}
          </span>
          <span
            v-if="store.changedCount > 0"
            class="rounded-full bg-[#EC4141]/10 px-2 py-0.5 text-[#EC4141]"
          >
            将改名 {{ store.changedCount }}
          </span>
          <span
            v-if="store.conflictCount > 0"
            class="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
          >
            冲突 {{ store.conflictCount }}
          </span>
          <span
            v-if="store.missingTagCount > 0"
            class="rounded-full bg-gray-100 px-2 py-0.5 text-gray-500 dark:bg-white/10 dark:text-white/50"
          >
            缺标签 {{ store.missingTagCount }}
          </span>
          <label
            class="ml-1 flex cursor-pointer items-center gap-1.5 text-xs text-gray-500 transition hover:text-[#EC4141] dark:text-white/60"
            title="目标名冲突时自动追加 (2)、(3) 后缀，让同名文件都能改名"
          >
            <AppCheckbox
              :checked="store.resolveConflicts"
              @change="store.setResolveConflicts($event)"
            />
            重名自动加序号
          </label>
        </div>
      </div>

      <button
        type="button"
        class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-gray-500 transition hover:bg-white/60 hover:text-[#EC4141] disabled:cursor-not-allowed disabled:opacity-50 dark:text-white/60 dark:hover:bg-white/10"
        :disabled="store.isScanning || !store.hasTarget"
        title="重新扫描当前文件夹"
        @click="store.refreshPreview()"
      >
        <RefreshCw class="h-3.5 w-3.5" :class="store.isScanning ? 'animate-spin' : ''" />
        重新扫描
      </button>
    </div>

    <!-- 表头 -->
    <div
      class="grid grid-cols-[28px_minmax(0,1fr)_20px_minmax(0,1fr)_auto] items-center gap-2 border-b border-white/40 py-2 text-xs font-semibold text-gray-500 dark:border-white/5 dark:text-white/50"
    >
      <span></span>
      <span>当前文件名</span>
      <span></span>
      <span>目标文件名</span>
      <span class="w-14 text-center">状态</span>
    </div>

    <!-- 未选择文件夹 -->
    <div v-if="!store.hasTarget" class="px-6 py-14 text-center">
      <p class="text-sm font-medium text-gray-600 dark:text-white/70">先选择要整理的文件夹</p>
      <p class="mt-2 text-xs leading-6 text-gray-400 dark:text-white/50">
        选择文件夹后会自动扫描其中的音频文件，<br />
        勾选清理规则与命名模板即可实时预览改名效果。
      </p>
    </div>

    <!-- 扫描中 -->
    <div
      v-else-if="store.isScanning && store.previewItems.length === 0"
      class="flex items-center justify-center gap-3 px-6 py-14 text-sm text-gray-500 dark:text-white/60"
    >
      <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      正在扫描文件夹...
    </div>

    <!-- 扫描失败 -->
    <div v-else-if="store.scanError" class="px-6 py-12 text-center">
      <p class="text-sm font-medium text-red-500">扫描失败</p>
      <p class="mt-2 break-all text-xs text-gray-400 dark:text-white/50">{{ store.scanError }}</p>
      <button
        type="button"
        class="mt-4 rounded-lg border border-gray-200 bg-white/70 px-4 py-2 text-xs text-gray-600 transition hover:border-[#EC4141] hover:text-[#EC4141] dark:border-white/10 dark:bg-white/5 dark:text-gray-300"
        @click="store.refreshPreview()"
      >
        重试
      </button>
    </div>

    <!-- 空文件夹 -->
    <div
      v-else-if="store.previewItems.length === 0"
      class="px-6 py-12 text-center text-sm text-amber-600 dark:text-amber-300"
    >
      该文件夹下没有找到支持的音频文件。
    </div>

    <!-- 文件列表：极轻表面保证长列表可读性 -->
    <div
      v-else
      class="custom-scrollbar mt-3 max-h-[480px] overflow-y-auto rounded-xl bg-white/25 dark:bg-white/[0.04]"
    >
      <div
        v-for="item in store.previewItems"
        :key="item.original_path"
        class="grid grid-cols-[28px_minmax(0,1fr)_20px_minmax(0,1fr)_auto] items-center gap-2 border-b border-white/30 px-4 py-2.5 text-sm transition-colors last:border-0 hover:bg-white/30 dark:border-white/5 dark:hover:bg-white/[0.06]"
      >
        <AppCheckbox
          :checked="isRowSelected(item.original_path)"
          :disabled="!isRowSelectable(item.original_path)"
          @change="store.toggleRow(item.original_path)"
        />

        <div
          class="truncate text-gray-600 dark:text-white/60"
          :class="item.will_change ? 'line-through decoration-gray-400/70 dark:decoration-white/30' : ''"
          :title="item.original_name"
        >
          {{ item.original_name }}
        </div>

        <div
          class="text-center text-xs"
          :class="item.will_change ? 'text-[#EC4141]' : 'text-gray-300 dark:text-white/20'"
        >
          →
        </div>

        <div class="min-w-0">
          <div
            class="truncate"
            :class="
              item.will_change
                ? 'font-medium text-gray-900 dark:text-white'
                : 'text-gray-400 dark:text-white/40'
            "
            :title="item.final_name"
          >
            {{ item.final_name }}
          </div>
          <div v-if="rowError(item.original_path)" class="truncate text-xs text-red-500" :title="rowError(item.original_path)">
            {{ rowError(item.original_path) }}
          </div>
        </div>

        <div class="flex w-14 justify-center">
          <span
            v-if="rowError(item.original_path)"
            class="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-600 dark:bg-red-500/15 dark:text-red-300"
          >
            失败
          </span>
          <span
            v-else-if="item.conflict"
            class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
            :title="
              item.conflict_reason === 'occupied'
                ? '目标文件名已被现有文件占用：文件夹里可能已有一份符合命名规范的文件。可删除重复文件，或开启「重名自动加序号」'
                : '标签与另一文件完全相同，渲染出了同一个目标名。可开启「重名自动加序号」，或在 MusicTag 中区分两份文件的标签'
            "
          >
            {{ item.conflict_reason === 'occupied' ? '占用' : '重名' }}
          </span>
          <span
            v-else-if="!item.will_change"
            class="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-400 dark:bg-white/10 dark:text-white/40"
          >
            无变化
          </span>
          <span
            v-else-if="item.tag_name"
            class="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
          >
            标签
          </span>
          <span
            v-else
            class="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
          >
            规则
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
