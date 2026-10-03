<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import {
  AlertCircle, ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Files, FolderOpen,
  HardDrive, Info, Library, LoaderCircle, Music2, Search, ShieldCheck, Sparkles, Trash2, X,
} from 'lucide-vue-next';
import AppCheckbox from '../common/AppCheckbox.vue';
import ModernModal from '../common/ModernModal.vue';
import DuplicateSongGroup from './DuplicateSongGroup.vue';
import DuplicateDeleteDialog from './DuplicateDeleteDialog.vue';
import { useDuplicateSongsStore } from '../../features/duplicates/store';
import type { DuplicateDeleteGroup, DuplicateSong } from '../../features/duplicates/types';
import { usePlaybackStore } from '../../features/playback/store';
import { usePlayerCore } from '../../composables/playerCore';
import { useToast } from '../../composables/toast';
import { fileApi } from '../../services/tauri/fileApi';
import { folderPathKey } from '../../utils/folderMove';
import type { Song } from '../../types';

const store = useDuplicateSongsStore();
const playback = usePlaybackStore();
const { showToast } = useToast();
const query = ref('');
const page = ref(1);
const pageSize = 12;
const choosingFolder = ref(false);
const playing = ref(false);
const settingsExpanded = ref(!store.hasScanned);
const pendingMove = ref<{ paths: string[]; folder: string; bytes: number } | null>(null);
const pendingDelete = ref<{ songs: DuplicateSong[]; groups: DuplicateDeleteGroup[]; hiddenCount: number } | null>(null);
let disposed = false;

const locked = computed(() => store.isScanning || store.isApplying || playing.value || choosingFolder.value || !!pendingMove.value || !!pendingDelete.value);
const playingPath = computed(() => playback.isPlaying ? playback.currentSong?.path : undefined);
const filteredGroups = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase();
  if (!keyword) return store.activeGroups;
  return store.activeGroups.filter(group =>
    [group.title, group.artist, ...group.songs.flatMap(song => [song.name, song.path, song.album])]
      .some(value => value.toLocaleLowerCase().includes(keyword)),
  );
});
const pageCount = computed(() => Math.max(1, Math.ceil(filteredGroups.value.length / pageSize)));
const visibleGroups = computed(() => filteredGroups.value.slice((page.value - 1) * pageSize, page.value * pageSize));
const hiddenSelectionCount = computed(() => {
  if (!query.value.trim()) return 0;
  const matchingPaths = new Set(filteredGroups.value.flatMap(group => group.songs.map(song => song.path)));
  return store.selectedSongs.filter(song => !matchingPaths.has(song.path)).length;
});
const matchLabel = computed(() => `${store.matchMode === 'tags' ? '歌名与歌手相同' : '文件名相同'}${store.matchDuration ? ' · 时长接近' : ''}`);
const matchDescription = computed(() => store.matchMode === 'tags'
  ? '比较歌名与歌手，不移除标签中的 Live、伴奏等版本标记；缺少标签的文件不参与此规则。'
  : '比较不含扩展名的完整文件名，忽略大小写和多余空格；不移除版本名称或数字后缀。');
const formatBytes = (bytes: number) => bytes >= 1024 ** 3
  ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
  : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
const errorMessage = (error: unknown) => typeof error === 'object' && error !== null && 'message' in error
  ? String(error.message) : String(error);
const moveMessage = computed(() => pendingMove.value
  ? `将选中的 ${pendingMove.value.paths.length} 个文件（${formatBytes(pendingMove.value.bytes)}）移动到「${pendingMove.value.folder}」？不会删除文件，每组至少保留一个版本。仅支持同盘移动，建议选择扫描范围之外的目录；同名冲突时不会覆盖文件。`
  : '');

watch(query, () => { page.value = 1; });
watch(() => store.hasScanned, hasScanned => { page.value = 1; query.value = ''; settingsExpanded.value = !hasScanned; });
watch(pageCount, count => { page.value = Math.min(page.value, count); });
onBeforeUnmount(() => { disposed = true; pendingMove.value = null; pendingDelete.value = null; });

async function chooseScanFolder() {
  if (locked.value) return;
  choosingFolder.value = true;
  try {
    const selected = await open({ directory: true, multiple: false, title: '选择重复歌曲扫描文件夹' });
    if (!disposed && typeof selected === 'string') store.folderPath = selected;
  } catch (error) {
    showToast(`选择文件夹失败：${errorMessage(error)}`, 'error');
  } finally { choosingFolder.value = false; }
}

function startScan() {
  if (locked.value) return;
  query.value = '';
  page.value = 1;
  void store.scan();
}

function toggleSong(path: string) {
  if (locked.value) return;
  if (!store.toggleSong(path)) showToast('每组至少需要保留一个版本', 'info');
}

async function reveal(path: string) {
  try { await fileApi.showInFolder(path); }
  catch (error) { showToast(`无法打开文件位置：${errorMessage(error)}`, 'error'); }
}

