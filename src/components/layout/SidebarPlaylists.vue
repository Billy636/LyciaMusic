<script setup lang="ts">
import { computed } from 'vue';

import type { Playlist } from '../../types';

interface DragState {
  active: boolean;
  type: string;
  data: any;
  targetPlaylist: { id: string } | null;
}

interface Props {
  isOpen: boolean;
  playlists: Playlist[];
  selectedPlaylistIds: Set<string>;
  playlistCoverCacheVersion: number;
  getPlaylistCover: (playlistId: string) => string | undefined;
  dragState: DragState;
  dragOverId: string | null;
  dragPosition: 'top' | 'bottom' | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (event: 'update:isOpen', value: boolean): void;
  (event: 'createPlaylist'): void;
  (event: 'pointerDown', nativeEvent: PointerEvent, index: number, playlist: Playlist): void;
  (event: 'itemPointerMove', nativeEvent: PointerEvent, playlistId: string): void;
  (event: 'playlistClick', nativeEvent: MouseEvent, id: string): void;
  (event: 'playlistContextMenu', nativeEvent: MouseEvent, playlist: Playlist): void;
  (event: 'deletePlaylist', id: string, name: string): void;
}>();

const isOpenModel = computed({
  get: () => props.isOpen,
  set: (value: boolean) => emit('update:isOpen', value),
});

const getPlaylistCover = (playlistId: string) => {
  void props.playlistCoverCacheVersion;
  return props.getPlaylistCover(playlistId);
};
</script>

<template>
  <div class="mt-6">
    <div class="px-4 pr-3 py-2 flex items-center justify-between group">
      <div class="flex items-center gap-1 cursor-pointer text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors" @click.stop="isOpenModel = !isOpenModel">
        <svg xmlns="http://www.w3.org/2000/svg" :class="['h-3 w-3 transition-transform duration-200', isOpen ? 'rotate-90' : '']" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
        <span class="text-xs font-bold tracking-wide">我的歌单</span>
        <span class="text-xs text-gray-500 dark:text-gray-400 font-normal ml-0.5">{{ playlists.length }}</span>
      </div>
      <button @click.stop="$emit('createPlaylist')" class="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded p-0.5 transition-colors" title="新建歌单"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg></button>
    </div>

    <Transition name="playlist-list">
      <ul v-show="isOpen" class="space-y-0.5 mt-1 overflow-hidden">
        <TransitionGroup name="playlist-item">
          <li
            v-for="(list, index) in playlists"
            :key="list.id"
            @pointerdown="$emit('pointerDown', $event, index, list)"
            @pointermove="$emit('itemPointerMove', $event, list.id)"
            @click.stop="$emit('playlistClick', $event, list.id)"
            @contextmenu="$emit('playlistContextMenu', $event, list)"
            :data-playlist-id="list.id"
            :data-playlist-name="list.name"
            class="playlist-drop-target px-3 py-2 mx-2 rounded-md cursor-pointer flex items-center transition-all duration-300 group relative border-t-2 border-transparent border-b-2 select-none active:scale-[0.98] [touch-action:none]"
            :class="[
              selectedPlaylistIds.has(list.id) ? 'bg-black/10 dark:bg-white/10 text-black dark:text-white font-medium shadow-sm translate-x-1' : 'hover:bg-black/5 dark:hover:bg-white/5 text-gray-600 dark:text-gray-300 hover:translate-x-1',
              (dragState.active && dragState.type === 'playlist' && dragState.data?.id === list.id) ? 'opacity-50 bg-gray-100 dark:bg-white/5' : '',
              (dragState.active && dragState.targetPlaylist?.id === list.id && dragState.type === 'song') ? '!bg-red-500/10 !ring-2 !ring-[#EC4141] ring-inset' : '',
              (dragState.type === 'playlist' && dragOverId === list.id && dragPosition === 'top') ? '!border-t-[#EC4141]' : '',
              (dragState.type === 'playlist' && dragOverId === list.id && dragPosition === 'bottom') ? '!border-b-[#EC4141]' : ''
            ]"
          >
            <div class="w-9 h-9 rounded bg-gray-200/50 border border-gray-100/50 shrink-0 overflow-hidden mr-3 flex items-center justify-center transition-transform duration-300 group-hover:scale-110">
              <img v-if="getPlaylistCover(list.id)" :src="getPlaylistCover(list.id)" class="w-full h-full object-cover" alt="Cover" />
              <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 dark:text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
            </div>
            <div class="flex-1 min-w-0 flex flex-col justify-center">
              <span class="text-sm truncate leading-tight mb-0.5">{{ list.name }}</span>
              <span class="text-[10px] text-gray-600 dark:text-gray-300 leading-tight">{{ list.songPaths.length }} 首</span>
            </div>
            <button @click.stop="$emit('deletePlaylist', list.id, list.name)" class="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-gray-400 dark:text-white/60 hover:text-red-500 transition-all p-1" title="删除歌单"><svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
          </li>
        </TransitionGroup>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
.playlist-item-enter-active,
.playlist-item-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.playlist-item-enter-from,
.playlist-item-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}

.playlist-list-enter-active,
.playlist-list-leave-active {
  transition: all 0.3s ease-in-out;
  max-height: 500px;
  overflow: hidden;
}

.playlist-list-enter-from,
.playlist-list-leave-to {
  max-height: 0;
  opacity: 0;
}
</style>
