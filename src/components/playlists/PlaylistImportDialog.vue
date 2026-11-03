<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { useRouter } from 'vue-router';
import { ArrowLeft, Check, FileMusic, Link, LoaderCircle, Search, X } from 'lucide-vue-next';
import { useCollectionsStore } from '../../features/collections/store';
import { usePlaylistImportDialog } from '../../features/playlistImport/dialog';
import { includeImportedPaths } from '../../features/playlistImport/files';
import { matchKey, type PlaylistImportData, type SourceDocument, type TrackMatch, type PlaylistCandidate } from '../../features/playlistImport/types';
import { playlistImportApi } from '../../services/tauri/playlistImportApi';
import { tauriInvoke } from '../../services/tauri/invoke';
import { localStore } from '../../services/storage/localStore';
import { fileApi } from '../../services/tauri/fileApi';
import { useLibrarySongResolver } from '../../composables/useLibrarySongResolver';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { useToast } from '../../composables/toast';
import { useHomeNavigation } from '../../composables/useHomeNavigation';
import { playerStorageKeys } from '../../services/storage/playerStorage';

const collections = useCollectionsStore();
const dialog = usePlaylistImportDialog();
const { loadSong, loadSongs } = useLibrarySongResolver();
const { playSong } = usePlaybackController();
const { showToast } = useToast();
const { openHomePlaylist } = useHomeNavigation(useRouter());
const card = ref<HTMLElement | null>(null);
const overlay = ref<HTMLElement | null>(null);
const position = ref({ x: 0, y: 0 });
const isDragging = ref(false);
let drag: { pointerId: number; startX: number; startY: number; x: number; y: number; handle: HTMLElement } | null = null;
let boundsObserver: ResizeObserver | undefined;

function clampPosition(x: number, y: number) {
  if (!overlay.value || !card.value) return { x: 0, y: 0 };
  const viewport = overlay.value.getBoundingClientRect();
  const panel = card.value.getBoundingClientRect();
  const padding = getComputedStyle(overlay.value);
  const maxX = Math.max(0, (viewport.width - panel.width) / 2 - parseFloat(padding.paddingLeft));
  const maxY = Math.max(0, (viewport.height - panel.height) / 2 - parseFloat(padding.paddingTop));
  return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
}

function startDrag(event: PointerEvent) {
  if (!event.isPrimary || event.button !== 0 || drag || (event.target instanceof Element && event.target.closest('button'))) return;
  event.preventDefault();
  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);
  drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, ...position.value, handle };
  isDragging.value = true;
  window.addEventListener('pointermove', moveDrag, true);
  window.addEventListener('pointerup', stopDrag, true);
  window.addEventListener('pointercancel', stopDrag, true);
}

function moveDrag(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  position.value = clampPosition(drag.x + event.clientX - drag.startX, drag.y + event.clientY - drag.startY);
}