async function audition(candidate: DuplicateSong) {
  if (locked.value || playing.value) return;
  playing.value = true;
  try {
    const player = usePlayerCore().playbackDomain;
    if (playback.currentSong?.path === candidate.path) {
      await player.togglePlay();
    } else {
      const song: Song = {
        ...candidate,
        title: candidate.title || candidate.name,
        artist_names: candidate.artist ? [candidate.artist] : [],
        effective_artist_names: candidate.artist ? [candidate.artist] : [],
        album_artist: '', album_key: '', is_various_artists_album: false,
        collapse_artist_credits: false, source_type: 'local',
      };
      await player.playSong(song, { preserveQueue: true });
    }
  } catch (error) { showToast(`试听失败：${errorMessage(error)}`, 'error'); }
  finally { playing.value = false; }
}

async function chooseDestination() {
  if (locked.value || !store.selectedSongs.length) return;
  choosingFolder.value = true;
  const songs = [...store.selectedSongs];
  try {
    const selected = await open({ directory: true, multiple: false, title: '选择同盘的文件夹存放冗余歌曲（建议在扫描范围外）' });
    if (disposed || typeof selected !== 'string') return;
    const moving = songs.filter(song => folderPathKey(song.path.replace(/[/\\][^/\\]+$/, '')) !== folderPathKey(selected));
    if (!moving.length) { showToast('所选歌曲已经在这个文件夹中', 'info'); return; }
    if (moving.length !== songs.length) showToast(`已跳过 ${songs.length - moving.length} 个位于目标文件夹的文件`, 'info');
    pendingMove.value = { paths: moving.map(song => song.path), folder: selected, bytes: moving.reduce((sum, song) => sum + song.file_size, 0) };
  } catch (error) { showToast(`选择目标文件夹失败：${errorMessage(error)}`, 'error'); }
  finally { choosingFolder.value = false; }
}

async function applyMove() {
  const operation = pendingMove.value;
  pendingMove.value = null;
  if (!operation || store.isApplying || store.isScanning) return;
  store.isApplying = true;
  store.applyingAction = 'move';
  try {
    // Recheck the preserved copy on disk: scan results may be older than the files.
    const selected = new Set(operation.paths);
    for (const group of store.activeGroups) {
      if (!group.songs.some(song => selected.has(song.path))) continue;
      let hasRetainedFile = false;
      for (const song of group.songs.filter(song => !selected.has(song.path))) {
        if (await fileApi.fileExists(song.path)) { hasRetainedFile = true; break; }
      }
      if (!hasRetainedFile) throw new Error(`「${group.title}」的保留文件已不存在，请重新扫描后再操作`);
    }
    const moved = await usePlayerCore().libraryDomain.moveFilesToFolder(operation.paths, operation.folder);
    if (moved === operation.paths.length) {
      store.removePaths(operation.paths);
      showToast(`已移动 ${moved} 个冗余文件，保留版本未改动`, 'success');
    } else {
      store.invalidateResults();
      showToast(`已移动 ${moved} 个文件，请重新扫描以更新结果`, 'info');
    }
  } catch (error) {
    store.invalidateResults();
    store.error = `移动未完成：${errorMessage(error)}。请重新扫描后确认文件状态。`;
    showToast(store.error, 'error');
  }
  finally { store.isApplying = false; store.applyingAction = null; }
}

function requestDelete() {
  if (locked.value || !store.selectedSongs.length) return;
  const songs = store.selectedSongs.map(song => ({ ...song }));
  const selected = new Set(songs.map(song => song.path));
  const groups = store.activeGroups.flatMap(group => {
    const deleteFiles = group.songs.filter(song => selected.has(song.path));
    if (!deleteFiles.length) return [];
    return [{
      delete_files: deleteFiles.map(song => ({
        path: song.path,
        expected_size: song.file_size,
        expected_modified_at_ms: song.modified_at_ms,
      })),
      retained_files: group.songs.filter(song => !selected.has(song.path)).map(song => ({
        path: song.path,
        expected_size: song.file_size,
        expected_modified_at_ms: song.modified_at_ms,
      })),
    }];
  });
  if (groups.some(group => !group.retained_files.length)) {
    showToast('每组至少需要保留一个版本，请检查选择', 'error');
    return;
  }
  pendingDelete.value = { songs, groups, hiddenCount: hiddenSelectionCount.value };
}

