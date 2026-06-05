<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

import FolderContextMenu from '../overlays/FolderContextMenu.vue';
import SortModeIcon from '../common/SortModeIcon.vue';
import { useToast } from '../../composables/toast';
import { usePlayerViewState } from '../../composables/usePlayerViewState';
import { dragSession } from '../../composables/dragState';
import { useAddToPlaylistDialog } from '../../features/collections/addToPlaylistDialog';
import { useLibraryRuntimeActions } from '../../features/library/useLibraryRuntimeActions';

const { folderSortMode, setFolderSortMode } = usePlayerViewState();

const props = defineProps<{
  isBatchMode: boolean;
  selectedCount: number;
  folderTree: any[];
  activeRootPath: string | null;
  currentFolderFilter: string;
  isManagementMode: boolean;
}>();

const emit = defineEmits([
  'update:isBatchMode',
  'update:activeRootPath',
  'playAll',
  'batchPlay',
  'batchDelete',
  'batchMove',
  'addToPlaylist',
  'rootCreatePlaylist',
  'addFolder',
  'refreshFolder',
  'removeFolder',
  'newFolder',
  'deleteFolderDisk',
  'update:isManagementMode',
]);

const toast = useToast();

const targetRootPath = ref('');
const showRootMenu = ref(false);
const rootMenuX = ref(0);
const rootMenuY = ref(0);

const showSortMenu = ref(false);
const sortMenuX = ref(0);
const sortMenuY = ref(0);
const sortMenuIsRightAligned = ref(false);

let toastTimer: ReturnType<typeof setTimeout> | null = null;

const toggleManagementMode = (enable: boolean) => {
  if (props.isManagementMode === enable) return;

  emit('update:isManagementMode', enable);

  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  toastTimer = setTimeout(() => {
    if (enable) {
      toast.showToast('注意：已进入管理模式，将会对本地文件直接进行操作', 'error');
    } else {
      toast.showToast('已退出管理模式', 'success');
    }
  }, 300);
};

const handleRootContextMenu = (e: MouseEvent, path: string) => {
  e.preventDefault();
  targetRootPath.value = path;
  rootMenuX.value = e.clientX;
  rootMenuY.value = e.clientY;
  showRootMenu.value = true;
  showSortMenu.value = false;
};

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
  showRootMenu.value = false;
};

const handleGlobalClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (!target.closest('.root-folder-menu') && !target.closest('.sort-menu-trigger')) {
    showRootMenu.value = false;
    showSortMenu.value = false;
  }
};

const isRootDropTarget = (path: string) =>
  props.isManagementMode &&
  dragSession.active &&
  dragSession.type === 'song' &&
  dragSession.targetFolder?.path === path;

const emitRootCreatePlaylist = () => {
  const rootNode = props.folderTree.find(node => node.path === targetRootPath.value);
  if (!rootNode) {
    showRootMenu.value = false;
    return;
  }

  showRootMenu.value = false;
  emit('rootCreatePlaylist', rootNode.path, rootNode.name);
};

const emitRootAddToPlaylist = () => {
  const rootNode = props.folderTree.find(node => node.path === targetRootPath.value);
  if (!rootNode) {
    showRootMenu.value = false;
    return;
  }

  showRootMenu.value = false;
  const { getSongsInFolder } = useLibraryRuntimeActions();
  const { openAddToPlaylistDialog } = useAddToPlaylistDialog();
  const songs = getSongsInFolder(rootNode.path);
  if (songs.length === 0) {
    toast.showToast('该文件夹下没有可用于添加到歌单的歌曲', 'info');
    return;
  }
  openAddToPlaylistDialog(songs.map(song => song.path));
};

onMounted(() => window.addEventListener('click', handleGlobalClick));
onUnmounted(() => {
  window.removeEventListener('click', handleGlobalClick);
});
</script>