function stopDrag(event?: PointerEvent) {
  if (!drag || event && event.pointerId !== drag.pointerId) return;
  const current = drag;
  drag = null;
  isDragging.value = false;
  window.removeEventListener('pointermove', moveDrag, true);
  window.removeEventListener('pointerup', stopDrag, true);
  window.removeEventListener('pointercancel', stopDrag, true);
  if (current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
}

const handleWindowBlur = () => stopDrag();
const sourceMode = ref<'url' | 'file' | 'text'>('url');
const sourceValue = ref(dialog.initialFile.value);
const mapping = ref({ from: '', to: '' });
const document = ref<SourceDocument | null>(null);
const matches = ref<TrackMatch[]>([]);
const choices = ref<(string | null)[]>([]);
const ignored = ref<number[]>([]);
const linked = ref(false);
const name = ref('');
const busy = ref('');
const error = ref('');
const filter = ref<'all' | 'pending'>('all');
const page = ref(0);
const searchIndex = ref<number | null>(null);
const query = ref('');
const searchResults = ref<PlaylistCandidate[]>([]);
const searching = ref(false);
const oldData = ref<PlaylistImportData | null>(null);
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const targetId = dialog.playlistId.value;
const returnFocus = globalThis.document.activeElement as HTMLElement | null;
let generation = 0;
let searchGeneration = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;

const selectedCount = computed(() => choices.value.filter(Boolean).length);
const pendingCount = computed(() => (document.value?.tracks ?? []).filter((_, i) => !choices.value[i] && !ignored.value.includes(i)).length);
const rows = computed(() => (document.value?.tracks ?? []).map((track, index) => ({ track, index }))
  .filter(row => filter.value === 'all' || !choices.value[row.index] && !ignored.value.includes(row.index)));
const visibleRows = computed(() => rows.value.slice(page.value * 40, (page.value + 1) * 40));
const isM3u = computed(() => document.value?.kind === 'm3u');
const canSave = computed(() => !!document.value && !!name.value.trim() && !busy.value);
watch(() => rows.value.length, length => { page.value = Math.min(page.value, Math.max(0, Math.ceil(length / 40) - 1)); });
const candidate = (index: number) => matches.value[index]?.candidates.find(c => c.path === choices.value[index]);

const close = () => { if (!busy.value.startsWith('正在保存')) dialog.close(); };
const fail = (value: unknown) => { error.value = String(value instanceof Error ? value.message : value); };

async function matchDocument(doc: SourceDocument, previous?: PlaylistImportData) {
  const request = ++generation;
  busy.value = '正在匹配本地曲库…';
  const results = await playlistImportApi.match(doc.tracks);
  if (disposed || request !== generation) return;
  const remembered = localStore.getJson<Record<string, string>>('player_playlist_match_choices') ?? {};
  const rememberedPaths = [...new Set(doc.tracks.map(t => remembered[matchKey(doc, t)]).filter((path): path is string => typeof path === 'string' && !!path))];
  const rememberedSongs = await loadSongs(rememberedPaths);
  if (disposed || request !== generation) return;
  const available = new Map(rememberedSongs.map(s => [s.path, s]));
  matches.value = results;
  choices.value = results.map((result, i) => {
    if (previous?.ignored.includes(i)) return null;
    if (previous?.linked && doc.kind === 'm3u') return result.selectedPath;
    const before = previous?.choices[i];
    if (before) return before;
    const path = remembered[matchKey(doc, doc.tracks[i]!)];
    const song = available.get(path ?? '');
    if (song && !doc.tracks[i]?.path) {
      if (!result.candidates.some(c => c.path === song.path)) result.candidates.push({ path: song.path, title: song.title || song.name, artists: song.artist_names, album: song.album, duration: song.duration, score: 1, reason: '使用你之前确认的匹配' });
      return song.path;
    }
    return result.selectedPath;
  });
  ignored.value = previous ? [...previous.ignored] : [];
  document.value = doc;
  name.value = previous ? collections.playlists.find(p => p.id === targetId)?.name ?? doc.name : doc.name;
  linked.value = previous?.linked ?? doc.kind === 'm3u';
  filter.value = 'all';
  page.value = 0;
}

async function readSource() {
  if (!sourceValue.value.trim() || busy.value) return;
  error.value = '';
  busy.value = '正在读取歌单…';
  try {
    const doc = await playlistImportApi.read({ kind: sourceMode.value, value: sourceValue.value, mapping: mapping.value });
    if (disposed) return;
    const existing = doc.kind === 'm3u' ? collections.playlists.find(p => p.id !== targetId && p.importData?.linked && p.importData.document.source === doc.source) : undefined;
    if (existing) throw new Error(`这个文件已关联到「${existing.name}」，请在已有歌单中查看或刷新。`);
    await matchDocument(doc);
  } catch (e) { if (!disposed) fail(e); }
  finally { if (!disposed) busy.value = ''; }
}

async function pickFile() {
  try {
    const path = await open({ multiple: false, filters: [{ name: '歌单文件', extensions: ['m3u', 'm3u8', 'csv', 'json', 'txt'] }] });
    if (typeof path === 'string' && !disposed) { sourceMode.value = 'file'; sourceValue.value = path; }
  } catch (e) { fail(e); }
}

async function applyMapping() {
  const current = document.value;
  if (!current || current.kind !== 'm3u' || busy.value) return;
  const previousName = name.value;
  const previousLinked = linked.value;
  busy.value = '正在按映射重新读取…';
  error.value = '';
  try {
    const doc = await playlistImportApi.read({ kind: 'file', value: current.source, mapping: mapping.value });
    if (disposed) return;
    await matchDocument(doc);
    name.value = previousName;
    linked.value = previousLinked;
  } catch (e) { if (!disposed) fail(e); }
  finally { if (!disposed) busy.value = ''; }
}

function choose(index: number, path: string | null) {
  choices.value[index] = path;
  ignored.value = ignored.value.filter(i => i !== index);
}
function skip(index: number) {
  choices.value[index] = null;
  if (!ignored.value.includes(index)) ignored.value.push(index);
}

function startSearch(index: number) {
  searchIndex.value = index;
  query.value = document.value?.tracks[index]?.title ?? '';
  void search();
  void nextTick(() => card.value?.querySelector<HTMLInputElement>('.manual-search input')?.focus());
}
function scheduleSearch() {
  searchGeneration += 1;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void search(), 250);
}
async function search() {
  const request = ++searchGeneration;
  if (!query.value.trim()) { searchResults.value = []; searching.value = false; return; }
  searching.value = true;
  try {
    const result = await tauriInvoke('get_library_song_path_page_for_all_view', { query: query.value.trim(), sortMode: 'title', offset: 0, limit: 40 });
    const songs = await loadSongs(result.paths);
    if (disposed || request !== searchGeneration) return;
    searchResults.value = songs.filter(s => s.source_type !== 'remote').map(s => ({ path: s.path, title: s.title || s.name, artists: s.artist_names, album: s.album, duration: s.duration, score: 0, reason: '手动选择' }));
  } catch (e) { if (!disposed && request === searchGeneration) fail(e); }
  finally { if (!disposed && request === searchGeneration) searching.value = false; }
}
function selectSearch(song: PlaylistCandidate) {
  if (searchIndex.value === null) return;
  const row = matches.value[searchIndex.value];
  if (row && !row.candidates.some(c => c.path === song.path)) row.candidates.push(song);
  choose(searchIndex.value, song.path);
  searchIndex.value = null;
}
async function audition(path: string) {
  try { const song = await loadSong(path) ?? (await fileApi.parseAudioFiles([path]))[0]; if (song) await playSong(song, { preserveQueue: true }); }
  catch (e) { fail(e); }
}

