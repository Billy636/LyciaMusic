<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { ArrowUpRight, ListPlus, Pencil, Pin, PinOff, Play, Trash2 } from 'lucide-vue-next';

export type PlaylistMenuAction = 'open' | 'play' | 'queue' | 'pin' | 'rename' | 'delete';
const props = defineProps<{ x: number; y: number; name: string; pinned: boolean; empty: boolean }>();
const emit = defineEmits<{ action: [action: PlaylistMenuAction]; close: [] }>();
const menu = ref<HTMLElement | null>(null);
const position = ref({ left: props.x, top: props.y });
const items = computed(() => [
  { action: 'open' as const, label: '打开歌单', icon: ArrowUpRight },
  { action: 'play' as const, label: '播放歌单', icon: Play, disabled: props.empty },
  { action: 'queue' as const, label: '加入播放队列', icon: ListPlus, disabled: props.empty },
  { action: 'pin' as const, label: props.pinned ? '取消置顶' : '置顶歌单', icon: props.pinned ? PinOff : Pin },
  { action: 'rename' as const, label: '重命名', icon: Pencil },
  { action: 'delete' as const, label: '删除歌单', icon: Trash2 },
]);

const onPointerDown = (event: PointerEvent) => {
  if (!menu.value?.contains(event.target as Node)) emit('close');
};
const onKeydown = (event: KeyboardEvent) => {
  event.stopPropagation();
  if (event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault();
    emit('close');
  }
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const buttons = Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[index]?.focus();
  }
};

onMounted(async () => {
  await nextTick();
  const rect = menu.value?.getBoundingClientRect();
  if (rect) position.value = { left: Math.max(8, Math.min(props.x, window.innerWidth - rect.width - 8)), top: Math.max(8, Math.min(props.y, window.innerHeight - rect.height - 8)) };
  menu.value?.querySelector<HTMLButtonElement>('button')?.focus();
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('resize', close);
});
const close = () => emit('close');
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointerDown);
  window.removeEventListener('resize', close);
});
</script>

<template>
  <Teleport to="body">
    <div ref="menu" role="menu" :aria-label="`${name}的操作`" class="playlist-actions-menu" :style="{ left: `${position.left}px`, top: `${position.top}px` }" @keydown="onKeydown">
      <div class="menu-heading" :title="name">{{ name }}</div>
      <button v-for="item in items" :key="item.action" type="button" role="menuitem" :disabled="item.disabled" :class="{ danger: item.action === 'delete' }" @click="emit('action', item.action)">
        <component :is="item.icon" :size="15" /><span>{{ item.label }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.playlist-actions-menu { position: fixed; z-index: 200; width: 196px; padding: 6px; border: 1px solid #e8e8e9; border-radius: 12px; background: #fffffff5; color: #36363e; box-shadow: 0 12px 36px #17172020; backdrop-filter: blur(20px); }
.menu-heading { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 8px 10px 10px; font-size: 11px; color: #84848e; border-bottom: 1px solid #80808018; margin-bottom: 4px; }
button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; border-radius: 7px; font-size: 12px; text-align: left; cursor: pointer; }
button:hover, button:focus-visible { background: #80808015; }
button:disabled { opacity: .4; cursor: default; }
button.danger { color: #ec4141; margin-top: 4px; border-top: 1px solid #80808018; }
:global(.dark .playlist-actions-menu) { background: #242428f5; border-color: #ffffff15; color: #ececf0; }
</style>