async function applyDelete() {
  const operation = pendingDelete.value;
  pendingDelete.value = null;
  if (!operation || store.isApplying || store.isScanning) return;
  store.isApplying = true;
  store.applyingAction = 'delete';
  store.error = '';
  store.lastDeleteResult = null;
  try {
    const result = await usePlayerCore().libraryDomain.deleteDuplicateSongs(operation.groups);
    const absentPaths = [...result.deleted_paths, ...result.missing_paths];
    if (absentPaths.length) store.removePaths(absentPaths);
    store.lastDeleteResult = result;
    const message = `已删除 ${result.deleted_paths.length} 个文件${result.missing_paths.length ? `，${result.missing_paths.length} 个文件原已不存在` : ''}${result.failures.length ? `，${result.failures.length} 个未删除，请查看原因` : ''}`;
    showToast(message, result.failures.length || result.warnings.length ? 'info' : 'success');
  } catch (error) {
    // 命令失联时无法推断哪些文件已删除，必须重新读取磁盘状态。
    store.invalidateResults();
    store.error = `未能确认删除结果：${errorMessage(error)}。请重新扫描并检查文件状态，不要直接重复操作。`;
    showToast(store.error, 'error');
  } finally {
    store.isApplying = false;
    store.applyingAction = null;
  }
}
</script>

