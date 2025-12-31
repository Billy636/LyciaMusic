<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch, nextTick } from 'vue';
import { usePlayer } from '../../composables/player';

const props = defineProps<{
  visible: boolean,
  x: number,
  y: number,
  path: string
}>();

const emit = defineEmits(['close']);

const { openInFinder } = usePlayer();
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

  // 极致兜底：确保不溢出屏幕顶端或左侧
  top = Math.max(8, top);
  left = Math.max(8, left);

  return {
    left: `${left}px`,
    top: `${top}px`,
    visibility: (menuSize.value.height === 0 ? 'hidden' : 'visible') as any
  };
});

const handleGlobalClick = (e: MouseEvent) => {
  if (props.visible && menuRef.value && !menuRef.value.contains(e.target as Node)) {
    emit('close');
  }
};

onMounted(() => window.addEventListener('mousedown', handleGlobalClick));
onUnmounted(() => window.removeEventListener('mousedown', handleGlobalClick));

const handleOpenFolder = () => {
  openInFinder(props.path);
  emit('close');
};
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
      <div @click="handleOpenFolder" class="px-4 py-2.5 hover:bg-gray-100 cursor-pointer flex items-center group transition-colors">
        <div class="w-5 h-5 mr-3 flex items-center justify-center text-gray-500 group-hover:text-gray-800">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
            <path d="M19.5 21a3 3 0 003-3v-4.5a3 3 0 00-3-3h-15a3 3 0 00-3 3V18a3 3 0 003 3h15zM1.5 10.146V6a3 3 0 013-3h5.379a2.25 2.25 0 011.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 013 3v1.146A4.483 4.483 0 0019.5 9h-15a4.483 4.483 0 00-3 1.146z" />
          </svg>
        </div>
        <span>打开文件所在目录</span>
      </div>
    </div>
  </Teleport>
</template>
