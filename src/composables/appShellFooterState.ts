import type { Song } from '../types';

export const shouldShowPlayerFooter = (playQueue: Song[], currentSong: Song | null) =>
  playQueue.length > 0 || currentSong !== null;
