<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { open, save } from '@tauri-apps/plugin-dialog';
import StatsOverviewCards from './StatsOverviewCards.vue';
import BehaviorStatsSection from './BehaviorStatsSection.vue';
import QualityPieChart from './QualityPieChart.vue';
import FormatPieChart from './FormatPieChart.vue';
import { useStatisticsStore, type TimeRangeType } from '../../features/statistics/store';
import StatisticsImportDialog from './StatisticsImportDialog.vue';
import { useToast } from '../../composables/toast';
import { statisticsApi, type StatisticsImportMode } from '../../services/tauri/statisticsApi';
import type { StatisticsImportPreview } from '../../services/tauri/contracts';

const TEXT = {
  range7Days: '\u8fd17\u5929',
  range30Days: '\u8fd130\u5929',
  thisYear: '\u4eca\u5e74',
  allTime: '\u5168\u90e8',
  totalSongs: '\u603b\u6b4c\u66f2',
  albums: '\u4e13\u8f91',
  artists: '\u6b4c\u624b',
  totalDuration: '\u603b\u65f6\u957f',
  librarySize: '\u5e93\u5927\u5c0f',
  losslessRate: '\u65e0\u635f\u5360\u6bd4',
  totalListenDuration: '\u603b\u542c\u6b4c\u65f6\u957f',
  playCount: '\u64ad\u653e\u6b21\u6570',
  peakPeriod: '\u6700\u6d3b\u8dc3\u65f6\u6bb5',
  topByCount: '\u6700\u5e38\u64ad\u653e(\u6309\u6b21\u6570)',
  topByDuration: '\u6700\u5e38\u64ad\u653e(\u6309\u65f6\u957f)',
  dailyDuration: '\u6700\u8fd1\u4e03\u5929\u6bcf\u65e5\u64ad\u653e\u65f6\u957f',
  topArtists: '\u5e38\u542c\u6b4c\u624b',
  topAlbums: '\u5e38\u542c\u4e13\u8f91',
  loadFailed: '\u52a0\u8f7d\u5931\u8d25\uff1a',
  retry: '\u91cd\u8bd5',
  noData: '\u6682\u65e0\u6570\u636e',
  noLibraryHint: '\u5148\u53bb\u8bbe\u7f6e\u4e2d\u6dfb\u52a0\u97f3\u4e50\u5e93\u6587\u4ef6\u5939\u5427',
  libraryOverview: '\u66f2\u5e93\u6982\u89c8',
  manageCards: '\u7ba1\u7406\u5361\u7247',
  updatedAt: '\u66f4\u65b0\u4e8e',
  managerHint: '\u52fe\u9009\u4ee5\u663e\u793a\u5361\u7247\uff1a',
  qualityDetail: '\u97f3\u8d28\u5206\u5e03\u8be6\u60c5',
  formatDetail: '\u97f3\u4e50\u683c\u5f0f\u5206\u5e03',
  behaviorTitle: '\u542c\u6b4c\u884c\u4e3a',
  exportStats: '\u5bfc\u51fa\u7edf\u8ba1',
  importStats: '\u5bfc\u5165\u7edf\u8ba1',
};

const CARD_TITLES = {
  totalSongs: TEXT.totalSongs,
  albums: TEXT.albums,
  artists: TEXT.artists,
  totalDuration: TEXT.totalDuration,
  librarySize: TEXT.librarySize,
  losslessRate: TEXT.losslessRate,
  totalListenDuration: TEXT.totalListenDuration,
  playCount: TEXT.playCount,
  peakPeriod: TEXT.peakPeriod,
  topByCount: TEXT.topByCount,
  topByDuration: TEXT.topByDuration,
  dailyDuration: TEXT.dailyDuration,
  topArtists: TEXT.topArtists,
  topAlbums: TEXT.topAlbums,
} as const;

const behaviorTimeOptions: { label: string; value: TimeRangeType }[] = [
  { label: TEXT.range7Days, value: 'Days7' },
  { label: TEXT.range30Days, value: 'Days30' },
  { label: TEXT.thisYear, value: 'ThisYear' },
  { label: TEXT.allTime, value: 'All' },
];

