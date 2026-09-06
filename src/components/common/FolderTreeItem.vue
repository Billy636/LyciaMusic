<template>
  <div class="select-none text-gray-800 dark:text-gray-200">
    <div
      class="flex items-center px-2 py-1.5 rounded-md cursor-pointer transition-colors group relative folder-drop-target"
      :data-folder-path="node.path"
      :data-folder-name="node.name"
      :class="[
        isSelected ? 'bg-blue-500/10 text-blue-500 dark:text-blue-400' : 'hover:bg-black/5 dark:hover:bg-white/5',
        isTarget ? 'ring-2 ring-blue-500 bg-blue-50/50 dark:bg-blue-900/20 z-10' : '',
      ]"
      @click.stop="handleSelect"
      @mousemove="handleMouseMoveDrag"
      @mouseleave="handleMouseLeaveDrag"
      @contextmenu.prevent.stop="handleContextMenu"
    >
      <div :style="{ width: `${depth * 16}px` }" class="shrink-0 transition-all"></div>
      <button
        v-if="node.child_count > 0"
        type="button"
        class="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-black/5 hover:text-gray-700 dark:text-white/50 dark:hover:bg-white/5 dark:hover:text-white/80"
        :aria-label="node.is_expanded ? '折叠文件夹' : '展开文件夹'"
        @click.stop="handleToggle"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-4 w-4 transition-transform duration-200"
          :class="node.is_expanded ? 'rotate-90' : ''"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 111.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" />
        </svg>
      </button>
      <div v-else class="mr-1 h-6 w-6 shrink-0"></div>

      <div class="w-9 h-9 rounded shrink-0 mr-2 overflow-hidden bg-gray-200 dark:bg-gray-700 flex items-center justify-center border border-black/5 dark:border-white/5 relative">
        <img v-if="coverUrl" :src="coverUrl" class="w-full h-full object-cover transition-opacity duration-300" />
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" /></svg>
      </div>

      <div class="flex-1 min-w-0 flex flex-col justify-center">
        <div class="text-sm font-medium truncate leading-tight">{{ node.name }}</div>
        <div
          class="text-[10px] truncate mt-0.5 flex items-center gap-1"
          :class="node.child_count > 0 ? 'text-blue-500 dark:text-blue-400' : 'text-gray-600 dark:text-white/60'"
        >
          <svg v-if="node.child_count > 0" xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
          </svg>
          <svg
            v-if="node.is_loading"
            xmlns="http://www.w3.org/2000/svg"
            class="h-3 w-3 shrink-0 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" class="opacity-25" />
            <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          </svg>
          <span>{{ node.child_count > 0 ? `${node.child_count} 个文件夹` : `${node.song_count} 首` }}</span>
        </div>
      </div>
    </div>

    <transition
      name="folder-expand"
      @before-enter="beforeEnter"
      @enter="enter"
      @enter-cancelled="afterEnter"
      @after-enter="afterEnter"
      @leave="leave"
      @after-leave="afterLeave"
    >
      <div v-show="node.is_expanded" class="overflow-hidden">
        <div
          v-if="node.is_loading"
          class="flex items-center gap-2 px-2 py-2 text-xs text-gray-500 dark:text-white/50"
          :style="{ paddingLeft: `${depth * 16 + 16}px` }"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" class="opacity-25" />
            <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          </svg>
          <span>正在加载子文件夹...</span>
        </div>
        <FolderTreeItem
          v-for="child in node.children"
          :key="child.path"
          :node="child"
          :depth="depth + 1"
          :selectedPath="selectedPath"
          @select="(childNode) => $emit('select', childNode)"
          @toggle="(childNode) => $emit('toggle', childNode)"
          @contextmenu="(payload) => $emit('contextmenu', payload)"
        />
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import { dragSession } from '../../composables/dragState';
import { useCoverCache } from '../../composables/useCoverCache';
import type { FolderNode } from '../../types';

const props = defineProps<{
  node: FolderNode;
  depth: number;
  selectedPath: string;
}>();

