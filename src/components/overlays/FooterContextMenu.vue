<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch, nextTick, type Component } from 'vue';
import { useRouter } from 'vue-router';
import { Disc3, Folder, Info, Plus, UserRound } from 'lucide-vue-next';

import { usePlayer } from '../../composables/player';
import { useHomeNavigation } from '../../composables/useHomeNavigation';
import { useSongInfoDialog } from '../../composables/useSongInfoDialog';
import { useToast } from '../../composables/toast';
import { useAddToPlaylistDialog } from '../../features/collections/addToPlaylistDialog';
import { getSongAlbumKey, getSongArtistNames } from '../../features/library/playerLibraryViewShared';
import type { Song } from '../../types';

type FooterMenuAction =
  | 'addToPlaylist'
  | 'viewArtist'
  | 'viewAlbum'
  | 'openFolder'
  | 'viewSongInfo';

type FooterMenuEntry =
  | { type: 'divider'; key: string }
  | { type: 'action'; key: FooterMenuAction; label: string; icon: Component };

const props = defineProps<{
  visible: boolean,
  x: number,
  y: number,
  song: Song | null
}>();

const emit = defineEmits(['close']);

const { openInFinder } = usePlayer();
const { openAddToPlaylistDialog } = useAddToPlaylistDialog();
const { openSongInfo } = useSongInfoDialog();
const { showToast } = useToast();
const router = useRouter();
const { openHomeArtist, openHomeAlbum } = useHomeNavigation(router);
const menuRef = ref<HTMLElement | null>(null);

// 存储菜单尺寸
const menuSize = ref({ width: 0, height: 0 });

const menuEntries: FooterMenuEntry[] = [
  { type: 'action', key: 'addToPlaylist', label: '收藏到歌单', icon: Plus },
  { type: 'action', key: 'viewArtist', label: '查看歌手', icon: UserRound },
  { type: 'action', key: 'viewAlbum', label: '查看专辑', icon: Disc3 },
  { type: 'divider', key: 'divider-file' },
  { type: 'action', key: 'openFolder', label: '打开文件所在目录', icon: Folder },
  { type: 'action', key: 'viewSongInfo', label: '查看歌曲信息', icon: Info },
];

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

const isMeaningfulMetadataValue = (value: string | undefined) => {
  const normalized = value?.trim() || '';
  return normalized !== '' && normalized.toLowerCase() !== 'unknown';
};

const resolvePrimaryArtistName = (song: Song) =>
  getSongArtistNames(song)
    .map(name => name.trim())
    .find(isMeaningfulMetadataValue) || '';

const hasAlbumMetadata = (song: Song) =>
  isMeaningfulMetadataValue(song.album)
  || (
    Boolean(song.album_key?.trim())
    && !song.album_key.trim().toLowerCase().startsWith('unknown::')
  );

const handleAction = (action: FooterMenuAction) => {
  if (!props.song) {
    return;
  }

  switch (action) {
    case 'addToPlaylist':
      openAddToPlaylistDialog(props.song.path);
      break;
    case 'viewArtist': {
      const artistName = resolvePrimaryArtistName(props.song);
      if (!artistName) {
        showToast('当前歌曲缺少歌手信息', 'info');
        break;
      }

      void openHomeArtist(artistName);
      break;
    }
    case 'viewAlbum':
      if (!hasAlbumMetadata(props.song)) {
        showToast('当前歌曲缺少专辑信息', 'info');
        break;
      }

      void openHomeAlbum(getSongAlbumKey(props.song));
      break;
    case 'openFolder':
      void openInFinder(props.song.path);
      break;
    case 'viewSongInfo':
      openSongInfo(props.song);
      break;
  }

  emit('close');
};
</script>

<template>
  <Teleport to="body">
    <div 
      v-if="visible" 
      ref="menuRef"
      class="fixed z-[9999] bg-white/80 backdrop-blur-2xl rounded-lg shadow-xl border border-gray-100/50 py-1.5 text-sm text-gray-700 min-w-[210px] animate-in fade-in zoom-in-95 duration-75 select-none"
      :style="menuStyle"
      @contextmenu.prevent
    >
      <template v-for="entry in menuEntries" :key="entry.key">
        <div
          v-if="entry.type === 'divider'"
          class="my-1 h-px bg-gray-200/70"
        ></div>
        <div
          v-else
          @click="handleAction(entry.key)"
          class="px-4 py-2.5 hover:bg-gray-100 cursor-pointer flex items-center group transition-colors"
        >
          <div class="w-5 h-5 mr-3 flex items-center justify-center text-gray-500 group-hover:text-gray-800">
            <component :is="entry.icon" class="w-5 h-5" :stroke-width="1.8" />
          </div>
          <span>{{ entry.label }}</span>
        </div>
      </template>
    </div>
  </Teleport>
</template>