const managerCards = [
  CARD_TITLES.totalSongs,
  CARD_TITLES.albums,
  CARD_TITLES.artists,
  CARD_TITLES.totalDuration,
  CARD_TITLES.librarySize,
  CARD_TITLES.losslessRate,
  CARD_TITLES.totalListenDuration,
  CARD_TITLES.playCount,
  CARD_TITLES.peakPeriod,
  CARD_TITLES.topByCount,
  CARD_TITLES.topByDuration,
  CARD_TITLES.dailyDuration,
  CARD_TITLES.topArtists,
  CARD_TITLES.topAlbums,
];

const statisticsStore = useStatisticsStore();
const {
  currentBehaviorTimeRange,
  stats,
  behaviorStats,
  loading,
  error,
  lastUpdated,
  isRefreshing,
  qualityDistribution,
  formatDistribution,
} = storeToRefs(statisticsStore);

const expandedCard = ref<string | null>(null);
const hiddenCards = ref<Set<string>>(new Set());
const showManager = ref(false);
const importDialogVisible = ref(false);
const importPreview = ref<StatisticsImportPreview | null>(null);
const importMode = ref<StatisticsImportMode>('merge');
const importFilePath = ref('');
const exportPending = ref(false);
const importPending = ref(false);
const { showToast } = useToast();

async function handleCardClick(cardTitle: string) {
  if (expandedCard.value === cardTitle) {
    expandedCard.value = null;
    return;
  }

  expandedCard.value = cardTitle;

  if (cardTitle === CARD_TITLES.losslessRate && !qualityDistribution.value) {
    try {
      await statisticsStore.ensureQualityDistribution();
    } catch (e) {
      console.warn('Failed to fetch quality distribution:', e);
    }
  }

  if (cardTitle === CARD_TITLES.librarySize && !formatDistribution.value) {
    try {
      await statisticsStore.ensureFormatDistribution();
    } catch (e) {
      console.warn('Failed to fetch format distribution:', e);
    }
  }
}

async function updateBehaviorTime(range: TimeRangeType) {
  try {
    await statisticsStore.refreshBehaviorOnly(range);
  } catch (e) {
    console.warn('Failed to fetch behavior stats:', e);
  }
}

async function handleRefresh() {
  try {
    await statisticsStore.refreshAll(currentBehaviorTimeRange.value);
  } catch {
    // Store state already carries the error.
  }
}

function buildExportDefaultName() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `LyciaStats_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.json`;
}

async function handleExportStatistics() {
  if (exportPending.value) {
    return;
  }

  try {
    const selected = await save({
      title: '导出统计',
      defaultPath: buildExportDefaultName(),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });

    if (!selected || Array.isArray(selected)) {
      return;
    }

    exportPending.value = true;
    const result = await statisticsApi.exportStatisticsFile(selected, true);
    showToast(`统计数据已导出：${result.filePath}`, 'success');
  } catch (error) {
    console.error('Failed to export statistics:', error);
    showToast(`导出统计失败: ${error}`, 'error');
  } finally {
    exportPending.value = false;
  }
}

async function handleSelectImportFile() {
  if (importPending.value) {
    return;
  }

  try {
    const selected = await open({
      title: '导入统计',
      multiple: false,
      directory: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });

    if (!selected || Array.isArray(selected)) {
      return;
    }

    importPending.value = true;
    importFilePath.value = selected;
    importMode.value = 'merge';
    importPreview.value = await statisticsApi.previewStatisticsImport(selected);
    importDialogVisible.value = true;
  } catch (error) {
    console.error('Failed to preview statistics import:', error);
    showToast(String(error), 'error');
  } finally {
    importPending.value = false;
  }
}

async function confirmImportStatistics() {
  if (!importFilePath.value || importPending.value) {
    return;
  }

  try {
    importPending.value = true;
    const result = await statisticsApi.importStatisticsFile(
      importFilePath.value,
      importMode.value,
      importPreview.value?.duplicateImportDetected ?? false,
    );
    importDialogVisible.value = false;
    importPreview.value = null;
    await statisticsStore.refreshAll('All');
    showToast(
      `统计导入完成：已合并 ${result.mergedSongCount} 首，未匹配 ${result.unmatchedSongCount} 首，新增最近播放 ${result.importedRecentPlaysCount} 条`,
      'success',
    );
  } catch (error) {
    console.error('Failed to import statistics:', error);
    showToast(`导入统计失败: ${error}`, 'error');
  } finally {
    importPending.value = false;
  }
}

