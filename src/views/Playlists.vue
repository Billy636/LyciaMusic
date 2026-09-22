<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { ArrowDownWideNarrow, Check, ChevronLeft, ChevronRight, LayoutGrid, List, ListChecks, ListMusic, ListPlus, LoaderCircle, MoreHorizontal, Pin, PinOff, Play, Plus, Search, Trash2, X } from 'lucide-vue-next';
import AppCheckbox from '../components/common/AppCheckbox.vue';
import ModernInputModal from '../components/common/ModernInputModal.vue';
import ModernModal from '../components/common/ModernModal.vue';
import PlaylistCover from '../components/playlists/PlaylistCover.vue';
import PlaylistActionsMenu, { type PlaylistMenuAction } from '../components/playlists/PlaylistActionsMenu.vue';
import { usePlaylistLibraryStore, type PlaylistLibraryFilter } from '../features/collections/playlistLibrary';
import { useLibraryCollections } from '../features/collections/useLibraryCollections';
import { usePlaybackController } from '../features/playback/usePlaybackController';
import { useLibrarySongResolver } from '../composables/useLibrarySongResolver';
import { useHomeNavigation } from '../composables/useHomeNavigation';
import { useListScrollMemory } from '../composables/useListScrollMemory';
import { usePlaylistManagement } from '../composables/usePlaylistManagement';
import { useToast } from '../composables/toast';
import type { Playlist } from '../types';