<template>
  <div class="px-6 shrink-0 select-none flex flex-col pt-2 pb-3 h-auto justify-center">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2 overflow-x-auto overflow-y-visible custom-scrollbar no-scrollbar py-2 pl-0 pr-4">
        <div
          v-for="rootNode in folderTree"
          :key="rootNode.path"
          :data-folder-path="rootNode.path"
          :data-folder-name="rootNode.name"
          @click="emit('update:activeRootPath', rootNode.path)"
          @contextmenu.prevent="handleRootContextMenu($event, rootNode.path)"
          :class="[
            'folder-drop-target group relative px-5 py-1.5 rounded-full text-sm font-medium transition-all duration-300 cursor-pointer select-none shrink-0 border border-transparent',
            activeRootPath === rootNode.path
              ? 'liquid-glass shadow-md'
              : 'bg-gray-50 text-gray-500 hover:bg-gray-100 dark:bg-white/5 dark:text-gray-400 dark:hover:bg-white/10',
            isRootDropTarget(rootNode.path)
              ? 'ring-2 ring-[#EC4141] ring-inset bg-red-50 text-[#EC4141] dark:bg-red-500/10 dark:text-red-300'
              : ''
          ]"
        >
          <span>{{ rootNode.name }}</span>
          <button
            @click.stop="emit('removeFolder', rootNode.path, rootNode.name)"
            class="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-400 hover:text-white shadow-sm"
            title="移除文件夹"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
            </svg>
          </button>
        </div>

        <FolderContextMenu
          :visible="showRootMenu"
          :x="rootMenuX"
          :y="rootMenuY"
          :folder-path="targetRootPath"
          :selected-count="1"
          :isManagementMode="isManagementMode"
          @close="showRootMenu = false"
          @create-playlist="emitRootCreatePlaylist"
          @add-to-playlist="emitRootAddToPlaylist"
          @remove="path => emit('removeFolder', path)"
          @new-folder="showRootMenu = false; emit('newFolder', targetRootPath)"
          @delete-disk="showRootMenu = false; emit('deleteFolderDisk', targetRootPath)"
        />
      </div>

      <div class="flex items-center gap-3">
        <div class="flex p-0.5 bg-gray-100 dark:bg-white/5 rounded-full relative w-24 h-6 items-center cursor-pointer select-none">
          <div
            class="absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] bg-white dark:bg-white/10 rounded-full shadow-sm transition-all duration-300 ease-out z-0"
            :style="{ transform: isManagementMode ? 'translateX(100%)' : 'translateX(0)' }"
          ></div>

          <div
            @click="toggleManagementMode(false)"
            class="flex-1 flex items-center justify-center text-[11px] font-medium transition-colors z-10"
            :class="!isManagementMode ? 'text-[#EC4141] dark:text-red-400' : 'text-gray-400'"
          >
            浏览
          </div>

          <div
            @click="toggleManagementMode(true)"
            class="flex-1 flex items-center justify-center text-[11px] font-medium transition-colors z-10"
            :class="isManagementMode ? 'text-[#EC4141] dark:text-red-400' : 'text-gray-400'"
          >
            管理
          </div>
        </div>

        <button
          @click="emit('addFolder')"
          class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
          title="添加文件夹"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
        </button>

        <button
          v-if="currentFolderFilter"
          @click="emit('refreshFolder')"
          class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
          title="刷新文件夹"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
        </button>

        <button
          @click="emit('update:isBatchMode', !isBatchMode)"
          class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
          :class="isBatchMode ? 'text-[#EC4141] border-red-200 bg-red-50/60 dark:bg-red-500/10' : ''"
          :title="isBatchMode ? '退出批量操作' : '批量操作'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
        </button>

        <button
          @click="handleSortClick"
          class="sort-menu-trigger bg-white/1 hover:bg-white/10 border border-white/1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
          :class="{ 'text-blue-500 border-blue-200 bg-blue-50/50 dark:bg-blue-500/10': folderSortMode !== 'title' }"
          title="排序方式"
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
              v-for="mode in (['title', 'name', 'artist', 'added_at', 'custom'] as const)"
              :key="mode"
              @click="
                if (mode === 'added_at') {
                  setFolderSortMode(folderSortMode === 'added_at' ? 'added_at_asc' : 'added_at');
                } else {
                  setFolderSortMode(mode);
                }
                showSortMenu = false;
              "
              class="px-3 py-2 text-xs cursor-pointer flex items-center justify-between hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
              :class="(folderSortMode || '').startsWith(mode) ? 'text-blue-500 font-medium' : 'text-gray-600 dark:text-gray-300'"
            >
              <span>{{ { title: '\u6b4c\u66f2\u540d', name: '\u6587\u4ef6\u540d', artist: '\u6b4c\u624b', added_at: '\u6dfb\u52a0\u65f6\u95f4', custom: '\u81ea\u5b9a\u4e49' }[mode] }}</span>
              <div v-if="(folderSortMode || '').startsWith(mode)" class="flex items-center gap-1.5">
                <svg v-if="mode === 'added_at'" xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 transition-transform duration-200" :class="{ 'rotate-180': folderSortMode === 'added_at_asc' }" viewBox="0 0 20 20" fill="currentColor">
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

    <Teleport to="body">
      <transition name="floating-bar">
        <div
          v-if="isBatchMode"
          class="fixed inset-x-0 bottom-6 z-[9998] flex justify-center px-4 pointer-events-none"
        >
          <div
            class="pointer-events-auto flex items-center gap-2 rounded-full border border-white/40 bg-white/70 px-3 py-2 shadow-[0_18px_48px_rgba(0,0,0,0.16)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#1f1f1f]/80"
          >
            <div class="px-3 text-sm font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap">
              已选 {{ selectedCount }} 首
            </div>

            <button @click="emit('addToPlaylist')" class="floating-action" title="添加到歌单">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
              <span>歌单</span>
            </button>

            <button
              v-if="isManagementMode"
              @click="emit('batchMove')"
              class="floating-action"
              title="批量移动到文件夹"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
              <span>移动</span>
            </button>

            <button
              v-if="isManagementMode"
              @click="emit('batchDelete')"
              class="floating-action danger"
              title="删除本地歌曲"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              <span>删除</span>
            </button>

            <div v-if="isManagementMode" class="h-6 w-px bg-black/10 dark:bg-white/10"></div>

            <button @click="emit('update:isBatchMode', false)" class="floating-action subtle" title="退出批量模式">
              <span>完成</span>
            </button>
          </div>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar {
  display: none;
}