function loadHiddenSettings() {
  const saved = localStorage.getItem('lycia-hidden-stats-cards');
  if (!saved) {
    return;
  }

  try {
    hiddenCards.value = new Set(JSON.parse(saved));
    if (hiddenCards.value.delete('24 \u5c0f\u65f6\u64ad\u653e\u5206\u5e03')) {
      hiddenCards.value.add(CARD_TITLES.dailyDuration);
      saveHiddenSettings();
    }
  } catch (e) {
    console.error('Failed to parse hidden cards settings:', e);
  }
}

function saveHiddenSettings() {
  localStorage.setItem('lycia-hidden-stats-cards', JSON.stringify(Array.from(hiddenCards.value)));
}

function toggleCardVisibility(cardTitle: string) {
  if (hiddenCards.value.has(cardTitle)) {
    hiddenCards.value.delete(cardTitle);
  } else {
    hiddenCards.value.add(cardTitle);
  }
  saveHiddenSettings();
}

function hideCard(cardTitle: string) {
  hiddenCards.value.add(cardTitle);
  saveHiddenSettings();
}

onMounted(async () => {
  loadHiddenSettings();
  statisticsStore.cancelHeavyDataRelease();
  const hadBehaviorStats = !!behaviorStats.value;
  await statisticsStore.ensureLoaded(currentBehaviorTimeRange.value);
  if (hadBehaviorStats) {
    try {
      await statisticsStore.refreshBehaviorOnly(currentBehaviorTimeRange.value);
    } catch (e) {
      console.warn('Failed to refresh behavior stats on enter:', e);
    }
  }
});

onUnmounted(() => {
  statisticsStore.scheduleHeavyDataRelease();
});
</script>