async function save() {
  const doc = document.value;
  if (!doc || !canSave.value) return;
  busy.value = '正在保存歌单…';
  error.value = '';
  const id = targetId ?? crypto.randomUUID();
  let rollback: (() => void) | undefined;
  try {
    const existing = targetId ? collections.playlists.find(p => p.id === targetId) : undefined;
    if (targetId && !existing) throw new Error('这个歌单已被删除，无法保存');
    if (linked.value && !existing?.importData?.linked && collections.playlists.filter(p => p.importData?.linked).length >= 500) throw new Error('最多关联 500 个歌单文件，请取消关联选项或先解除其他文件关联');
    if (existing?.importData?.linked && (existing.importData.revision !== oldData.value?.revision || existing.importData.updatedAt !== oldData.value?.updatedAt)) throw new Error('源文件内容已更新，请关闭后重新打开');
    const paths = choices.value.filter((p): p is string => !!p);
    const playable = await playlistImportApi.prepare(id, paths);
    const ready = new Set(playable);
    const selected = choices.value.map(path => path && ready.has(path) ? path : null);
    const next: PlaylistImportData = { document: clone(doc), choices: selected, ignored: [...ignored.value], linked: linked.value && doc.kind === 'm3u', mapping: { ...mapping.value }, revision: crypto.randomUUID(), updatedAt: new Date().toISOString(), error: null };
    const newPaths = selected.filter((p): p is string => !!p);
    if (existing && (!collections.playlists.includes(existing) || existing.importData?.linked && existing.importData.updatedAt !== oldData.value?.updatedAt)) throw new Error('歌单在保存期间发生了变化，请重新打开后重试');
    if (existing) {
      const before = clone(existing);
      rollback = () => { Object.assign(existing, before); };
      // Retry fills gaps without resetting the user's order or restoring songs they removed.
      const previous = oldData.value;
      if (previous && !previous.linked && !next.linked) {
        const replacements = new Map(previous.choices.flatMap((path, i) => path && selected[i] !== path ? [[path, selected[i] ?? null] as const] : []));
        existing.songPaths = existing.songPaths.flatMap(path => replacements.has(path) ? replacements.get(path) ? [replacements.get(path)!] : [] : [path]);
        selected.forEach((path, i) => { if (path && !previous.choices[i] && !existing.songPaths.includes(path)) existing.songPaths.push(path); });
      } else existing.songPaths = newPaths;
      existing.name = name.value.trim();
      existing.importData = next;
    } else {
      collections.playlists.push({ id, name: name.value.trim(), songPaths: newPaths, createdAt: new Date().toLocaleDateString('sv-SE'), importData: next });
      rollback = () => { collections.playlists = collections.playlists.filter(p => p.id !== id); };
    }
    // Persist the source record before reporting success, including all unresolved entries.
    localStore.setJson(playerStorageKeys.playlists, collections.playlists);
    rollback = undefined;
    collections.setPlaylistSortOverride(id, 'custom');
    includeImportedPaths(playable);
    try {
      const remembered = localStore.getJson<Record<string, string>>('player_playlist_match_choices') ?? {};
      doc.tracks.forEach((track, i) => { const key = matchKey(doc, track); if (key && selected[i]) remembered[key] = selected[i]!; });
      localStore.setJson('player_playlist_match_choices', Object.fromEntries(Object.entries(remembered).slice(-10000)));
    } catch (error) { console.warn('无法保存匹配偏好：', error); }
    showToast(`已保存「${name.value.trim()}」，${newPaths.length} 首可播放，${selected.filter((p, i) => !p && !next.ignored.includes(i)).length} 首待补齐`, 'success');
    dialog.close();
    if (!targetId) void openHomePlaylist(id);
  } catch (e) { rollback?.(); fail(e); }
  finally { busy.value = ''; }
}

