<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { Copy, Download, ExternalLink, FileMusic, Info, MoreHorizontal, RefreshCw, X } from 'lucide-vue-next';
import { open, save } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useCollectionsStore } from '../../features/collections/store';
import { usePlaylistImportDialog } from '../../features/playlistImport/dialog';
import { includeImportedPaths } from '../../features/playlistImport/files';
import { playlistImportApi } from '../../services/tauri/playlistImportApi';
import { useToast } from '../../composables/toast';

const props = defineProps<{ playlistId: string }>();
const collections = useCollectionsStore();
const dialog = usePlaylistImportDialog();
const { showToast } = useToast();
const playlist = computed(() => collections.playlists.find(p => p.id === props.playlistId));
const data = computed(() => playlist.value?.importData);

const busy = ref(false);

const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const infoDialog = ref<HTMLDialogElement | null>(null);
const infoTitleId = useId();
const menuOpen = ref(false);
const menuPosition = ref({ left: '0px', top: '0px' });
const sourceLabel = computed(() => data.value?.linked ? '文件关联 · 自动刷新' : data.value?.document.kind === 'netease' ? '网易云音乐' : data.value?.document.kind === 'qq' ? 'QQ 音乐' : '文件或清单');
const sourceUrl = computed(() => {
  try {
    const url = new URL(data.value?.document.source ?? '');
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
});
const actions = computed(() => [
  ...(data.value ? [
    { label: '导入信息', icon: Info, run: () => infoDialog.value?.showModal() },
    { label: data.value.linked ? '查看来源条目' : '补充匹配', icon: FileMusic, run: () => dialog.open(props.playlistId) },
    ...(data.value.linked ? [
      { label: '立即刷新', icon: RefreshCw, run: refresh },
      { label: '重新关联文件', icon: FileMusic, run: relink },
      { label: '复制为普通歌单', icon: Copy, run: copy },
      { label: '解除文件关联', icon: X, run: detach },
    ] : []),
  ] : []),
  { label: '导出 M3U8', icon: Download, run: exportFile },
]);
function closeMenu() {
  if (menu.value?.matches(':popover-open')) menu.value.hidePopover();
  menuOpen.value = false;
}
async function toggleMenu() {
  if (menuOpen.value) { closeMenu(); return; }
  const rect = trigger.value?.getBoundingClientRect();
  if (!menu.value || !rect) return;
  menu.value.showPopover();
  menuOpen.value = true;
  const bounds = menu.value.getBoundingClientRect();
  const below = window.innerHeight - rect.bottom - 8;
  menuPosition.value = {
    left: `${Math.max(8, Math.min(rect.left, window.innerWidth - bounds.width - 8))}px`,
    top: `${Math.max(8, below >= bounds.height ? rect.bottom + 6 : rect.top - bounds.height - 6)}px`,
  };
  await nextTick();
  menu.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
}
function menuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(); trigger.value?.focus(); }
  else if (event.key === 'Tab') closeMenu();
  else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const items = Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[index]?.focus();
  }
}
function runAction(action: () => unknown) { closeMenu(); trigger.value?.focus({ preventScroll: true }); action(); }
async function copySource() {
  try { await navigator.clipboard.writeText(data.value?.document.source ?? ''); showToast('已复制来源', 'success'); }
  catch { showToast('复制失败，请重试', 'error'); }
}
async function openSource() {
  if (!sourceUrl.value) return;
  try { await openUrl(sourceUrl.value); }
  catch { showToast('无法打开来源链接', 'error'); }
}
watch(() => props.playlistId, () => { closeMenu(); infoDialog.value?.close(); });
onMounted(() => window.addEventListener('resize', closeMenu));
onBeforeUnmount(() => { window.removeEventListener('resize', closeMenu); closeMenu(); infoDialog.value?.close(); });

function refresh() {
  if (!data.value?.linked) return;
  data.value.error = null;
  data.value.revision = crypto.randomUUID();
  showToast('正在重新读取源文件', 'info');
}
function detach() {
  if (!data.value) return;
  data.value.linked = false;
  data.value.revision = crypto.randomUUID();
  data.value.error = null;
  showToast('已解除文件关联，当前歌单可自由编辑', 'success');
}
function copy() {
  const value = playlist.value;
  if (!value) return;
  const id = collections.createPlaylist(`${value.name}（副本）`, value.songPaths);
  const target = collections.playlists.find(p => p.id === id);
  if (target && value.importData) {
    target.importData = JSON.parse(JSON.stringify(value.importData));
    target.importData!.linked = false;
    target.importData!.revision = crypto.randomUUID();
    target.importData!.error = null;
  }
  if (id) collections.setPlaylistSortOverride(id, 'custom');
  showToast('已创建可编辑的歌单副本', 'success');
}
async function relink() {
  if (!playlist.value || busy.value) return;
  const target = playlist.value;
  const before = target.importData;
  busy.value = true;
  try {
    const path = await open({ filters: [{ name: '本地文件歌单', extensions: ['m3u', 'm3u8'] }] });
    if (typeof path !== 'string') return;
    const doc = await playlistImportApi.read({ kind: 'file', value: path, mapping: before?.mapping });
    if (collections.playlists.some(p => p.id !== target.id && p.importData?.linked && p.importData.document.source === doc.source)) throw new Error('这个文件已经关联到其他歌单');
    const paths = doc.tracks.flatMap(t => t.path ? [t.path] : []);
    const playable = await playlistImportApi.prepare(target.id, paths);
    if (!collections.playlists.includes(target) || target.importData !== before) return;
    const ready = new Set(playable);
    const choices = doc.tracks.map(t => t.path && ready.has(t.path) ? t.path : null);
    target.importData = { document: doc, choices, ignored: [], linked: true, mapping: before?.mapping ?? { from: '', to: '' }, revision: crypto.randomUUID(), updatedAt: new Date().toISOString(), error: null };
    target.songPaths = choices.filter((p): p is string => !!p);
    collections.setPlaylistSortOverride(target.id, 'custom');
    includeImportedPaths(playable);
    showToast('已关联新的歌单文件', 'success');
  } catch (error) { showToast(String(error), 'error'); }
  finally { busy.value = false; }
}
async function exportFile() {
  if (!playlist.value || busy.value) return;
  const value = playlist.value;
  busy.value = true;
  try {
    const path = await save({ defaultPath: `${value.name.replace(/[<>:"/\\|?*]/g, '_')}.m3u8`, filters: [{ name: 'UTF-8 歌单', extensions: ['m3u8'] }] });
    if (!path) return;
    // Retain missing entries in a linked file rather than silently exporting only its playable subset.
    const paths = value.importData?.linked ? value.importData.document.tracks.flatMap(t => t.path ? [t.path] : []) : [...value.songPaths];
    await playlistImportApi.export(path, paths);
    showToast('已导出 M3U8 歌单（优先使用相对路径）', 'success');
  } catch (error) { showToast(String(error), 'error'); }
  finally { busy.value = false; }
}
</script>