<template>
  <div class="statistics-page h-full overflow-y-auto custom-scrollbar w-full select-none">
    <div class="px-6 py-6">
      <div v-if="loading && !stats" class="grid grid-cols-3 gap-4">
        <div v-for="i in 6" :key="i" class="h-24 rounded-xl bg-gray-100/50 dark:bg-white/5 animate-pulse"></div>
      </div>

      <div v-else-if="error" class="p-6 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
        <p class="text-red-600 dark:text-red-400">{{ TEXT.loadFailed }}{{ error }}</p>
        <button @click="handleRefresh" class="mt-2 px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors">
          {{ TEXT.retry }}
        </button>
      </div>

      <div v-else-if="stats && stats.total_songs === 0" class="text-center py-12">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto text-gray-300 dark:text-gray-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
        </svg>
        <p class="text-gray-800 dark:text-gray-200 text-lg">{{ TEXT.noData }}</p>
        <p class="text-gray-600 dark:text-gray-300 text-sm mt-1">{{ TEXT.noLibraryHint }}</p>
      </div>

      <template v-else-if="stats">
        <div class="flex items-center justify-between mb-4 animate-fade-in-up" style="animation-delay: 0ms;">
          <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100 italic flex items-center gap-2">
            {{ TEXT.libraryOverview }}
            <button
              @click="showManager = !showManager"
              class="text-[10px] font-normal not-italic px-1.5 py-0.5 rounded text-gray-700 dark:text-gray-300 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              :class="{ 'bg-blue-500/10 text-blue-500': showManager }"
            >
              {{ TEXT.manageCards }}
            </button>
          </h2>

          <div class="flex items-center gap-3">
            <span v-if="lastUpdated" class="text-xs text-gray-600 dark:text-gray-300">
              {{ TEXT.updatedAt }} {{ lastUpdated.toLocaleTimeString() }}
            </span>
            <button
              @click="handleRefresh"
              class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-700 dark:text-gray-300 hover:text-black dark:hover:text-white w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
              :class="{ 'animate-spin': isRefreshing }"
              :disabled="isRefreshing"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        <transition
          enter-active-class="transition duration-200 ease-out"
          enter-from-class="transform -translate-y-2 opacity-0"
          enter-to-class="transform translate-y-0 opacity-100"
          leave-active-class="transition duration-150 ease-in"
          leave-from-class="transform translate-y-0 opacity-100"
          leave-to-class="transform -translate-y-2 opacity-0"
        >
          <div v-if="showManager" class="mb-6 p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10">
            <p class="text-xs font-medium text-gray-700 dark:text-gray-300 mb-3">{{ TEXT.managerHint }}</p>
            <div class="flex flex-wrap gap-x-6 gap-y-2">
              <label v-for="card in managerCards" :key="card" class="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  :checked="!hiddenCards.has(card)"
                  @change="toggleCardVisibility(card)"
                  class="w-3.5 h-3.5 rounded border-gray-300 text-blue-500 focus:ring-blue-500/20"
                />
                <span class="text-xs text-gray-800 dark:text-gray-200 group-hover:text-black dark:group-hover:text-white transition-colors">
                  {{ card }}
                </span>
              </label>
            </div>
          </div>
        </transition>

        <StatsOverviewCards
          :total-songs="stats.total_songs"
          :total-duration="stats.total_duration"
          :total-file-size="stats.total_file_size"
          :album-count="stats.album_count"
          :artist-count="stats.artist_count"
          :lossless-count="stats.lossless_count"
          :this-month-added="stats.this_month_added"
          :hidden-cards="hiddenCards"
          :expanded-card="expandedCard"
          @hide="hideCard"
          @card-click="handleCardClick"
        />

        <transition
          enter-active-class="transition-all duration-400 ease-out"
          enter-from-class="opacity-0 max-h-0 -translate-y-4"
          enter-to-class="opacity-100 max-h-[500px] translate-y-0"
          leave-active-class="transition-all duration-300 ease-in"
          leave-from-class="opacity-100 max-h-[500px] translate-y-0"
          leave-to-class="opacity-0 max-h-0 -translate-y-4"
        >
          <div
            v-if="expandedCard === CARD_TITLES.losslessRate && qualityDistribution"
            class="overflow-hidden rounded-xl bg-white/40 dark:bg-white/5 backdrop-blur-md border border-white/20 dark:border-white/5 mb-4"
          >
            <div class="flex items-center justify-between px-6 pt-4">
              <h3 class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ TEXT.qualityDetail }}</h3>
              <button
                @click="expandedCard = null"
                class="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
                </svg>
              </button>
            </div>
            <QualityPieChart
              :hires="qualityDistribution.hires"
              :super-quality="qualityDistribution.super_quality"
              :high-quality="qualityDistribution.high_quality"
              :other="qualityDistribution.other"
            />
          </div>
        </transition>

        <transition
          enter-active-class="transition-all duration-400 ease-out"
          enter-from-class="opacity-0 max-h-0 -translate-y-4"
          enter-to-class="opacity-100 max-h-[500px] translate-y-0"
          leave-active-class="transition-all duration-300 ease-in"
          leave-from-class="opacity-100 max-h-[500px] translate-y-0"
          leave-to-class="opacity-0 max-h-0 -translate-y-4"
        >
          <div
            v-if="expandedCard === CARD_TITLES.librarySize && formatDistribution"
            class="overflow-hidden rounded-xl bg-white/40 dark:bg-white/5 backdrop-blur-md border border-white/20 dark:border-white/5 mb-4"
          >
            <div class="flex items-center justify-between px-6 pt-4">
              <h3 class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ TEXT.formatDetail }}</h3>
              <button
                @click="expandedCard = null"
                class="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
                </svg>
              </button>
            </div>
            <FormatPieChart
              :flac="formatDistribution.flac"
              :mp3="formatDistribution.mp3"
              :alac="formatDistribution.alac"
              :wav="formatDistribution.wav"
              :aiff="formatDistribution.aiff"
              :aac="formatDistribution.aac"
              :ogg="formatDistribution.ogg"
              :other="formatDistribution.other"
            />
          </div>
        </transition>

        <hr class="border-gray-100 dark:border-gray-800 my-8 animate-fade-in" style="animation-delay: 600ms;" />

        <section class="mt-8 animate-fade-in-up" style="animation-delay: 700ms;">
          <div class="flex items-center justify-between mb-6">
            <div class="flex items-center gap-3">
              <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100 italic">{{ TEXT.behaviorTitle }}</h2>
              <button
                type="button"
                class="rounded-full border border-[#EC4141]/20 px-3 py-1.5 text-xs font-medium text-[#EC4141] transition-colors hover:bg-[#EC4141]/8 disabled:cursor-not-allowed disabled:opacity-60"
                :disabled="exportPending"
                @click="handleExportStatistics"
              >
                {{ exportPending ? '导出中...' : TEXT.exportStats }}
              </button>
              <button
                type="button"
                class="rounded-full border border-[#EC4141]/20 px-3 py-1.5 text-xs font-medium text-[#EC4141] transition-colors hover:bg-[#EC4141]/8 disabled:cursor-not-allowed disabled:opacity-60"
                :disabled="importPending"
                @click="handleSelectImportFile"
              >
                {{ importPending ? '读取中...' : TEXT.importStats }}
              </button>
            </div>

            <div class="relative bg-gray-100 dark:bg-white/5 rounded-lg p-1 shrink-0 grid grid-cols-4" style="min-width: 240px;">
              <div
                class="rounded-md bg-white dark:bg-gray-700 shadow-sm transition-transform duration-300 ease-spring row-start-1 col-start-1"
                :style="{ transform: `translateX(${behaviorTimeOptions.findIndex(option => option.value === currentBehaviorTimeRange) * 100}%)` }"
              ></div>

              <button
                v-for="(range, index) in behaviorTimeOptions"
                :key="range.value"
                @click="updateBehaviorTime(range.value)"
                class="row-start-1 z-10 px-2 py-1.5 text-xs font-medium rounded-md transition-colors duration-200 text-center whitespace-nowrap"
                :style="{ gridColumn: index + 1 }"
                :class="currentBehaviorTimeRange === range.value
                  ? 'text-gray-900 dark:text-white'
                  : 'text-gray-600 dark:text-white/70 hover:text-gray-900 dark:hover:text-white'"
              >
                {{ range.label }}
              </button>
            </div>
          </div>

          <BehaviorStatsSection
            v-if="behaviorStats"
            :total-plays7d="behaviorStats.total_plays"
            :total-duration="behaviorStats.total_duration"
            :top-songs7d="behaviorStats.top_songs"
            :top-songs-by-duration="behaviorStats.top_songs_by_duration"
            :top-artists="behaviorStats.top_artists"
            :top-albums="behaviorStats.top_albums"
            :hour-distribution="behaviorStats.hour_distribution"
            :recent-activity="behaviorStats.recent_activity"
            :hidden-cards="hiddenCards"
            @hide="hideCard"
          />
        </section>
      </template>
    </div>
  </div>

  <StatisticsImportDialog
    v-model:visible="importDialogVisible"
    :preview="importPreview"
    :mode="importMode"
    :importing="importPending"
    @update:mode="importMode = $event"
    @confirm="confirmImportStatistics"
  />
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 10px;
}

