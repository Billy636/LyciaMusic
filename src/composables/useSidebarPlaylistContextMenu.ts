import { ref, type Ref } from 'vue';

import type { Playlist, Song } from '../types';

interface UseSidebarPlaylistContextMenuOptions {
  selectedPlaylistIds: Ref<Set<string>>;
  ensurePlaylistSelected: (id: string) => void;
  getSongsFromPlaylist: (id: string) => Song[];
  addSongsToQueue: (songs: Song[]) => void;
  clearQueue: () => Promise<unknown> | unknown;
  playSong: (song: Song) => Promise<unknown> | unknown;
  openHomePlaylist: (playlistId: string) => Promise<unknown> | unknown;
  deletePlaylist: (id: string) => void;
  clearSelection: () => void;
}

export function useSidebarPlaylistContextMenu({
  selectedPlaylistIds,
  ensurePlaylistSelected,
  getSongsFromPlaylist,
  addSongsToQueue,
  clearQueue,
  playSong,
  openHomePlaylist,
  deletePlaylist,
  clearSelection,
}: UseSidebarPlaylistContextMenuOptions) {
  const showContextMenu = ref(false);
  const contextMenuX = ref(0);
  const contextMenuY = ref(0);
  const targetPlaylist = ref<Playlist | null>(null);
  const showDeleteModal = ref(false);
  const playlistsToDelete = ref<string[]>([]);
  const deleteModalContent = ref('');

  const handleDeletePlaylist = (id: string, name: string) => {
    playlistsToDelete.value = [id];
    deleteModalContent.value = `确定要删除播放列表 "${name}" 吗？`;
    showDeleteModal.value = true;
  };

  const handleDeletePlaylistBatch = (ids: string[], count: number) => {
    playlistsToDelete.value = ids;
    deleteModalContent.value = `确定要删除 ${count} 个播放列表吗？`;
    showDeleteModal.value = true;
  };

  const confirmDeletePlaylist = () => {
    playlistsToDelete.value.forEach(id => deletePlaylist(id));
    clearSelection();
    playlistsToDelete.value = [];
    showDeleteModal.value = false;
  };

  const handlePlaylistContextMenu = (event: MouseEvent, playlist: Playlist) => {
    event.preventDefault();
    event.stopPropagation();
    targetPlaylist.value = playlist;

    ensurePlaylistSelected(playlist.id);

    contextMenuX.value = event.clientX;
    contextMenuY.value = event.clientY;
    showContextMenu.value = true;
  };

  const handleMenuPlay = () => {
    if (!targetPlaylist.value) {
      return;
    }

    const songs = getSongsFromPlaylist(targetPlaylist.value.id);
    if (songs.length > 0) {
      void clearQueue();
      void openHomePlaylist(targetPlaylist.value.id);
      setTimeout(() => {
        void playSong(songs[0]);
      }, 50);
    }
    showContextMenu.value = false;
  };

  const handleMenuAddToQueue = () => {
    if (selectedPlaylistIds.value.size > 1) {
      selectedPlaylistIds.value.forEach(id => {
        addSongsToQueue(getSongsFromPlaylist(id));
      });
    } else if (targetPlaylist.value) {
      addSongsToQueue(getSongsFromPlaylist(targetPlaylist.value.id));
    }
    showContextMenu.value = false;
  };

  const handleMenuDelete = () => {
    if (selectedPlaylistIds.value.size > 0) {
      handleDeletePlaylistBatch(
        Array.from(selectedPlaylistIds.value),
        selectedPlaylistIds.value.size,
      );
    } else if (targetPlaylist.value) {
      handleDeletePlaylist(targetPlaylist.value.id, targetPlaylist.value.name);
    }
    showContextMenu.value = false;
  };

  return {
    showContextMenu,
    contextMenuX,
    contextMenuY,
    targetPlaylist,
    showDeleteModal,
    deleteModalContent,
    handleDeletePlaylist,
    confirmDeletePlaylist,
    handlePlaylistContextMenu,
    handleMenuPlay,
    handleMenuAddToQueue,
    handleMenuDelete,
  };
}