const emit = defineEmits<{
  (e: 'select', node: FolderNode): void;
  (e: 'toggle', node: FolderNode): void;
  (e: 'contextmenu', payload: { event: MouseEvent; node: FolderNode }): void;
}>();

const isSelected = computed(() => props.selectedPath === props.node.path);

const isTarget = computed(() =>
  dragSession.active && dragSession.type === 'song' && dragSession.targetFolder?.path === props.node.path,
);

const handleMouseMoveDrag = () => {
  if (dragSession.active && dragSession.type === 'song' && dragSession.targetFolder?.path !== props.node.path) {
    dragSession.targetFolder = { name: props.node.name, path: props.node.path };
  }
};

const handleMouseLeaveDrag = () => {
  if (dragSession.active && dragSession.type === 'song' && dragSession.targetFolder?.path === props.node.path) {
    dragSession.targetFolder = null;
  }
};

const shouldAnimateExpansion = computed(() => props.node.child_count <= 16);

const handleSelect = () => {
  emit('select', props.node);
};

const handleToggle = () => {
  emit('toggle', props.node);
};

const handleContextMenu = (event: MouseEvent) => {
  emit('contextmenu', { event, node: props.node });
};

const coverUrl = ref('');
const { loadCover: loadThumbnailCover } = useCoverCache();
let coverRequestId = 0;

const effectiveCoverSongPath = computed(() =>
  props.node.cover_song_path || '',
);

const loadFolderCover = async () => {
  const requestId = ++coverRequestId;
  if (!effectiveCoverSongPath.value) {
    coverUrl.value = '';
    return;
  }

  try {
    const resolvedCover = await loadThumbnailCover(effectiveCoverSongPath.value);
    if (requestId !== coverRequestId) return;
    coverUrl.value = resolvedCover || '';
  } catch {
    if (requestId !== coverRequestId) return;
    coverUrl.value = '';
  }
};

onMounted(loadFolderCover);
watch(effectiveCoverSongPath, loadFolderCover);

const beforeEnter = (element: Element) => {
  const htmlElement = element as HTMLElement;
  if (!shouldAnimateExpansion.value) {
    htmlElement.style.height = 'auto';
    htmlElement.style.opacity = '1';
    return;
  }

  htmlElement.style.height = '0';
  htmlElement.style.opacity = '0';
};

const enter = (element: Element, done: () => void) => {
  const htmlElement = element as HTMLElement;
  if (!shouldAnimateExpansion.value) {
    htmlElement.style.height = 'auto';
    htmlElement.style.opacity = '1';
    htmlElement.style.transition = '';
    done();
    return;
  }

  htmlElement.offsetHeight;
  htmlElement.style.transition = 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)';
  htmlElement.style.height = `${htmlElement.scrollHeight}px`;
  htmlElement.style.opacity = '1';

  const onTransitionEnd = (event: TransitionEvent) => {
    if (event.target === htmlElement && event.propertyName === 'height') {
      htmlElement.removeEventListener('transitionend', onTransitionEnd);
      done();
    }
  };

  htmlElement.addEventListener('transitionend', onTransitionEnd);
};

const afterEnter = (element: Element) => {
  const htmlElement = element as HTMLElement;
  htmlElement.style.height = 'auto';
  htmlElement.style.opacity = '';
  htmlElement.style.transition = '';
};

const leave = (element: Element) => {
  const htmlElement = element as HTMLElement;
  if (!shouldAnimateExpansion.value) {
    htmlElement.style.transition = '';
    htmlElement.style.height = '';
    htmlElement.style.opacity = '';
    return;
  }

  htmlElement.style.height = `${htmlElement.offsetHeight}px`;
  htmlElement.offsetHeight;

  requestAnimationFrame(() => {
    htmlElement.style.transition = 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)';
    htmlElement.style.height = '0';
    htmlElement.style.opacity = '0';
  });
};

const afterLeave = (element: Element) => {
  const htmlElement = element as HTMLElement;
  htmlElement.style.transition = '';
  htmlElement.style.height = '';
  htmlElement.style.opacity = '';
};
</script>

<style scoped>
.folder-expand-move {
  transition: transform 0.3s ease;
}
</style>
