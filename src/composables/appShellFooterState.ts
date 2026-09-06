import type { Song } from '../types';

export const shouldShowPlayerFooter = (queue: unknown[] | number, currentSong: Song | null) =>
  (typeof queue === 'number' ? queue : queue.length) > 0 || currentSong !== null;
