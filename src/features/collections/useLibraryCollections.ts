import { storeToRefs } from 'pinia';
import type { Song } from '../../types';
import { playerStorage } from '../../services/storage/playerStorage';
import { historyApi } from '../../services/tauri/historyApi';
import { useCollectionsStore } from './store';
import router from '../../router';
import { useHomeNavigation } from '../../composables/useHomeNavigation';
import { useAddToPlaylistDialog } from './addToPlaylistDialog';

const LEGACY_PLAYER_HISTORY_KEY = 'player_history';

export function useLibraryCollections() {
  const collectionsStore = useCollectionsStore();
  const { openHomeDefault, openHomePlaylist } = useHomeNavigation(router);
  const collectionsRefs = storeToRefs(collectionsStore);
  const { openAddToPlaylistDialog: openDialog } = useAddToPlaylistDialog();

  const createPlaylist = (name: string, initialSongs: string[] = []) =>
    collectionsStore.createPlaylist(name, initialSongs);

  const deletePlaylist = (id: string) => {
    const deleted = collectionsStore.deletePlaylist(id);
    const currentRoute = router.currentRoute.value;
    const openedPlaylistId =
      currentRoute.path === '/' && currentRoute.query.view === 'playlist'
        ? currentRoute.query.filter
        : undefined;

    if (deleted && openedPlaylistId === id) {
      void openHomeDefault({ replace: true });
    }

    return deleted;
  };

  const addToPlaylist = (playlistId: string, path: string) =>
    collectionsStore.addToPlaylist(playlistId, path);

  const removeFromPlaylist = (playlistId: string, path: string) =>
    collectionsStore.removeFromPlaylist(playlistId, path);

  const addSongsToPlaylist = (playlistId: string, songPaths: string[]) =>
    collectionsStore.addSongsToPlaylist(playlistId, songPaths);

  const reorderPlaylists = (from: number, to: number) =>
    collectionsStore.reorderPlaylists(from, to);

  const getSongsFromPlaylist = (playlistId: string) =>
    collectionsStore.getSongsFromPlaylist(playlistId);

  const viewPlaylist = (playlistId: string) => {
    void openHomePlaylist(playlistId);
  };

  const resolveSongPath = (target: Song | string | null | undefined) => {
    if (!target) {
      return null;
    }

    return typeof target === 'string' ? target : target.path;
  };

  const isFavorite = (target: Song | string | null | undefined) =>
    collectionsStore.isFavoritePath(resolveSongPath(target));

  const toggleFavorite = (target: Song | string) => {
    const path = resolveSongPath(target);
    if (!path) {
      return false;
    }

    return collectionsStore.toggleFavoritePath(path);
  };

  const removeFavoritePaths = (paths: string[]) => {
    collectionsStore.removeFavoritePaths(paths);
  };

  const clearFavorites = () => {
    collectionsStore.clearFavorites();
  };

  const addToHistory = async (song: Song) => {
    collectionsStore.addRecentSong(song);
    playerStorage.remove(LEGACY_PLAYER_HISTORY_KEY);

    historyApi.addToHistory(song.path).catch(error => {
      console.warn('add_to_history failed:', error);
    });
  };

  const removeFromHistory = async (songPaths: string[]) => {
    if (songPaths.length === 0) {
      return;
    }

    collectionsStore.removeRecentSongs(songPaths);
    playerStorage.remove(LEGACY_PLAYER_HISTORY_KEY);

    try {
      await historyApi.removeFromRecentHistory(songPaths);
    } catch (error) {
      console.warn('remove_from_recent_history failed:', error);
    }
  };

  const clearHistory = async () => {
    collectionsStore.clearRecentSongs();
    playerStorage.remove(LEGACY_PLAYER_HISTORY_KEY);

    try {
      await historyApi.clearRecentHistory();
    } catch (error) {
      console.warn('clear_recent_history failed:', error);
    }
  };

  const openAddToPlaylistDialog = (songPaths: string | string[]) => openDialog(songPaths);

  return {
    ...collectionsRefs,
    createPlaylist,
    deletePlaylist,
    addToPlaylist,
    removeFromPlaylist,
    addSongsToPlaylist,
    reorderPlaylists,
    getSongsFromPlaylist,
    viewPlaylist,
    isFavorite,
    toggleFavorite,
    removeFavoritePaths,
    clearFavorites,
    addToHistory,
    removeFromHistory,
    clearHistory,
    openAddToPlaylistDialog,
  };
}