<template>
  <div class="duplicate-workbench text-gray-800 dark:text-gray-100">
    <header class="page-intro">
      <div>
        <h2 class="section-title"><span></span>重复歌曲管理</h2>
        <p class="intro-description app-text-secondary">找出音乐库中的重复版本，对比后留下更合适的那一首。</p>
      </div>
      <span class="safe-label app-text-secondary"><ShieldCheck :size="14" aria-hidden="true" />扫描不会改动文件</span>
    </header>

    <section class="scan-settings" aria-label="重复歌曲扫描设置">
      <div v-if="store.hasScanned && !settingsExpanded" class="compact-settings">
        <div class="compact-scope"><Library v-if="store.scope === 'library'" :size="16" aria-hidden="true" /><FolderOpen v-else :size="16" aria-hidden="true" /><span :title="store.scope === 'library' ? '本地音乐库' : store.folderPath">{{ store.scope === 'library' ? '本地音乐库' : store.folderPath }}</span><span class="compact-rule app-text-secondary">{{ matchLabel }}</span></div>
        <div class="compact-actions"><button type="button" class="text-button app-text-secondary" :disabled="locked" :aria-expanded="false" @click="settingsExpanded = true">调整规则<ChevronDown :size="13" aria-hidden="true" /></button><button type="button" class="primary-button" :disabled="locked" @click="startScan"><Search :size="14" aria-hidden="true" />重新扫描</button></div>
      </div>
      <div v-if="settingsExpanded || !store.hasScanned" class="settings-grid">
        <div class="scope-settings">
          <h3 class="field-heading">扫描范围</h3>
          <div class="segmented-control" role="group" aria-label="扫描范围">
            <button type="button" :class="{ active: store.scope === 'library' }" :aria-pressed="store.scope === 'library'" :disabled="locked" @click="store.scope = 'library'"><Library :size="14" aria-hidden="true" />本地音乐库</button>
            <button type="button" :class="{ active: store.scope === 'folder' }" :aria-pressed="store.scope === 'folder'" :disabled="locked" @click="store.scope = 'folder'"><FolderOpen :size="14" aria-hidden="true" />指定文件夹</button>
          </div>
          <div v-if="store.scope === 'library'" class="scope-description app-text-secondary"><HardDrive :size="14" aria-hidden="true" /><span>分析已添加的本地音乐文件夹，不包含远程音乐</span></div>
          <button v-else type="button" class="folder-picker app-text-secondary" :disabled="locked" :title="store.folderPath || '选择要扫描的文件夹'" @click="chooseScanFolder"><FolderOpen :size="14" aria-hidden="true" /><span>{{ store.folderPath || '选择要扫描的文件夹' }}</span><span class="folder-change">{{ store.folderPath ? '更换' : '选择' }}</span></button>
        </div>
        <div class="rule-settings">
          <h3 class="field-heading">匹配规则</h3>
          <div class="rule-options" role="group" aria-label="匹配规则">
            <button type="button" :class="{ active: store.matchMode === 'tags' }" :aria-pressed="store.matchMode === 'tags'" :disabled="locked" @click="store.matchMode = 'tags'"><span class="radio-dot"><Check v-if="store.matchMode === 'tags'" :size="10" :stroke-width="3" aria-hidden="true" /></span>歌曲名 + 歌手<span class="recommend-tag">推荐</span></button>
            <button type="button" :class="{ active: store.matchMode === 'filename' }" :aria-pressed="store.matchMode === 'filename'" :disabled="locked" @click="store.matchMode = 'filename'"><span class="radio-dot"><Check v-if="store.matchMode === 'filename'" :size="10" :stroke-width="3" aria-hidden="true" /></span>文件名</button>
          </div>
          <p class="rule-description app-text-secondary">{{ matchDescription }}</p>
        </div>
      </div>
      <div v-if="settingsExpanded || !store.hasScanned" class="scan-settings-footer">
        <div class="scan-options">
          <div class="checkbox-option app-text-secondary"><AppCheckbox :checked="store.recursive" :disabled="locked" aria-label="包含子文件夹" @change="store.recursive = $event" /><span>包含子文件夹</span></div>
          <div class="checkbox-option app-text-secondary" title="整组最长与最短时长相差不超过 3 秒，缺少时长的文件不参与匹配"><AppCheckbox :checked="store.matchDuration" :disabled="locked" aria-label="同时校验时长，差值不超过3秒" @change="store.matchDuration = $event" /><span>同时校验时长 <span class="option-hint">≤ 3 秒</span></span></div>
        </div>
        <div class="compact-actions"><button v-if="store.hasScanned" type="button" class="text-button app-text-secondary" :disabled="locked" :aria-expanded="true" @click="settingsExpanded = false">收起设置</button><button type="button" class="primary-button" :disabled="locked || (store.scope === 'folder' && !store.folderPath)" :aria-busy="store.isScanning" @click="startScan"><LoaderCircle v-if="store.isScanning" :size="15" class="animate-spin" aria-hidden="true" /><Search v-else :size="15" aria-hidden="true" />{{ store.isScanning ? '正在分析…' : store.hasScanned ? '重新扫描' : '开始扫描' }}</button></div>
      </div>
    </section>

    <div v-if="store.error" role="alert" class="error-banner"><AlertCircle :size="17" aria-hidden="true" /><span>{{ store.error }}</span></div>
    <section v-if="store.lastDeleteResult" class="delete-report" aria-label="删除操作结果" aria-live="polite">
      <div class="delete-report-heading"><Check :size="17" aria-hidden="true" /><span>已删除 {{ store.lastDeleteResult.deleted_paths.length }} 个文件<span v-if="store.lastDeleteResult.missing_paths.length"> · {{ store.lastDeleteResult.missing_paths.length }} 个文件原已不存在</span><span v-if="store.lastDeleteResult.failures.length"> · {{ store.lastDeleteResult.failures.length }} 个未删除</span></span><button type="button" class="text-button app-text-secondary" aria-label="关闭删除结果" @click="store.lastDeleteResult = null"><X :size="16" aria-hidden="true" /></button></div>
      <details v-if="store.lastDeleteResult.failures.length" open><summary>未删除的文件与原因</summary><ul><li v-for="failure in store.lastDeleteResult.failures" :key="failure.path"><span>{{ failure.path }}</span><span class="app-text-secondary">{{ failure.reason }}</span></li></ul></details>
      <details v-if="store.lastDeleteResult.warnings.length" open><summary>音乐库同步提示</summary><p v-for="(warning, index) in store.lastDeleteResult.warnings" :key="index">{{ warning }}</p></details>
    </section>
    <div v-if="store.hasScanned && (store.skippedCount || store.warnings.length)" class="scan-warning app-text-secondary">
      <details><summary>扫描提示{{ store.skippedCount ? ` · ${store.skippedCount} 个文件未能读取` : '' }}</summary><p v-for="(warning, index) in store.warnings" :key="index">{{ warning }}</p></details>
    </div>

    <section class="scan-summary" aria-label="扫描结果概览" aria-live="polite">
      <div class="summary-item"><span class="summary-icon"><Copy :size="18" :stroke-width="1.5" aria-hidden="true" /></span><div><span class="summary-label app-text-secondary">疑似重复组</span><p><strong>{{ store.hasScanned ? store.activeGroups.length.toLocaleString() : '—' }}</strong><span class="summary-unit app-text-secondary">组</span></p></div></div>
      <div class="summary-item"><span class="summary-icon"><Music2 :size="18" :stroke-width="1.5" aria-hidden="true" /></span><div><span class="summary-label app-text-secondary">可整理的冗余文件</span><p><strong>{{ store.hasScanned ? store.duplicateFileCount.toLocaleString() : '—' }}</strong><span class="summary-unit app-text-secondary">个</span></p></div></div>
      <div class="summary-item"><span class="summary-icon"><HardDrive :size="18" :stroke-width="1.5" aria-hidden="true" /></span><div><span class="summary-label app-text-secondary">冗余文件大小 <span title="每组按音质参数推荐保留一份，其余文件大小的合计">ⓘ</span></span><p><strong class="size-value">{{ store.hasScanned ? formatBytes(store.duplicateBytes) : '—' }}</strong></p></div></div>
    </section>

    <section aria-labelledby="duplicate-results-title" class="results-section" :aria-busy="store.isScanning">
      <div class="results-heading">
        <div class="results-heading-text"><h3 id="duplicate-results-title" class="section-title"><span></span>重复结果</h3><span v-if="store.hasScanned" class="scan-count app-text-secondary">已检查 {{ store.scannedCount.toLocaleString() }} 个音频文件</span></div>
        <button v-if="store.ignoredCount" type="button" class="text-button app-text-secondary" :disabled="locked" @click="store.restoreIgnored()">恢复已忽略的 {{ store.ignoredCount }} 组</button>
      </div>
      <div v-if="store.activeGroups.length && !store.isScanning" class="results-toolbar">
        <div class="search-field"><Search :size="16" class="app-text-secondary" aria-hidden="true" /><input v-model="query" :disabled="locked" type="search" placeholder="搜索歌曲、歌手或文件路径" aria-label="搜索重复结果" /><button v-if="query" type="button" :disabled="locked" aria-label="清空搜索" @click="query = ''"><X :size="14" aria-hidden="true" /></button></div>
        <button type="button" class="secondary-button smart-select" :disabled="locked" title="作用于全部未忽略的结果，按无损格式、位深、采样率、码率推荐保留；只勾选，不移动或删除文件" @click="store.selectRecommended()"><Sparkles :size="16" aria-hidden="true" />按音质参数勾选冗余项</button>
      </div>

      <div v-if="store.isScanning" class="empty-state" role="status">
        <span class="empty-illustration scanning"><LoaderCircle :size="35" :stroke-width="1.3" class="animate-spin" aria-hidden="true" /></span>
        <h4>正在寻找重复的旋律</h4><p class="app-text-secondary">{{ store.progressLabel || '正在读取音频标签与文件信息，大型音乐库可能需要一些时间。' }}</p>
        <button type="button" class="text-button app-text-secondary" @click="store.cancelScan(); showToast('已取消等待，后台文件读取可能仍在继续', 'info')">取消等待</button>
      </div>
      <div v-else-if="!store.hasScanned" class="empty-state">
        <div class="empty-illustration"><Files :size="34" :stroke-width="1.25" aria-hidden="true" /><span class="illustration-search"><Search :size="15" aria-hidden="true" /></span></div>
        <h4>给喜欢的音乐，留一个位置</h4><p class="app-text-secondary">选择扫描范围，开始查找散落在不同文件夹中的重复版本。</p>
        <div class="empty-steps app-text-secondary"><span><span class="step-number">1</span>扫描歌曲</span><ChevronRight :size="12" aria-hidden="true" /><span><span class="step-number">2</span>对比版本</span><ChevronRight :size="12" aria-hidden="true" /><span><span class="step-number">3</span>确认整理</span></div>
      </div>
      <div v-else-if="!store.activeGroups.length" class="empty-state">
        <span class="empty-illustration success"><ShieldCheck :size="35" :stroke-width="1.3" aria-hidden="true" /></span>
        <h4>{{ store.ignoredCount ? '当前重复组已全部忽略' : '当前没有待整理的重复项' }}</h4>
        <p class="app-text-secondary">{{ store.ignoredCount ? '可以恢复已忽略的分组，重新对比版本。' : '未发现符合当前规则的重复文件，也可以调整匹配规则再次扫描。' }}</p>
      </div>
      <div v-else-if="!filteredGroups.length" class="empty-state search-empty"><Search :size="28" :stroke-width="1.3" class="app-text-secondary" aria-hidden="true" /><h4>没有找到匹配的分组</h4><button type="button" class="text-button" @click="query = ''">清空搜索，查看全部结果</button></div>
      <div v-else class="group-list">
        <DuplicateSongGroup v-for="group in visibleGroups" :key="group.id" :group="group" :selected-paths="store.selectedPaths" :disabled="locked || playing" :match-label="matchLabel" :playing-path="playingPath"
          @toggle="toggleSong" @retain="store.retain" @ignore="store.ignoreGroup" @play="audition" @reveal="reveal" />
      </div>
      <nav v-if="pageCount > 1 && !store.isScanning" class="pagination app-text-secondary" aria-label="重复分组分页"><span>共 {{ filteredGroups.length }} 组</span><button type="button" :disabled="page <= 1 || locked" aria-label="上一页" @click="page--"><ChevronLeft :size="16" aria-hidden="true" /></button><span>{{ page }} / {{ pageCount }}</span><button type="button" :disabled="page >= pageCount || locked" aria-label="下一页" @click="page++"><ChevronRight :size="16" aria-hidden="true" /></button></nav>
      <p class="safety-note app-text-secondary"><Info :size="13" aria-hidden="true" /><span>结果依据标签或文件名，不是音频指纹鉴定。建议保留仅参考音质参数，请试听确认；每组至少保留一份。</span></p>
    </section>

    <footer v-if="store.hasScanned && store.activeGroups.length" class="selection-bar">
      <div class="selection-summary"><span>已选 <strong>{{ store.selectedSongs.length }}</strong> 个文件<span class="selection-bytes app-text-secondary">{{ formatBytes(store.selectedBytes) }}</span></span><button type="button" class="text-button app-text-secondary" :disabled="locked || !store.selectedSongs.length" @click="store.clearSelection()">清空选择</button><span v-if="hiddenSelectionCount" class="hidden-selection-note app-text-secondary">含 {{ hiddenSelectionCount }} 个搜索范围外的已选项</span></div>
      <div class="selection-actions">
        <button type="button" class="primary-button move-button" :disabled="locked || !store.selectedSongs.length" :aria-busy="store.applyingAction === 'move'" @click="chooseDestination"><LoaderCircle v-if="store.applyingAction === 'move'" :size="17" class="animate-spin" aria-hidden="true" /><FolderOpen v-else :size="17" aria-hidden="true" />{{ store.applyingAction === 'move' ? '正在移动…' : '移动到文件夹' }}<ArrowRight v-if="store.applyingAction !== 'move'" :size="15" aria-hidden="true" /></button>
        <button type="button" class="delete-button" :disabled="locked || !store.selectedSongs.length" :aria-busy="store.applyingAction === 'delete'" title="永久删除已勾选的文件，需核对并确认，不会进入回收站" @click="requestDelete"><LoaderCircle v-if="store.applyingAction === 'delete'" :size="17" class="animate-spin" aria-hidden="true" /><Trash2 v-else :size="17" aria-hidden="true" />{{ store.applyingAction === 'delete' ? '正在删除…' : '删除所选' }}</button>
      </div>
      <p class="delete-disclaimer app-text-secondary"><AlertCircle :size="14" aria-hidden="true" /><span>删除为永久操作，请仔细检查并备份。因用户选择或误删造成的数据丢失，本软件不承担责任。</span></p>
    </footer>
    <ModernModal :visible="!!pendingMove" title="移动选中的冗余文件？" :content="moveMessage" type="info" confirm-text="确认移动" @confirm="applyMove" @cancel="pendingMove = null" />
    <DuplicateDeleteDialog :visible="!!pendingDelete" :songs="pendingDelete?.songs ?? []" :hidden-count="pendingDelete?.hiddenCount ?? 0" @confirm="applyDelete" @cancel="pendingDelete = null" />
  </div>
