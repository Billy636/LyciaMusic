<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

defineProps<{
  visible: boolean;
  x: number;
  y: number;
  folderPath: string; // 当前右键点击的文件夹路径
}>();

const emit = defineEmits(['close', 'play', 'addToQueue', 'createPlaylist', 'openFolder', 'remove']);

const menuRef = ref<HTMLElement | null>(null);

// 点击外部关闭
const handleClickOutside = (e: MouseEvent) => {
  if (menuRef.value && !menuRef.value.contains(e.target as Node)) {
    emit('close');
  }
};

onMounted(() => window.addEventListener('click', handleClickOutside));
onUnmounted(() => window.removeEventListener('click', handleClickOutside));

// 简单的样式封装
const itemClass = "px-4 py-2 hover:bg-gray-100 cursor-pointer text-sm text-gray-700 flex items-center gap-2 transition-colors";
</script>

<template>
  <div 
    v-if="visible"
    ref="menuRef"
    class="fixed z-[9999] bg-white rounded-lg shadow-xl border border-gray-100 py-1 w-48 overflow-hidden select-none animate-in fade-in zoom-in-95 duration-100"
    :style="{ top: y + 'px', left: x + 'px' }"
    @contextmenu.prevent
  >
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

    <div @click="emit('remove')" class="px-4 py-2 hover:bg-gray-100 cursor-pointer text-sm text-[#EC4141] flex items-center gap-2 transition-colors">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
      从列表删除
    </div>
  </div>
</template>