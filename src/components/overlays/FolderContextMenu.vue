<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch, type CSSProperties } from 'vue';

import {
  canUseFolderManagementAction,
  shouldShowFolderManagementActions,
} from './folderContextMenuState';

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  folderPath: string;
  selectedCount?: number;
  isManagementMode?: boolean;
  isRootFolder?: boolean;
}>();

const emit = defineEmits([
  'close',
  'play',
  'addToQueue',
  'createPlaylist',
  'addToPlaylist',
  'openFolder',
  'remove',
  'refresh',
  'cancel',
  'delete-disk',
  'new-folder',
]);

const menuRef = ref<HTMLElement | null>(null);
const menuSize = ref({ width: 0, height: 0 });

watch(
  () => props.visible,
  async (visible) => {
    if (visible) {
      await nextTick();
      if (menuRef.value) {
        menuSize.value = {
          width: menuRef.value.offsetWidth,
          height: menuRef.value.offsetHeight,
        };
      }
      return;
    }

    menuSize.value = { width: 0, height: 0 };
  },
);

const menuStyle = computed<CSSProperties>(() => {
  if (!props.visible) {
    return {};
  }

  let top = props.y;
  let left = props.x;
  let verticalOrigin = 'top';
  let horizontalOrigin = 'left';

  if (top + menuSize.value.height > window.innerHeight) {
    top = props.y - menuSize.value.height;
    verticalOrigin = 'bottom';
  }

  if (left + menuSize.value.width > window.innerWidth) {
    left = props.x - menuSize.value.width;
    horizontalOrigin = 'right';
  }

  return {
    left: `${Math.max(8, left)}px`,
    top: `${Math.max(8, top)}px`,
    visibility: menuSize.value.height === 0 ? 'hidden' : 'visible',
    transformOrigin: `${horizontalOrigin} ${verticalOrigin}`,
  };
});

const handleClickOutside = (event: MouseEvent) => {
  if (menuRef.value && !menuRef.value.contains(event.target as Node)) {
    emit('cancel');
    emit('close');
  }
};

onMounted(() => window.addEventListener('mousedown', handleClickOutside));
onUnmounted(() => window.removeEventListener('mousedown', handleClickOutside));

const itemClass =
  'song-menu-item px-4 py-2.5 cursor-pointer flex items-center group transition-colors';
const sectionTitleClass = 'song-menu-section px-4 pt-1 pb-2 text-[11px] font-semibold tracking-[0.08em] text-gray-400';
const enabledItemClass =
  'song-menu-item w-full px-4 py-2.5 text-left cursor-pointer flex items-center group transition-colors';
const disabledItemClass =
  'song-menu-item w-full px-4 py-2.5 text-left flex items-center transition-colors cursor-not-allowed opacity-45';

const showManagementActions = computed(() =>
  shouldShowFolderManagementActions(!!props.isManagementMode),
);

const canRemoveFromLibrary = computed(() =>
  canUseFolderManagementAction(!!props.isManagementMode),
);

const emitIfAllowed = (
  eventName: 'remove' | 'new-folder' | 'delete-disk',
  allowed: boolean,
) => {
  if (!allowed) {
    return;
  }

  emit(eventName, props.folderPath);
};

const motionDelay = (index: number): CSSProperties => ({
  '--menu-item-delay': `${index * 14}ms`,
} as CSSProperties);
</script>