</template>

<style scoped>
.duplicate-workbench { container: duplicates / inline-size; width: 100%; padding: 8px 20px 0; font-size: 15px; }
.page-intro { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin: 2px 0 24px; }
.section-title { display: flex; align-items: center; gap: 9px; font-size: 17px; font-weight: 700; }
.section-title > span { width: 4px; height: 18px; border-radius: 4px; background: #EC4141; }
.intro-description { font-size: 14px; line-height: 1.8; margin-top: 8px; }
.safe-label { display: flex; align-items: center; gap: 6px; font-size: 13px; white-space: nowrap; }
.scan-settings { border: 1px solid rgb(255 255 255 / .52); border-radius: 12px; background: rgb(255 255 255 / .19); }
.compact-settings { display: flex; align-items: center; justify-content: space-between; gap: 12px 20px; padding: 16px 18px; flex-wrap: wrap; }
.compact-scope { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; flex: 1; font-size: 14px; }
.compact-scope > svg { flex-shrink: 0; color: #c73434; }
.compact-scope > span:first-of-type { max-width: 350px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.compact-rule { font-size: 13px; margin-left: 10px; }
.compact-actions { display: flex; align-items: center; gap: 18px; }
.compact-actions .text-button { display: flex; align-items: center; gap: 4px; }
.settings-grid { display: grid; grid-template-columns: minmax(250px, .9fr) minmax(300px, 1.1fr); gap: 24px; padding: 20px; }
.scope-settings, .rule-settings { min-width: 0; }
.rule-settings { padding-left: 24px; border-left: 1px solid rgb(128 128 128 / .13); }
.field-heading { font-size: 15px; font-weight: 600; margin-bottom: 11px; }
.segmented-control { display: flex; width: fit-content; max-width: 100%; padding: 3px; border-radius: 8px; background: rgb(0 0 0 / .045); }
.segmented-control button { display: flex; align-items: center; justify-content: center; gap: 7px; padding: 8px 16px; border-radius: 6px; font-size: 14px; white-space: nowrap; cursor: pointer; transition: background .15s, color .15s; }
.segmented-control button.active { background: rgb(255 255 255 / .72); box-shadow: 0 1px 4px rgb(0 0 0 / .05); color: #c73434; font-weight: 500; }
.scope-description, .folder-picker { display: flex; align-items: center; gap: 7px; min-height: 34px; margin-top: 9px; font-size: 13px; }
.scope-description svg, .folder-picker svg { flex-shrink: 0; }
.folder-picker { width: 100%; text-align: left; cursor: pointer; }
.folder-picker > span:first-of-type { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; user-select: text; }
.folder-change { margin-left: auto; color: #c73434; flex-shrink: 0; }
.rule-options { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.rule-options button { display: flex; align-items: center; gap: 7px; padding: 9px 12px; border: 1px solid rgb(128 128 128 / .18); border-radius: 7px; font-size: 14px; white-space: nowrap; cursor: pointer; }
.rule-options button.active { border-color: rgb(236 65 65 / .42); background: rgb(236 65 65 / .04); }
.radio-dot { display: grid; place-items: center; width: 13px; height: 13px; border-radius: 50%; border: 1px solid rgb(128 128 128 / .4); color: white; }
.active .radio-dot { background: #EC4141; border-color: #EC4141; }
.recommend-tag { color: #c73333; font-size: 12px; }
.rule-description { margin-top: 10px; font-size: 13px; line-height: 1.7; }
.scan-settings-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; padding: 13px 20px; border-top: 1px solid rgb(255 255 255 / .4); }
.scan-options { display: flex; flex-wrap: wrap; gap: 12px 22px; }
.checkbox-option { display: flex; align-items: center; gap: 7px; font-size: 13px; }
.option-hint { font-size: 12px; margin-left: 4px; opacity: .75; }
.primary-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 10px 19px; border: 1px solid transparent; border-radius: 8px; background: #EC4141; color: #fff; font-size: 14px; font-weight: 500; white-space: nowrap; cursor: pointer; transition: background .15s; }
.primary-button:hover:not(:disabled) { background: #d83a3a; }
button:disabled { opacity: .45; cursor: not-allowed; }
button:focus-visible { box-shadow: 0 0 0 3px rgb(236 65 65 / .35); border-radius: 6px; }
.scan-summary { display: grid; grid-template-columns: 1fr 1fr 1fr; margin: 20px 0 27px; padding: 4px 0; }
.summary-item { display: flex; align-items: center; gap: 14px; padding: 4px 24px; border-left: 1px solid rgb(128 128 128 / .14); }
.summary-item:first-child { padding-left: 6px; border-left: 0; }
.summary-icon { display: grid; place-items: center; height: 38px; width: 38px; flex-shrink: 0; border-radius: 10px; color: #b33c3c; background: rgb(236 65 65 / .055); }
.summary-label { font-size: 13px; }
.summary-item p { display: flex; gap: 6px; align-items: baseline; margin-top: 5px; }
.summary-item strong { font-size: 28px; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; letter-spacing: -.6px; }
.summary-item strong.size-value { font-size: 26px; }
.summary-unit { font-size: 13px; }
.results-heading, .results-heading-text { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 13px; }
.results-heading { justify-content: space-between; margin-bottom: 15px; }
.scan-count { font-size: 13px; }
.results-toolbar { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 14px; }
.search-field { display: flex; align-items: center; gap: 8px; min-width: 220px; width: 360px; max-width: 100%; padding: 10px 12px; border: 1px solid rgb(128 128 128 / .18); border-radius: 7px; background: rgb(255 255 255 / .22); }
.search-field:focus-within { border-color: rgb(236 65 65 / .5); }
.search-field input { width: 100%; min-width: 0; font-size: 14px; background: transparent; outline: none; }
.search-field input::placeholder { color: var(--app-text-muted); }
.search-field input::-webkit-search-cancel-button { display: none; }
.search-field button { display: flex; cursor: pointer; }
.secondary-button { display: flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid rgb(128 128 128 / .16); border-radius: 7px; padding: 9px 13px; background: rgb(255 255 255 / .32); font-size: 13px; cursor: pointer; }
.secondary-button:hover:not(:disabled) { border-color: rgb(236 65 65 / .35); color: #c73434; }
.smart-select svg { color: #c73434; }
.text-button { padding: 4px 0; font-size: 13px; cursor: pointer; }
.text-button:hover:not(:disabled) { color: #EC4141; }
.group-list { display: flex; flex-direction: column; gap: 13px; }
.empty-state { display: flex; align-items: center; justify-content: center; flex-direction: column; min-height: 245px; gap: 11px; border: 1px dashed rgb(128 128 128 / .23); border-radius: 12px; background: rgb(255 255 255 / .08); padding: 30px 20px; text-align: center; }
.empty-illustration { position: relative; display: grid; place-items: center; width: 66px; height: 66px; border-radius: 19px; background: rgb(255 255 255 / .35); color: #bd7772; border: 1px solid rgb(255 255 255 / .4); margin-bottom: 4px; }
.illustration-search { position: absolute; right: -6px; bottom: 2px; display: grid; place-items: center; height: 25px; width: 25px; border-radius: 50%; background: #f8e6e3; color: #c44242; border: 3px solid rgb(255 255 255 / .6); }
.empty-state h4 { font-size: 16px; font-weight: 500; }
.empty-state > p { max-width: 520px; font-size: 13px; line-height: 1.8; }
.empty-steps { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; justify-content: center; font-size: 12px; margin-top: 9px; }
.empty-steps > span { display: flex; gap: 6px; align-items: center; }
.step-number { display: grid; place-items: center; width: 19px; height: 19px; border-radius: 50%; background: rgb(0 0 0 / .04); font-size: 11px; }
.success { color: #269172; }
.search-empty { min-height: 180px; }
.safety-note { display: flex; align-items: flex-start; gap: 7px; margin: 14px 0 20px; font-size: 12px; line-height: 1.8; }
.safety-note svg { flex-shrink: 0; margin-top: 3px; }
.selection-bar { position: sticky; bottom: -16px; z-index: 2; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; border: 1px solid rgb(255 255 255 / .5); border-radius: 10px; padding: 13px 16px; background: rgb(244 242 240 / .88); backdrop-filter: blur(20px); box-shadow: 0 -5px 22px rgb(0 0 0 / .025); }
.selection-summary { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; font-size: 14px; }
.selection-summary strong { color: #c73434; font-weight: 600; }
.selection-bytes { margin-left: 12px; font-size: 13px; }
.hidden-selection-note { font-size: 12px; width: 100%; }
.selection-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-left: auto; }
.delete-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 10px 17px; border: 1px solid rgb(196 54 54 / .4); border-radius: 8px; background: rgb(236 65 65 / .045); color: #b82f2f; font-size: 14px; font-weight: 500; white-space: nowrap; cursor: pointer; }
.delete-button:hover:not(:disabled) { background: rgb(236 65 65 / .12); border-color: #c43636; }
.delete-disclaimer { display: flex; align-items: flex-start; gap: 6px; flex-basis: 100%; font-size: 12px; line-height: 1.7; border-top: 1px solid rgb(128 128 128 / .12); padding-top: 10px; }
.delete-disclaimer svg { flex-shrink: 0; margin-top: 3px; }
.delete-report { padding: 14px 16px; margin-top: 16px; border: 1px solid rgb(128 128 128 / .16); border-radius: 10px; background: rgb(255 255 255 / .2); font-size: 13px; }
.delete-report-heading { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.delete-report-heading > span { flex: 1; }
.delete-report-heading > svg { flex-shrink: 0; color: #258267; }
.delete-report details { margin-top: 12px; }
.delete-report summary { cursor: pointer; color: #b82f2f; }
.delete-report ul { max-height: 240px; overflow-y: auto; }
.delete-report li { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; overflow-wrap: anywhere; }
.delete-report p { margin-top: 8px; overflow-wrap: anywhere; }
.pagination { display: flex; justify-content: flex-end; align-items: center; gap: 10px; margin-top: 16px; font-size: 13px; }
.pagination button { display: grid; place-items: center; width: 28px; height: 28px; border: 1px solid rgb(128 128 128 / .17); border-radius: 6px; cursor: pointer; }
.error-banner { display: flex; align-items: flex-start; gap: 8px; padding: 12px 14px; margin-top: 14px; background: rgb(236 65 65 / .07); border: 1px solid rgb(236 65 65 / .16); border-radius: 9px; color: #af3030; font-size: 14px; overflow-wrap: anywhere; }
.error-banner svg { flex-shrink: 0; }
.scan-warning { font-size: 13px; padding: 10px 13px; background: rgb(217 155 38 / .06); border-radius: 8px; margin-top: 12px; }
.scan-warning summary { cursor: pointer; }
.scan-warning p { margin-top: 5px; overflow-wrap: anywhere; }
.dark .scan-settings { border-color: rgb(255 255 255 / .10); background: rgb(255 255 255 / .025); }
.dark .segmented-control { background: rgb(0 0 0 / .15); }
.dark .segmented-control button.active { background: rgb(255 255 255 / .085); color: #ff9393; }
.dark .scan-settings-footer { border-color: rgb(255 255 255 / .06); }
.dark .summary-icon { background: rgb(236 65 65 / .085); color: #ff9393; }
.dark .folder-change, .dark .recommend-tag, .dark .smart-select svg, .dark .selection-summary strong { color: #ff9393; }
.dark .search-field, .dark .secondary-button { background: rgb(255 255 255 / .035); border-color: rgb(255 255 255 / .12); }
.dark .empty-state { background: rgb(255 255 255 / .015); border-color: rgb(255 255 255 / .13); }
.dark .empty-illustration { background: rgb(255 255 255 / .04); border-color: rgb(255 255 255 / .06); color: #c58b86; }
.dark .illustration-search { background: #463233; color: #ff9393; border-color: #292a2e; }
.dark .step-number { background: rgb(255 255 255 / .06); }
.dark .selection-bar { background: rgb(30 31 36 / .9); border-color: rgb(255 255 255 / .09); }
.dark .error-banner { color: #ffaaaa; }
.dark .delete-button, .dark .delete-report summary { color: #ff9393; }
.dark .delete-button { border-color: rgb(255 147 147 / .35); }
.dark .delete-report { background: rgb(255 255 255 / .025); border-color: rgb(255 255 255 / .1); }
@container duplicates (max-width: 760px) {
  .settings-grid { grid-template-columns: 1fr; gap: 16px; }
  .rule-settings { padding-left: 0; border-left: 0; padding-top: 15px; border-top: 1px solid rgb(128 128 128 / .13); }
  .safe-label { display: none; }
  .summary-item { padding: 4px 12px; gap: 8px; }
  .summary-icon { display: none; }
  .summary-item strong, .summary-item strong.size-value { font-size: 24px; }
  .summary-label { font-size: 12px; }
  .selection-actions { margin-left: 0; }
}
@media (max-width: 750px) { .duplicate-workbench { padding: 8px 0 0; } }
@media (prefers-reduced-motion: reduce) { .animate-spin { animation: none; } button { transition: none; } }
</style>
