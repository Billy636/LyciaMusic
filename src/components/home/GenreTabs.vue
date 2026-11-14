<script setup lang="ts">
import type { GenreTabId } from '../../composables/useHomeViewState';
import type { GenreCatalogItem } from '../../types';

interface Props {
  genre: GenreCatalogItem | null;
  tab: GenreTabId;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (event: 'update:tab', value: GenreTabId): void;
  (event: 'playAll'): void;
}>();

const tabs: Array<{ id: GenreTabId; label: string }> = [
  { id: 'songs', label: '歌曲' },
  { id: 'albums', label: '专辑' },
  { id: 'artists', label: '歌手' },
];

const handleTabClick = (id: GenreTabId) => {
  if (id !== props.tab) {
    emit('update:tab', id);
  }
};
</script>

<template>
  <div v-if="genre" class="flex items-center justify-between gap-3 px-2 pb-2.5 min-h-10 shrink-0">
    <div class="flex items-center gap-1.5" role="tablist" aria-label="流派分组方式">
      <button
        v-for="item in tabs"
        :key="item.id"
        type="button"
        role="tab"
        class="genre-tab"
        :class="{ active: tab === item.id }"
        :aria-selected="tab === item.id"
        @click="handleTabClick(item.id)"
      >
        {{ item.label }}
      </button>
    </div>
    <button
      type="button"
      class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white w-7 h-7 shrink-0 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
      :title="`播放「${genre.name}」全部歌曲`"
      :aria-label="`播放「${genre.name}」全部歌曲`"
      @click="$emit('playAll')"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9 5.5v13l10-6.5-10-6.5Z" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.genre-tab {
  border: 0;
  border-radius: 999px;
  padding: 5px 14px;
  background: rgb(0 0 0 / 5%);
  color: #6b7280;
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
  transition: background-color 120ms, color 120ms;
}

.dark .genre-tab {
  background: rgb(255 255 255 / 5%);
  color: #9aa0aa;
}

.genre-tab:hover {
  color: #24272d;
}

.dark .genre-tab:hover {
  color: #e8eaed;
}

.genre-tab.active {
  background: #EC4141;
  color: #fff;
  font-weight: 600;
}

</style>
