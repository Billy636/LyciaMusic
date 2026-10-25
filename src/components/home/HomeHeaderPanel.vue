<script setup lang="ts">
import { computed } from 'vue';

import type { FolderNode, Song } from '../../types';
import DetailHeader from '../headers/DetailHeader.vue';
import FoldersHeader from '../headers/FoldersHeader.vue';
import GenreHeader from '../headers/GenreHeader.vue';
import LocalMusicHeader from '../headers/LocalMusicHeader.vue';

interface PlaylistDetail {
  name: string;
  date: string;
}

interface Props {
  localViewMode: string;
  isBatchMode: boolean;
  isManagementMode: boolean;
  activeRootPath: string;
  selectedCount: number;
  folderTree: FolderNode[];
  currentFolderFilter: string;
  playlistDetail: PlaylistDetail | null;
  localSongList: Song[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (event: 'update:isBatchMode', value: boolean): void;
  (event: 'update:isManagementMode', value: boolean): void;
  (event: 'playAll'): void;
  (event: 'batchPlay'): void;
  (event: 'showAddToPlaylist'): void;
  (event: 'batchDelete'): void;
  (event: 'folderBatchDelete'): void;
  (event: 'batchMove'): void;
  (event: 'rootCreatePlaylist', path: string, name: string): void;
  (event: 'addFolder'): void;
  (event: 'refreshFolder'): void;
  (event: 'removeFolder', path: string, name?: string): void;
  (event: 'rootCreateFolder', path: string): void;
  (event: 'rootDeleteFolder', path: string): void;
  (event: 'activeRootChange', value: string): void;
  (event: 'renamePlaylist'): void;
  (event: 'refreshAll'): void;
}>();

const isBatchModeModel = computed({
  get: () => props.isBatchMode,
  set: (value: boolean) => emit('update:isBatchMode', value),
});

const isManagementModeModel = computed({
  get: () => props.isManagementMode,
  set: (value: boolean) => emit('update:isManagementMode', value),
});
</script>

<template>
  <FoldersHeader
    v-if="localViewMode === 'folder'"
    v-model:isBatchMode="isBatchModeModel"
    :activeRootPath="activeRootPath"
    :selectedCount="selectedCount"
    :folderTree="folderTree"
    :currentFolderFilter="currentFolderFilter"
    @playAll="$emit('playAll')"
    @batchPlay="$emit('batchPlay')"
    @addToPlaylist="$emit('showAddToPlaylist')"
    @rootCreatePlaylist="(path, name) => $emit('rootCreatePlaylist', path, name)"
    @batchDelete="$emit('folderBatchDelete')"
    @batchMove="$emit('batchMove')"
    @addFolder="$emit('addFolder')"
    @refreshFolder="$emit('refreshFolder')"
    @removeFolder="(path, name) => $emit('removeFolder', path, name)"
    @newFolder="(path) => $emit('rootCreateFolder', path)"
    @deleteFolderDisk="(path) => $emit('rootDeleteFolder', path)"
    @update:activeRootPath="$emit('activeRootChange', $event)"
    v-model:isManagementMode="isManagementModeModel"
  />

  <DetailHeader
    v-else-if="localViewMode === 'playlist'"
    v-model:isBatchMode="isBatchModeModel"
    :title="playlistDetail?.name || ''"
    :subtitle="playlistDetail?.date ? `创建于 ${playlistDetail.date}` : ''"
    :songs="localSongList"
    :selectedCount="selectedCount"
    :showRename="true"
    @playAll="$emit('playAll')"
    @batchPlay="$emit('batchPlay')"
    @addToPlaylist="$emit('showAddToPlaylist')"
    @batchDelete="$emit('batchDelete')"
    @rename="$emit('renamePlaylist')"
  />

  <GenreHeader v-else-if="localViewMode === 'genre'" />

  <LocalMusicHeader
    v-else-if="!['statistics', 'artist', 'album'].includes(localViewMode)"
    v-model:isBatchMode="isBatchModeModel"
    :selectedCount="selectedCount"
    @playAll="$emit('playAll')"
    @batchPlay="$emit('batchPlay')"
    @addToPlaylist="$emit('showAddToPlaylist')"
    @batchDelete="$emit('batchDelete')"
    @batchMove="$emit('batchMove')"
    @refreshAll="$emit('refreshAll')"
  />
</template>
