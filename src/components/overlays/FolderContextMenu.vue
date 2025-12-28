<script setup lang="ts">
import { onMounted, onUnmounted, ref, nextTick, watch } from 'vue';

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  folderPath: string;
  selectedCount?: number; // 新增：选中数量
}>();

const emit = defineEmits(['close', 'play', 'addToQueue', 'createPlaylist', 'openFolder', 'remove', 'refresh']);

const menuRef = ref<HTMLElement | null>(null);
const adjustedY = ref(props.y);

// 监听 visible 或 y 的变化，重新计算位置
watch([() => props.visible, () => props.y], async ([newVisible]) => {
  if (newVisible) {
    await nextTick();
    if (menuRef.value) {
      const menuHeight = menuRef.value.offsetHeight;
      const windowHeight = window.innerHeight;
      
      // 如果底部超出屏幕，就向上弹出
      if (props.y + menuHeight > windowHeight - 10) {
        adjustedY.value = props.y - menuHeight;
      } else {
        adjustedY.value = props.y;
      }
    }
  }
});

// 点击外部关闭
const handleClickOutside = (e: MouseEvent) => {
  if (menuRef.value && !menuRef.value.contains(e.target as Node)) {
    emit('close');
  }
};

onMounted(() => window.addEventListener('mousedown', handleClickOutside)); // 使用 mousedown 体验更好
onUnmounted(() => window.removeEventListener('mousedown', handleClickOutside));

const itemClass = "px-4 py-2 hover:bg-gray-100 cursor-pointer text-sm text-gray-700 flex items-center gap-2 transition-colors";
</script>

<template>
  <div 
    v-if="visible"
    ref="menuRef"
    class="fixed z-[9999] bg-white rounded-lg shadow-xl border border-gray-100 py-1 w-56 overflow-hidden select-none animate-in fade-in zoom-in-95 duration-100"
    :style="{ top: adjustedY + 'px', left: x + 'px' }"
    @contextmenu.prevent
  >
    <!-- 批量操作时，只显示删除 -->
    <template v-if="selectedCount && selectedCount > 1">
       <div class="px-4 py-2 text-xs text-gray-400 border-b border-gray-50">
         已选择 {{ selectedCount }} 个文件夹
       </div>
       <div @click="emit('remove')" class="px-4 py-2 hover:bg-gray-100 cursor-pointer text-sm text-[#EC4141] flex items-center gap-2 transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
        批量移除文件夹
      </div>
    </template>

    <template v-else>
      <div @click="emit('play')" :class="itemClass">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-500" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" /></svg>
        播放
      </div>
      <div @click="emit('addToQueue')" :class="itemClass">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
        添加到播放队列
      </div>
      
      <div class="h-[1px] bg-gray-100 my-1"></div>

      <div @click="emit('createPlaylist')" :class="itemClass">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
        创建为歌单
      </div>
      
      <div @click="emit('openFolder')" :class="itemClass">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" /></svg>
        打开文件所在目录
      </div>

      <div class="h-[1px] bg-gray-100 my-1"></div>

      <div @click="emit('refresh')" :class="itemClass">
         <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
         刷新文件夹内容
      </div>

      <div @click="emit('remove')" class="px-4 py-2 hover:bg-gray-100 cursor-pointer text-sm text-[#EC4141] flex items-center gap-2 transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
        从列表删除
      </div>
    </template>
  </div>
</template>