<template>
  <div v-if="playlist" class="playlist-more">
    <button ref="trigger" type="button" class="more-trigger" title="更多操作" aria-label="歌单更多操作" aria-haspopup="menu" :aria-expanded="menuOpen" @click="toggleMenu" @keydown.down.prevent="toggleMenu"><MoreHorizontal :size="20" /></button>
    <Teleport to="body">
      <div ref="menu" popover="auto" role="menu" aria-label="歌单更多操作" class="source-menu custom-scrollbar" :style="menuPosition" @toggle="menuOpen = ($event as ToggleEvent).newState === 'open'" @keydown.stop="menuKeydown" @keyup.stop>
        <button v-for="action in actions" :key="action.label" type="button" role="menuitem" :disabled="busy" @click="runAction(action.run)"><component :is="action.icon" :size="15" /><span>{{ action.label }}</span></button>
      </div>
      <dialog v-if="data" ref="infoDialog" class="source-info custom-scrollbar" :aria-labelledby="infoTitleId" @keydown.stop @keyup.stop @close="trigger?.focus()">
        <header><h2 :id="infoTitleId">导入信息</h2><button type="button" aria-label="关闭导入信息" autofocus @click="infoDialog?.close()"><X :size="18" /></button></header>
        <dl><dt>来源</dt><dd>{{ sourceLabel }}</dd><dt>来源链接 / 文件</dt><dd class="source-path">{{ data.document.source || '粘贴清单' }}</dd><template v-if="data.updatedAt"><dt>最近更新</dt><dd>{{ new Date(data.updatedAt).toLocaleString() }}</dd></template></dl>
        <p v-if="data.linked" class="info-hint">歌曲和顺序由源文件决定，源文件更新后自动同步。</p>
        <p v-if="data.error" role="status" class="source-error">{{ data.error }} · 已保留上次成功的歌单，将自动重试。</p>
        <footer><button v-if="data.document.source" type="button" @click="copySource"><Copy :size="14" />复制来源</button><button v-if="sourceUrl" type="button" @click="openSource"><ExternalLink :size="14" />打开链接</button></footer>
      </dialog>
    </Teleport>
  </div>
</template>

<style scoped>
.playlist-more { display: flex; flex-shrink: 0; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border-radius: 8px; cursor: pointer; }
.more-trigger { padding: 8px 20px; color: inherit; border: 1px solid #8080800a; border-radius: 999px; box-shadow: 0 1px 2px #0000000d; }
button:hover, button:focus-visible { background: #80808015; }
button:focus-visible { outline: 2px solid #ec4141; outline-offset: 2px; }
button:disabled { opacity: .4; cursor: default; }
.source-menu, .source-info { color: #36363e; background: #fff; border: 1px solid #80808025; box-shadow: 0 12px 36px #0003; }
:global(.dark .source-menu), :global(.dark .source-info) { color: #ececf0; background: #242428; border-color: #ffffff20; }
.source-menu { position: fixed; inset: auto; margin: 0; width: 208px; max-width: calc(100vw - 16px); max-height: calc(100dvh - 16px); padding: 6px; border-radius: 12px; overflow-y: auto; }
.source-menu button { display: flex; width: 100%; justify-content: flex-start; padding: 10px; font-size: 12px; text-align: left; }
.source-info { box-sizing: border-box; position: fixed; inset: 0; margin: auto; width: min(460px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); padding: 22px; border-radius: 16px; overflow-y: auto; }
.source-info::backdrop { background: #10101875; }
.source-info header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.source-info header button { padding: 6px; flex-shrink: 0; }
h2 { font-size: 18px; font-weight: 700; }
dl { font-size: 13px; } dt { margin-top: 16px; color: #8b8b96; font-size: 11px; } dd { margin-top: 6px; overflow-wrap: anywhere; user-select: text; }
.info-hint, .source-error { margin-top: 16px; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.info-hint { color: #8b8b96; } .source-error { color: #bd8518; }
.source-info footer { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; } footer button { padding: 8px 10px; font-size: 12px; background: #8080800d; }
</style>
