<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { LayoutGrid, Tag } from 'lucide-vue-next';
import { useHomeNavigation } from '../../composables/useHomeNavigation';
import { useLibraryStore } from '../../features/library/store';
import { useNavigationStore } from '../../shared/stores/navigation';
import { storeToRefs } from 'pinia';

const router = useRouter();
const { openHomeGenre } = useHomeNavigation(router);
const libraryStore = useLibraryStore();
const { genreCatalog } = storeToRefs(libraryStore);
const { filterCondition, searchQuery } = storeToRefs(useNavigationStore());

const isOverview = computed(() => !filterCondition.value);
const selectedGenreKey = computed(() => filterCondition.value.trim().toLowerCase());

// In a selected genre the global query searches songs, not navigation labels.
const keyword = computed(() => isOverview.value ? searchQuery.value.trim().toLowerCase() : '');
const visibleGenres = computed(() => {
  if (!keyword.value) {
    return genreCatalog.value;
  }
  return genreCatalog.value.filter(item => item.name.toLowerCase().includes(keyword.value));
});

const selectOverview = () => {
  if (isOverview.value) return;
  searchQuery.value = '';
  void openHomeGenre();
};

const selectGenre = (name: string) => {
  if (selectedGenreKey.value === name.toLowerCase()) return;
  searchQuery.value = '';
  void openHomeGenre(name);
};
</script>

<template>
  <aside
    class="w-52 shrink-0 min-h-0 flex flex-col gap-0.5 overflow-y-auto custom-scrollbar border-r border-black/5 dark:border-white/5 py-2 pr-2 mr-3 pl-1 select-none"
    aria-label="流派导航"
  >
    <button
      type="button"
      class="genre-nav-item"
      :class="{ active: isOverview }"
      :aria-current="isOverview ? 'page' : undefined"
      @click="selectOverview"
    >
      <LayoutGrid :size="15" aria-hidden="true" />
      <span class="genre-nav-name">总览</span>
    </button>
    <span class="genre-nav-divider" aria-hidden="true"></span>
    <button
      v-for="genre in visibleGenres"
      :key="genre.name"
      type="button"
      class="genre-nav-item"
      :class="{ active: selectedGenreKey === genre.name.toLowerCase() }"
      :aria-current="selectedGenreKey === genre.name.toLowerCase() ? 'page' : undefined"
      :title="genre.name"
      @click="selectGenre(genre.name)"
    >
      <Tag :size="15" aria-hidden="true" />
      <span class="genre-nav-name">{{ genre.name }}</span>
      <span class="genre-nav-count">{{ genre.songCount }}</span>
    </button>
    <p v-if="visibleGenres.length === 0" class="px-3 py-4 text-xs text-gray-500 dark:text-gray-400">
      {{ keyword ? '没有匹配的流派' : '暂无流派标签' }}
    </p>
  </aside>
</template>

<style scoped>
.genre-nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 6px 10px;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--app-text-secondary, #6b7280);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms, color 120ms;
}

.genre-nav-item:hover {
  background: rgb(0 0 0 / 5%);
  color: #24272d;
}

.dark .genre-nav-item:hover {
  background: rgb(255 255 255 / 5%);
  color: #e8eaed;
}

.genre-nav-item.active {
  background: rgb(0 0 0 / 9%);
  color: #24272d;
}

.dark .genre-nav-item.active {
  background: rgb(255 255 255 / 9%);
  color: #e8eaed;
}

.genre-nav-item.active::before {
  content: "";
  position: absolute;
  left: -2px;
  top: 7px;
  bottom: 7px;
  width: 3px;
  border-radius: 3px;
  background: #EC4141;
}

.genre-nav-item.active .genre-nav-name {
  color: #EC4141;
  font-weight: 600;
}

.genre-nav-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.genre-nav-count {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--app-text-secondary, #9aa0aa);
  font-variant-numeric: tabular-nums;
}

.genre-nav-divider {
  height: 1px;
  margin: 6px 6px;
  background: rgb(0 0 0 / 5%);
}

.dark .genre-nav-divider {
  background: rgb(255 255 255 / 5%);
}
</style>
