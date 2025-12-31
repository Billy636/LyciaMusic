<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch, nextTick } from 'vue';

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  folderPath: string;
  selectedCount?: number; // 新增：选中数量
}>();

const emit = defineEmits(['close', 'play', 'addToQueue', 'createPlaylist', 'openFolder', 'remove', 'refresh', 'cancel']);

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
    visibility: menuSize.value.height === 0 ? 'hidden' : 'visible'
  };
});

// 点击外部关闭
const handleClickOutside = (e: MouseEvent) => {
  if (menuRef.value && !menuRef.value.contains(e.target as Node)) {
    emit('cancel'); // 点击外部时触发取消事件
    emit('close');
  }
};

onMounted(() => window.addEventListener('mousedown', handleClickOutside)); // 使用 mousedown 体验更好
onUnmounted(() => window.removeEventListener('mousedown', handleClickOutside));

const itemClass = "px-4 py-2.5 hover:bg-gray-100 cursor-pointer flex items-center group transition-colors";
</script>

<template>
  <Teleport to="body">
    <div 
      v-if="visible"
      ref="menuRef"
      class="fixed z-[9999] bg-white/80 backdrop-blur-2xl rounded-lg shadow-xl border border-gray-100/50 py-1.5 text-sm text-gray-700 min-w-[180px] animate-in fade-in zoom-in-95 duration-75 select-none"
      :style="menuStyle"
      @contextmenu.prevent
    >
      <!-- 批量操作时，只显示删除 -->
      <template v-if="selectedCount && selectedCount > 1">
        <div class="px-4 py-2 text-xs text-gray-400 border-b border-gray-100/50 mb-1">
          已选择 {{ selectedCount }} 个文件夹
        </div>
        <div @click="emit('remove')" class="px-4 py-2.5 hover:bg-gray-100 cursor-pointer text-[#EC4141] flex items-center group transition-colors">
          <div class="w-5 h-5 mr-3 flex items-center justify-center text-[#EC4141]">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </div>
          <span>批量移除文件夹</span>
        </div>
      </template>

      <template v-else>
        <div @click="emit('play')" :class="itemClass">
          <div class="w-5 h-5 mr-3 flex items-center justify-center text-gray-500 group-hover:text-gray-800">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" /></svg>
          </div>
          <span>播放</span>
        </div>
        <div @click="emit('addToQueue')" :class="itemClass">
          <div class="w-5 h-5 mr-3 flex items-center justify-center text-gray-500 group-hover:text-gray-800">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
          </div>
          <span>添加到播放队列</span>
        </div>
        
        <div class="h-[1px] bg-gray-100 my-1"></div>

        <div @click="emit('createPlaylist')" :class="itemClass">
          <div class="w-5 h-5 mr-3 flex items-center justify-center text-gray-500 group-hover:text-gray-800">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
          </div>
          <span>创建为歌单</span>
        </div>
        
        <div @click="emit('openFolder')" :class="itemClass">
          <div class="w-5 h-5 mr-3 flex items-center justify-center text-gray-500 group-hover:text-gray-800">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" /></svg>
          </div>
          <span>打开文件所在目录</span>
        </div>

        <div class="h-[1px] bg-gray-100 my-1"></div>

        <div @click="emit('refresh')" :class="itemClass">
          <div class="w-5 h-5 mr-3 flex items-center justify-center text-gray-500 group-hover:text-gray-800">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          </div>
          <span>刷新文件夹内容</span>
        </div>

        <div @click="emit('remove')" class="px-4 py-2.5 hover:bg-gray-100 cursor-pointer text-[#EC4141] flex items-center group transition-colors">
          <div class="w-5 h-5 mr-3 flex items-center justify-center text-[#EC4141]">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </div>
          <span>从列表删除</span>
        </div>
      </template>
    </div>
  </Teleport>
</template>