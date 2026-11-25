<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useRouter } from 'vue-router';

import { useHomeNavigation } from '../../composables/useHomeNavigation';
import { useVisibleCoverUrls } from '../../composables/useVisibleCoverUrls';
import { useLibraryBrowse } from '../../features/library/useLibraryBrowse';
import { useNavigationStore } from '../../shared/stores/navigation';
import type { RecentAlbumCatalogItem, RecentPlaylistCatalogItem } from '../../types';

/**
 * 「最近播放」的歌单 / 专辑聚合视图。
 * 后端目录（get_recent_album_catalog / get_recent_playlist_catalog）已按
 * 「集合内歌曲最后播放时间」倒序聚合，这里只负责展示与跳转。
 */
const router = useRouter();
const { openHomeAlbum, openHomePlaylist } = useHomeNavigation(router);
const navigationStore = useNavigationStore();
const { recentTab, searchQuery } = storeToRefs(navigationStore);
const { recentAlbumList, recentPlaylistList } = useLibraryBrowse();

// 专辑卡片不再显示「N 首」，只保留歌手名 + 时间；歌单卡片保留数量。
type RecentGridItem =
  | { kind: 'album'; key: string; name: string; artist: string; playedAt: number; firstSongPath: string }
  | { kind: 'playlist'; key: string; id: string; name: string; playedAt: number; firstSongPath: string; count: number };

const matchesSearch = (name: string, artist: string) => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return true;
  return name.toLowerCase().includes(query) || artist.toLowerCase().includes(query);
};

const gridItems = computed<RecentGridItem[]>(() => {
  if (recentTab.value === 'albums') {
    return recentAlbumList.value
      .filter((item: RecentAlbumCatalogItem) => matchesSearch(item.name, item.artist))
      .map((item: RecentAlbumCatalogItem) => ({
        kind: 'album' as const,
        key: item.key,
        name: item.name,
        artist: item.artist,
        playedAt: item.playedAt,
        firstSongPath: item.firstSongPath,
      }));
  }

  return recentPlaylistList.value
    .filter((item: RecentPlaylistCatalogItem) => matchesSearch(item.name, ''))
    .map((item: RecentPlaylistCatalogItem) => ({
      kind: 'playlist' as const,
      key: `playlist::${item.id}`,
      id: item.id,
      name: item.name,
      playedAt: item.playedAt,
      firstSongPath: item.firstSongPath,
      count: item.count,
    }));
});

const coverPaths = computed(() => gridItems.value.map(item => item.firstSongPath));
const { getDisplayedCoverUrl } = useVisibleCoverUrls(coverPaths, 'card');

const formatPlayedAt = (playedAt: number) => {
  if (!Number.isFinite(playedAt) || playedAt <= 0) return '';
  const diffMs = Date.now() - playedAt;
  if (diffMs < 60_000) return '刚刚';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}分钟前`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}小时前`;
  if (diffMs < 30 * 86_400_000) return `${Math.floor(diffMs / 86_400_000)}天前`;
  const date = new Date(playedAt);
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
};

const handleItemClick = (item: RecentGridItem) => {
  if (item.kind === 'album') {
    void openHomeAlbum(item.key);
    return;
  }
  void openHomePlaylist(item.id);
};
</script>

<template>
  <section class="flex-1 flex overflow-hidden">
    <div v-if="gridItems.length === 0" class="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
      {{ recentTab === 'albums' ? '最近没有播放过专辑中的歌曲' : '最近没有播放过歌单里的歌曲' }}
    </div>

    <div
      v-else
      class="flex-1 overflow-y-auto custom-scrollbar px-4 pb-4 pt-2 md:px-6 md:pb-6 md:pt-3 lg:px-8 lg:pb-8"
    >
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-6 gap-y-10">
        <div
          v-for="item in gridItems"
          :key="item.key"
          class="group cursor-pointer rounded-xl p-2 md:p-3 transition-all duration-300 flex flex-col relative select-none hover:bg-white/40 dark:hover:bg-white/10"
          :title="`${item.name} · 最后播放于 ${formatPlayedAt(item.playedAt)}`"
          @click="handleItemClick(item)"
        >
          <div class="relative w-full aspect-square mb-3 mt-1">
            <div class="absolute inset-0 z-10 bg-white dark:bg-gray-800 rounded-md shadow-md border border-gray-100 dark:border-white/10 p-1 flex items-center justify-center overflow-hidden group-hover:shadow-xl transition-shadow duration-300">
              <img
                v-if="getDisplayedCoverUrl(item.firstSongPath)"
                :src="getDisplayedCoverUrl(item.firstSongPath)"
                :alt="item.name"
                loading="lazy"
                decoding="async"
                draggable="false"
                class="w-full h-full rounded-sm object-cover select-none"
              />

              <div
                v-else
                class="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-white/5 dark:to-white/10 rounded-sm flex items-center justify-center text-4xl font-bold text-gray-300 dark:text-gray-600 shadow-inner"
              >
                {{ item.name ? item.name.substring(0, 1).toUpperCase() : '#' }}
              </div>
            </div>
          </div>

          <div class="flex flex-col items-start px-1 z-20">
            <h3 class="font-bold text-sm md:text-base text-gray-800 dark:text-gray-200 truncate w-full group-hover:text-[#EC4141] transition-colors leading-tight">
              {{ item.name }}
            </h3>
            <p class="text-xs text-gray-500 dark:text-gray-400 truncate w-full mt-1.5 flex items-center gap-1.5 opacity-80">
              <span v-if="item.kind === 'album' ? item.artist.trim() !== '' : item.count > 0" class="truncate">
                {{ item.kind === 'album' ? item.artist : `${item.count}首` }}
              </span>
              <span
                v-if="(item.kind === 'album' ? item.artist.trim() !== '' : item.count > 0) && formatPlayedAt(item.playedAt)"
                class="w-0.5 h-0.5 rounded-full bg-gray-400 shrink-0"
              ></span>
              <span class="truncate">{{ formatPlayedAt(item.playedAt) }}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
