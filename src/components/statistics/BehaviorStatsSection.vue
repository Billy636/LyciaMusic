<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, watch } from 'vue';
import { useLibraryBrowse } from '../../features/library/useLibraryBrowse';
import { useCoverCache } from '../../composables/useCoverCache';
import { useLibrarySongResolver } from '../../composables/useLibrarySongResolver';

interface TopSong {
  song_path: string;
  play_count: number;
  value: number;
}

interface TopArtist {
  artist: string;
  play_count: number;
}

interface TopAlbum {
  album: string;
  play_count: number;
}

const TEXT = {
  totalListenDuration: '\u603b\u542c\u6b4c\u65f6\u957f',
  playCount: '\u64ad\u653e\u6b21\u6570',
  peakPeriod: '\u6700\u6d3b\u8dc3\u65f6\u6bb5',
  topByCount: '\u6700\u5e38\u64ad\u653e(\u6309\u6b21\u6570)',
  topByDuration: '\u6700\u5e38\u64ad\u653e(\u6309\u65f6\u957f)',
  topArtists: '\u5e38\u542c\u6b4c\u624b',
  topAlbums: '\u5e38\u542c\u4e13\u8f91',
  hourlyDistribution: '24 \u5c0f\u65f6\u64ad\u653e\u5206\u5e03',
  hideCard: '\u9690\u85cf\u6b64\u5361\u7247',
  unknownSong: '\u672a\u77e5\u6b4c\u66f2',
  unknownArtist: '\u672a\u77e5\u827a\u672f\u5bb6',
  deletedSong: '\u5df2\u5220\u9664\u6b4c\u66f2',
  deletedArtist: '\u6e90\u6587\u4ef6\u5df2\u4e0d\u5b58\u5728',
  morning: '\u4e0a\u5348',
  noon: '\u4e2d\u5348',
  afternoon: '\u4e0b\u5348',
  evening: '\u665a\u4e0a',
  lateNight: '\u6df1\u591c',
  timesSuffix: '\u6b21',
  noDataHint: '\u6682\u65e0\u6570\u636e\uff0c\u53bb\u64ad\u653e\u51e0\u9996\u6b4c\u5427',
  secondsSuffix: 'S',
  hourSuffix: 'H',
  minuteSuffix: 'M',
};

const props = defineProps<{
  totalPlays7d: number;
  totalDuration: number;
  topSongs7d: TopSong[];
  topSongsByDuration: TopSong[];
  topArtists: TopArtist[];
  topAlbums: TopAlbum[];
  hourDistribution: number[];
  recentActivity: number[];
  hiddenCards: Set<string>;
}>();

const emit = defineEmits<{
  hide: [title: string];
}>();

const { canonicalSongPaths } = useLibraryBrowse();
const { loadSongs, peekSong } = useLibrarySongResolver();
const { coverCache, loadCover, touchCoverPaths, preloadPriorityCovers } = useCoverCache();
const displayedCoverUrls = reactive(new Map<string, string>());
const songInfoByPath = reactive(new Map<string, { title: string; artist: string }>());
let trackedSongPaths = new Set<string>();

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

function getCoverUrl(songPath: string): string | null {
  const normalizedPath = normalizePath(songPath);
  const existsInLibrary = canonicalSongPaths.value.some(path => normalizePath(path) === normalizedPath);
  if (!existsInLibrary) {
    return null;
  }

  const cover = displayedCoverUrls.get(songPath) ?? coverCache.get(songPath);
  return cover || null;
}

function syncDisplayedCoverUrls(paths: string[]) {
  const nextPaths = Array.from(new Set(paths.filter(Boolean)));
  trackedSongPaths = new Set(nextPaths);

  for (const path of Array.from(displayedCoverUrls.keys())) {
    if (!trackedSongPaths.has(path)) {
      displayedCoverUrls.delete(path);
    }
  }

  touchCoverPaths(nextPaths);

  nextPaths.forEach((path) => {
    const cachedUrl = coverCache.get(path);
    if (cachedUrl) {
      displayedCoverUrls.set(path, cachedUrl);
      return;
    }

    if (displayedCoverUrls.has(path)) {
      return;
    }

    void loadCover(path).then((coverUrl) => {
      if (!coverUrl || !trackedSongPaths.has(path)) {
        return;
      }

      displayedCoverUrls.set(path, coverUrl);
    });
  });
}

