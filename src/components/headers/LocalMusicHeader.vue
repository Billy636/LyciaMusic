<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { usePlayerViewState } from '../../composables/usePlayerViewState';
import SortModeIcon from '../common/SortModeIcon.vue';

defineProps<{
  isBatchMode: boolean;
  selectedCount?: number;
}>();

const emit = defineEmits([
  'update:isBatchMode',
  'playAll',
  'batchPlay',
  'addToPlaylist',
  'batchDelete',
  'batchMove',
  'refreshAll',
  'addAllToQueue',
]);

const {
  localSortMode,
  setLocalSortMode,
} = usePlayerViewState();

const sortLabelMap = {
  title: '\u6b4c\u66f2\u540d',
  artist: '\u6b4c\u624b',
  added_at: '\u6dfb\u52a0\u65f6\u95f4',
  file_modified_at: '\u4fee\u6539\u65f6\u95f4',
  custom: '\u81ea\u5b9a\u4e49',
} as const;

const showSortMenu = ref(false);
const sortMenuX = ref(0);
const sortMenuY = ref(0);
const sortMenuIsRightAligned = ref(false);

const handleSortClick = (e: MouseEvent) => {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const windowWidth = window.innerWidth;

  if (rect.left > windowWidth / 2) {
    sortMenuIsRightAligned.value = true;
    sortMenuX.value = windowWidth - rect.right;
  } else {
    sortMenuIsRightAligned.value = false;
    sortMenuX.value = rect.left;
  }

  sortMenuY.value = rect.bottom + 8;
  showSortMenu.value = !showSortMenu.value;
};

const handleGlobalClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (!target.closest('.sort-menu-trigger')) {
    showSortMenu.value = false;
  }
};

onMounted(() => window.addEventListener('click', handleGlobalClick));
onUnmounted(() => window.removeEventListener('click', handleGlobalClick));

const handleRefreshAll = () => {
  emit('refreshAll');
};

const handlePlayAll = () => {
  emit('playAll');
};

const handleAddAllToQueue = () => {
  emit('addAllToQueue');
};

const handleEnterBatchMode = () => {
  emit('update:isBatchMode', true);
};
</script>

<template>
  <div class="px-6 shrink-0 select-none flex flex-col pt-2 pb-3 h-auto justify-center">
    <div v-if="isBatchMode" class="flex items-center justify-between animate-in fade-in slide-in-from-top-1 duration-200">
      <div class="flex items-center gap-3">
        <button @click="emit('batchPlay')" class="bg-[#EC4141] hover:bg-[#d13b3b] text-white px-4 py-1.5 rounded-full text-sm transition flex items-center gap-1 active:scale-95 shadow-sm">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" /></svg>
        </button>
        <button @click="emit('batchMove')" class="bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
          &#31227;&#21160;&#21040;&#25991;&#20214;&#22841;
        </button>
        <button @click="emit('addToPlaylist')" class="bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
          &#28155;&#21152;&#21040;&#27468;&#21333;
        </button>
        <button @click="emit('batchDelete')" class="bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          &#21024;&#38500;
        </button>
      </div>
      <div class="flex items-center gap-4">
        <button @click="emit('update:isBatchMode', false)" class="text-[#EC4141] hover:bg-red-50 dark:hover:bg-red-500/10 px-3 py-1 rounded transition">&#21462;&#28040;</button>
      </div>
    </div>

    <div v-else class="flex items-center justify-between">
      <div class="flex items-center gap-2 pb-1">
        <h2 class="text-xl font-bold text-gray-900 dark:text-white">&#26412;&#22320;&#38899;&#20048;</h2>
      </div>

      <div class="flex items-center gap-2">
        <button
          @click="handlePlayAll"
          class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
          title="&#25773;&#25918;&#20840;&#37096;"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 5.5v13l10-6.5-10-6.5Z" />
          </svg>
        </button>

        <button
          @click="handleRefreshAll"
          class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
          title="&#21047;&#26032;&#38899;&#20048;&#24211;"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
        </button>

        <button
          @click="handleAddAllToQueue"
          class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
          title="&#20840;&#37096;&#28155;&#21152;&#21040;&#25773;&#25918;&#38431;&#21015;"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3.5 6H17" />
            <path d="M3.5 12H14" />
            <path d="M3.5 18H11" />
            <path d="M18 14v6" />
            <path d="M15 17h6" />
          </svg>
        </button>

        <button
          @click="handleEnterBatchMode"
          class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
          title="&#25209;&#37327;&#25805;&#20316;"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
        </button>

        <button
          @click.stop="handleSortClick"
          class="sort-menu-trigger bg-white/1 hover:bg-white/10 border border-white/1 text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
          title="&#25490;&#24207;&#26041;&#24335;"
        >
          <SortModeIcon class="h-4 w-4" />
        </button>

        <Teleport to="body">
          <div
            v-if="showSortMenu"
            class="fixed z-[9999] bg-white dark:bg-[#2b2b2b] rounded-lg shadow-xl border border-gray-100 dark:border-white/10 py-1 min-w-[120px] isolate animate-in fade-in zoom-in-95 duration-100"
            :style="sortMenuIsRightAligned
              ? { right: sortMenuX + 'px', top: sortMenuY + 'px' }
              : { left: sortMenuX + 'px', top: sortMenuY + 'px' }"
          >
            <div
              v-for="mode in (['title', 'artist', 'added_at', 'file_modified_at', 'custom'] as const)"
              :key="mode"
              @click="
                if (mode === 'added_at') {
                  setLocalSortMode(localSortMode === 'added_at' ? 'added_at_asc' : 'added_at');
                } else if (mode === 'file_modified_at') {
                  setLocalSortMode(localSortMode === 'file_modified_at' ? 'file_modified_at_asc' : 'file_modified_at');
                } else {
                  setLocalSortMode(mode);
                }
                showSortMenu = false;
              "
              class="px-3 py-2 text-xs cursor-pointer flex items-center justify-between hover:bg-gray-50 dark:hover:bg-white/10 transition-colors"
              :class="(localSortMode || '').startsWith(mode) ? 'text-blue-500 font-medium' : 'text-gray-600 dark:text-gray-300'"
            >
              <span>{{ sortLabelMap[mode] }}</span>
              <div v-if="(localSortMode || '').startsWith(mode)" class="flex items-center gap-1.5">
                <svg v-if="mode === 'added_at' || mode === 'file_modified_at'" xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 transition-transform duration-200" :class="{ 'rotate-180': localSortMode === 'added_at_asc' || localSortMode === 'file_modified_at_asc' }" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M14.707 12.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l2.293-2.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              </div>
            </div>
          </div>
        </Teleport>
      </div>
    </div>
  </div>
</template>
