<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { storeToRefs } from 'pinia';

import type { GenreGroups, Song } from '../../types';
import { tauriInvoke } from '../../services/tauri/invoke';
import { useNavigationStore } from '../../shared/stores/navigation';
import AlbumDetailHeader from '../headers/AlbumDetailHeader.vue';
import ArtistDetailHeader from '../headers/ArtistDetailHeader.vue';
import MasterPanel from '../song-list/MasterPanel.vue';
import SongTable from '../song-list/SongTable.vue';
import StatisticsPage from '../statistics/StatisticsPage.vue';
import ArtistAlbumGrid from './ArtistAlbumGrid.vue';
import GenreArtistList from './GenreArtistList.vue';
import GenreOverview from './GenreOverview.vue';
import GenreSidebar from './GenreSidebar.vue';
import GenreTabs from './GenreTabs.vue';
import HomeEmptyState from './HomeEmptyState.vue';
import { useLibraryStore } from '../../features/library/store';
import type { GenreTabId } from '../../composables/useHomeViewState';

interface ArtistAlbumItem {
  key: string;
  name: string;
  count: number;
  artist: string;
  firstSongPath: string;
}

interface Props {
  localViewMode: string;
  isBatchMode: boolean;
  isManagementMode: boolean;
  artistActiveTab: 'songs' | 'albums' | 'details';
  genreActiveTab: GenreTabId;
  localFilterCondition: string;
  songTableMemoryScopeKey: string;
  localSongList: Song[];
  localSongPaths: string[];
  selectedCount: number;
  selectedAlbumSong: Song | null;
  artistAlbumList: ArtistAlbumItem[];
  selectedPaths: Set<string>;
  setSongTableRef?: (instance: any | null) => void;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (event: 'update:isBatchMode', value: boolean): void;
  (event: 'update:artistActiveTab', value: 'songs' | 'albums' | 'details'): void;
  (event: 'update:genreActiveTab', value: GenreTabId): void;
  (event: 'update:selectedPaths', value: Set<string>): void;
  (event: 'playAll'): void;
  (event: 'batchPlay'): void;
  (event: 'showAddToPlaylist'): void;
  (event: 'batchDelete'): void;
  (event: 'batchMove'): void;
  (event: 'playSong', song: Song): void;
  (event: 'contextMenuSong', nativeEvent: MouseEvent, song: Song): void;
  (event: 'tableDragStart', ...args: any[]): void;
  (event: 'artistAlbumClick', albumKey: string): void;
}>();

const { genreCatalog } = storeToRefs(useLibraryStore());
const { searchQuery, searchRevision } = storeToRefs(useNavigationStore());
const genreGroups = shallowRef<GenreGroups>({ albums: [], artists: [] });

const activeGenreItem = computed(() => {
  if (props.localViewMode !== 'genre' || !props.localFilterCondition) {
    return null;
  }
  const key = props.localFilterCondition.trim().toLowerCase();
  return genreCatalog.value.find(item => item.name.toLowerCase() === key) ?? null;
});