function keydown(event: KeyboardEvent) {
  event.stopPropagation();
  if (event.key === 'Escape') { event.preventDefault(); if (searchIndex.value !== null) searchIndex.value = null; else close(); }
  if (event.key === 'Tab') {
    const scope = searchIndex.value !== null ? card.value?.querySelector('.manual-search') : card.value;
    const items = Array.from(scope?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? []).filter(el => el.getClientRects().length);
    const first = items[0]; const last = items[items.length - 1];
    if (event.shiftKey && globalThis.document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && globalThis.document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
}

onMounted(async () => {
  await nextTick();
  card.value?.focus();
  boundsObserver = new ResizeObserver(() => {
    stopDrag();
    position.value = clampPosition(position.value.x, position.value.y);
  });
  if (overlay.value) boundsObserver.observe(overlay.value);
  if (card.value) boundsObserver.observe(card.value);
  window.addEventListener('blur', handleWindowBlur);
  const previous = collections.playlists.find(p => p.id === targetId)?.importData;
  if (previous) {
    oldData.value = clone(previous);
    mapping.value = { ...previous.mapping };
    try { await matchDocument(clone(previous.document), previous); }
    catch (e) { fail(e); }
    finally { busy.value = ''; }
  } else if (sourceValue.value) { sourceMode.value = 'file'; await readSource(); }
});
onBeforeUnmount(() => {
  stopDrag();
  boundsObserver?.disconnect();
  window.removeEventListener('blur', handleWindowBlur);
  disposed = true; generation += 1; searchGeneration += 1; clearTimeout(searchTimer); returnFocus?.focus(); });
</script>

<template>
  <Teleport to="body">
    <div ref="overlay" class="import-overlay" @pointerdown.self="close">
      <section ref="card" class="import-dialog" :class="{ 'is-preview': document, 'is-dragging': isDragging }" :style="{ transform: `translate(${position.x}px, ${position.y}px)` }" role="dialog" aria-modal="true" aria-labelledby="playlist-import-title" tabindex="-1" @keydown="keydown" @keyup.stop>
        <header @pointerdown="startDrag" @lostpointercapture="stopDrag"><div><h2 id="playlist-import-title">{{ targetId ? '导入记录与补充匹配' : '导入外部歌单' }}</h2></div><button class="icon-button" aria-label="关闭导入窗口" :disabled="busy.startsWith('正在保存')" @click="close"><X :size="20" /></button></header>
        <nav v-if="!document" aria-label="歌单来源"><button :class="{ active: sourceMode === 'url' }" :aria-pressed="sourceMode === 'url'" :disabled="!!busy" @click="sourceMode = 'url'; sourceValue = ''"><Link :size="16" />分享链接</button><button :class="{ active: sourceMode === 'file' }" :aria-pressed="sourceMode === 'file'" :disabled="!!busy" @click="sourceMode = 'file'; sourceValue = ''"><FileMusic :size="16" />歌单文件</button><button :class="{ active: sourceMode === 'text' }" :aria-pressed="sourceMode === 'text'" :disabled="!!busy" @click="sourceMode = 'text'; sourceValue = ''">粘贴清单</button></nav>
        <div class="import-body">
          <div v-if="!document" :key="sourceMode" class="import-source custom-scrollbar">
            <label v-if="sourceMode === 'url'">网易云音乐 / QQ 音乐公开歌单<input v-model="sourceValue" :disabled="!!busy" placeholder="粘贴歌单链接或分享文字" @keydown.enter.prevent="readSource" /><small>平台限制可能导致读取失败；可以使用导出的歌曲清单文件。</small></label>
            <template v-else-if="sourceMode === 'file'"><button class="file-picker" :disabled="!!busy" @click="pickFile"><FileMusic :size="24" /><span :title="sourceValue">{{ sourceValue || '选择 M3U、M3U8、CSV、JSON 或 TXT 文件' }}</span></button><details><summary>跨设备路径不同？设置路径前缀映射</summary><label>原设备目录<input v-model="mapping.from" placeholder="/storage/emulated/0/Music" :disabled="!!busy" /></label><label>本机对应目录<input v-model="mapping.to" placeholder="D:/Music" :disabled="!!busy" /></label></details></template>
            <label v-else class="text-source">每行一首歌<textarea class="custom-scrollbar" v-model="sourceValue" :disabled="!!busy" rows="5" placeholder="晴天 - 周杰伦&#10;夜曲 - 周杰伦" /><small>也支持用 Tab 分隔：歌名、歌手、专辑；多位歌手用分号分隔。</small></label>

          </div>
          <div v-else class="import-preview custom-scrollbar">
            <div class="preview-heading"><label>歌单名称<input v-model="name" :disabled="!!busy" maxlength="200" /></label><div class="counts"><strong>{{ document.tracks.length }} 个条目</strong><span>{{ selectedCount }} 已匹配</span><span>{{ pendingCount }} 待补齐</span><span v-if="ignored.length">{{ ignored.length }} 已跳过</span></div></div>
            <label v-if="isM3u" class="link-option"><input v-model="linked" type="checkbox" :disabled="!!busy || !!oldData?.linked" /><span>关联源文件，自动跟随文件更新<small>关联后由文件决定歌曲和顺序；缺失歌曲到达后自动恢复。</small></span></label>
            <details v-if="isM3u" class="mapping-editor"><summary>查看或修改跨设备路径映射</summary><div><label>原设备目录<input v-model="mapping.from" :disabled="!!busy" placeholder="/storage/emulated/0/Music" /></label><label>本机对应目录<input v-model="mapping.to" :disabled="!!busy" placeholder="D:/Music" /></label><button :disabled="!!busy" @click="applyMapping">按映射重新读取</button></div></details>
            <p v-if="oldData && !oldData.linked" class="hint">补齐的歌曲会追加到歌单；保留已有歌曲的手动顺序和移除操作。</p>
            <p v-for="warning in document.warnings" :key="warning" class="warning">{{ warning }}</p>
            <div class="preview-tools"><div role="group" aria-label="筛选匹配结果"><button :class="{ active: filter === 'all' }" @click="filter = 'all'; page = 0">全部</button><button :class="{ active: filter === 'pending' }" @click="filter = 'pending'; page = 0">待确认 / 未找到 {{ pendingCount }}</button></div><span v-if="linked">源文件只读</span><span v-else>相近版本请先试听确认</span></div>
            <div class="match-list custom-scrollbar" aria-label="歌曲匹配结果">
              <article v-for="{ track, index } in visibleRows" :key="index" class="match-row" :class="{ unresolved: !choices[index] && !ignored.includes(index) }">
                <span class="track-number">{{ index + 1 }}</span><div class="source-track"><strong>{{ track.title || `未读取到详情（${track.id}）` }}</strong><span>{{ track.artists.join(' / ') || '歌手未知' }}<template v-if="track.album"> · {{ track.album }}</template></span><small v-if="track.path" :title="track.path">{{ track.path }}</small></div>
                <div class="matched-track"><template v-if="choices[index]"><select :value="choices[index]" :disabled="linked || !!busy" :aria-label="`选择第 ${index + 1} 首的本地歌曲`" @change="choose(index, ($event.target as HTMLSelectElement).value || null)"><option v-if="!candidate(index)" :value="choices[index]!">{{ choices[index] }}</option><option v-for="c in matches[index]?.candidates" :key="c.path" :value="c.path">{{ c.title }} · {{ c.artists.join(' / ') }} · {{ c.album }}</option><option value="">取消匹配</option></select><small :title="choices[index]!">{{ candidate(index)?.reason || '已保留的匹配' }}</small></template><template v-else><span>{{ ignored.includes(index) ? '已跳过' : matches[index]?.candidates.length ? '找到相近歌曲，请确认' : track.path ? '文件暂不可用' : '本地未找到' }}</span><select v-if="matches[index]?.candidates.length && !linked" value="" :aria-label="`确认第 ${index + 1} 首的候选歌曲`" @change="choose(index, ($event.target as HTMLSelectElement).value || null)"><option value="">选择候选歌曲</option><option v-for="c in matches[index]?.candidates" :key="c.path" :value="c.path">{{ c.title }} · {{ c.artists.join(' / ') }} · {{ c.reason }}</option></select></template></div>
                <div class="row-actions"><button v-if="choices[index]" :disabled="!!busy" @click="audition(choices[index]!)">试听</button><template v-if="!linked"><button :disabled="!!busy" @click="startSearch(index)">搜索</button><button :disabled="!!busy" @click="ignored.includes(index) ? ignored = ignored.filter(i => i !== index) : skip(index)">{{ ignored.includes(index) ? '恢复' : '跳过' }}</button></template></div>
              </article>
              <p v-if="!visibleRows.length" class="empty">{{ filter === 'pending' ? '所有条目都已处理' : '这是一张空歌单，可以保存并等待源文件更新' }}</p>
            </div>
            <div class="pagination"><button :disabled="page === 0" @click="page--">上一页</button><span>{{ page + 1 }} / {{ Math.max(1, Math.ceil(rows.length / 40)) }}</span><button :disabled="(page + 1) * 40 >= rows.length" @click="page++">下一页</button></div>
          </div>
          <p v-if="error" class="error custom-scrollbar" role="alert">{{ error }}</p>
        </div>
        <footer><span v-if="busy" class="busy" role="status"><LoaderCircle :size="16" class="spin" />{{ busy }}</span><span v-else class="hint">{{ document ? '未匹配条目会保留，之后可继续补齐。' : '歌曲由本地曲库提供。' }}</span><div><button v-if="document && !targetId" :disabled="!!busy" @click="document = null"><ArrowLeft :size="14" />重新选择</button><button v-if="!document" class="primary" :disabled="!sourceValue.trim() || !!busy" @click="readSource">读取并匹配</button><button v-else class="primary" :disabled="!canSave" @click="save"><Check :size="15" />{{ targetId ? '保存匹配结果' : '创建歌单' }}</button></div></footer>
        <div v-if="searchIndex !== null" class="manual-search" role="region" aria-label="搜索本地歌曲"><div><strong>为「{{ document?.tracks[searchIndex]?.title }}」选择歌曲</strong><button class="icon-button" aria-label="关闭本地搜索" @click="searchIndex = null"><X :size="18" /></button></div><label class="search-input"><Search :size="16" /><input v-model="query" autofocus placeholder="搜索本地歌名、歌手或专辑" @input="scheduleSearch" /></label><p v-if="searching" role="status">正在搜索…</p><div class="search-results custom-scrollbar"><button v-for="song in searchResults" :key="song.path" @click="selectSearch(song)"><strong>{{ song.title }}</strong><span>{{ song.artists.join(' / ') }} · {{ song.album }}</span><small>{{ song.path }}</small></button><p v-if="!searching && !searchResults.length">没有找到匹配歌曲，试试更短的关键词。</p></div></div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.import-overlay { --dialog-gutter: clamp(8px, 2vw, 24px); position: fixed; inset: 0; z-index: 10020; display: flex; align-items: center; justify-content: center; box-sizing: border-box; padding: var(--dialog-gutter); background: #10101875; }
.import-dialog { --surface: #fff; --ink: #282830; --muted: #777781; --line: #80809025; --field: #8080900b; position: relative; display: flex; flex-direction: column; box-sizing: border-box; width: 100%; max-width: 760px; height: min(600px, calc(100dvh - 2 * var(--dialog-gutter))); max-height: 100%; min-height: 0; min-width: 0; flex-shrink: 0; background: var(--surface); color: var(--ink); border: 1px solid var(--line); border-radius: 20px; box-shadow: 0 28px 100px #0004; outline: none; overflow: hidden; font-size: 13px; }
.import-dialog.is-preview { max-width: 1100px; height: min(820px, calc(100dvh - 2 * var(--dialog-gutter))); }
:global(.dark .import-dialog) { --surface: #242429; --ink: #eeeef4; --muted: #a2a2ad; --line: #ffffff1a; --field: #ffffff07; }
header, footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-shrink: 0; padding: 18px 24px; }
header > div { min-width: 0; } header > button { flex-shrink: 0; }
.is-dragging header { cursor: grabbing; }
header { cursor: grab; touch-action: none; user-select: none; border-bottom: 1px solid var(--line); } h2 { margin: 0; font-size: 20px; font-weight: 650; line-height: 1.4; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 12px; border-radius: 8px; cursor: pointer; background: var(--field); }
button:hover { background: #80809020; } button:disabled { opacity: .45; cursor: default; } button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid #ec4141; outline-offset: 2px; } .icon-button { padding: 8px; background: transparent; }
.primary { background: #ec4141; color: white; } .primary:hover { background: #d93737; }
input:not([type="checkbox"]), textarea, select { box-sizing: border-box; min-width: 0; max-width: 100%; width: 100%; padding: 11px 12px; border: 1px solid var(--line); border-radius: 8px; color: var(--ink); background: var(--field); } select option { background: var(--surface); } textarea { resize: vertical; min-height: 120px; }
label { display: flex; flex-direction: column; gap: 8px; } small, .hint { font-size: 11px; color: var(--muted); line-height: 1.6; } p { line-height: 1.7; }
.import-dialog .custom-scrollbar { scrollbar-color: #80809066 transparent; overscroll-behavior: contain; }
@supports selector(::-webkit-scrollbar) {
  .import-dialog .custom-scrollbar { scrollbar-width: auto; scrollbar-color: auto; }
  .import-dialog .custom-scrollbar::-webkit-scrollbar-button { display: none; }
  .import-dialog .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #80809055; }
  .import-dialog .custom-scrollbar:hover::-webkit-scrollbar-thumb { background-color: #80809088; }
  .import-dialog .custom-scrollbar::-webkit-scrollbar-thumb:hover { background-color: #808090aa; }
}
.import-body { flex: 1; min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.import-source, .import-preview, .match-list, .search-results { min-width: 0; overflow-x: hidden; }
.import-source { flex: 1; min-height: 0; overflow-y: auto; scrollbar-gutter: stable; margin-block: 12px; padding: 8px 24px 12px; display: flex; flex-direction: column; gap: 20px; }
nav { display: flex; flex-shrink: 0; gap: 8px; padding: 18px 24px 0; } nav button { flex: 1; min-width: 0; padding: 12px 8px; white-space: nowrap; } .active { color: #ec4141; background: #ec414114; }
.import-source > * { flex-shrink: 0; }
.text-source { flex: 1; min-height: 200px; } .text-source textarea { flex: 1; min-height: 100px; resize: none; }
.file-picker { width: 100%; min-width: 0; height: 120px; display: flex; flex-direction: column; gap: 12px; border: 1px dashed var(--line); } .file-picker span { max-width: 100%; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
details { color: var(--muted); font-size: 12px; } summary { cursor: pointer; } details label { margin-top: 14px; } details p { margin-top: 12px; }
.import-preview { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow-y: auto; scrollbar-gutter: stable; padding: 18px 26px 0; } .preview-heading { display: flex; align-items: flex-end; gap: 20px; margin-bottom: 14px; } .preview-heading label { flex: 1; max-width: 360px; } .counts { display: flex; flex-wrap: wrap; gap: 8px 14px; padding-bottom: 10px; color: var(--muted); font-size: 12px; } .counts strong { color: var(--ink); }
.import-preview > * { flex-shrink: 0; }
.link-option { flex-direction: row; align-items: flex-start; gap: 10px; padding: 12px; margin-bottom: 12px; background: var(--field); border-radius: 10px; } .link-option input { margin-top: 3px; accent-color: #ec4141; } .link-option small { display: block; margin-top: 3px; }
.warning, .error { overflow-wrap: anywhere; padding: 10px 12px; border-radius: 8px; background: #d99a1012; color: #aa7410; margin: 0 0 8px; font-size: 12px; } .error { color: #d94343; background: #ec41410c; margin: 8px 26px; flex-shrink: 0; max-height: min(80px, 25%); overflow-y: auto; overflow-wrap: anywhere; }
.mapping-editor { margin-bottom: 12px; } .mapping-editor > div { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; padding-bottom: 4px; } .mapping-editor label { flex: 1; min-width: min(200px, 100%); }
.preview-tools { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 0 12px; color: var(--muted); font-size: 11px; } .preview-tools > div { display: flex; gap: 6px; }
.match-list { overflow-y: auto; min-height: 120px; flex: 1 0 120px; border-top: 1px solid var(--line); }
.match-row { display: grid; grid-template-columns: 24px minmax(0, 1fr) minmax(0, 1.1fr) auto; align-items: center; gap: 12px; padding: 14px 4px; border-bottom: 1px solid var(--line); } .track-number { font-size: 11px; color: var(--muted); }
.source-track, .matched-track { min-width: 0; display: flex; flex-direction: column; gap: 5px; } .source-track strong, .source-track span, .source-track small, .matched-track small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .source-track span { font-size: 11px; color: var(--muted); } .matched-track select { padding: 7px 6px; font-size: 11px; } .matched-track > span { font-size: 12px; color: var(--muted); } .unresolved .matched-track > span { color: #bd8518; } .row-actions { display: flex; gap: 4px; } .row-actions button { padding: 5px 7px; font-size: 11px; }
.empty { text-align: center; padding: 30px; color: var(--muted); } .pagination { display: flex; align-items: center; justify-content: center; gap: 16px; padding: 12px 0; color: var(--muted); font-size: 11px; }
footer { display: grid; grid-template-columns: minmax(0, 1fr) auto; border-top: 1px solid var(--line); padding-block: 16px; } footer > div { grid-column: 2; display: flex; flex-shrink: 0; gap: 10px; margin-left: auto; } footer > .hint, footer > .busy { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .busy { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; } .spin { animation: import-spin 1s linear infinite; } @keyframes import-spin { to { transform: rotate(360deg); } }
.manual-search { position: absolute; inset: 90px 24px 24px; display: flex; flex-direction: column; gap: 16px; padding: 20px; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 0 0 1000px #0004; z-index: 1; } .manual-search > div:first-child { display: flex; min-width: 0; gap: 12px; justify-content: space-between; align-items: center; } .manual-search > div:first-child strong { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; } .manual-search .icon-button { flex-shrink: 0; } .search-input { flex-direction: row; align-items: center; } .search-results { overflow-y: auto; } .search-results button { display: flex; align-items: flex-start; flex-direction: column; width: 100%; margin-bottom: 6px; text-align: left; } .search-results span { font-size: 11px; color: var(--muted); } .search-results small { overflow-wrap: anywhere; }
@media (max-width: 440px) { footer > .hint { display: none; } footer > div { gap: 6px; } footer button { padding-inline: 8px; } h2 { font-size: 18px; } }
@media (max-width: 760px) { header, footer { padding: 14px 16px; } footer { gap: 12px; } nav { padding: 14px 16px 0; } nav button { padding: 10px 6px; } .import-source, .import-preview { padding-inline: 16px; } .preview-heading { flex-direction: column; align-items: stretch; gap: 8px; } .preview-heading label { max-width: none; } .counts { padding: 0; } .match-row { grid-template-columns: 20px minmax(0, 1fr); } .matched-track { grid-column: 2; } .row-actions { grid-column: 2; } .preview-tools > span { display: none; } }
@media (max-height: 500px) { header, footer { padding-block: 10px; } nav { padding-top: 10px; } .import-source { margin-block: 8px; padding-block: 6px; gap: 14px; } }
</style>
