<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch, type CSSProperties } from 'vue';
import { usePlayer } from '../../composables/player';
import { useLibrarySongResolver } from '../../composables/useLibrarySongResolver';
import { useLibraryDetailSongPathCache } from '../../composables/useLibraryDetailSongPathCache';
import { usePlaybackStore } from '../../features/playback/store';
import { useAddToPlaylistDialog } from '../../features/collections/addToPlaylistDialog';
import { useLibraryCollections } from '../../features/collections/useLibraryCollections';
import { useToast } from '../../composables/toast';
import ModernInputModal from '../common/ModernInputModal.vue';

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  type: 'artist' | 'album';
  targetKey: string;
  targetName: string;
}>();

const emit = defineEmits(['close']);

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
    emit('close');
  }
};

onMounted(() => window.addEventListener('mousedown', handleClickOutside));
onUnmounted(() => window.removeEventListener('mousedown', handleClickOutside));

const itemClass =
  'song-menu-item flex cursor-pointer items-center px-4 py-2.5 transition-colors text-sm text-gray-700 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5';
const sectionTitleClass = 'song-menu-section px-4 pt-1.5 pb-1 text-[11px] font-semibold tracking-[0.08em] text-gray-400 dark:text-white/40 truncate max-w-[220px]';

const motionDelay = (index: number): CSSProperties => ({
  '--menu-item-delay': `${index * 14}ms`,
});

const { playSong } = usePlayer();
const { loadSong } = useLibrarySongResolver();
const { loadArtistSongPaths, loadAlbumSongPaths } = useLibraryDetailSongPathCache();
const { openAddToPlaylistDialog } = useAddToPlaylistDialog();
const { createPlaylist } = useLibraryCollections();
const { showToast } = useToast();
const playbackStore = usePlaybackStore();

const getSongPaths = async (): Promise<string[]> => {
  if (props.type === 'artist') {
    return await loadArtistSongPaths(props.targetKey);
  } else {
    return await loadAlbumSongPaths(props.targetKey, 'track_number');
  }
};

const handlePlay = async () => {
  emit('close');
  const paths = await getSongPaths();
  if (paths.length === 0) {
    showToast('未找到该内容的歌曲', 'info');
    return;
  }
  const song = await loadSong(paths[0]);
  if (song) {
    playbackStore.playQueuePaths = paths;
    playbackStore.tempQueuePaths = [];
    await playSong(song, { preserveQueue: true });
    showToast(`已开始播放`, 'success');
  }
};

const handleAddToQueue = async () => {
  emit('close');
  const paths = await getSongPaths();
  if (paths.length === 0) {
    showToast('未找到该内容的歌曲', 'info');
    return;
  }
  const { addSongPathsToQueue } = usePlayer();
  addSongPathsToQueue(paths);
};

const showCreatePlaylistModal = ref(false);

const handleCreatePlaylistClick = () => {
  emit('close');
  showCreatePlaylistModal.value = true;
};

const confirmCreatePlaylist = async (name: string) => {
  const paths = await getSongPaths();
  if (paths.length === 0) {
    showToast('未找到该内容的歌曲', 'info');
    return;
  }
  createPlaylist(name, paths);
  showToast(`已创建歌单 "${name}"`, 'success');
};

const handleAddToPlaylist = async () => {
  emit('close');
  const paths = await getSongPaths();
  if (paths.length === 0) {
    showToast('未找到该内容的歌曲', 'info');
    return;
  }
  openAddToPlaylistDialog(paths);
};
</script>

<template>
  <div>
    <Teleport to="body">
      <Transition name="song-menu-pop" appear>
        <div
          v-if="visible"
          ref="menuRef"
          class="fixed z-[9999] min-w-[200px] select-none rounded-[18px] border border-white/65 bg-white/78 py-1.5 shadow-[0_20px_45px_rgba(15,23,42,0.16),0_6px_18px_rgba(15,23,42,0.08)] backdrop-blur-[22px] supports-[backdrop-filter]:bg-white/72 dark:border-white/10 dark:bg-[#2c2c2c]/82"
          :style="menuStyle"
          @contextmenu.prevent
        >
          <div :class="sectionTitleClass" :style="motionDelay(0)" :title="targetName">
            {{ type === 'artist' ? '歌手：' : '专辑：' }}{{ targetName }}
          </div>

          <div class="song-menu-divider" :style="motionDelay(1)"></div>

          <div :class="itemClass" :style="motionDelay(2)" @click="handlePlay">
            <div class="mr-3 flex h-5 w-5 shrink-0 items-center justify-center text-[#6b778c] dark:text-white/60">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" />
              </svg>
            </div>
            <span class="min-w-0 flex-1 truncate">播放</span>
          </div>

          <div :class="itemClass" :style="motionDelay(3)" @click="handleAddToQueue">
            <div class="mr-3 flex h-5 w-5 shrink-0 items-center justify-center text-[#6b778c] dark:text-white/60">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <span class="min-w-0 flex-1 truncate">添加到播放队列</span>
          </div>

          <div class="song-menu-divider" :style="motionDelay(4)"></div>

          <div :class="itemClass" :style="motionDelay(5)" @click="handleCreatePlaylistClick">
            <div class="mr-3 flex h-5 w-5 shrink-0 items-center justify-center text-[#6b778c] dark:text-white/60">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              </svg>
            </div>
            <span class="min-w-0 flex-1 truncate">创建为歌单</span>
          </div>

          <div :class="itemClass" :style="motionDelay(6)" @click="handleAddToPlaylist">
            <div class="mr-3 flex h-5 w-5 shrink-0 items-center justify-center text-[#6b778c] dark:text-white/60">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <span class="min-w-0 flex-1 truncate">添加到歌单</span>
          </div>
        </div>
      </Transition>
    </Teleport>

    <ModernInputModal
      v-model:visible="showCreatePlaylistModal"
      title="新建歌单"
      placeholder="请输入歌单名称"
      confirm-text="创建"
      @confirm="confirmCreatePlaylist"
    />
  </div>
</template>

<style scoped>
.song-menu-item {
  margin: 0 0.375rem;
  border-radius: 12px;
}

.song-menu-item:hover {
  background: rgba(15, 23, 42, 0.055);
}

.dark .song-menu-item:hover {
  background: rgba(255, 255, 255, 0.085);
}

.song-menu-divider {
  height: 1px;
  margin: 0.34rem 0.85rem;
  background: linear-gradient(90deg, rgba(148, 163, 184, 0), rgba(148, 163, 184, 0.34), rgba(148, 163, 184, 0));
}

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
