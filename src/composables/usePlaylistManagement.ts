import { computed, ref, watch, type Ref } from 'vue';
import type { Playlist } from '../types';

interface PlaylistManagementOptions {
  playlists: Ref<Playlist[]>;
  visiblePlaylists: Ref<Playlist[]>;
  createPlaylist: (name: string) => string | null;
  deletePlaylist: (id: string) => unknown;
  removePinned: (ids: string[]) => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function usePlaylistManagement(options: PlaylistManagementOptions) {
  const isManaging = ref(false);
  const selectedIds = ref(new Set<string>());
  const showNameModal = ref(false);
  const renameId = ref<string | null>(null);
  const initialName = ref('');
  const showDeleteModal = ref(false);
  const pendingDeleteIds = ref<string[]>([]);
  const deleteMessage = ref('');
  const allVisibleSelected = computed(() => options.visiblePlaylists.value.length > 0 && options.visiblePlaylists.value.every(playlist => selectedIds.value.has(playlist.id)));

  watch(() => options.visiblePlaylists.value.map(playlist => playlist.id), ids => {
    const visible = new Set(ids);
    selectedIds.value = new Set([...selectedIds.value].filter(id => visible.has(id)));
  });

  const toggleSelection = (id: string) => {
    if (!options.visiblePlaylists.value.some(playlist => playlist.id === id)) return;
    const next = new Set(selectedIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds.value = next;
  };
  const toggleSelectAll = () => {
    selectedIds.value = allVisibleSelected.value ? new Set() : new Set(options.visiblePlaylists.value.map(playlist => playlist.id));
  };
  const exitManagement = () => {
    isManaging.value = false;
    selectedIds.value = new Set();
  };
  const requestCreate = () => {
    renameId.value = null;
    initialName.value = '';
    showNameModal.value = true;
  };
  const requestRename = (playlist: Playlist) => {
    renameId.value = playlist.id;
    initialName.value = playlist.name;
    showNameModal.value = true;
  };
  const confirmName = (value: string) => {
    if (!showNameModal.value) return;
    const name = value.trim();
    if (!name) return;
    if (renameId.value) {
      const playlist = options.playlists.value.find(item => item.id === renameId.value);
      if (!playlist) {
        showNameModal.value = false;
        options.showToast('这个歌单已被删除，无法重命名', 'info');
        return;
      }
      playlist.name = name;
      options.showToast('歌单已重命名', 'success');
    } else {
      if (!options.createPlaylist(name)) return;
      options.showToast('歌单已创建，可从歌曲列表添加音乐', 'success');
    }
    showNameModal.value = false;
  };
  const requestDelete = (ids: string[]) => {
    const targets = options.playlists.value.filter(playlist => ids.includes(playlist.id));
    if (!targets.length) return;
    // 冻结确认目标，避免弹窗期间的选择或筛选变化改变实际删除对象。
    pendingDeleteIds.value = targets.map(playlist => playlist.id);
    deleteMessage.value = `${targets.length === 1 ? `确定删除歌单「${targets[0].name}」吗？` : `确定删除选中的 ${targets.length} 个歌单吗？`}仅移除歌单，不会删除本地音乐文件。此操作无法撤销。`;
    showDeleteModal.value = true;
  };
  const confirmDelete = () => {
    const ids = [...pendingDeleteIds.value];
    if (!showDeleteModal.value || !ids.length) return;
    ids.forEach(id => options.deletePlaylist(id));
    options.removePinned(ids);
    selectedIds.value = new Set([...selectedIds.value].filter(id => !ids.includes(id)));
    pendingDeleteIds.value = [];
    showDeleteModal.value = false;
    options.showToast(`已删除 ${ids.length} 个歌单，本地音乐文件未改动`, 'success');
  };

  return { isManaging, selectedIds, allVisibleSelected, toggleSelection, toggleSelectAll, exitManagement, showNameModal, renameId, initialName, requestCreate, requestRename, confirmName, showDeleteModal, deleteMessage, requestDelete, confirmDelete };
}
