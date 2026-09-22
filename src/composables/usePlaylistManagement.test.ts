import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, effectScope, nextTick, ref, type EffectScope } from 'vue';

import type { Playlist } from '../types';
import { usePlaylistManagement } from './usePlaylistManagement';

const scopes: EffectScope[] = [];

const makePlaylist = (id: string, name = `歌单 ${id}`, songPaths: string[] = []): Playlist => ({
  id,
  name,
  songPaths,
  createdAt: '2026-09-22',
});

const createHarness = (initial = [makePlaylist('a'), makePlaylist('b'), makePlaylist('c')]) => {
  const playlists = ref(initial);
  const visibleIds = ref<string[] | null>(null);
  const visiblePlaylists = computed(() => playlists.value.filter(
    playlist => visibleIds.value === null || visibleIds.value.includes(playlist.id),
  ));
  let createdCount = 0;
  const createPlaylist = vi.fn((name: string): string | null => {
    const id = `created-${++createdCount}`;
    playlists.value.push(makePlaylist(id, name));
    return id;
  });
  const deletePlaylist = vi.fn((id: string) => {
    const originalLength = playlists.value.length;
    playlists.value = playlists.value.filter(playlist => playlist.id !== id);
    return playlists.value.length !== originalLength;
  });
  const removePinned = vi.fn();
  const showToast = vi.fn();
  const scope = effectScope();
  scopes.push(scope);
  const management = scope.run(() => usePlaylistManagement({
    playlists,
    visiblePlaylists,
    createPlaylist,
    deletePlaylist,
    removePinned,
    showToast,
  }))!;

  return { management, playlists, visibleIds, visiblePlaylists, createPlaylist, deletePlaylist, removePinned, showToast };
};

afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop());
});