const genreAlbumList = computed(() => [...genreGroups.value.albums]
  .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')));
const genreArtistList = computed(() => [...genreGroups.value.artists]
  .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-CN')));
const genreGroupFilter = computed(() => props.localViewMode === 'genre' && props.genreActiveTab !== 'songs'
  ? props.localFilterCondition : '');

watch(
  [genreGroupFilter, searchQuery, searchRevision, genreCatalog],
  async ([genre, query], _previous, onCleanup) => {
    let cancelled = false;
    onCleanup(() => { cancelled = true; });
    genreGroups.value = { albums: [], artists: [] };
    if (!genre) return;
    try {
      const groups = await tauriInvoke('get_library_genre_groups', { genre, query });
      if (!cancelled) genreGroups.value = groups;
    } catch (error) {
      if (!cancelled) console.warn('Failed to load genre groups:', error);
    }
  },
  { immediate: true },
);

const isBatchModeModel = computed({
  get: () => props.isBatchMode,
  set: (value: boolean) => emit('update:isBatchMode', value),
});

const artistActiveTabModel = computed({
  get: () => props.artistActiveTab,
  set: (value: 'songs' | 'albums' | 'details') => emit('update:artistActiveTab', value),
});

const genreActiveTabModel = computed({
  get: () => props.genreActiveTab,
  set: (value: GenreTabId) => emit('update:genreActiveTab', value),
});

const localSongTableRef = ref<any>(null);

watch(localSongTableRef, value => {
  props.setSongTableRef?.(value);
}, { immediate: true });

onBeforeUnmount(() => {
  props.setSongTableRef?.(null);
});

const handleSongContextMenu = (...args: [MouseEvent, Song]) => {
  emit('contextMenuSong', args[0], args[1]);
};

const handleTableDragStart = (...args: any[]) => {
  emit('tableDragStart', ...args);
};
</script>

<template>
  <div class="flex-1 flex overflow-hidden relative min-w-0">
    <MasterPanel
      v-if="localViewMode === 'folder'"
      :isManagementMode="isManagementMode"
    />

    <GenreSidebar v-if="localViewMode === 'genre'" />

    <section class="flex-1 min-w-0 min-h-0 flex flex-col overflow-x-hidden relative">
      <ArtistDetailHeader
        v-if="localViewMode === 'artist'"
        v-model:isBatchMode="isBatchModeModel"
        v-model:activeTab="artistActiveTabModel"
        :artistName="localFilterCondition || 'Unknown Artist'"
        :songs="localSongList"
        :songPaths="localSongPaths"
        :selectedCount="selectedCount"
        @playAll="$emit('playAll')"
        @batchPlay="$emit('batchPlay')"
        @addToPlaylist="$emit('showAddToPlaylist')"
        @batchDelete="$emit('batchDelete')"
        @batchMove="$emit('batchMove')"
      />

      <AlbumDetailHeader
        v-else-if="localViewMode === 'album'"
        v-model:isBatchMode="isBatchModeModel"
        :albumName="selectedAlbumSong?.album || 'Unknown Album'"
        :albumArtist="selectedAlbumSong?.album_artist || selectedAlbumSong?.artist || 'Unknown Artist'"
        :songs="localSongList"
        :songPaths="localSongPaths"
        :selectedCount="selectedCount"
        @playAll="$emit('playAll')"
        @batchPlay="$emit('batchPlay')"
        @addToPlaylist="$emit('showAddToPlaylist')"
        @batchDelete="$emit('batchDelete')"
        @batchMove="$emit('batchMove')"
      />

      <GenreTabs
        v-if="localViewMode === 'genre' && localFilterCondition"
        :genre="activeGenreItem"
        :tab="genreActiveTab"
        @update:tab="genreActiveTabModel = $event"
        @playAll="$emit('playAll')"
      />

      <Transition name="tab-slide" mode="out-in">
        <StatisticsPage v-if="localViewMode === 'statistics'" />

        <GenreOverview
          v-else-if="localViewMode === 'genre' && !localFilterCondition"
        />

        <ArtistAlbumGrid
          v-else-if="localViewMode === 'artist' && artistActiveTab === 'albums'"
          :albums="artistAlbumList"
          @openAlbum="$emit('artistAlbumClick', $event)"
        />

        <GenreArtistList
          v-else-if="localViewMode === 'genre' && genreActiveTab === 'artists'"
          :artists="genreArtistList"
        />

        <ArtistAlbumGrid
          v-else-if="localViewMode === 'genre' && genreActiveTab === 'albums'"
          :albums="genreAlbumList"
          @openAlbum="$emit('artistAlbumClick', $event)"
        />

        <HomeEmptyState
          v-else-if="localViewMode === 'artist' && artistActiveTab === 'details'"
          message="Artist details coming soon"
          icon-path="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />

        <SongTable
          v-else
          ref="localSongTableRef"
          :songs="localSongList"
          :songPaths="localSongPaths"
          :isBatchMode="isBatchMode"
          :selectedPaths="selectedPaths"
          :memoryScopeKey="songTableMemoryScopeKey"
          class="min-h-0"
          @play="$emit('playSong', $event)"
          @contextmenu="handleSongContextMenu"
          @update:selectedPaths="$emit('update:selectedPaths', $event)"
          @drag-start="handleTableDragStart"
        />
      </Transition>
    </section>
  </div>
</template>

<style scoped>
.tab-slide-enter-active,
.tab-slide-leave-active {
  transition: all 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.tab-slide-enter-from {
  opacity: 0;
  transform: translateX(15px);
}

.tab-slide-leave-to {
  opacity: 0;
  transform: translateX(-15px);
}
</style>