function getSongInfo(path: string) {
  const song = songInfoByPath.get(normalizePath(path)) ?? (() => {
    const cached = peekSong(path);
    return cached ? { title: cached.title || cached.name, artist: cached.artist } : null;
  })();

  if (song) {
    return {
      title: song.title || TEXT.unknownSong,
      artist: song.artist || TEXT.unknownArtist,
    };
  }

  return {
    title: path.split(/[/\\]/).pop() || TEXT.deletedSong,
    artist: TEXT.deletedArtist,
  };
}

function formatDuration(seconds: number) {
  if (!seconds) {
    return `0${TEXT.secondsSuffix}`;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}${TEXT.hourSuffix} ${minutes}${TEXT.minuteSuffix}`;
  }

  return `${minutes}${TEXT.minuteSuffix} ${Math.floor(seconds % 60)}${TEXT.secondsSuffix}`;
}

function formatDurationShort(seconds: number) {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  return `${Math.floor(seconds / 60)}m`;
}

function getHourLabel(hour: number): string {
  if (hour >= 6 && hour < 12) return TEXT.morning;
  if (hour >= 12 && hour < 14) return TEXT.noon;
  if (hour >= 14 && hour < 18) return TEXT.afternoon;
  if (hour >= 18 && hour < 22) return TEXT.evening;
  return TEXT.lateNight;
}

const allSongPaths = computed(() => {
  const paths = new Set<string>();
  props.topSongs7d.forEach(song => paths.add(song.song_path));
  props.topSongsByDuration.forEach(song => paths.add(song.song_path));
  return Array.from(paths);
});

const maxHourCount = computed(() => Math.max(...props.hourDistribution, 1));

const peakHour = computed(() => {
  let maxIndex = 0;
  for (let i = 1; i < props.hourDistribution.length; i += 1) {
    if (props.hourDistribution[i] > props.hourDistribution[maxIndex]) {
      maxIndex = i;
    }
  }
  return maxIndex;
});

const peakTimeDesc = computed(() => `${getHourLabel(peakHour.value)} ${peakHour.value}:00 - ${peakHour.value + 1}:00`);

watch(allSongPaths, paths => {
  syncDisplayedCoverUrls(paths);
  preloadPriorityCovers(paths);
  const libraryPathByNormalized = new Map(
    canonicalSongPaths.value.map(path => [normalizePath(path), path]),
  );
  const libraryPaths = paths
    .map(path => libraryPathByNormalized.get(normalizePath(path)))
    .filter((path): path is string => !!path);
  void loadSongs(libraryPaths).then((songs) => {
    songs.forEach(song => {
      songInfoByPath.set(normalizePath(song.path), {
        title: song.title || song.name || TEXT.unknownSong,
        artist: song.artist || TEXT.unknownArtist,
      });
    });
  });
}, { immediate: true });

onBeforeUnmount(() => {
  displayedCoverUrls.clear();
  trackedSongPaths = new Set<string>();
});
</script>

<template>
  <div class="behavior-stats mt-6 space-y-6">
    <div
      v-if="!hiddenCards.has(TEXT.totalListenDuration) || !hiddenCards.has(TEXT.playCount) || !hiddenCards.has(TEXT.peakPeriod)"
      class="grid grid-cols-1 md:grid-cols-3 gap-4"
    >
      <div
        v-if="!hiddenCards.has(TEXT.totalListenDuration)"
        class="stat-card relative overflow-hidden rounded-xl p-4 backdrop-blur-md bg-white/60 dark:bg-white/5 border border-white/20 dark:border-white/10 shadow-lg group animate-slide-up-fade"
        style="animation-delay: 100ms;"
      >
        <div class="delete-trigger-area absolute top-0 right-0 w-14 h-14 z-20 flex items-start justify-end p-2 cursor-pointer">
          <button @click.stop="emit('hide', TEXT.totalListenDuration)" class="card-close-btn p-1 rounded-full bg-black/5 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white transition-opacity" :title="TEXT.hideCard">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="absolute inset-0 opacity-10 dark:opacity-20 bg-gradient-to-br from-pink-500 to-rose-400"></div>
        <div class="relative z-10">
          <div class="w-10 h-10 rounded-lg flex items-center justify-center mb-3 bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-md">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p class="text-xs font-medium text-gray-700 dark:text-white/80 mb-1">{{ TEXT.totalListenDuration }}</p>
          <p class="text-xl font-bold text-gray-900 dark:text-white tracking-tight relative z-10">{{ formatDuration(totalDuration) }}</p>
        </div>
      </div>

      <div
        v-if="!hiddenCards.has(TEXT.playCount)"
        class="stat-card relative overflow-hidden rounded-xl p-4 backdrop-blur-md bg-white/60 dark:bg-white/5 border border-white/20 dark:border-white/10 shadow-lg group animate-slide-up-fade"
        style="animation-delay: 200ms;"
      >
        <div class="delete-trigger-area absolute top-0 right-0 w-14 h-14 z-20 flex items-start justify-end p-2 cursor-pointer">
          <button @click.stop="emit('hide', TEXT.playCount)" class="card-close-btn p-1 rounded-full bg-black/5 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white transition-opacity" :title="TEXT.hideCard">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="absolute inset-0 opacity-10 dark:opacity-20 bg-gradient-to-br from-green-500 to-emerald-400"></div>
        <div class="relative z-10">
          <div class="w-10 h-10 rounded-lg flex items-center justify-center mb-3 bg-gradient-to-br from-green-500 to-emerald-400 text-white shadow-md">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p class="text-xs font-medium text-gray-700 dark:text-white/80 mb-1">{{ TEXT.playCount }}</p>
          <p class="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">{{ totalPlays7d }}</p>
        </div>
      </div>

      <div
        v-if="!hiddenCards.has(TEXT.peakPeriod)"
        class="stat-card relative overflow-hidden rounded-xl p-4 backdrop-blur-md bg-white/60 dark:bg-white/5 border border-white/20 dark:border-white/10 shadow-lg group animate-slide-up-fade"
        style="animation-delay: 300ms;"
      >
        <div class="delete-trigger-area absolute top-0 right-0 w-14 h-14 z-20 flex items-start justify-end p-2 cursor-pointer">
          <button @click.stop="emit('hide', TEXT.peakPeriod)" class="card-close-btn p-1 rounded-full bg-black/5 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white transition-opacity" :title="TEXT.hideCard">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="absolute inset-0 opacity-10 dark:opacity-20 bg-gradient-to-br from-indigo-500 to-violet-400"></div>
        <div class="relative z-10">
          <div class="w-10 h-10 rounded-lg flex items-center justify-center mb-3 bg-gradient-to-br from-indigo-500 to-violet-400 text-white shadow-md">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <p class="text-xs font-medium text-gray-700 dark:text-white/80 mb-1">{{ TEXT.peakPeriod }}</p>
          <div class="flex flex-col">
            <div class="flex items-end gap-0.5 h-8" :title="peakTimeDesc">
              <div
                v-for="(count, hour) in hourDistribution"
                :key="hour"
                class="flex-1 rounded-sm transition-all duration-200"
                :style="{ height: `${Math.max((count / maxHourCount) * 100, 10)}%`, backgroundColor: hour === peakHour ? 'rgb(99 102 241)' : `rgba(99, 102, 241, ${0.15 + (count / maxHourCount) * 0.55})` }"
              ></div>
            </div>
            <div class="flex justify-between mt-1 text-[8px] text-gray-600 dark:text-gray-300 font-medium">
              <span>00</span>
              <span>12</span>
              <span>24</span>
            </div>
          </div>
          <p class="text-xs text-indigo-500 dark:text-indigo-400 font-medium mt-0.5">{{ peakTimeDesc }}</p>
        </div>
      </div>
    </div>

    <div v-if="!hiddenCards.has(TEXT.topByCount) || !hiddenCards.has(TEXT.topByDuration)" class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div v-if="!hiddenCards.has(TEXT.topByCount) && topSongs7d.length > 0" class="relative rounded-xl p-4 backdrop-blur-md bg-white/60 dark:bg-white/5 border border-white/20 dark:border-white/10 shadow-lg group animate-slide-up-fade" style="animation-delay: 400ms;">
        <div class="delete-trigger-area absolute top-0 right-0 w-14 h-14 z-20 flex items-start justify-end p-2 cursor-pointer">
          <button @click.stop="emit('hide', TEXT.topByCount)" class="card-close-btn p-1 rounded-full bg-black/5 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white transition-opacity" :title="TEXT.hideCard">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <h4 class="text-sm font-medium text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-amber-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
          {{ TEXT.topByCount }}
        </h4>
        <div class="space-y-2">
          <div v-for="(song, index) in topSongs7d" :key="song.song_path" class="flex items-center gap-3 p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
            <div :class="['w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0', index === 0 ? 'bg-yellow-400 text-yellow-900' : index === 1 ? 'bg-gray-300 text-gray-700' : index === 2 ? 'bg-amber-600 text-amber-100' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300']">{{ index + 1 }}</div>
            <div class="w-8 h-8 rounded bg-gray-200 dark:bg-white/10 shrink-0 overflow-hidden shadow-sm">
              <img v-if="getCoverUrl(song.song_path)" :src="getCoverUrl(song.song_path)!" class="w-full h-full object-cover" loading="lazy" />
              <div v-else class="w-full h-full flex items-center justify-center text-gray-600 dark:text-gray-300">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>
              </div>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{{ getSongInfo(song.song_path).title }}</p>
              <p class="text-xs text-gray-600 dark:text-gray-300 truncate">{{ getSongInfo(song.song_path).artist }}</p>
            </div>
            <div class="text-sm text-gray-700 dark:text-gray-300 text-right">{{ song.value }} {{ TEXT.timesSuffix }}</div>
          </div>
        </div>
      </div>

      <div v-if="!hiddenCards.has(TEXT.topByDuration) && topSongsByDuration.length > 0" class="relative rounded-xl p-4 backdrop-blur-md bg-white/60 dark:bg-white/5 border border-white/20 dark:border-white/10 shadow-lg group animate-slide-up-fade" style="animation-delay: 500ms;">
        <div class="delete-trigger-area absolute top-0 right-0 w-14 h-14 z-20 flex items-start justify-end p-2 cursor-pointer">
          <button @click.stop="emit('hide', TEXT.topByDuration)" class="card-close-btn p-1 rounded-full bg-black/5 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white transition-opacity" :title="TEXT.hideCard">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <h4 class="text-sm font-medium text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-pink-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          {{ TEXT.topByDuration }}
        </h4>
        <div class="space-y-2">
          <div v-for="(song, index) in topSongsByDuration" :key="song.song_path" class="flex items-center gap-3 p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
            <div :class="['w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0', index === 0 ? 'bg-yellow-400 text-yellow-900' : index === 1 ? 'bg-gray-300 text-gray-700' : index === 2 ? 'bg-amber-600 text-amber-100' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300']">{{ index + 1 }}</div>
            <div class="w-8 h-8 rounded bg-gray-200 dark:bg-white/10 shrink-0 overflow-hidden shadow-sm">
              <img v-if="getCoverUrl(song.song_path)" :src="getCoverUrl(song.song_path)!" class="w-full h-full object-cover" loading="lazy" />
              <div v-else class="w-full h-full flex items-center justify-center text-gray-600 dark:text-gray-300">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>
              </div>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{{ getSongInfo(song.song_path).title }}</p>
              <p class="text-xs text-gray-600 dark:text-gray-300 truncate">{{ getSongInfo(song.song_path).artist }}</p>
            </div>
            <div class="text-sm text-gray-700 dark:text-gray-300 text-right">{{ formatDurationShort(song.value) }}</div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="!hiddenCards.has(TEXT.topArtists) || !hiddenCards.has(TEXT.topAlbums)" class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div v-if="!hiddenCards.has(TEXT.topArtists)" class="relative rounded-xl p-4 backdrop-blur-md bg-white/60 dark:bg-white/5 border border-white/20 dark:border-white/10 shadow-lg group animate-slide-up-fade" style="animation-delay: 600ms;">
        <div class="delete-trigger-area absolute top-0 right-0 w-14 h-14 z-20 flex items-start justify-end p-2 cursor-pointer">
          <button @click.stop="emit('hide', TEXT.topArtists)" class="card-close-btn p-1 rounded-full bg-black/5 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white transition-opacity" :title="TEXT.hideCard">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <h4 class="text-sm font-medium text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
          {{ TEXT.topArtists }}
        </h4>
        <div v-if="topArtists.length > 0" class="space-y-2">
          <div v-for="(artist, index) in topArtists" :key="artist.artist" class="flex items-center gap-3 p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors animate-list-item" :style="{ animationDelay: `${800 + index * 60}ms` }">
            <div :class="['w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0', index === 0 ? 'bg-yellow-400 text-yellow-900' : index === 1 ? 'bg-gray-300 text-gray-700' : index === 2 ? 'bg-amber-600 text-amber-100' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300']">{{ index + 1 }}</div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate" :title="artist.artist">{{ artist.artist }}</p>
            </div>
            <div class="text-xs text-gray-700 dark:text-gray-300 shrink-0">{{ artist.play_count }} {{ TEXT.timesSuffix }}</div>
          </div>
        </div>
        <div v-else class="text-center py-6 text-gray-700 dark:text-gray-300 text-sm">{{ TEXT.noDataHint }}</div>
      </div>

      <div v-if="!hiddenCards.has(TEXT.topAlbums)" class="relative rounded-xl p-4 backdrop-blur-md bg-white/60 dark:bg-white/5 border border-white/20 dark:border-white/10 shadow-lg group animate-slide-up-fade" style="animation-delay: 700ms;">
        <div class="delete-trigger-area absolute top-0 right-0 w-14 h-14 z-20 flex items-start justify-end p-2 cursor-pointer">
          <button @click.stop="emit('hide', TEXT.topAlbums)" class="card-close-btn p-1 rounded-full bg-black/5 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white transition-opacity" :title="TEXT.hideCard">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <h4 class="text-sm font-medium text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
          {{ TEXT.topAlbums }}
        </h4>
        <div v-if="topAlbums.length > 0" class="space-y-2">
          <div v-for="(album, index) in topAlbums" :key="album.album" class="flex items-center gap-3 p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors animate-list-item" :style="{ animationDelay: `${900 + index * 60}ms` }">
            <div :class="['w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0', index === 0 ? 'bg-yellow-400 text-yellow-900' : index === 1 ? 'bg-gray-300 text-gray-700' : index === 2 ? 'bg-amber-600 text-amber-100' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300']">{{ index + 1 }}</div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate" :title="album.album">{{ album.album }}</p>
            </div>
            <div class="text-xs text-gray-700 dark:text-gray-300 shrink-0">{{ album.play_count }} {{ TEXT.timesSuffix }}</div>
          </div>
        </div>
        <div v-else class="text-center py-6 text-gray-700 dark:text-gray-300 text-sm">{{ TEXT.noDataHint }}</div>
      </div>
    </div>

    <div v-if="!hiddenCards.has(TEXT.hourlyDistribution)" class="relative rounded-xl p-4 backdrop-blur-md bg-white/60 dark:bg-white/5 border border-white/20 dark:border-white/10 shadow-lg group animate-slide-up-fade" style="animation-delay: 900ms;">
      <div class="delete-trigger-area absolute top-0 right-0 w-14 h-14 z-20 flex items-start justify-end p-2 cursor-pointer">
        <button @click.stop="emit('hide', TEXT.hourlyDistribution)" class="card-close-btn p-1 rounded-full bg-black/5 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white transition-opacity" :title="TEXT.hideCard">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
      <h4 class="text-sm font-medium text-gray-800 dark:text-gray-200 mb-4 flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        {{ TEXT.hourlyDistribution }}
      </h4>
      <div class="flex items-end gap-1 h-24">
        <div v-for="(count, hour) in hourDistribution" :key="hour" class="flex-1 flex flex-col items-center gap-1">
          <div :style="{ height: `${(count / maxHourCount) * 100}%`, opacity: 0.3 + (count / maxHourCount) * 0.7, animationDelay: `${1000 + hour * 30}ms` }" :class="['w-full rounded-t min-h-[2px] animate-bar-grow', 'bg-indigo-500 dark:bg-indigo-400']" :title="`${hour}:00 - ${count} ${TEXT.timesSuffix}`"></div>
        </div>
      </div>
      <div class="flex justify-between mt-2 text-[10px] text-gray-700 dark:text-gray-300 font-medium px-1">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stat-card {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s ease;
  height: 135px;
  display: flex;
  flex-direction: column;
}

.stat-card:hover {
  transform: scale(1.02);
}

@keyframes barGrow {
  from {
    transform: scaleY(0);
    opacity: 0;
  }

  to {
    transform: scaleY(1);
    opacity: 1;
  }
}

.animate-bar-grow {
  transform-origin: bottom center;
  animation: barGrow 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  opacity: 0;
}

@keyframes listItemSlide {
  from {
    opacity: 0;
    transform: translateX(12px);
  }

  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.animate-list-item {
  opacity: 0;
  animation: listItemSlide 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.delete-trigger-area .card-close-btn {
  opacity: 0;
}

.delete-trigger-area:hover .card-close-btn {
  opacity: 1;
}
</style>
