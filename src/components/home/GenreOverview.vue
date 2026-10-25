<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useHomeNavigation } from '../../composables/useHomeNavigation';
import { useLibraryStore } from '../../features/library/store';
import { useNavigationStore } from '../../shared/stores/navigation';
import { storeToRefs } from 'pinia';

const router = useRouter();
const { openHomeGenre } = useHomeNavigation(router);
const libraryStore = useLibraryStore();
const { genreCatalog } = storeToRefs(libraryStore);
const { searchQuery } = storeToRefs(useNavigationStore());

const keyword = computed(() => searchQuery.value.trim().toLowerCase());
const visibleGenres = computed(() => {
  if (!keyword.value) {
    return genreCatalog.value;
  }
  return genreCatalog.value.filter(item => item.name.toLowerCase().includes(keyword.value));
});

const selectGenre = (name: string) => {
  searchQuery.value = '';
  void openHomeGenre(name);
};
</script>

<template>
  <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-1 pb-6" aria-label="流派总览">
    <p class="px-2 pb-3 text-xs text-gray-500 dark:text-gray-400">
      标签总览 · {{ genreCatalog.length }} 个流派
    </p>
    <div v-if="visibleGenres.length" class="genre-tag-grid">
      <button
        v-for="genre in visibleGenres"
        :key="genre.name"
        type="button"
        class="genre-tag"
        :aria-label="`查看「${genre.name}」`"
        :title="genre.name"
        @click="selectGenre(genre.name)"
      >
        <span class="genre-tag-meta">
          <b>{{ genre.name }}</b>
          <span>{{ genre.songCount }}首 · {{ genre.artistCount }}位歌手</span>
        </span>
      </button>
    </div>
    <div v-else class="py-16 flex flex-col items-center gap-3 text-gray-500 dark:text-gray-400 select-none">
      <p class="text-sm">{{ keyword ? '没有匹配的流派' : '曲库中的歌曲没有流派标签' }}</p>
      <p v-if="!keyword" class="text-xs opacity-70">用标签工具（如 Mp3tag）为歌曲写入 GENRE 字段后重新扫描即可归类</p>
    </div>
  </div>
</template>

<style scoped>
.genre-tag-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr));
  gap: 8px 10px;
}

.genre-tag {
  display: flex;
  align-items: center;
  padding: 9px 12px;
  border: 0;
  border-radius: 11px;
  background: none;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms;
}

.genre-tag:hover {
  background: rgb(0 0 0 / 5%);
}

.dark .genre-tag:hover {
  background: rgb(255 255 255 / 5%);
}

.genre-tag-meta {
  min-width: 0;
}

.genre-tag-meta b {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: #24272d;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 120ms;
}

.dark .genre-tag-meta b {
  color: #e8eaed;
}

.genre-tag:hover .genre-tag-meta b {
  color: #EC4141;
}

.genre-tag-meta > span {
  display: block;
  margin-top: 2px;
  font-size: 11.5px;
  color: #6b7280;
}

.dark .genre-tag-meta > span {
  color: #9aa0aa;
}
</style>