describe('playlist name management', () => {
  it('opens creation with a blank name and clears an earlier rename target', () => {
    const { management, playlists } = createHarness();
    management.requestRename(playlists.value[0]!);

    management.requestCreate();

    expect(management.renameId.value).toBeNull();
    expect(management.initialName.value).toBe('');
    expect(management.showNameModal.value).toBe(true);
  });

  it('trims a new playlist name and closes only after successful creation', () => {
    const { management, playlists, createPlaylist, showToast } = createHarness();
    management.requestCreate();

    management.confirmName('  夜间漫游 \n');

    expect(createPlaylist).toHaveBeenCalledExactlyOnceWith('夜间漫游');
    expect(playlists.value[playlists.value.length - 1]?.name).toBe('夜间漫游');
    expect(management.showNameModal.value).toBe(false);
    expect(showToast).toHaveBeenCalledWith('歌单已创建，可从歌曲列表添加音乐', 'success');
  });

  it.each(['', ' ', '\t\n'])('ignores a blank creation name: %j', (name) => {
    const { management, createPlaylist, showToast } = createHarness();
    management.requestCreate();

    management.confirmName(name);

    expect(createPlaylist).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(management.showNameModal.value).toBe(true);
  });

  it('keeps the name modal open if the creation action cannot create a playlist', () => {
    const { management, playlists, createPlaylist, showToast } = createHarness();
    createPlaylist.mockReturnValueOnce(null);
    management.requestCreate();

    management.confirmName('新歌单');

    expect(playlists.value).toHaveLength(3);
    expect(management.showNameModal.value).toBe(true);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('ignores name confirmation while the modal is closed', () => {
    const { management, playlists, createPlaylist, showToast } = createHarness();

    management.confirmName('不应创建');

    expect(createPlaylist).not.toHaveBeenCalled();
    expect(playlists.value).toHaveLength(3);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('does not create a duplicate playlist when confirmation is dispatched twice', () => {
    const { management, playlists, createPlaylist, showToast } = createHarness();
    management.requestCreate();

    management.confirmName('一次创建');
    management.confirmName('一次创建');

    expect(createPlaylist).toHaveBeenCalledExactlyOnceWith('一次创建');
    expect(playlists.value).toHaveLength(4);
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('renames only the requested playlist with a trimmed name, preserving its songs and metadata', () => {
    const { management, playlists, createPlaylist, showToast } = createHarness([
      makePlaylist('a', '原名称', ['C:/Music/a.flac', 'C:/Music/shared.flac']),
      makePlaylist('b', '其他歌单', ['C:/Music/shared.flac']),
    ]);
    const originalPaths = playlists.value[0]!.songPaths;
    management.requestRename(playlists.value[0]!);
    expect(management.initialName.value).toBe('原名称');
    expect(management.renameId.value).toBe('a');

    management.confirmName('  全新名称  ');

    expect(playlists.value[0]).toEqual({
      id: 'a', name: '全新名称', songPaths: ['C:/Music/a.flac', 'C:/Music/shared.flac'], createdAt: '2026-09-22',
    });
    expect(playlists.value[0]!.songPaths).toBe(originalPaths);
    expect(playlists.value[1]!.name).toBe('其他歌单');
    expect(createPlaylist).not.toHaveBeenCalled();
    expect(management.showNameModal.value).toBe(false);
    expect(showToast).toHaveBeenCalledWith('歌单已重命名', 'success');
  });

  it('ignores a blank rename without losing the original name', () => {
    const { management, playlists, showToast } = createHarness();
    management.requestRename(playlists.value[0]!);

    management.confirmName(' \n ');

    expect(playlists.value[0]!.name).toBe('歌单 a');
    expect(management.showNameModal.value).toBe(true);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('does not create or rename another playlist when the rename target disappeared', () => {
    const { management, playlists, createPlaylist, showToast } = createHarness();
    management.requestRename(playlists.value[0]!);
    playlists.value = playlists.value.filter(playlist => playlist.id !== 'a');

    management.confirmName('新名称');

    expect(playlists.value.map(playlist => playlist.name)).toEqual(['歌单 b', '歌单 c']);
    expect(createPlaylist).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('这个歌单已被删除，无法重命名', 'info');
    expect(management.showNameModal.value).toBe(false);
  });
});

describe('playlist management selection', () => {
  it('toggles individual visible playlists and ignores hidden or unknown IDs', () => {
    const { management, visibleIds } = createHarness();
    visibleIds.value = ['a', 'b'];

    management.toggleSelection('a');
    management.toggleSelection('c');
    management.toggleSelection('unknown');

    expect([...management.selectedIds.value]).toEqual(['a']);
    expect(management.allVisibleSelected.value).toBe(false);
    management.toggleSelection('b');
    expect(management.allVisibleSelected.value).toBe(true);
    management.toggleSelection('a');
    expect([...management.selectedIds.value]).toEqual(['b']);
  });

  it('selects only the current visible result set and toggles all off', () => {
    const { management, visibleIds } = createHarness();
    visibleIds.value = ['a', 'c'];
    management.toggleSelection('a');

    management.toggleSelectAll();

    expect([...management.selectedIds.value]).toEqual(['a', 'c']);
    expect(management.allVisibleSelected.value).toBe(true);
    management.toggleSelectAll();
    expect(management.selectedIds.value.size).toBe(0);
    expect(management.allVisibleSelected.value).toBe(false);
  });

  it('does not report every row selected when the visible result is empty', () => {
    const { management, visibleIds } = createHarness();
    visibleIds.value = [];

    management.toggleSelectAll();

    expect(management.selectedIds.value.size).toBe(0);
    expect(management.allVisibleSelected.value).toBe(false);
  });

  it('prunes hidden selections after filtering and does not restore them when the filter clears', async () => {
    const { management, visibleIds } = createHarness();
    management.toggleSelectAll();

    visibleIds.value = ['b'];
    await nextTick();

    expect([...management.selectedIds.value]).toEqual(['b']);
    expect(management.allVisibleSelected.value).toBe(true);

    visibleIds.value = null;
    await nextTick();

    expect([...management.selectedIds.value]).toEqual(['b']);
    expect(management.allVisibleSelected.value).toBe(false);
  });

  it('cleans externally removed rows from the selection', async () => {
    const { management, playlists } = createHarness();
    management.toggleSelectAll();
    playlists.value = playlists.value.filter(playlist => playlist.id !== 'b');

    await nextTick();

    expect([...management.selectedIds.value]).toEqual(['a', 'c']);
    expect(management.allVisibleSelected.value).toBe(true);
  });

  it('exits management and clears selection without changing any playlist', () => {
    const { management, playlists, deletePlaylist, removePinned } = createHarness();
    management.isManaging.value = true;
    management.toggleSelectAll();

    management.exitManagement();

    expect(management.isManaging.value).toBe(false);
    expect(management.selectedIds.value.size).toBe(0);
    expect(playlists.value).toHaveLength(3);
    expect(deletePlaylist).not.toHaveBeenCalled();
    expect(removePinned).not.toHaveBeenCalled();
  });
});

describe('playlist deletion confirmation', () => {
  it('ignores empty or unknown targets without opening confirmation', () => {
    const { management, deletePlaylist, removePinned, showToast } = createHarness();

    management.requestDelete([]);
    management.requestDelete(['unknown']);
    management.confirmDelete();

    expect(management.showDeleteModal.value).toBe(false);
    expect(deletePlaylist).not.toHaveBeenCalled();
    expect(removePinned).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('deduplicates targets, excludes unknown IDs and describes the actual target count', () => {
    const { management, deletePlaylist, removePinned } = createHarness();

    management.requestDelete(['b', 'b', 'unknown']);

    expect(management.showDeleteModal.value).toBe(true);
    expect(management.deleteMessage.value).toContain('歌单「歌单 b」');
    expect(management.deleteMessage.value).toContain('不会删除本地音乐文件');
    expect(deletePlaylist).not.toHaveBeenCalled();
    management.confirmDelete();
    expect(deletePlaylist).toHaveBeenCalledExactlyOnceWith('b');
    expect(removePinned).toHaveBeenCalledExactlyOnceWith(['b']);
  });

  it('freezes targets despite selection, filter and caller-array changes while the modal is open', async () => {
    const { management, playlists, visibleIds, deletePlaylist, removePinned } = createHarness();
    management.toggleSelection('a');
    management.toggleSelection('b');
    const targetIds = [...management.selectedIds.value];
    management.requestDelete(targetIds);
    targetIds.splice(0, targetIds.length, 'c');

    visibleIds.value = ['c'];
    await nextTick();
    management.toggleSelection('c');
    expect([...management.selectedIds.value]).toEqual(['c']);
    expect(management.deleteMessage.value).toContain('2 个歌单');

    management.confirmDelete();
    await nextTick();

    expect(deletePlaylist.mock.calls).toEqual([['a'], ['b']]);
    expect(removePinned).toHaveBeenCalledExactlyOnceWith(['a', 'b']);
    expect(playlists.value.map(playlist => playlist.id)).toEqual(['c']);
    expect([...management.selectedIds.value]).toEqual(['c']);
    expect(management.showDeleteModal.value).toBe(false);
  });

  it('cancelling the modal prevents confirmation from deleting its previous targets', () => {
    const { management, playlists, deletePlaylist, removePinned, showToast } = createHarness();
    management.requestDelete(['a']);

    management.showDeleteModal.value = false;
    management.confirmDelete();

    expect(deletePlaylist).not.toHaveBeenCalled();
    expect(removePinned).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(playlists.value).toHaveLength(3);
  });

  it('replaces cancelled targets when a later deletion is requested', () => {
    const { management, playlists, deletePlaylist, removePinned } = createHarness();
    management.requestDelete(['a']);
    management.showDeleteModal.value = false;

    management.requestDelete(['b']);
    management.confirmDelete();

    expect(deletePlaylist).toHaveBeenCalledExactlyOnceWith('b');
    expect(removePinned).toHaveBeenCalledExactlyOnceWith(['b']);
    expect(playlists.value.map(playlist => playlist.id)).toEqual(['a', 'c']);
  });

  it('makes repeated confirmation safe and shows success only once', () => {
    const { management, deletePlaylist, removePinned, showToast } = createHarness();
    management.requestDelete(['a', 'b']);

    management.confirmDelete();
    management.confirmDelete();

    expect(deletePlaylist.mock.calls).toEqual([['a'], ['b']]);
    expect(removePinned).toHaveBeenCalledExactlyOnceWith(['a', 'b']);
    expect(showToast).toHaveBeenCalledExactlyOnceWith('已删除 2 个歌单，本地音乐文件未改动', 'success');
  });

  it('deletes only requested playlists without changing their songs or any other playlist', () => {
    const sharedPath = 'C:/Music/shared.flac';
    const { management, playlists, deletePlaylist, removePinned } = createHarness([
      makePlaylist('a', '删除目标', ['C:/Music/a.flac', sharedPath]),
      makePlaylist('b', '保留歌单', ['C:/Music/b.flac', sharedPath]),
      makePlaylist('c', '空歌单'),
    ]);
    const removedPlaylist = playlists.value[0]!;
    const retainedPlaylist = playlists.value[1]!;
    const removedPaths = [...removedPlaylist.songPaths];
    const retainedPaths = [...retainedPlaylist.songPaths];
    management.toggleSelectAll();

    management.requestDelete(['a']);
    management.confirmDelete();

    expect(deletePlaylist).toHaveBeenCalledExactlyOnceWith('a');
    expect(removePinned).toHaveBeenCalledExactlyOnceWith(['a']);
    expect(playlists.value.map(playlist => playlist.id)).toEqual(['b', 'c']);
    expect(playlists.value[0]).toBe(retainedPlaylist);
    expect(removedPlaylist.songPaths).toEqual(removedPaths);
    expect(retainedPlaylist.songPaths).toEqual(retainedPaths);
    expect(retainedPlaylist.name).toBe('保留歌单');
    expect([...management.selectedIds.value]).toEqual(['b', 'c']);
  });

  it('tolerates a target being removed elsewhere while confirmation is open', () => {
    const { management, playlists, deletePlaylist, removePinned } = createHarness();
    management.requestDelete(['a', 'b']);
    playlists.value = playlists.value.filter(playlist => playlist.id !== 'a');

    expect(() => management.confirmDelete()).not.toThrow();

    expect(deletePlaylist.mock.calls).toEqual([['a'], ['b']]);
    expect(removePinned).toHaveBeenCalledExactlyOnceWith(['a', 'b']);
    expect(playlists.value.map(playlist => playlist.id)).toEqual(['c']);
    expect(management.showDeleteModal.value).toBe(false);
  });
});
