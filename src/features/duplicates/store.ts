import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';

import { duplicateApi } from '../../services/tauri/duplicateApi';
import { libraryApi } from '../../services/tauri/libraryApi';
import {
  duplicateSongBytes,
  findDuplicateGroups,
  type DuplicateGroup,
  type DuplicateMatchMode,
} from './matching';
import type { DuplicateDeleteResult, DuplicateSong } from './types';

export type { DuplicateGroup, DuplicateMatchMode } from './matching';

export const useDuplicateSongsStore = defineStore('duplicate-songs', () => {
  const scope = ref<'library' | 'folder'>('library');
  const folderPath = ref('');
  const recursive = ref(true);
  const matchMode = ref<DuplicateMatchMode>('tags');
  const matchDuration = ref(true);

  const isScanning = ref(false);
  const isApplying = ref(false);
  const applyingAction = ref<'move' | 'delete' | null>(null);
  const lastDeleteResult = ref<DuplicateDeleteResult | null>(null);
  const progressLabel = ref('');
  const error = ref('');
  const hasScanned = ref(false);
  const scannedCount = ref(0);
  const skippedCount = ref(0);
  const warnings = ref<string[]>([]);
  const groups = ref<DuplicateGroup[]>([]);
  const selectedPaths = ref<Set<string>>(new Set());
  const ignoredGroupIds = ref<Set<string>>(new Set());

  // 保留全部扫描候选，移走或删除文件后可重新计算分组，不必重新读取标签。
  let scannedSongs: DuplicateSong[] = [];
  let generation = 0;
  let restoringSettings = false;
  const readSettings = () => ({
    scope: scope.value,
    folderPath: folderPath.value,
    recursive: recursive.value,
    matchMode: matchMode.value,
    matchDuration: matchDuration.value,
  });
  let validSettings = readSettings();

  const activeGroups = computed(() =>
    groups.value.filter((group) => !ignoredGroupIds.value.has(group.id)),
  );
  const ignoredCount = computed(
    () => groups.value.length - activeGroups.value.length,
  );
  const duplicateFileCount = computed(() =>
    activeGroups.value.reduce((count, group) => count + group.songs.length - 1, 0),
  );
  const duplicateBytes = computed(() =>
    activeGroups.value.reduce(
      (total, group) => total + group.songs.reduce(
        (bytes, song) => bytes + (song.path === group.recommendedPath ? 0 : duplicateSongBytes(song)),
        0,
      ),
      0,
    ),
  );
  const selectedSongs = computed(() =>
    activeGroups.value.flatMap((group) =>
      group.songs.filter((song) => selectedPaths.value.has(song.path)),
    ),
  );
  const selectedBytes = computed(() =>
    selectedSongs.value.reduce((total, song) => total + duplicateSongBytes(song), 0),
  );

  function clearResults() {
    scannedSongs = [];
    groups.value = [];
    selectedPaths.value = new Set();
    ignoredGroupIds.value = new Set();
    hasScanned.value = false;
    scannedCount.value = 0;
    skippedCount.value = 0;
    warnings.value = [];
    error.value = '';
    progressLabel.value = '';
    lastDeleteResult.value = null;
  }

  // 操作结果不明确时，即使仍处于操作锁中，也必须丢弃过时的文件快照。
  function invalidateResults() {
    generation += 1;
    isScanning.value = false;
    clearResults();
  }

  watch([scope, folderPath, recursive, matchMode, matchDuration], () => {
    if (restoringSettings) return;
    if (isApplying.value) {
      // 即便页面卸载后从其他入口修改设置，也不能改变正在操作的候选范围。
      restoringSettings = true;
      scope.value = validSettings.scope;
      folderPath.value = validSettings.folderPath;
      recursive.value = validSettings.recursive;
      matchMode.value = validSettings.matchMode;
      matchDuration.value = validSettings.matchDuration;
      restoringSettings = false;
      return;
    }
    validSettings = readSettings();
    generation += 1;
    isScanning.value = false;
    clearResults();
  }, { flush: 'sync' });

  async function scan(): Promise<void> {
    if (isApplying.value || isScanning.value) return;
    const token = ++generation;
    const settings = readSettings();
    clearResults();
    isScanning.value = true;
    progressLabel.value = settings.scope === 'library'
      ? '正在读取音乐库文件夹…'
      : '正在读取文件夹中的音频文件…';

    try {
      const roots = settings.scope === 'library'
        ? (await libraryApi.getLibraryFolders()).map((folder) => folder.path.trim()).filter(Boolean)
        : [settings.folderPath.trim()].filter(Boolean);
      if (token !== generation) return;
      if (roots.length === 0) {
        error.value = settings.scope === 'library'
          ? '本地音乐库还没有文件夹，请先添加音乐库文件夹，或切换到指定文件夹。'
          : '请先选择要扫描的文件夹。';
        progressLabel.value = '';
        return;
      }

      progressLabel.value = '正在读取音频标签并分析疑似重复歌曲，大型音乐库可能需要一些时间…';
      const result = await duplicateApi.scan([...new Set(roots)], settings.recursive);
      if (token !== generation) return;

      scannedSongs = result.songs;
      groups.value = findDuplicateGroups(result.songs, {
        mode: settings.matchMode,
        matchDuration: settings.matchDuration,
      });
      scannedCount.value = result.scanned_count;
      skippedCount.value = result.skipped_count;
      warnings.value = result.warnings;
      hasScanned.value = true;
      progressLabel.value = '扫描完成';
    } catch (cause) {
      if (token !== generation) return;
      error.value = cause instanceof Error ? cause.message : String(cause);
      progressLabel.value = '';
    } finally {
      if (token === generation) isScanning.value = false;
    }
  }

  /** 使异步返回失效；不声称停止已进入后端的磁盘扫描。 */
  function cancelScan() {
    if (isApplying.value || !isScanning.value) return;
    generation += 1;
    isScanning.value = false;
    progressLabel.value = '已取消等待本次扫描结果；已开始的文件读取可能仍在后台继续。';
  }

  function retain(groupId: string, path: string): boolean {
    if (isApplying.value) return false;
    const group = activeGroups.value.find((candidate) => candidate.id === groupId);
    if (!group?.songs.some((song) => song.path === path)) return false;
    const next = new Set(selectedPaths.value);
    for (const song of group.songs) {
      if (song.path === path) next.delete(song.path);
      else next.add(song.path);
    }
    selectedPaths.value = next;
    return true;
  }

  /** false 表示该歌曲不可勾选；每组必须至少保留一个未勾选文件。 */
  function toggleSong(path: string): boolean {
    if (isApplying.value) return false;
    const group = activeGroups.value.find((candidate) =>
      candidate.songs.some((song) => song.path === path),
    );
    if (!group) return false;
    const next = new Set(selectedPaths.value);
    if (next.has(path)) next.delete(path);
    else {
      const selectedInGroup = group.songs.filter((song) => next.has(song.path)).length;
      if (selectedInGroup >= group.songs.length - 1) return false;
      next.add(path);
    }
    selectedPaths.value = next;
    return true;
  }

  function selectRecommended() {
    if (isApplying.value) return;
    selectedPaths.value = new Set(activeGroups.value.flatMap((group) =>
      group.songs.filter((song) => song.path !== group.recommendedPath).map((song) => song.path),
    ));
  }

  function clearSelection() {
    if (isApplying.value) return;
    selectedPaths.value = new Set();
  }

  function ignoreGroup(groupId: string) {
    if (isApplying.value) return;
    const group = groups.value.find((candidate) => candidate.id === groupId);
    if (!group) return;
    ignoredGroupIds.value = new Set([...ignoredGroupIds.value, groupId]);
    const next = new Set(selectedPaths.value);
    for (const song of group.songs) next.delete(song.path);
    selectedPaths.value = next;
  }

  function restoreIgnored() {
    if (isApplying.value) return;
    ignoredGroupIds.value = new Set();
  }

  /** 仅传入后端确认已移走、删除或不存在的路径，失败项继续保留供用户检查。 */
  function removePaths(paths: string[]) {
    const removed = new Set(paths);
    scannedSongs = scannedSongs.filter((song) => !removed.has(song.path));
    groups.value = findDuplicateGroups(scannedSongs, {
      mode: matchMode.value,
      matchDuration: matchDuration.value,
    });
    const validGroupIds = new Set(groups.value.map((group) => group.id));
    ignoredGroupIds.value = new Set([...ignoredGroupIds.value].filter((id) => validGroupIds.has(id)));
    const next = new Set(activeGroups.value.flatMap((group) =>
      group.songs.filter((song) => selectedPaths.value.has(song.path)).map((song) => song.path),
    ));
    for (const group of activeGroups.value) {
      if (group.songs.every((song) => next.has(song.path))) next.delete(group.recommendedPath);
    }
    selectedPaths.value = next;
  }

  return {
    scope,
    folderPath,
    recursive,
    matchMode,
    matchDuration,
    isScanning,
    isApplying,
    applyingAction,
    lastDeleteResult,
    progressLabel,
    error,
    hasScanned,
    scannedCount,
    skippedCount,
    warnings,
    groups,
    selectedPaths,
    ignoredGroupIds,
    activeGroups,
    ignoredCount,
    duplicateFileCount,
    duplicateBytes,
    selectedSongs,
    selectedBytes,
    invalidateResults,
    scan,
    cancelScan,
    retain,
    toggleSong,
    selectRecommended,
    clearSelection,
    ignoreGroup,
    restoreIgnored,
    removePaths,
  };
});