.dark .custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
}
</style>

<style>
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
    filter: blur(4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
    filter: blur(0);
  }
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

@keyframes slideUpFade {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.98);
    filter: blur(2px);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
    filter: blur(0);
  }
}

@keyframes popIn {
  0% {
    opacity: 0;
    transform: scale(0.8);
  }

  60% {
    transform: scale(1.05);
  }

  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes shimmer {
  0% {
    background-position: -200% 0;
  }

  100% {
    background-position: 200% 0;
  }
}

.animate-fade-in-up {
  opacity: 0;
  animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.animate-fade-in {
  opacity: 0;
  animation: fadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.animate-slide-up-fade {
  opacity: 0;
  animation: slideUpFade 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.animate-pop-in {
  opacity: 0;
  animation: popIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

hr.animate-fade-in {
  background: linear-gradient(90deg, transparent, rgba(99, 102, 241, 0.3), transparent);
  background-size: 200% 100%;
  animation: fadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards, shimmer 2s ease-in-out 0.5s;
  border: none;
  height: 1px;
}

.animate-slide-up-fade:hover {
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@media (prefers-reduced-motion: reduce) {
  .animate-fade-in-up,
  .animate-fade-in,
  .animate-slide-up-fade,
  .animate-pop-in,
  .animate-list-item,
  .animate-bar-grow {
    animation: none;
    opacity: 1;
    transform: none;
    filter: none;
  }
}
</style>
