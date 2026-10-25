<script setup lang="ts">
import { Play } from 'lucide-vue-next';
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

const tabs: Array<{ id: GenreTabId; label: string; countKey: 'songCount' | 'albumCount' | 'artistCount' }> = [
  { id: 'songs', label: '歌曲', countKey: 'songCount' },
  { id: 'albums', label: '专辑', countKey: 'albumCount' },
  { id: 'artists', label: '歌手', countKey: 'artistCount' },
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
        <span class="genre-tab-count">{{ genre[item.countKey] }}</span>
      </button>
    </div>
    <button
      type="button"
      class="genre-playall"
      :title="`播放「${genre.name}」全部歌曲`"
      :aria-label="`播放「${genre.name}」全部歌曲`"
      @click="$emit('playAll')"
    >
      <Play :size="14" aria-hidden="true" />
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

.genre-tab-count {
  margin-left: 3px;
  font-size: 11px;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}

.genre-playall {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: #EC4141;
  color: #fff;
  cursor: pointer;
  box-shadow: 0 3px 9px rgb(236 65 65 / 32%);
  transition: transform 150ms, background-color 150ms;
}

.genre-playall:hover {
  transform: scale(1.08);
  background: #d93a3a;
}
</style>
