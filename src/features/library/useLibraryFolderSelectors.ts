import { computed, type ComputedRef, type Ref } from 'vue';

import type { FolderSortMode } from '../../services/storage/playerStorage';
import type { Song } from '../../types';
import { sortItemsByAlphabetIndex } from '../../utils/alphabetIndex';
import {
  compareSongPathsByTrackNumber,
  getSongFileNameLabel,
  getSongTitleLabel,
  isDirectParent,
} from './playerLibraryViewShared';

interface FolderListItem {
  path: string;
  name: string;
  count: number;
  firstSongPath: string;
}

interface UseLibraryFolderSelectorsOptions {
  watchedFolders: Ref<string[]>;
  sourceSongPaths: Ref<string[]>;
  songLookup: ComputedRef<Map<string, Song>>;
  currentFolderFilter: Ref<string>;
  folderSortMode: Ref<FolderSortMode>;
  folderCustomOrder: Ref<Record<string, string[]>>;
}

export function useLibraryFolderSelectors({
  watchedFolders,
  sourceSongPaths,
  songLookup,
  currentFolderFilter,
  folderSortMode,
  folderCustomOrder,
}: UseLibraryFolderSelectorsOptions) {
  const lookupSong = (path: string): Song | null => {
    const direct = songLookup.value.get(path);
    if (direct) return direct;
    const normalized = path.replace(/\\/g, '/').toLowerCase();
    for (const [key, song] of songLookup.value.entries()) {
      if (key.replace(/\\/g, '/').toLowerCase() === normalized) {
        return song;
      }
    }
    return null;
  };

  const sourceSongs = computed(() =>
    sourceSongPaths.value
      .map(path => lookupSong(path))
      .filter((song): song is Song => !!song),
  );

  const currentFolderSongPaths = computed(() => {
    if (!currentFolderFilter.value) {
      return [];
    }

    const paths = sourceSongPaths.value.filter(path => isDirectParent(currentFolderFilter.value, path));
    if (folderSortMode.value !== 'custom' && songLookup.value.size === 0) {
      return paths;
    }

    if (folderSortMode.value === 'title') {
      return sortItemsByAlphabetIndex(paths, (path) => getSongTitleLabel(lookupSong(path), path));
    }

    if (folderSortMode.value === 'name') {
      return sortItemsByAlphabetIndex(paths, (path) => getSongFileNameLabel(lookupSong(path), path));
    }

    if (folderSortMode.value === 'artist') {
      return [...paths].sort((left, right) =>
        (lookupSong(left)?.artist || '').localeCompare(lookupSong(right)?.artist || '', 'zh-CN'),
      );
    }

    if (folderSortMode.value === 'added_at') {
      return [...paths].sort((left, right) =>
        (lookupSong(right)?.added_at || 0) - (lookupSong(left)?.added_at || 0),
      );
    }

    if (folderSortMode.value === 'track_number') {
      const sortedPaths = [...paths];
      sortedPaths.sort((left, right) =>
        compareSongPathsByTrackNumber(left, right, songLookup.value),
      );
      return sortedPaths;
    }

    if (folderSortMode.value === 'custom') {
      const customOrder = folderCustomOrder.value[currentFolderFilter.value] || [];
      if (customOrder.length > 0) {
        const orderMap = new Map(customOrder.map((path, index) => [path, index]));
        return [...paths].sort((left, right) => {
          const leftIndex = orderMap.has(left) ? orderMap.get(left)! : Number.MAX_SAFE_INTEGER;
          const rightIndex = orderMap.has(right) ? orderMap.get(right)! : Number.MAX_SAFE_INTEGER;
          return leftIndex - rightIndex;
        });
      }
    }

    return paths;
  });

  const folderList = computed<FolderListItem[]>(() =>
    watchedFolders.value.map(folderPath => {
      const songsInFolder = sourceSongPaths.value.filter(path => isDirectParent(folderPath, path));

      return {
        path: folderPath,
        name: folderPath.split(/[/\\]/).pop() || folderPath,
        count: songsInFolder.length,
        firstSongPath: songsInFolder.length > 0 ? songsInFolder[0] : '',
      };
    }),
  );

  const currentFolderSongs = computed(() =>
    currentFolderSongPaths.value
      .map(path => lookupSong(path))
      .filter((song): song is Song => !!song),
  );

  return {
    folderList,
    currentFolderSongPaths,
    currentFolderSongs,
    sourceSongs,
  };
}
