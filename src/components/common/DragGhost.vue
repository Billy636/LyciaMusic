<script setup lang="ts">
import { dragSession } from '../../composables/dragState';
import { computed, ref, watch, onActivated, onDeactivated, onMounted, onUnmounted, type CSSProperties } from 'vue';
import { useCoverCache } from '../../composables/useCoverCache';

const POINTER_GAP = 12;
// Leave room for the count badge, which extends 8px outside the card.
const VIEWPORT_GUTTER = 16;
const isViewActive = ref(true);
const isGhostVisible = computed(() => isViewActive.value && dragSession.showGhost);
const ghostElement = ref<HTMLElement | null>(null);
const ghostSize = ref({ width: 0, height: 0 });
const viewport = ref({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
const visualViewport = window.visualViewport;
let resizeObserver: ResizeObserver | null = null;
const ghostCover = ref('');
const { loadCover } = useCoverCache();
let ghostRequestId = 0;

// 🟢 监听拖拽状态和类型
watch([isGhostVisible, () => dragSession.type], async ([active, type]) => {
  const requestId = ++ghostRequestId;
  ghostCover.value = '';
  if (active) {
    // 1. 歌曲类型
    if (type === 'song' && dragSession.songs.length > 0) {
      try {
        const coverUrl = await loadCover(dragSession.songs[0].path);
        if (requestId !== ghostRequestId) return;
        ghostCover.value = coverUrl || '';
      } catch {
        if (requestId !== ghostRequestId) return;
        ghostCover.value = '';
      }
    } 
    // 文件夹和歌单使用默认图标。
    else {
       ghostCover.value = '';
    }
  } else {
    ghostCover.value = '';
  }
}, { immediate: true });

const updateViewport = () => {
  viewport.value = {
    left: visualViewport?.offsetLeft ?? 0,
    top: visualViewport?.offsetTop ?? 0,
    width: visualViewport?.width ?? window.innerWidth,
    height: visualViewport?.height ?? window.innerHeight,
  };
};

const measureGhost = () => {
  const element = ghostElement.value;
  if (!element) return;
  // offset dimensions ignore the fade transition's scale transform.
  ghostSize.value = { width: element.offsetWidth, height: element.offsetHeight };
};

watch(ghostElement, element => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  ghostSize.value = { width: 0, height: 0 };
  if (!element) return;
  updateViewport();
  measureGhost();
  resizeObserver = new ResizeObserver(measureGhost);
  resizeObserver.observe(element);
}, { flush: 'post' });

onMounted(() => {
  updateViewport();
  window.addEventListener('resize', updateViewport, { passive: true });
  visualViewport?.addEventListener('resize', updateViewport, { passive: true });
  visualViewport?.addEventListener('scroll', updateViewport, { passive: true });
});

onActivated(() => {
  isViewActive.value = true;
  updateViewport();
});
onDeactivated(() => { isViewActive.value = false; });

onUnmounted(() => {
  ++ghostRequestId;
  resizeObserver?.disconnect();
  window.removeEventListener('resize', updateViewport);
  visualViewport?.removeEventListener('resize', updateViewport);
  visualViewport?.removeEventListener('scroll', updateViewport);
});

const ghostStyle = computed<CSSProperties>(() => {
  const { width, height } = ghostSize.value;
  const minX = viewport.value.left + VIEWPORT_GUTTER;
  const minY = viewport.value.top + VIEWPORT_GUTTER;
  const maxX = viewport.value.left + viewport.value.width - VIEWPORT_GUTTER - width;
  const maxY = viewport.value.top + viewport.value.height - VIEWPORT_GUTTER - height;
  let left = dragSession.mouseX + POINTER_GAP;
  let top = dragSession.mouseY + POINTER_GAP;

  // Prefer the other side of the pointer before clamping to the window edges.
  if (left > maxX) left = dragSession.mouseX - POINTER_GAP - width;
  if (top > maxY) top = dragSession.mouseY - POINTER_GAP - height;

  return {
    left: `${Math.max(minX, Math.min(left, maxX))}px`,
    top: `${Math.max(minY, Math.min(top, maxY))}px`,
    maxWidth: `${Math.max(0, viewport.value.width - VIEWPORT_GUTTER * 2)}px`,
    visibility: width > 0 && height > 0 ? 'visible' : 'hidden',
  };
});

const songCount = computed(() => dragSession.songPaths?.length ?? dragSession.songs.length);

// 🟢 计算显示内容
const title = computed(() => {
  if (dragSession.type === 'song' && dragSession.songs.length > 0) return dragSession.songs[0].title || dragSession.songs[0].name;
  if (dragSession.type === 'playlist') return dragSession.data?.name || '未知歌单';
  if (dragSession.type === 'folder') return dragSession.data?.name || '未知文件夹';
  return '移动中...';
});

const subtitle = computed(() => {
  if (dragSession.type === 'song' && dragSession.targetFolder) return `移动到 ${dragSession.targetFolder.name}`;
  if (dragSession.type === 'song' && songCount.value > 1) return `共 ${songCount.value} 首歌曲`;
  if (dragSession.type === 'song' && dragSession.songs.length > 0) return dragSession.songs[0].artist;
  if (dragSession.type === 'playlist') return '歌单';
  if (dragSession.type === 'folder') return dragSession.targetFolder
    ? `移动到 ${dragSession.targetFolder.name}` : '拖到目标文件夹以移动';
  return '';
});

const badgeCount = computed(() => {
  if (dragSession.type === 'song') return songCount.value;
  return 0;
});
</script>

<template>
  <teleport to="body">
    <transition name="fade">
      <div 
        v-if="isGhostVisible"
        ref="ghostElement"
        class="fixed w-max z-[9999] pointer-events-none p-3 bg-white/90 dark:bg-[#1a1a1a]/90 backdrop-blur-md rounded-lg shadow-2xl border border-white/20 dark:border-white/10 flex items-center gap-3 select-none transition-transform"
        :style="ghostStyle"
      >
        <!-- Icon / Cover Area -->
        <div 
          class="w-12 h-12 bg-gray-200/50 dark:bg-white/10 flex items-center justify-center overflow-hidden shrink-0 shadow-sm relative rounded"
        >
          <!-- Song Cover -->
          <img v-if="dragSession.type === 'song' && ghostCover" :src="ghostCover" class="w-full h-full object-cover" />
          
          <!-- Default Icons based on Type -->
          <template v-else>
             <!-- Song Default -->
             <svg v-if="dragSession.type === 'song'" xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-gray-400 dark:text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
             </svg>
             <!-- Playlist Default -->
             <svg v-else-if="dragSession.type === 'playlist'" xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-gray-400 dark:text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
             </svg>
             <!-- Folder Default -->
             <svg v-else-if="dragSession.type === 'folder'" xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-gray-400 dark:text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
             </svg>
          </template>

          <div class="absolute inset-0 bg-black/5"></div>
        </div>

        <div class="flex flex-col min-w-0">
          <span class="text-sm font-bold text-gray-900 dark:text-white truncate max-w-[200px] drop-shadow-sm">{{ title }}</span>
          <span class="text-xs text-gray-500 dark:text-white/60 truncate max-w-[200px]">{{ subtitle }}</span>
        </div>
        
        <div v-if="badgeCount > 1" class="absolute -top-2 -right-2 w-6 h-6 bg-[#EC4141] text-white rounded-full flex items-center justify-center text-xs font-bold shadow-md border-2 border-white dark:border-[#222]">
           {{ badgeCount }}
        </div>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
