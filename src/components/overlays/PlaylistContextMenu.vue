<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch, nextTick } from 'vue';

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  playlistName: string;
  selectedCount?: number;
}>();

const emit = defineEmits(['close', 'play', 'addToQueue', 'delete', 'cancel']);

const menuRef = ref<HTMLElement | null>(null);

// 存储菜单尺寸
const menuSize = ref({ width: 0, height: 0 });

// 当菜单显示时，立即测量其尺寸
watch(() => props.visible, async (newVal) => {
  if (newVal) {
    await nextTick();
    if (menuRef.value) {
      menuSize.value = {
        width: menuRef.value.offsetWidth,
        height: menuRef.value.offsetHeight
      };
    }
  } else {
    menuSize.value = { width: 0, height: 0 };
  }
});

const menuStyle = computed(() => {
  if (!props.visible) return {};

  let top = props.y;
  let left = props.x;

  // 边界检查 - 垂直方向
  if (top + menuSize.value.height > window.innerHeight) {
    top = props.y - menuSize.value.height;
  }

  // 边界检查 - 水平方向
  if (left + menuSize.value.width > window.innerWidth) {
    left = props.x - menuSize.value.width;
  }

  // 极致兜底
  top = Math.max(8, top);
  left = Math.max(8, left);

  return {
    left: `${left}px`,
    top: `${top}px`,
    visibility: (menuSize.value.height === 0 ? 'hidden' : 'visible') as any
  };
});

const handleClickOutside = (e: MouseEvent) => {
  if (menuRef.value && !menuRef.value.contains(e.target as Node)) {
    emit('cancel');
    emit('close');
  }
};

onMounted(() => window.addEventListener('mousedown', handleClickOutside));
onUnmounted(() => window.removeEventListener('mousedown', handleClickOutside));

const itemClass = "px-4 py-2.5 hover:bg-gray-100 dark:hover:bg-white/10 cursor-pointer flex items-center group transition-colors";
</script>

<template>
  <Teleport to="body">
    <div 
      v-if="visible"
      ref="menuRef"
      class="fixed z-[9999] bg-white/80 dark:bg-[#2b2b2b]/90 backdrop-blur-2xl rounded-lg shadow-xl border border-gray-100/50 dark:border-white/10 py-1.5 text-sm text-gray-700 dark:text-white/90 min-w-[180px] animate-in fade-in zoom-in-95 duration-75 select-none"
      :style="menuStyle"
      @contextmenu.prevent
    >
      <div class="px-4 py-2 text-xs text-gray-400 dark:text-white/40 border-b border-gray-100/50 dark:border-white/10 mb-1 truncate max-w-[200px]">
        {{ selectedCount && selectedCount > 1 ? `已选中 ${selectedCount} 个歌单` : playlistName }}
      </div>

      <div v-if="!selectedCount || selectedCount <= 1" @click="emit('play')" :class="itemClass">
        <div class="w-5 h-5 mr-3 flex items-center justify-center text-gray-500 dark:text-white/60 group-hover:text-gray-800 dark:group-hover:text-white">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" /></svg>
        </div>
        <span>播放</span>
      </div>

      <div @click="emit('addToQueue')" :class="itemClass">
        <div class="w-5 h-5 mr-3 flex items-center justify-center text-gray-500 dark:text-white/60 group-hover:text-gray-800 dark:group-hover:text-white">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
        </div>
        <span>添加到播放队列</span>
      </div>

      <div class="h-[1px] bg-gray-100 dark:bg-white/10 my-1"></div>

      <div @click="emit('delete')" class="px-4 py-2.5 hover:bg-gray-100 dark:hover:bg-white/10 cursor-pointer text-[#EC4141] flex items-center group transition-colors">
        <div class="w-5 h-5 mr-3 flex items-center justify-center text-[#EC4141]">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
        </div>
        <span>{{ selectedCount && selectedCount > 1 ? `删除选中的 ${selectedCount} 个歌单` : '删除歌单' }}</span>
      </div>
    </div>
  </Teleport>
</template>