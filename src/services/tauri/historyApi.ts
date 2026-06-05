import { tauriInvoke } from './invoke';
import type { RecentHistoryImportRecord, RecentHistoryRecord } from './contracts';

export const historyApi = {
  addToHistory: (songPath: string) =>
    tauriInvoke('add_to_history', { songPath }),
  removeFromRecentHistory: (songPaths: string[]) =>
    tauriInvoke('remove_from_recent_history', { songPaths }),
  removeSongsFromHistoryAndStatistics: (songPaths: string[]) =>
    tauriInvoke('remove_songs_from_history_and_statistics', { songPaths }),
  clearRecentHistory: () =>
    tauriInvoke('clear_recent_history'),
  getRecentHistory: (limit: number) =>
    tauriInvoke('get_recent_history', { limit }) as Promise<RecentHistoryRecord[]>,
  importRecentHistory: (entries: RecentHistoryImportRecord[]) =>
    tauriInvoke('import_recent_history', { entries }),
};
