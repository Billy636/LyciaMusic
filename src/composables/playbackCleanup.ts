import type { Ref } from 'vue';
import type { Song } from '../types';

interface PlaybackSongRefs {
  playQueuePaths: Ref<string[]>;
  tempQueuePaths: Ref<string[]>;
  currentSong: Ref<Song | null>;
}

export const removeSongPathsFromPlaybackState = (
  { playQueuePaths, tempQueuePaths, currentSong }: PlaybackSongRefs,
  paths: Iterable<string>,
) => {
  const removedPaths = new Set(paths);
  if (removedPaths.size === 0) {
    return;
  }

  playQueuePaths.value = playQueuePaths.value.filter(path => !removedPaths.has(path));
  tempQueuePaths.value = tempQueuePaths.value.filter(path => !removedPaths.has(path));

  if (currentSong.value && removedPaths.has(currentSong.value.path)) {
    currentSong.value = null;
  }
};
