<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { ArrowDownWideNarrow, Check, ChevronDown } from 'lucide-vue-next';
import { usePlaylistLibraryStore, type PlaylistLibrarySortMode } from '../../features/collections/playlistLibrary';
import { useCollectionsStore } from '../../features/collections/store';
import { playlistSortOptions } from '../../features/collections/playlistSort';
import type { PlaylistSortMode } from '../../services/storage/playerStorage';

const library = usePlaylistLibraryStore();
const collections = useCollectionsStore();
const menuId = useId();
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const isOpen = ref(false);
const position = ref({ left: 0, top: 0 });
const libraryOptions: { value: PlaylistLibrarySortMode; label: string }[] = [
  { value: 'custom', label: '默认排序' },
  { value: 'newest', label: '最近创建' },
  { value: 'name', label: '名称 A–Z' },
  { value: 'count', label: '歌曲数量' },
];

const close = (restoreFocus = false) => {
  isOpen.value = false;
  if (restoreFocus) trigger.value?.focus();
};
const open = async () => {
  isOpen.value = true;
  await nextTick();
  if (!isOpen.value || !trigger.value || !menu.value) return;
  const anchor = trigger.value.getBoundingClientRect();
  const bounds = menu.value.getBoundingClientRect();
  position.value = {
    left: Math.max(8, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 8)),
    top: Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - bounds.height - 8)),
  };
  menu.value.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
};
const setLibrarySort = (value: PlaylistLibrarySortMode) => {
  library.sortMode = value;
  close(true);
};
const setSongSort = (value: PlaylistSortMode) => {
  collections.playlistSortMode = value;
  close(true);
};
const onPointerDown = (event: PointerEvent) => {
  if (isOpen.value && !menu.value?.contains(event.target as Node) && !trigger.value?.contains(event.target as Node)) close();
};
const onScroll = (event: Event) => {
  if (isOpen.value && !menu.value?.contains(event.target as Node)) close();
};
const onResize = () => close();
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' || event.key === 'Tab') {
    event.stopPropagation();
    if (event.key === 'Escape') event.preventDefault();
    close(true);
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const buttons = Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('button') ?? []);
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[index]?.focus();
};

onMounted(() => {
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onScroll, true);
});
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointerDown);
  window.removeEventListener('resize', onResize);
  window.removeEventListener('scroll', onScroll, true);
});
</script>

<template>
  <button ref="trigger" type="button" class="sort-trigger" :class="{ active: isOpen }"
    aria-label="排序" aria-haspopup="menu" :aria-expanded="isOpen" :aria-controls="isOpen ? menuId : undefined"
    @click="isOpen ? close() : open()" @keydown.down.prevent="open" @keydown.up.prevent="open">
    <ArrowDownWideNarrow :size="15" /><span>排序</span><ChevronDown :size="13" />
  </button>
  <Teleport to="body">
    <div v-if="isOpen" :id="menuId" ref="menu" class="playlist-sort-menu" role="menu" aria-label="排序"
      :style="{ left: `${position.left}px`, top: `${position.top}px` }" @keydown="onKeydown">
      <div role="group" aria-label="歌单排列">
        <div class="sort-heading" aria-hidden="true">歌单排列</div>
        <button v-for="option in libraryOptions" :key="option.value" type="button" role="menuitemradio" tabindex="-1"
          :aria-checked="library.sortMode === option.value" @click="setLibrarySort(option.value)">
          <span>{{ option.label }}</span><Check v-if="library.sortMode === option.value" :size="14" />
        </button>
      </div>
      <div role="group" aria-label="单内歌曲默认排序" class="song-sort-group">
        <div class="sort-heading" aria-hidden="true">单内歌曲默认排序</div>
        <button v-for="option in playlistSortOptions" :key="option.value" type="button" role="menuitemradio" tabindex="-1"
          :aria-checked="collections.playlistSortMode === option.value" @click="setSongSort(option.value)">
          <span>{{ option.label }}</span><Check v-if="collections.playlistSortMode === option.value" :size="14" />
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.sort-trigger { display: inline-flex; align-items: center; gap: 6px; padding: 7px 4px; border-radius: 6px; color: var(--ink); font-size: 11px; white-space: nowrap; cursor: pointer; }
.sort-trigger > svg { color: var(--muted); }
.sort-trigger:hover, .sort-trigger.active { background: var(--hover); }
.playlist-sort-menu { position: fixed; z-index: 200; width: 208px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); overflow-y: auto; overscroll-behavior: contain; padding: 6px; border: 1px solid #e8e8e9; border-radius: 12px; background: #fffffff5; color: #36363e; box-shadow: 0 12px 36px #17172020; backdrop-filter: blur(20px); }
.sort-heading { padding: 7px 10px; color: #84848e; font-size: 11px; font-weight: 600; }
.song-sort-group { margin-top: 5px; padding-top: 5px; border-top: 1px solid #80808018; }
.playlist-sort-menu button { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; padding: 8px 10px; border-radius: 7px; font-size: 12px; text-align: left; cursor: pointer; }
.playlist-sort-menu button:hover, .playlist-sort-menu button:focus-visible { background: #80808015; outline: none; }
.playlist-sort-menu button[aria-checked="true"] { color: #ec4141; }
:global(.dark .playlist-sort-menu) { background: #242428f5; border-color: #ffffff15; color: #ececf0; }
</style>