const router = useRouter();
const route = useRoute();
const { openHomePlaylist } = useHomeNavigation(router);
const library = usePlaylistLibraryStore();
const { searchQuery, filter, viewMode, sortMode, visiblePlaylists, pinnedCount, emptyCount } = storeToRefs(library);
const { playlists, createPlaylist, deletePlaylist } = useLibraryCollections();
const { currentSong, playSong, clearQueue, addSongPathsToQueue } = usePlaybackController();
const { loadSongs } = useLibrarySongResolver();
const { showToast } = useToast();
const PAGE_SIZE = 24;
const container = ref<HTMLElement | null>(null);
const page = ref(Math.max(1, Math.floor(Number(route.query.page) || 1)));
const pageCount = computed(() => Math.max(1, Math.ceil(visiblePlaylists.value.length / PAGE_SIZE)));
const pagedPlaylists = computed(() => visiblePlaylists.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const scrollKey = computed(() => `playlists:${filter.value}:${searchQuery.value}:${sortMode.value}:${viewMode.value}:${page.value}`);
useListScrollMemory(scrollKey, container);
const management = usePlaylistManagement({ playlists, visiblePlaylists: pagedPlaylists, createPlaylist, deletePlaylist, removePinned: library.removePinned, showToast });
const { isManaging, selectedIds, allVisibleSelected, toggleSelection, toggleSelectAll, exitManagement, showNameModal, renameId, initialName, requestCreate, requestRename, confirmName, showDeleteModal, deleteMessage, requestDelete, confirmDelete } = management;
const tabs = computed<{ value: PlaylistLibraryFilter; label: string; count: number }[]>(() => [
  { value: 'all', label: '全部歌单', count: playlists.value.length },
  { value: 'pinned', label: '已置顶', count: pinnedCount.value },
  { value: 'empty', label: '空歌单', count: emptyCount.value },
]);
const allSelectedPinned = computed(() => selectedIds.value.size > 0 && [...selectedIds.value].every(library.isPinned));
const menuPlaylist = ref<Playlist | null>(null);
const menuPosition = ref({ x: 0, y: 0 });
const playingId = ref<string | null>(null);
let menuTrigger: HTMLElement | null = null;
let playbackRequest = 0;
onBeforeUnmount(() => { playbackRequest += 1; });

watch([searchQuery, filter, sortMode], () => {
  page.value = 1;
  selectedIds.value = new Set();
  container.value?.scrollTo({ top: 0 });
});
watch(pageCount, count => { page.value = Math.min(page.value, count); }, { immediate: true });
watch(page, value => {
  selectedIds.value = new Set();
  void router.replace({ query: { ...route.query, page: value > 1 ? String(value) : undefined } });
  container.value?.scrollTo({ top: 0 });
});
watch(() => route.query.page, value => {
  const requested = Number(value);
  page.value = Number.isFinite(requested) ? Math.min(pageCount.value, Math.max(1, Math.floor(requested))) : 1;
});

const resetFilters = () => { searchQuery.value = ''; filter.value = 'all'; };
const openPlaylist = (playlist: Playlist) => {
  if (isManaging.value) toggleSelection(playlist.id);
  else void openHomePlaylist(playlist.id);
};
const openMenu = (event: MouseEvent, playlist: Playlist) => {
  event.preventDefault();
  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  menuTrigger = event.type === 'contextmenu' ? target.querySelector<HTMLButtonElement>('.more-button') : target;
  menuPosition.value = event.type === 'contextmenu' ? { x: event.clientX, y: event.clientY } : { x: rect.right - 196, y: rect.bottom + 6 };
  menuPlaylist.value = playlist;
};
const closeMenu = () => {
  menuPlaylist.value = null;
  if (menuTrigger?.isConnected) menuTrigger.focus();
};
const playPlaylist = async (playlist: Playlist) => {
  if (playingId.value || !playlist.songPaths.length) return;
  const request = ++playbackRequest;
  const previousSong = currentSong.value;
  const stillCurrent = () => request === playbackRequest && playlists.value.some(item => item.id === playlist.id);
  playingId.value = playlist.id;
  try {
    // 曲库按需加载，不能依赖内存 songList 覆盖整个歌单。
    let firstSong = null;
    for (let offset = 0; offset < playlist.songPaths.length && !firstSong; offset += 32) {
      firstSong = (await loadSongs(playlist.songPaths.slice(offset, offset + 32)))[0] ?? null;
      if (!stillCurrent() || currentSong.value !== previousSong) return;
    }
    if (!firstSong) {
      showToast('歌单中的歌曲暂不可用，请检查音乐文件是否存在', 'info');
      return;
    }
    await clearQueue();
    if (!stillCurrent()) return;
    addSongPathsToQueue(playlist.songPaths);
    await playSong(firstSong, { preserveQueue: true });
  } catch {
    if (stillCurrent()) showToast('歌单播放失败，请稍后重试', 'error');
  } finally {
    playingId.value = null;
  }
};
const addSelectionToQueue = () => {
  const paths = [...new Set(playlists.value.filter(playlist => selectedIds.value.has(playlist.id)).flatMap(playlist => playlist.songPaths))];
  if (paths.length) addSongPathsToQueue(paths);
  else showToast('所选歌单中还没有歌曲', 'info');
};
const pinSelection = () => library.setPinned([...selectedIds.value], !allSelectedPinned.value);
const handleMenuAction = (action: PlaylistMenuAction) => {
  const playlist = menuPlaylist.value;
  closeMenu();
  if (!playlist) return;
  if (action === 'open') void openHomePlaylist(playlist.id);
  if (action === 'play') void playPlaylist(playlist);
  if (action === 'queue') addSongPathsToQueue(playlist.songPaths);
  if (action === 'pin') library.togglePin(playlist.id);
  if (action === 'rename') requestRename(playlist);
  if (action === 'delete') requestDelete([playlist.id]);
};
const createFromModal = (name: string) => {
  const creating = !renameId.value;
  confirmName(name);
  if (creating) {
    resetFilters();
    sortMode.value = 'newest';
    void nextTick(() => container.value?.scrollTo({ top: 0 }));
  }
};
</script>

<template>
  <section class="playlist-page" aria-label="歌单资料库">
    <header class="page-header">
      <div>
        <div class="eyebrow"><span></span> YOUR COLLECTION</div>
        <h1>我的歌单<span class="title-count">{{ playlists.length }}</span></h1>
        <p class="page-description">把喜欢的音乐，整理成自己的节奏。</p>
      </div>
      <div class="header-actions">
        <button type="button" class="button button-secondary" :class="{ 'is-active': isManaging }" :aria-pressed="isManaging" @click="isManaging ? exitManagement() : isManaging = true"><ListChecks :size="16" />{{ isManaging ? '完成管理' : '批量管理' }}</button>
        <button type="button" class="button button-primary" @click="requestCreate"><Plus :size="17" />新建歌单</button>
      </div>
    </header>

    <div class="library-toolbar">
      <div class="filter-tabs" role="group" aria-label="筛选歌单">
        <button v-for="tab in tabs" :key="tab.value" type="button" :class="{ active: filter === tab.value }" :aria-pressed="filter === tab.value" @click="filter = tab.value">{{ tab.label }}<span>{{ tab.count }}</span></button>
      </div>
      <div class="toolbar-controls">
        <div class="search-field"><Search :size="15" /><input v-model="searchQuery" type="search" aria-label="搜索歌单" placeholder="搜索歌单，支持拼音" @keydown.esc.stop="searchQuery = ''" /><button v-if="searchQuery" type="button" aria-label="清空歌单搜索" @click="searchQuery = ''"><X :size="14" /></button></div>
        <label class="sort-field"><ArrowDownWideNarrow :size="15" /><select v-model="sortMode" aria-label="歌单排序"><option value="custom">默认排序</option><option value="newest">最近创建</option><option value="name">名称 A–Z</option><option value="count">歌曲数量</option></select></label>
        <div class="view-switch" role="group" aria-label="歌单显示方式"><button type="button" title="网格视图" aria-label="网格视图" :aria-pressed="viewMode === 'grid'" :class="{ active: viewMode === 'grid' }" @click="viewMode = 'grid'"><LayoutGrid :size="16" /></button><button type="button" title="列表视图" aria-label="列表视图" :aria-pressed="viewMode === 'list'" :class="{ active: viewMode === 'list' }" @click="viewMode = 'list'"><List :size="17" /></button></div>
      </div>
    </div>

    <div v-if="isManaging" class="selection-toolbar">
      <div class="selection-summary"><AppCheckbox :checked="allVisibleSelected" :indeterminate="selectedIds.size > 0 && !allVisibleSelected" :disabled="!pagedPlaylists.length" aria-label="选择本页全部歌单" @change="toggleSelectAll" /><button type="button" @click="toggleSelectAll">本页全选</button><span aria-live="polite">已选 {{ selectedIds.size }} 个</span></div>
      <div class="selection-actions"><button type="button" :disabled="!selectedIds.size" @click="pinSelection"><component :is="allSelectedPinned ? PinOff : Pin" :size="14" />{{ allSelectedPinned ? '取消置顶' : '置顶' }}</button><button type="button" :disabled="!selectedIds.size" @click="addSelectionToQueue"><ListPlus :size="15" />加入队列</button><button type="button" class="danger" :disabled="!selectedIds.size" @click="requestDelete([...selectedIds])"><Trash2 :size="14" />删除</button><button type="button" aria-label="退出批量管理" @click="exitManagement"><X :size="16" /></button></div>
    </div>
    <div v-else class="collection-summary"><span aria-live="polite">{{ searchQuery.trim() ? `找到 ${visiblePlaylists.length} 个歌单` : `${visiblePlaylists.length} 个歌单` }}<template v-if="pinnedCount && filter === 'all' && !searchQuery.trim()"><span class="summary-divider">/</span><span>{{ pinnedCount }} 个已置顶</span></template></span><span class="collection-tip"><Pin :size="11" />置顶歌单优先显示</span></div>

    <div ref="container" class="collection-content custom-scrollbar" @scroll="menuPlaylist && closeMenu()">
      <div v-if="!visiblePlaylists.length" class="empty-state">
        <div class="empty-art"><ListMusic :size="37" :stroke-width="1.25" /></div>
        <h2>{{ !playlists.length ? '从一张歌单开始' : searchQuery.trim() ? '没有找到匹配的歌单' : filter === 'pinned' ? '把常听的歌单放在前面' : '所有歌单都有音乐了' }}</h2>
        <p>{{ !playlists.length ? '为通勤、专注或一个好心情，收集专属的音乐。' : searchQuery.trim() ? '试试其他名称，或用拼音和首字母搜索。' : filter === 'pinned' ? '在歌单的更多菜单中选择「置顶歌单」，下次更快找到。' : '新建的空歌单会出现在这里，方便你继续整理。' }}</p>
        <button v-if="!playlists.length" type="button" class="button button-primary" @click="requestCreate"><Plus :size="16" />创建第一张歌单</button>
        <button v-else type="button" class="button button-secondary" @click="resetFilters">{{ searchQuery.trim() ? '清除筛选' : '查看全部歌单' }}</button>
      </div>

      <div v-else :class="viewMode === 'grid' ? 'playlist-grid' : 'playlist-list'">
        <div v-if="viewMode === 'list'" class="list-heading"><span></span><span>歌单名称</span><span>歌曲数</span><span>创建日期</span><span></span></div>
        <article v-for="playlist in pagedPlaylists" :key="playlist.id" class="playlist-item" :class="{ selected: selectedIds.has(playlist.id), 'list-item': viewMode === 'list' }" @contextmenu.prevent="!isManaging && openMenu($event, playlist)">
          <div class="artwork-area">
            <button type="button" class="cover-button" :aria-label="isManaging ? `${selectedIds.has(playlist.id) ? '取消选择' : '选择'}${playlist.name}` : `打开歌单：${playlist.name}`" @click="openPlaylist(playlist)"><PlaylistCover :playlist="playlist" :compact="viewMode === 'list'" /><span v-if="selectedIds.has(playlist.id)" class="selected-overlay"><Check :size="28" /></span></button>
            <span v-if="library.isPinned(playlist.id) && !isManaging && viewMode === 'grid'" class="pinned-badge" title="已置顶"><Pin :size="11" fill="currentColor" />置顶</span>
            <div v-if="isManaging" class="card-checkbox"><AppCheckbox :checked="selectedIds.has(playlist.id)" :aria-label="`选择${playlist.name}`" @change="toggleSelection(playlist.id)" /></div>
            <button v-else-if="playlist.songPaths.length && viewMode === 'grid'" type="button" class="card-play" :disabled="!!playingId" :aria-label="`播放${playlist.name}`" @click="playPlaylist(playlist)"><LoaderCircle v-if="playingId === playlist.id" :size="19" class="loading-spinner" /><Play v-else :size="19" fill="currentColor" /></button>
          </div>
          <div class="playlist-info"><button type="button" class="playlist-name" :title="playlist.name" @click="openPlaylist(playlist)"><Pin v-if="library.isPinned(playlist.id) && viewMode === 'list'" :size="12" /><span>{{ playlist.name }}</span></button><div class="playlist-meta">{{ playlist.songPaths.length }} 首歌曲<span v-if="!playlist.songPaths.length" class="empty-label">等待添加</span></div></div>
          <span v-if="viewMode === 'list'" class="list-song-count">{{ playlist.songPaths.length }} 首</span>
          <span v-if="viewMode === 'list'" class="list-date">{{ playlist.createdAt || '—' }}</span>
          <div v-if="!isManaging" class="item-actions"><button v-if="viewMode === 'list'" type="button" class="list-play" :disabled="!playlist.songPaths.length || !!playingId" :aria-label="`播放${playlist.name}`" @click="playPlaylist(playlist)"><LoaderCircle v-if="playingId === playlist.id" :size="16" class="loading-spinner" /><Play v-else :size="16" /></button><button type="button" class="more-button" :aria-label="`${playlist.name}的更多操作`" aria-haspopup="menu" :aria-expanded="menuPlaylist?.id === playlist.id" @click="openMenu($event, playlist)"><MoreHorizontal :size="19" /></button></div>
        </article>
        <button v-if="viewMode === 'grid' && filter === 'all' && !searchQuery.trim() && page === pageCount && !isManaging" type="button" class="create-tile" @click="requestCreate"><span class="create-tile-art"><span><Plus :size="27" :stroke-width="1.25" /></span><strong>新建歌单</strong></span><span class="create-tile-caption">给下一段旋律留个位置</span></button>
      </div>
    </div>

    <footer v-if="visiblePlaylists.length" class="collection-footer"><span>{{ (page - 1) * PAGE_SIZE + 1 }}–{{ Math.min(page * PAGE_SIZE, visiblePlaylists.length) }} / {{ visiblePlaylists.length }} 个歌单</span><div v-if="pageCount > 1" class="pagination"><button type="button" aria-label="上一页歌单" :disabled="page <= 1" @click="page--"><ChevronLeft :size="16" /></button><span>{{ page }} / {{ pageCount }}</span><button type="button" aria-label="下一页歌单" :disabled="page >= pageCount" @click="page++"><ChevronRight :size="16" /></button></div><span v-else class="footer-note">每一份喜欢，都有归处</span></footer>

    <PlaylistActionsMenu v-if="menuPlaylist" :key="menuPlaylist.id" :x="menuPosition.x" :y="menuPosition.y" :name="menuPlaylist.name" :pinned="library.isPinned(menuPlaylist.id)" :empty="!menuPlaylist.songPaths.length" @close="closeMenu" @action="handleMenuAction" />
    <ModernInputModal v-model:visible="showNameModal" :title="renameId ? '重命名歌单' : '新建歌单'" :initial-value="initialName" placeholder="为这张歌单取个名字" :confirm-text="renameId ? '保存' : '创建'" @confirm="createFromModal" />
    <ModernModal v-model:visible="showDeleteModal" title="删除歌单" :content="deleteMessage" type="danger" confirm-text="删除歌单" @confirm="confirmDelete" />
  </section>
</template>

<style scoped>
.playlist-page { --ink: #29292f; --muted: #85858f; --line: #72727f1c; --surface: #ffffff60; --hover: #72727f0b; --accent: #ec4141; display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 22px 32px 0; color: var(--ink); }
:global(.dark .playlist-page) { --ink: #eeeef2; --muted: #9999a5; --line: #ffffff12; --surface: #ffffff05; --hover: #ffffff07; }
.page-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 32px; flex-shrink: 0; }
.eyebrow { display: flex; align-items: center; gap: 7px; color: var(--muted); font-size: 9px; font-weight: 600; letter-spacing: .19em; margin-bottom: 9px; }
.eyebrow > span { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); }
h1 { display: flex; align-items: center; gap: 13px; font-size: 28px; font-weight: 700; letter-spacing: -.8px; line-height: 1.3; }
.title-count { padding: 3px 9px; border: 1px solid var(--line); border-radius: 8px; color: var(--muted); font-size: 12px; font-weight: 500; letter-spacing: 0; }
.page-description { margin-top: 10px; font-size: 12px; color: var(--muted); }
.header-actions, .toolbar-controls { display: flex; align-items: center; gap: 10px; }
.button { display: inline-flex; justify-content: center; align-items: center; gap: 7px; padding: 10px 15px; border-radius: 9px; font-size: 12px; font-weight: 500; white-space: nowrap; cursor: pointer; transition: background .15s, transform .15s; }
.button:active { transform: scale(.98); }
.button-primary { background: var(--accent); color: white; box-shadow: 0 4px 12px #ec41411a; }
.button-primary:hover { background: #dd3636; }
.button-secondary { background: var(--surface); border: 1px solid var(--line); }
.button-secondary:hover, .button-secondary.is-active { background: var(--hover); }
.library-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; border-bottom: 1px solid var(--line); padding-bottom: 14px; }
.filter-tabs { display: flex; align-items: center; gap: 20px; }
.filter-tabs > button { position: relative; display: flex; gap: 7px; align-items: center; padding: 9px 0; font-size: 12px; color: var(--muted); white-space: nowrap; cursor: pointer; }
.filter-tabs > button.active { color: var(--ink); font-weight: 600; }
.filter-tabs > button.active::after { position: absolute; content: ''; bottom: -15px; left: 0; width: 23px; height: 3px; border-radius: 3px; background: var(--accent); }
.filter-tabs span { font-size: 10px; opacity: .8; font-variant-numeric: tabular-nums; }
.search-field { display: flex; align-items: center; gap: 7px; height: 34px; width: 205px; border: 1px solid var(--line); border-radius: 8px; padding: 0 10px; color: var(--muted); background: var(--surface); }
.search-field:focus-within { border-color: #ec414180; box-shadow: 0 0 0 3px #ec41410a; }
.search-field input { min-width: 0; width: 100%; color: var(--ink); font-size: 11px; outline: none; background: transparent; }
.search-field input::-webkit-search-cancel-button { display: none; }
.search-field button { cursor: pointer; }
.sort-field { display: flex; align-items: center; gap: 6px; color: var(--muted); }
.sort-field select { background: transparent; color: var(--ink); font-size: 11px; padding: 7px 2px; outline: none; cursor: pointer; max-width: 105px; }
.sort-field option { background: white; color: #29292f; }
:global(.dark .playlist-page .sort-field option) { background: #28282d; color: #eeeef2; }
.view-switch { display: flex; padding: 3px; border: 1px solid var(--line); border-radius: 8px; gap: 2px; }
.view-switch button { display: flex; padding: 5px; border-radius: 5px; color: var(--muted); cursor: pointer; }
.view-switch .active { background: #72727f13; color: var(--ink); }
.collection-summary { display: flex; align-items: center; justify-content: space-between; min-height: 52px; font-size: 11px; color: var(--muted); }
.summary-divider { margin: 0 9px; opacity: .4; }
.collection-tip { display: flex; gap: 5px; align-items: center; font-size: 10px; }
.collection-content { min-height: 0; flex: 1; overflow: auto; padding: 2px 4px 24px; margin: 0 -4px; }
.playlist-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); column-gap: 22px; row-gap: 28px; }
.playlist-item { position: relative; min-width: 0; border-radius: 12px; }
.artwork-area { position: relative; }
.cover-button { position: relative; display: block; overflow: hidden; width: 100%; aspect-ratio: 1; border-radius: 12px; cursor: pointer; box-shadow: 0 3px 10px #00000005; transition: box-shadow .2s, transform .2s; }
.playlist-item:hover .cover-button { box-shadow: 0 7px 18px #00000012; transform: translateY(-2px); }
.pinned-badge { position: absolute; left: 9px; top: 9px; display: flex; align-items: center; gap: 4px; padding: 4px 6px; border-radius: 5px; font-size: 9px; color: #fff; background: #26252c66; backdrop-filter: blur(12px); pointer-events: none; }
.card-play { position: absolute; right: 11px; bottom: 11px; display: flex; justify-content: center; align-items: center; width: 36px; height: 36px; border-radius: 50%; color: #fff; background: var(--accent); box-shadow: 0 3px 14px #0002; opacity: 0; transform: translateY(5px); transition: opacity .18s, transform .18s; cursor: pointer; }
.card-play svg { margin-left: 2px; }
.playlist-item:hover .card-play, .playlist-item:focus-within .card-play { opacity: 1; transform: translateY(0); }
.playlist-info { min-width: 0; padding-top: 12px; padding-right: 27px; }
.playlist-name { display: flex; align-items: center; gap: 6px; width: 100%; font-size: 12px; font-weight: 600; line-height: 1.7; text-align: left; cursor: pointer; }
.playlist-name > span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.playlist-name > svg { color: var(--accent); flex-shrink: 0; }
.playlist-name:hover { color: var(--accent); }
.playlist-meta { display: flex; gap: 8px; margin-top: 3px; font-size: 10px; color: var(--muted); }
.empty-label { opacity: .7; }
.item-actions { position: absolute; right: -3px; bottom: 21px; display: flex; align-items: center; gap: 4px; }
.more-button, .list-play { display: flex; justify-content: center; align-items: center; width: 27px; height: 27px; border-radius: 6px; color: var(--muted); cursor: pointer; }
.more-button:hover, .list-play:hover { color: var(--ink); background: var(--hover); }
.selected .cover-button { box-shadow: 0 0 0 2px var(--accent); }
.selected-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: #ec414124; color: white; }
.card-checkbox { position: absolute; top: 10px; left: 10px; border-radius: 6px; background: white; box-shadow: 0 2px 6px #0002; }
.create-tile { text-align: center; align-self: start; color: var(--muted); cursor: pointer; }
.create-tile-art { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; width: 100%; aspect-ratio: 1; border: 1px dashed #87879148; border-radius: 12px; transition: color .2s, background .2s; }
.create-tile-art > span { display: flex; padding: 10px; border-radius: 50%; background: var(--hover); }
.create-tile-art strong { font-size: 12px; font-weight: 500; }
.create-tile:hover .create-tile-art { color: var(--accent); border-color: #ec414177; background: #ec414104; }
.create-tile-caption { display: block; margin-top: 15px; font-size: 10px; }
.selection-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; min-height: 52px; padding: 8px 0; font-size: 11px; }
.selection-summary, .selection-actions { display: flex; align-items: center; gap: 12px; }
.selection-summary > span { color: var(--muted); }
.selection-summary > button { cursor: pointer; }
.selection-actions button { display: flex; align-items: center; gap: 5px; padding: 6px; border-radius: 5px; cursor: pointer; }
.selection-actions button:hover { background: var(--hover); }
.selection-actions .danger { color: var(--accent); }
button:disabled { opacity: .4; cursor: default; }
.list-heading, .list-item { display: grid; grid-template-columns: 50px minmax(0, 1fr) 76px 112px 65px; align-items: center; gap: 16px; }
.list-heading { font-size: 10px; color: var(--muted); padding: 0 12px 12px; }
.list-item { padding: 11px 12px; border-bottom: 1px solid var(--line); border-radius: 7px; }
.list-item:hover { background: var(--hover); }
.list-item.selected { background: #ec414108; }
.list-item .cover-button { border-radius: 7px; }
.list-item .playlist-info { padding: 0; }
.list-item .item-actions { position: static; justify-content: flex-end; }
.list-item .card-checkbox { top: 3px; left: 3px; }
.list-song-count, .list-date { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.list-item .playlist-meta { display: none; }
.collection-footer { display: flex; justify-content: space-between; align-items: center; min-height: 46px; gap: 12px; flex-shrink: 0; border-top: 1px solid var(--line); color: var(--muted); font-size: 10px; }
.pagination { display: flex; align-items: center; gap: 14px; font-variant-numeric: tabular-nums; }
.pagination button { display: flex; padding: 6px; border: 1px solid var(--line); border-radius: 5px; cursor: pointer; }
.footer-note { opacity: .6; font-size: 10px; }
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 280px; height: 100%; text-align: center; padding: 30px 16px; }
.empty-art { display: flex; align-items: center; justify-content: center; width: 86px; height: 86px; border-radius: 24px; border: 1px solid #ec414115; background: #ec414108; color: #ec4141aa; transform: rotate(-7deg); margin-bottom: 26px; }
.empty-state h2 { font-size: 17px; font-weight: 600; }
.empty-state p { color: var(--muted); font-size: 12px; line-height: 1.8; margin: 12px 0 25px; }
.playlist-page :deep(button:focus-visible), .playlist-page select:focus-visible { box-shadow: 0 0 0 3px #ec414155; }
.loading-spinner { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (hover: none) { .card-play { opacity: 1; transform: none; } }
@media (min-width: 1600px) { .playlist-grid { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 32px; } }
@media (max-width: 1050px) { .playlist-page { padding: 16px 24px 0; } .library-toolbar { gap: 20px; } .toolbar-controls { flex: 1; justify-content: flex-end; } .search-field { width: 180px; } .playlist-grid { grid-template-columns: repeat(auto-fill, minmax(145px, 1fr)); gap: 24px 18px; } }
@media (max-width: 820px) { .page-header { align-items: flex-start; margin-bottom: 24px; } .header-actions { flex-wrap: wrap; justify-content: flex-end; gap: 6px; } .button { padding: 9px 11px; } .toolbar-controls { width: 100%; flex-basis: 100%; justify-content: flex-start; } .search-field { flex: 1; } .filter-tabs > button.active::after { bottom: -4px; } .list-heading, .list-item { grid-template-columns: 44px minmax(0, 1fr) 55px 60px; gap: 10px; } .list-date, .list-heading > span:nth-child(4) { display: none; } .collection-tip, .footer-note { display: none; } }
@media (max-width: 600px) { .playlist-page { padding: 12px 16px 0; } .page-header { flex-direction: column; gap: 16px; } h1 { font-size: 24px; } .playlist-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px 12px; } .selection-actions { gap: 4px; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } }
</style>