<template>
  <Teleport to="body">
    <Transition name="song-menu-pop" appear>
      <div
        v-if="visible"
        ref="menuRef"
        class="fixed z-[9999] min-w-[220px] select-none rounded-[18px] border border-white/65 bg-white/78 py-1.5 text-sm text-gray-700 shadow-[0_20px_45px_rgba(15,23,42,0.16),0_6px_18px_rgba(15,23,42,0.08)] backdrop-blur-[22px] supports-[backdrop-filter]:bg-white/72"
        :style="menuStyle"
        @contextmenu.prevent
      >
      <template v-if="selectedCount && selectedCount > 1">
        <div class="song-menu-section px-4 py-2 text-xs text-gray-400" :style="motionDelay(0)">
          已选择 {{ selectedCount }} 个文件夹
        </div>
        <div
          class="song-menu-item flex cursor-pointer items-center px-4 py-2.5 text-[#EC4141] transition-colors"
          :style="motionDelay(1)"
          @click="emit('remove')"
        >
          <div class="mr-3 flex h-5 w-5 items-center justify-center text-[#EC4141]">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <span>批量移除文件夹</span>
        </div>
      </template>

      <template v-else>
        <div :class="itemClass" :style="motionDelay(0)" @click="emit('play')">
          <div class="mr-3 flex h-5 w-5 items-center justify-center text-gray-500 group-hover:text-gray-800">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" />
            </svg>
          </div>
          <span>播放</span>
        </div>

        <div :class="itemClass" :style="motionDelay(1)" @click="emit('addToQueue')">
          <div class="mr-3 flex h-5 w-5 items-center justify-center text-gray-500 group-hover:text-gray-800">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <span>添加到播放队列</span>
        </div>

        <div class="song-menu-divider" :style="motionDelay(2)"></div>

        <div :class="itemClass" :style="motionDelay(3)" @click="emit('createPlaylist')">
          <div class="mr-3 flex h-5 w-5 items-center justify-center text-gray-500 group-hover:text-gray-800">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
          </div>
          <span>创建为歌单</span>
        </div>

        <div :class="itemClass" :style="motionDelay(4)" @click="emit('addToPlaylist')">
          <div class="mr-3 flex h-5 w-5 items-center justify-center text-gray-500 group-hover:text-gray-800">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <span>添加到歌单</span>
        </div>

        <div :class="itemClass" :style="motionDelay(5)" @click="emit('openFolder')">
          <div class="mr-3 flex h-5 w-5 items-center justify-center text-gray-500 group-hover:text-gray-800">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
            </svg>
          </div>
          <span>打开所在目录</span>
        </div>

        <div class="song-menu-divider" :style="motionDelay(6)"></div>

        <div :class="itemClass" :style="motionDelay(7)" @click="emit('refresh')">
          <div class="mr-3 flex h-5 w-5 items-center justify-center text-gray-500 group-hover:text-gray-800">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <span>刷新文件夹内容</span>
        </div>

        <template v-if="showManagementActions">
          <div class="song-menu-divider" :style="motionDelay(8)"></div>
          <div :class="sectionTitleClass" :style="motionDelay(9)">仅管理模式可用</div>

          <button
            type="button"
            :class="canRemoveFromLibrary ? enabledItemClass : disabledItemClass"
            :style="motionDelay(10)"
            :disabled="!canRemoveFromLibrary"
            @click="emitIfAllowed('remove', canRemoveFromLibrary)"
          >
            <div class="mr-3 flex h-5 w-5 items-center justify-center" :class="canRemoveFromLibrary ? 'text-gray-500 group-hover:text-gray-800' : 'text-gray-400'">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7h16M7 7V5a2 2 0 012-2h6a2 2 0 012 2v2M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" />
              </svg>
            </div>
            <div class="min-w-0">从音乐库移除</div>
          </button>

          <button
            type="button"
            :class="enabledItemClass"
            :style="motionDelay(11)"
            @click="emitIfAllowed('new-folder', showManagementActions)"
          >
            <div class="mr-3 flex h-5 w-5 items-center justify-center text-gray-500 group-hover:text-gray-800">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <div class="min-w-0">新建文件夹</div>
          </button>

          <button
            type="button"
            :class="enabledItemClass"
            :style="motionDelay(12)"
            @click="emitIfAllowed('delete-disk', showManagementActions)"
          >
            <div class="mr-3 flex h-5 w-5 items-center justify-center text-[#EC4141]">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 11v6m4-6v6" />
              </svg>
            </div>
            <div class="min-w-0 font-bold text-[#EC4141]">删除文件夹（本地）</div>
          </button>
        </template>
      </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.song-menu-pop-enter-active,
.song-menu-pop-leave-active {
  will-change: opacity, transform;
}

.song-menu-pop-enter-active {
  animation: song-menu-enter 240ms cubic-bezier(0.16, 1, 0.3, 1);
}

.song-menu-pop-leave-active {
  animation: song-menu-leave 140ms cubic-bezier(0.4, 0, 0.2, 1);
}

.song-menu-pop-enter-active .song-menu-item,
.song-menu-pop-enter-active .song-menu-divider,
.song-menu-pop-enter-active .song-menu-section {
  animation: song-menu-item-in 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: var(--menu-item-delay, 0ms);
}

.song-menu-item {
  margin: 0 0.375rem;
  border-radius: 12px;
}

.song-menu-item:hover:not(:disabled) {
  background: rgba(15, 23, 42, 0.055);
}

.song-menu-divider {
  height: 1px;
  margin: 0.34rem 0.85rem;
  background: linear-gradient(90deg, rgba(148, 163, 184, 0), rgba(148, 163, 184, 0.34), rgba(148, 163, 184, 0));
}

@keyframes song-menu-enter {
  0% {
    opacity: 0;
    transform: translateY(10px) scale(0.965);
  }

  72% {
    opacity: 1;
    transform: translateY(-1px) scale(1.008);
  }

  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes song-menu-leave {
  0% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  100% {
    opacity: 0;
    transform: translateY(4px) scale(0.985);
  }
}

@keyframes song-menu-item-in {
  0% {
    opacity: 0;
    transform: translateY(6px);
  }

  100% {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
