import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tauriInvoke } = vi.hoisted(() => ({
  tauriInvoke: vi.fn(),
}));

vi.mock('./invoke', () => ({
  tauriInvoke,
}));

import { historyApi } from './historyApi';

describe('historyApi', () => {
  beforeEach(() => {
    tauriInvoke.mockReset();
  });

  it('removes all history and statistics for song paths', () => {
    const songPaths = ['C:\\Music\\removed.flac'];

    historyApi.removeSongsFromHistoryAndStatistics(songPaths);

    expect(tauriInvoke).toHaveBeenCalledWith('remove_songs_from_history_and_statistics', {
      songPaths,
    });
  });
});