.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.liquid-glass {
  background: linear-gradient(135deg, rgba(235, 240, 255, 0.4), rgba(255, 255, 255, 0.2));
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-color: rgba(255, 255, 255, 0.6);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.3),
    inset 0 2px 8px rgba(255, 255, 255, 0.5);
  color: #2563eb;
}

:global(.dark) .liquid-glass {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.02));
  border-color: rgba(255, 255, 255, 0.15);
  color: #fff;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
}

.floating-action {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  border-radius: 9999px;
  padding: 0.55rem 0.9rem;
  font-size: 0.875rem;
  line-height: 1;
  color: rgb(75 85 99);
  transition: all 0.2s ease;
}

.floating-action:hover {
  background: rgba(255, 255, 255, 0.55);
  color: rgb(17 24 39);
}

.floating-action.danger {
  color: #dc2626;
}

.floating-action.danger:hover {
  background: rgba(254, 226, 226, 0.9);
  color: #b91c1c;
}

.floating-action.subtle {
  color: #ec4141;
}

.floating-action.subtle:hover {
  background: rgba(254, 242, 242, 0.9);
}

:global(.dark) .floating-action {
  color: rgba(255, 255, 255, 0.82);
}

:global(.dark) .floating-action:hover {
  background: rgba(255, 255, 255, 0.08);
  color: white;
}

:global(.dark) .floating-action.danger {
  color: #fca5a5;
}

:global(.dark) .floating-action.danger:hover {
  background: rgba(127, 29, 29, 0.45);
  color: #fecaca;
}

:global(.dark) .floating-action.subtle {
  color: #f87171;
}

:global(.dark) .floating-action.subtle:hover {
  background: rgba(127, 29, 29, 0.3);
}

.floating-bar-enter-active,
.floating-bar-leave-active {
  transition:
    opacity 0.24s ease,
    transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

.floating-bar-enter-from,
.floating-bar-leave-to {
  opacity: 0;
  transform: translateY(18px) scale(0.96);
}

.floating-bar-enter-to,
.floating-bar-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
}
</style>
