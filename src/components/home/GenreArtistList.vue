<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useHomeNavigation } from '../../composables/useHomeNavigation';
import type { GenreArtistItem } from '../../types';

defineProps<{ artists: GenreArtistItem[] }>();

const router = useRouter();
const { openHomeArtist } = useHomeNavigation(router);

const handleArtistClick = (name: string) => {
  void openHomeArtist(name);
};
</script>

<template>
  <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-1 pb-6" aria-label="流派内歌手">
    <button
      v-for="artist in artists"
      :key="artist.name"
      type="button"
      class="genre-artist-row"
      :title="artist.name"
      @click="handleArtistClick(artist.name)"
    >
      <span class="genre-artist-name">{{ artist.name }}</span>
      <span class="genre-artist-count">流派内 {{ artist.count }}首</span>
    </button>
    <p v-if="artists.length === 0" class="px-3 py-10 text-sm text-gray-500 dark:text-gray-400 select-none">
      该流派下暂无歌手信息
    </p>
  </div>
</template>

<style scoped>
.genre-artist-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 9px 12px;
  border: 0;
  border-bottom: 1px solid rgb(0 0 0 / 5%);
  background: none;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms;
}

.dark .genre-artist-row {
  border-bottom-color: rgb(255 255 255 / 5%);
}

.genre-artist-row:hover {
  background: rgb(0 0 0 / 5%);
}

.dark .genre-artist-row:hover {
  background: rgb(255 255 255 / 5%);
}

.genre-artist-name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  color: #24272d;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 120ms;
}

.dark .genre-artist-name {
  color: #e8eaed;
}

.genre-artist-row:hover .genre-artist-name {
  color: #EC4141;
}

.genre-artist-count {
  flex-shrink: 0;
  font-size: 12px;
  color: #6b7280;
  font-variant-numeric: tabular-nums;
}

.dark .genre-artist-count {
  color: #9aa0aa;
}
</style>
