<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import type { Song } from '../../types';
import AlbumDetailHeader from '../headers/AlbumDetailHeader.vue';
import ArtistDetailHeader from '../headers/ArtistDetailHeader.vue';
import MasterPanel from '../song-list/MasterPanel.vue';
import SongTable from '../song-list/SongTable.vue';
import StatisticsPage from '../statistics/StatisticsPage.vue';
import ArtistAlbumGrid from './ArtistAlbumGrid.vue';
import HomeEmptyState from './HomeEmptyState.vue';

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
  localFilterCondition: string;
  songTableMemoryScopeKey: string;
  localSongList: Song[];
  localSongPaths: string[];
  selectedCount: number;
  selectedAlbumSong: Song | null;
  artistAlbumList: ArtistAlbumItem[];
  coverCache: Map<string, string>;
  loadingSet: Set<string>;
  selectedPaths: Set<string>;
  setSongTableRef?: (instance: any | null) => void;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (event: 'update:isBatchMode', value: boolean): void;
  (event: 'update:artistActiveTab', value: 'songs' | 'albums' | 'details'): void;
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

const isBatchModeModel = computed({
  get: () => props.isBatchMode,
  set: (value: boolean) => emit('update:isBatchMode', value),
});

const artistActiveTabModel = computed({
  get: () => props.artistActiveTab,
  set: (value: 'songs' | 'albums' | 'details') => emit('update:artistActiveTab', value),
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

      <Transition name="tab-slide" mode="out-in">
        <StatisticsPage v-if="localViewMode === 'statistics'" />

        <ArtistAlbumGrid
          v-else-if="localViewMode === 'artist' && artistActiveTab === 'albums'"
          :albums="artistAlbumList"
          :coverCache="coverCache"
          :loadingSet="loadingSet"
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
