import { storeToRefs } from 'pinia';
import { playerStorage } from '../services/storage/playerStorage';
import { useCollectionsStore } from '../features/collections/store';
import { useLibraryStore } from '../features/library/store';
import { usePlaybackStore } from '../features/playback/store';
import { useSettingsStore } from '../features/settings/store';

interface PlayerPersistenceKeys {
  playerPlaylistPaths: string;
  playerQueuePaths: string;
  legacyPlayerPlaylist: string;
  legacyPlayerQueue: string;
}

export const createPlayerPersistence = ({ keys }: { keys: PlayerPersistenceKeys }) => {
  const collectionsStore = useCollectionsStore();
  const libraryStore = useLibraryStore();
  const playbackStore = usePlaybackStore();
  const settingsStore = useSettingsStore();
  const {
    albumCustomOrder,
    folderCustomOrder,
    localCustomOrder,
    sourceSongPaths,
  } = storeToRefs(libraryStore);
  const { playQueuePaths } = storeToRefs(playbackStore);
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  const flushPersistedState = () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }

    playerStorage.writePlayerState({
      playlistPathKey: keys.playerPlaylistPaths,
      queuePathKey: keys.playerQueuePaths,
      legacyPlaylistKey: keys.legacyPlayerPlaylist,
      legacyQueueKey: keys.legacyPlayerQueue,
      sourceSongPaths: sourceSongPaths.value,
      watchedFolders: libraryStore.watchedFolders,
      favoritePaths: collectionsStore.favoritePaths,
      playlists: collectionsStore.playlists,
      settings: settingsStore.settings,
      playQueuePaths: playQueuePaths.value,
      albumCustomOrder: albumCustomOrder.value,
      folderCustomOrder: folderCustomOrder.value,
      localCustomOrder: localCustomOrder.value,
    });
  };

  const schedulePersistedState = () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
    }
    persistTimer = setTimeout(() => {
      flushPersistedState();
    }, 200);
  };

  const dispose = () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
  };

  return {
    flushPersistedState,
    schedulePersistedState,
    dispose,
  };
};
