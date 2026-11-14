import { computed, ref } from 'vue';

import { useToast } from '../../composables/toast';
import { useCollectionsStore } from './store';

const isAddToPlaylistDialogVisible = ref(false);
const addToPlaylistTargetSongPaths = ref<string[]>([]);
let afterAddToPlaylist: (() => void) | null = null;

const normalizeSongPaths = (songPaths: string | string[]) => {
  const list = Array.isArray(songPaths) ? songPaths : [songPaths];
  return [...new Set(list.filter((path): path is string => typeof path === 'string' && path.length > 0))];
};

export function useAddToPlaylistDialog() {
  const collectionsStore = useCollectionsStore();
  const { showToast } = useToast();

  const closeAddToPlaylistDialog = () => {
    isAddToPlaylistDialogVisible.value = false;
    addToPlaylistTargetSongPaths.value = [];
    afterAddToPlaylist = null;
  };

  const openAddToPlaylistDialog = (
    songPaths: string | string[],
    options: { onAdded?: () => void } = {},
  ) => {
    const nextSongPaths = normalizeSongPaths(songPaths);
    if (nextSongPaths.length === 0) {
      return false;
    }

    addToPlaylistTargetSongPaths.value = nextSongPaths;
    isAddToPlaylistDialogVisible.value = true;
    afterAddToPlaylist = options.onAdded ?? null;
    return true;
  };

  const addSelectedSongsToPlaylist = (playlistId: string) => {
    if (collectionsStore.getPlaylistById(playlistId)?.importData?.linked) {
      showToast('文件关联歌单由源文件管理，请先复制为普通歌单', 'info');
      return 0;
    }
    const addedCount = collectionsStore.addSongsToPlaylist(
      playlistId,
      addToPlaylistTargetSongPaths.value,
    );
    const onAdded = afterAddToPlaylist;

    closeAddToPlaylistDialog();

    if (onAdded) {
      onAdded();
    }

    showToast(addedCount === 0 ? '歌单内歌曲重复' : '已加入歌单', addedCount === 0 ? 'info' : 'success');
    return addedCount;
  };

  return {
    showAddToPlaylistModal: isAddToPlaylistDialogVisible,
    playlistAddTargetSongs: addToPlaylistTargetSongPaths,
    selectedCount: computed(() => addToPlaylistTargetSongPaths.value.length),
    openAddToPlaylistDialog,
    closeAddToPlaylistDialog,
    addSelectedSongsToPlaylist,
  };
}
