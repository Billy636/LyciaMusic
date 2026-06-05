<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { SquarePen, Tag } from 'lucide-vue-next';
import type { Song, SongDetail } from '../../types';
import { useCoverCache } from '../../composables/useCoverCache';
import { usePlayer } from '../../composables/player';
import { useSongDetailCache } from '../../composables/useSongDetailCache';
import { useThemeSettings } from '../../composables/useThemeSettings';
import { useToast } from '../../composables/toast';
import { useLibraryStore } from '../../features/library/store';
import type { LyricsStorageSource } from '../../services/tauri/contracts';
import { tauriInvoke } from '../../services/tauri/invoke';

const props = defineProps<{
  visible: boolean;
  song: Song | null;
}>();

const emit = defineEmits(['close']);

const { loadCover, clearCoverCaches } = useCoverCache();
const { loadSongDetail } = useSongDetailCache();
const { openInFinder } = usePlayer();
const { isDarkTheme } = useThemeSettings();
const { showToast } = useToast();
const libraryStore = useLibraryStore();

interface SongInfoEditForm {
  title: string;
  artist: string;
  album: string;
  trackNumber: string;
  discNumber: string;
  year: string;
  coverPath: string | null;
  coverPreviewUrl: string;
}

const createEmptySongInfoEditForm = (): SongInfoEditForm => ({
  title: '',
  artist: '',
  album: '',
  trackNumber: '',
  discNumber: '',
  year: '',
  coverPath: null,
  coverPreviewUrl: '',
});

const coverUrl = ref('');
const savedSongOverride = ref<Song | null>(null);
const isClosing = ref(false);
const currentSongDetail = ref<SongDetail | null>(null);
const isSongInfoEditing = ref(false);
const isSongInfoSaving = ref(false);
const songInfoEditError = ref('');
const songInfoEditForm = ref<SongInfoEditForm>(createEmptySongInfoEditForm());
const lyricsText = ref('');
const originalLyricsText = ref('');
const lyricsSource = ref<LyricsStorageSource>('empty');
const lyricsSourcePath = ref<string | null>(null);
const isLyricsLoading = ref(false);
const isLyricsSaving = ref(false);
const lyricsError = ref('');
const isSongInfoExpanded = ref(false);
const isLyricsEditorExpanded = ref(false);
const pendingSongInfoExpanded = ref<boolean | null>(null);
const pendingLyricsExpanded = ref<boolean | null>(null);
let detailRequestId = 0;
let songInfoExpandTimer: ReturnType<typeof window.setTimeout> | null = null;
let lyricsExpandTimer: ReturnType<typeof window.setTimeout> | null = null;

const clearSongInfoExpandTimers = () => {
  if (songInfoExpandTimer !== null) {
    window.clearTimeout(songInfoExpandTimer);
    songInfoExpandTimer = null;
  }
};

const clearLyricsExpandTimers = () => {
  if (lyricsExpandTimer !== null) {
    window.clearTimeout(lyricsExpandTimer);
    lyricsExpandTimer = null;
  }
};

const handleClose = () => {
  if (isClosing.value) return;
  isClosing.value = true;
  setTimeout(() => {
    emit('close');
    isClosing.value = false;
  }, 200); // 时长匹配退出动画
};

watch(
  [() => props.visible, () => props.song?.path ?? ''],
  async ([visible, path]) => {
    const requestId = ++detailRequestId;

    if (!visible || !path) {
      clearSongInfoExpandTimers();
      clearLyricsExpandTimers();
      currentSongDetail.value = null;
      savedSongOverride.value = null;
      isSongInfoEditing.value = false;
      isSongInfoSaving.value = false;
      songInfoEditError.value = '';
      songInfoEditForm.value = createEmptySongInfoEditForm();
      lyricsText.value = '';
      originalLyricsText.value = '';
      lyricsSource.value = 'empty';
      lyricsSourcePath.value = null;
      lyricsError.value = '';
      isLyricsLoading.value = false;
      isLyricsSaving.value = false;
      isSongInfoExpanded.value = false;
      isLyricsEditorExpanded.value = false;
      pendingSongInfoExpanded.value = null;
      pendingLyricsExpanded.value = null;
      setTimeout(() => {
        if (requestId === detailRequestId) {
          coverUrl.value = '';
        }
      }, 200);
      return;
    }

    clearSongInfoExpandTimers();
    clearLyricsExpandTimers();
    isClosing.value = false;
    savedSongOverride.value = null;
    isSongInfoEditing.value = false;
    isSongInfoSaving.value = false;
    songInfoEditError.value = '';
    songInfoEditForm.value = createEmptySongInfoEditForm();
    isLyricsLoading.value = true;
    isLyricsSaving.value = false;
    lyricsSource.value = 'empty';
    lyricsSourcePath.value = null;
    lyricsError.value = '';
    isSongInfoExpanded.value = false;
    isLyricsEditorExpanded.value = false;
    pendingSongInfoExpanded.value = null;
    pendingLyricsExpanded.value = null;

    const [url, detail, lyricsResult] = await Promise.all([
      loadCover(path),
      loadSongDetail(path).catch(() => null),
      tauriInvoke('get_song_lyrics_for_edit', { path })
        .then((lyrics) => ({ ...lyrics, error: '' }))
        .catch((error) => ({
          lyrics: '',
          source: 'empty' as LyricsStorageSource,
          sourcePath: null,
          error: String(error),
        })),
    ]);

    if (requestId !== detailRequestId || !props.visible || path !== (props.song?.path ?? '')) {
      return;
    }

    coverUrl.value = url || '';
    currentSongDetail.value = detail;
    lyricsText.value = lyricsResult.lyrics;
    originalLyricsText.value = lyricsResult.lyrics;
    lyricsSource.value = lyricsResult.source;
    lyricsSourcePath.value = lyricsResult.sourcePath;
    lyricsError.value = lyricsResult.error;
    isLyricsLoading.value = false;
  },
  { immediate: true },
);

const hasLyricsChanged = computed(() => lyricsText.value !== originalLyricsText.value);
const isSongInfoVisuallyExpanded = computed(
  () => pendingSongInfoExpanded.value ?? isSongInfoExpanded.value,
);
const isLyricsEditorVisuallyExpanded = computed(
  () => pendingLyricsExpanded.value ?? isLyricsEditorExpanded.value,
);

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.visible) {
    handleClose();
  }
};

onMounted(() => window.addEventListener('keydown', handleKeydown));
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
  clearSongInfoExpandTimers();
  clearLyricsExpandTimers();
});

const handleOpenFolder = () => {
  if (props.song?.path) {
    void openInFinder(props.song.path);
    handleClose();
  }
};

const ensureMusicTagPath = async (): Promise<string | null> => {
  const MUSICTAG_PATH_KEY = 'toolbox_musictag_path';
  let path = localStorage.getItem(MUSICTAG_PATH_KEY);

  if (path) {
    const exists = await tauriInvoke('file_exists', { path });
    if (!exists) {
      localStorage.removeItem(MUSICTAG_PATH_KEY);
      showToast('MusicTag 路径无效，请重新选择', 'error');
      path = null;
    }
  }

  if (!path) {
    const selected = await open({
      multiple: false,
      directory: false,
      title: '选择 MusicTag 可执行文件',
      filters: [
        {
          name: '可执行文件',
          extensions: ['exe'],
        },
      ],
    });

    if (!selected || typeof selected !== 'string') {
      showToast('已取消选择 MusicTag', 'info');
      return null;
    }

    const exists = await tauriInvoke('file_exists', { path: selected });
    if (!exists) {
      showToast('MusicTag 路径无效', 'error');
      return null;
    }

    localStorage.setItem(MUSICTAG_PATH_KEY, selected);
    path = selected;
  }

  return path;
};

const handleOpenInMusicTag = async () => {
  const songPath = props.song?.path;
  if (!songPath) {
    showToast('当前歌曲文件路径无效', 'error');
    return;
  }

  const songExists = await tauriInvoke('file_exists', { path: songPath });
  if (!songExists) {
    showToast('当前歌曲文件路径无效', 'error');
    return;
  }

  const musicTagPath = await ensureMusicTagPath();
  if (!musicTagPath) {
    return;
  }

  try {
    await tauriInvoke('open_external_program', {
      path: musicTagPath,
      args: [songPath],
    });
    showToast('已在 MusicTag 中打开当前歌曲', 'success');
  } catch (error) {
    console.error('Failed to open MusicTag:', error);
    showToast('无法打开 MusicTag，请检查路径配置', 'error');
  }
};

const handleSaveLyrics = async () => {
  if (!props.song?.path || isLyricsSaving.value) return;

  isLyricsSaving.value = true;
  lyricsError.value = '';

  try {
    const savedLyrics = await tauriInvoke('save_song_lyrics', {
      path: props.song.path,
      lyrics: lyricsText.value,
      source: lyricsSource.value,
      sourcePath: lyricsSourcePath.value,
    });
    originalLyricsText.value = lyricsText.value;
    lyricsSource.value = savedLyrics.source;
    lyricsSourcePath.value = savedLyrics.sourcePath;
  } catch (error) {
    lyricsError.value = String(error);
  } finally {
    isLyricsSaving.value = false;
  }
};

const toggleSongInfoExpanded = () => {
  clearSongInfoExpandTimers();

  const nextExpanded = !isSongInfoExpanded.value;
  pendingSongInfoExpanded.value = nextExpanded;

  if (nextExpanded) {
    clearLyricsExpandTimers();
    isLyricsEditorExpanded.value = false;
    pendingLyricsExpanded.value = null;
  }

  songInfoExpandTimer = window.setTimeout(() => {
    isSongInfoExpanded.value = nextExpanded;
    pendingSongInfoExpanded.value = null;
    songInfoExpandTimer = null;
  }, 360);
};

const toggleLyricsEditorExpanded = () => {
  clearLyricsExpandTimers();

  const nextExpanded = !isLyricsEditorExpanded.value;
  pendingLyricsExpanded.value = nextExpanded;

  if (nextExpanded) {
    clearSongInfoExpandTimers();
    isSongInfoExpanded.value = false;
    pendingSongInfoExpanded.value = null;
  }

  lyricsExpandTimer = window.setTimeout(() => {
    isLyricsEditorExpanded.value = nextExpanded;
    pendingLyricsExpanded.value = null;
    lyricsExpandTimer = null;
  }, 360);
};

const displaySong = computed(() => {
  if (!props.song) {
    return null;
  }

  const baseSong = savedSongOverride.value?.path === props.song.path
    ? savedSongOverride.value
    : props.song;

  return {
    ...baseSong,
    genre: currentSongDetail.value?.genre ?? baseSong.genre,
    year: currentSongDetail.value?.year ?? baseSong.year,
    container: currentSongDetail.value?.container ?? baseSong.container,
    codec: currentSongDetail.value?.codec ?? baseSong.codec,
    file_size: currentSongDetail.value?.file_size ?? baseSong.file_size,
    track_number: currentSongDetail.value?.track_number,
    disc_number: currentSongDetail.value?.disc_number,
  };
});

const populateSongInfoEditForm = () => {
  const song = displaySong.value;
  if (!song) {
    songInfoEditForm.value = createEmptySongInfoEditForm();
    return;
  }

  songInfoEditForm.value = {
    title: song.title || song.name || '',
    artist: song.artist || '',
    album: song.album || '',
    trackNumber: song.track_number || '',
    discNumber: song.disc_number || '',
    year: song.year || '',
    coverPath: null,
    coverPreviewUrl: '',
  };
};

const beginSongInfoEdit = () => {
  songInfoEditError.value = '';
  populateSongInfoEditForm();
  isSongInfoEditing.value = true;
};

const cancelSongInfoEdit = () => {
  if (isSongInfoSaving.value) return;
  songInfoEditError.value = '';
  isSongInfoEditing.value = false;
  populateSongInfoEditForm();
};

const normalizeFormValue = (value: string) => value.trim() || null;

const handleChooseCover = async () => {
  if (!isSongInfoEditing.value) return;

  const selected = await open({
    multiple: false,
    directory: false,
    title: '选择歌曲封面',
    filters: [
      {
        name: '图片',
        extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'],
      },
    ],
  });

  if (!selected || Array.isArray(selected)) {
    return;
  }

  songInfoEditForm.value.coverPath = selected;
  songInfoEditForm.value.coverPreviewUrl = convertFileSrc(selected);
};

const handleSaveSongInfo = async () => {
  const songPath = props.song?.path;
  if (!songPath || isSongInfoSaving.value) return;

  const title = songInfoEditForm.value.title.trim();
  if (!title) {
    songInfoEditError.value = '歌名不能为空';
    return;
  }

  isSongInfoSaving.value = true;
  songInfoEditError.value = '';

  try {
    const result = await tauriInvoke('save_song_info', {
      path: songPath,
      payload: {
        title,
        artist: songInfoEditForm.value.artist.trim(),
        album: songInfoEditForm.value.album.trim(),
        trackNumber: normalizeFormValue(songInfoEditForm.value.trackNumber),
        discNumber: normalizeFormValue(songInfoEditForm.value.discNumber),
        year: normalizeFormValue(songInfoEditForm.value.year),
        coverPath: songInfoEditForm.value.coverPath,
      },
    });

    savedSongOverride.value = result.song;
    currentSongDetail.value = result.detail;
    libraryStore.setSongRecord(result.song);

    if (songInfoEditForm.value.coverPath) {
      await tauriInvoke('clear_cover_cache');
      clearCoverCaches();
      coverUrl.value = (await loadCover(songPath)) || '';
    }

    isSongInfoEditing.value = false;
    populateSongInfoEditForm();
    showToast('歌曲信息已保存', 'success');
  } catch (error) {
    const message = String(error);
    songInfoEditError.value = message;
    showToast(`保存歌曲信息失败: ${message}`, 'error');
  } finally {
    isSongInfoSaving.value = false;
  }
};

// 格式化工具
const formatSize = (bytes?: number) => {
  if (bytes === undefined || bytes <= 0) return '无';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
};

const formatDuration = (seconds?: number) => {
  if (!seconds) return '无';
  const totalSeconds = Math.floor(seconds);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const formatBitrate = (bitrate?: number) => {
  if (!bitrate) return '待扫描';
  return `${Math.round(bitrate)} kbps`;
};

const formatSampleRate = (rate?: number) => {
  if (!rate) return '无';
  return `${(rate / 1000).toFixed(1)} kHz`;
};

const formatTime = (timestampSeconds?: number) => {
  if (!timestampSeconds) return '无';
  const date = new Date(timestampSeconds * 1000);
  return date.toLocaleString();
};
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-[10000] flex items-center justify-center p-4 sm:p-6"
      :class="{'pointer-events-none': isClosing}"
    >
      <!-- 背景盖板 -->
      <div
        class="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ease-out"
        :class="isClosing ? 'opacity-0' : 'opacity-100'"
        @click="handleClose"
      ></div>

      <div class="song-info-window-drag-strip" data-tauri-drag-region></div>

      <div
        class="song-info-stage"
        :class="[
          isClosing ? 'scale-95 opacity-0 translate-y-4' : 'scale-100 opacity-100 -translate-y-3',
          isDarkTheme ? 'song-info-stage--dark' : '',
          isSongInfoExpanded ? 'song-info-stage--song-expanded' : '',
          isLyricsEditorExpanded ? 'song-info-stage--lyrics-expanded' : '',
          pendingSongInfoExpanded === true ? 'song-info-stage--song-expanding' : '',
          pendingSongInfoExpanded === false ? 'song-info-stage--song-collapsing' : '',
          pendingLyricsExpanded === true ? 'song-info-stage--lyrics-expanding' : '',
          pendingLyricsExpanded === false ? 'song-info-stage--lyrics-collapsing' : '',
        ]"
      >
        <section class="song-info-column">
          <div class="modal-external-header song-info-header">
            <div class="song-info-header-title">
              <h2 class="text-lg font-bold text-gray-900 dark:text-white">歌曲信息</h2>
              <button
                type="button"
                class="song-info-edit-toggle"
                :class="isSongInfoEditing ? 'song-info-edit-toggle--active' : ''"
                :title="isSongInfoEditing ? '取消编辑歌曲信息' : '编辑歌曲信息'"
                :aria-label="isSongInfoEditing ? '取消编辑歌曲信息' : '编辑歌曲信息'"
                @click="isSongInfoEditing ? cancelSongInfoEdit() : beginSongInfoEdit()"
              >
                <SquarePen class="h-4 w-4" :stroke-width="2.2" />
              </button>
            </div>
            <button
              type="button"
              class="lyrics-editor-expand-button"
              :title="isSongInfoVisuallyExpanded ? '还原歌曲信息' : '放大歌曲信息'"
              @click="toggleSongInfoExpanded"
            >
              <svg v-if="!isSongInfoVisuallyExpanded" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              </svg>
              <svg v-else class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
              </svg>
            </button>
          </div>

          <!-- 模态框主体 -->
          <div
            class="song-info-main relative w-full bg-white/85 dark:bg-gray-900/90 backdrop-blur-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-white/40 dark:border-white/10"
          >
            <!-- 内容区 -->
            <div v-if="displaySong" class="song-info-content p-6 overflow-y-auto custom-scrollbar">
              <!-- 上半部分：封面 + 基本信息 -->
              <div class="song-info-hero flex flex-col sm:flex-row gap-6 mb-4">
                <button
                  type="button"
                  class="song-info-cover w-32 h-32 shrink-0 rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 shadow-md border border-gray-200/50 dark:border-gray-700/50 flex items-center justify-center"
                  :class="isSongInfoEditing ? 'song-info-cover--editable' : ''"
                  :disabled="!isSongInfoEditing"
                  @click="handleChooseCover"
                >
                  <img v-if="songInfoEditForm.coverPreviewUrl || coverUrl" :src="songInfoEditForm.coverPreviewUrl || coverUrl" class="w-full h-full object-cover" draggable="false" />
                  <svg v-else class="w-12 h-12 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                  </svg>
                  <span v-if="isSongInfoEditing" class="song-info-cover-overlay">更换封面</span>
                </button>

                <div class="flex-1 min-w-0 flex flex-col justify-center">
                  <template v-if="isSongInfoEditing">
                    <div class="song-info-edit-wrapper">
                      <label class="song-info-edit-label" for="song-info-title-input">歌名</label>
                      <input
                        id="song-info-title-input"
                        v-model="songInfoEditForm.title"
                        class="song-info-edit-input song-info-edit-input--title song-info-edit-input--with-label"
                        placeholder="请输入歌名"
                      />
                    </div>
                    <div class="song-info-edit-wrapper mt-3">
                      <label class="song-info-edit-label" for="song-info-artist-input">歌手</label>
                      <input
                        id="song-info-artist-input"
                        v-model="songInfoEditForm.artist"
                        class="song-info-edit-input song-info-edit-input--artist song-info-edit-input--with-label"
                        placeholder="请输入歌手名"
                      />
                    </div>
                    <div class="song-info-edit-wrapper mt-2">
                      <label class="song-info-edit-label" for="song-info-album-input">专辑</label>
                      <input
                        id="song-info-album-input"
                        v-model="songInfoEditForm.album"
                        class="song-info-edit-input song-info-edit-input--with-label"
                        placeholder="请输入专辑名"
                      />
                    </div>
                  </template>
                  <template v-else>
                    <h3 class="song-info-name text-3xl font-bold text-gray-900 dark:text-white truncate" :title="displaySong.title || displaySong.name">{{ displaySong.title || displaySong.name }}</h3>
                    <p class="text-lg text-gray-600 dark:text-gray-300 mt-3 truncate" :title="displaySong.artist">{{ displaySong.artist }}</p>
                    <p class="text-base text-gray-500 dark:text-gray-400 mt-2 truncate" :title="displaySong.album">专辑：{{ displaySong.album }}</p>
                  </template>

                  <div v-if="displaySong.is_various_artists_album" class="flex flex-wrap gap-2 mt-4">
                    <span class="px-2 py-0.5 text-xs font-semibold rounded bg-blue-100/80 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800/50">
                      群星合辑
                    </span>
                  </div>
                </div>
              </div>

              <div v-if="songInfoEditError" class="song-info-edit-error">{{ songInfoEditError }}</div>

              <!-- 下半部分：详细属性网格 -->
              <div class="flex flex-col gap-4">
                <div class="song-info-detail-grid bg-gray-50/50 dark:bg-white/5 rounded-xl p-4 border border-gray-100 dark:border-gray-800 grid grid-cols-3 gap-y-6 gap-x-4">
                  <!-- 第一行 -->
                  <div>
                    <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">音轨号</div>
                    <input
                      v-if="isSongInfoEditing"
                      v-model="songInfoEditForm.trackNumber"
                      class="song-info-edit-input song-info-edit-input--compact"
                      placeholder="无"
                    />
                    <div v-else class="text-sm text-gray-800 dark:text-gray-200">{{ displaySong.track_number || '无' }}</div>
                  </div>
                  <div>
                    <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">碟号</div>
                    <input
                      v-if="isSongInfoEditing"
                      v-model="songInfoEditForm.discNumber"
                      class="song-info-edit-input song-info-edit-input--compact"
                      placeholder="无"
                    />
                    <div v-else class="text-sm text-gray-800 dark:text-gray-200">{{ displaySong.disc_number || '无' }}</div>
                  </div>
                  <div>
                    <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">年份</div>
                    <input
                      v-if="isSongInfoEditing"
                      v-model="songInfoEditForm.year"
                      class="song-info-edit-input song-info-edit-input--compact"
                      placeholder="无"
                    />
                    <div v-else class="text-sm text-gray-800 dark:text-gray-200">{{ displaySong.year || '无' }}</div>
                  </div>

                  <!-- 第二行 -->
                  <div>
                    <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">音乐时长</div>
                    <div class="text-sm text-gray-800 dark:text-gray-200">{{ formatDuration(displaySong.duration) }}</div>
                  </div>
                  <div>
                    <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">文件大小</div>
                    <div class="text-sm text-gray-800 dark:text-gray-200">{{ formatSize(displaySong.file_size) }}</div>
                  </div>
                  <div>
                    <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">格式</div>
                    <div class="text-sm text-gray-800 dark:text-gray-200 uppercase">{{ displaySong.format || displaySong.container || '无' }}</div>
                  </div>

                  <!-- 第三行 -->
                  <div>
                    <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">位深</div>
                    <div class="text-sm text-gray-800 dark:text-gray-200">{{ displaySong.bit_depth ? displaySong.bit_depth + ' bit' : '无' }}</div>
                  </div>
                  <div>
                    <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">采样率</div>
                    <div class="text-sm text-gray-800 dark:text-gray-200">{{ formatSampleRate(displaySong.sample_rate) }}</div>
                  </div>
                  <div>
                    <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">比特率</div>
                    <div class="text-sm text-gray-800 dark:text-gray-200">{{ formatBitrate(displaySong.bitrate) }}</div>
                  </div>
                </div>

                <div class="bg-gray-50/50 dark:bg-white/5 rounded-xl p-4 border border-gray-100 dark:border-gray-800">
                  <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1 no-text-select">文件路径</div>
                  <div class="text-sm text-gray-800 dark:text-gray-200 break-all leading-snug selectable-text">{{ displaySong.path }}</div>
                </div>

                <div class="song-info-time-grid bg-gray-50/50 dark:bg-white/5 rounded-xl p-4 border border-gray-100 dark:border-gray-800 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">添加时间</div>
                    <div class="text-sm text-gray-800 dark:text-gray-200">{{ formatTime(displaySong.added_at) }}</div>
                  </div>
                  <div>
                    <div class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">文件修改时间</div>
                    <div class="text-sm text-gray-800 dark:text-gray-200">{{ formatTime(displaySong.file_modified_at) }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 外置操作区 -->
          <div class="song-info-footer modal-external-actions">
            <button
              v-if="!isSongInfoEditing"
              @click="handleOpenFolder"
              class="modal-action-button modal-action-button--wide"
            >
              <svg class="w-4 h-4 mr-2 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
              </svg>
              打开文件所在目录
            </button>
            <button
              v-if="!isSongInfoEditing"
              @click="handleOpenInMusicTag"
              :disabled="!props.song?.path"
              class="modal-action-button modal-action-button--wide"
            >
              <Tag class="w-4 h-4 mr-2 text-gray-500 dark:text-gray-400" />
              用 MusicTag 修正标签
            </button>
            <template v-else>
              <button
                type="button"
                class="modal-action-button"
                :disabled="isSongInfoSaving"
                @click="cancelSongInfoEdit"
              >
                取消
              </button>
              <button
                type="button"
                class="modal-action-button modal-action-button--primary"
                :disabled="isSongInfoSaving"
                @click="handleSaveSongInfo"
              >
                {{ isSongInfoSaving ? '保存中' : '保存信息' }}
              </button>
            </template>
          </div>
        </section>

        <section class="lyrics-editor-column" :class="isLyricsEditorVisuallyExpanded ? 'lyrics-editor-column--expanded' : ''">
          <div class="modal-external-header lyrics-editor-header">
            <div class="lyrics-editor-heading">
              <div class="lyrics-editor-title" :class="isLyricsEditorVisuallyExpanded ? 'lyrics-editor-title--expanded' : ''">
                编辑歌词
              </div>
              <div
                v-if="displaySong"
                class="lyrics-editor-inline-song"
                :class="isLyricsEditorVisuallyExpanded ? '' : 'lyrics-editor-inline-song--hidden'"
              >
                <div class="lyrics-editor-cover">
                  <img v-if="coverUrl" :src="coverUrl" alt="" draggable="false" />
                  <svg v-else class="h-5 w-5 text-gray-400 dark:text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                  </svg>
                </div>
                <div class="min-w-0">
                  <div class="truncate text-sm font-bold text-gray-900 dark:text-white" :title="displaySong.title || displaySong.name">
                    {{ displaySong.title || displaySong.name }}
                  </div>
                  <div class="truncate text-xs text-gray-500 dark:text-white/50" :title="displaySong.artist">
                    {{ displaySong.artist }}
                  </div>
                </div>
              </div>
            </div>
            <button
              type="button"
              class="lyrics-editor-expand-button"
              :title="isLyricsEditorVisuallyExpanded ? '还原歌词编辑器' : '放大歌词编辑器'"
              @click="toggleLyricsEditorExpanded"
            >
              <svg v-if="!isLyricsEditorVisuallyExpanded" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              </svg>
              <svg v-else class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
              </svg>
            </button>
          </div>

          <aside class="lyrics-editor-panel" :class="isLyricsEditorVisuallyExpanded ? 'lyrics-editor-panel--expanded' : ''">
            <textarea
              v-model="lyricsText"
              class="lyrics-editor-textarea custom-scrollbar"
              :placeholder="isLyricsLoading ? '正在读取歌词...' : '[00:00.00] 在这里编辑 LRC 歌词'"
              :disabled="isLyricsLoading"
              spellcheck="false"
            ></textarea>

            <div v-if="lyricsError" class="lyrics-editor-error">{{ lyricsError }}</div>
          </aside>

          <div class="lyrics-editor-actions modal-external-actions">
            <button
              type="button"
              class="modal-action-button modal-action-button--primary"
              :disabled="!hasLyricsChanged || isLyricsSaving"
              @click="handleSaveLyrics"
            >
              {{ isLyricsSaving ? '保存中' : '保存' }}
            </button>
          </div>
        </section>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cubic-bezier {
  transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
}

.song-info-stage {
  --song-info-footer-height: clamp(44px, 5.8vh, 52px);
  --song-info-footer-gap: clamp(10px, 1.2vh, 14px);
  --song-info-page-gap: clamp(12px, 1.3vw, 18px);
  --song-info-viewport-x: clamp(360px, 26vw, 520px);
  --song-info-viewport-y: clamp(120px, 14vh, 190px);
  --lyrics-panel-width: clamp(340px, 32vw, 460px);
  --song-info-main-width: min(680px, calc(100% - var(--lyrics-panel-width) - var(--song-info-page-gap)));
  --lyrics-editor-panel-bg: rgba(255, 255, 255, 0.82);
  --lyrics-editor-panel-border: rgba(255, 255, 255, 0.38);
  --lyrics-editor-panel-shadow: 0 24px 70px rgba(15, 23, 42, 0.2);
  --modal-external-header-bg: rgba(255, 255, 255, 0.62);
  --modal-external-header-border: rgba(255, 255, 255, 0.42);
  --modal-external-header-shadow: 0 10px 28px rgba(15, 23, 42, 0.12);
  --lyrics-editor-title-color: rgb(17 24 39);
  --lyrics-editor-text-color: rgb(31 41 55);
  --lyrics-editor-placeholder-color: rgb(156 163 175);
  --lyrics-editor-button-bg: rgba(255, 255, 255, 0.72);
  --lyrics-editor-button-border: rgba(148, 163, 184, 0.26);
  --lyrics-editor-button-color: rgb(55 65 81);
  --lyrics-editor-button-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
  --lyrics-editor-expand-bg: rgba(255, 255, 255, 0.68);
  --lyrics-editor-expand-border: rgba(148, 163, 184, 0.22);
  --lyrics-editor-expand-color: rgb(75 85 99);
  position: relative;
  z-index: 2;
  display: flex;
  gap: var(--song-info-page-gap);
  width: min(1360px, calc(100vw - var(--song-info-viewport-x)));
  height: min(1040px, calc(100dvh - var(--song-info-viewport-y)));
  max-height: min(1040px, calc(100dvh - var(--song-info-viewport-y)));
  -webkit-user-select: text;
  user-select: text;
  transform-origin: center center;
  transition:
    gap 360ms cubic-bezier(0.4, 0, 0.2, 1),
    opacity 300ms ease,
    transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.song-info-stage--dark {
  --lyrics-editor-panel-bg: rgba(15, 23, 42, 0.92);
  --lyrics-editor-panel-border: rgba(255, 255, 255, 0.1);
  --lyrics-editor-panel-shadow: 0 24px 70px rgba(0, 0, 0, 0.38);
  --modal-external-header-bg: rgba(15, 23, 42, 0.72);
  --modal-external-header-border: rgba(255, 255, 255, 0.1);
  --modal-external-header-shadow: 0 10px 28px rgba(0, 0, 0, 0.26);
  --lyrics-editor-title-color: rgb(248 250 252);
  --lyrics-editor-text-color: rgba(255, 255, 255, 0.86);
  --lyrics-editor-placeholder-color: rgba(148, 163, 184, 0.72);
  --lyrics-editor-button-bg: rgba(255, 255, 255, 0.06);
  --lyrics-editor-button-border: rgba(255, 255, 255, 0.1);
  --lyrics-editor-button-color: rgba(255, 255, 255, 0.82);
  --lyrics-editor-button-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
  --lyrics-editor-expand-bg: rgba(255, 255, 255, 0.06);
  --lyrics-editor-expand-border: rgba(255, 255, 255, 0.1);
  --lyrics-editor-expand-color: rgba(255, 255, 255, 0.68);
}

.song-info-window-drag-strip {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  z-index: 1;
  height: clamp(56px, 9vh, 92px);
  cursor: default;
}

.song-info-content {
  flex: 1 1 auto;
  min-height: 0;
  padding: clamp(18px, 2.2vw, 24px);
}

.song-info-hero {
  gap: clamp(16px, 2vw, 24px);
}

.song-info-cover {
  width: clamp(96px, 10vw, 128px);
  height: clamp(96px, 10vw, 128px);
}

.song-info-name {
  font-size: clamp(22px, 2.8vw, 30px);
  line-height: 1.18;
}

.song-info-detail-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: clamp(14px, 1.8vw, 24px) clamp(12px, 1.6vw, 16px);
}

.song-info-stage--lyrics-expanded,
.song-info-stage--lyrics-expanding,
.song-info-stage--song-expanded,
.song-info-stage--song-expanding {
  gap: 0;
}

.song-info-stage--lyrics-collapsing,
.song-info-stage--song-collapsing {
  gap: var(--song-info-page-gap);
}

.song-info-stage--lyrics-expanded .song-info-column,
.song-info-stage--lyrics-expanding .song-info-column {
  flex-basis: 0;
  width: 0;
  opacity: 0;
  transform: translateX(-18px);
  pointer-events: none;
}

.song-info-stage--lyrics-collapsing .song-info-column {
  flex-basis: var(--song-info-main-width);
  width: auto;
  opacity: 1;
  transform: translateX(0);
  pointer-events: auto;
}

.song-info-stage--song-expanded .song-info-column,
.song-info-stage--song-expanding .song-info-column {
  flex-basis: 100%;
}

.song-info-stage--song-collapsing .song-info-column {
  flex-basis: var(--song-info-main-width);
}

.song-info-stage--lyrics-expanded .lyrics-editor-column,
.song-info-stage--lyrics-expanding .lyrics-editor-column {
  flex-basis: 100%;
}

.song-info-stage--song-expanded .lyrics-editor-column,
.song-info-stage--song-expanding .lyrics-editor-column {
  flex-basis: 0;
  min-width: 0;
  width: 0;
  opacity: 0;
  transform: translateX(18px);
  pointer-events: none;
}

.song-info-stage--lyrics-collapsing .lyrics-editor-column {
  flex-basis: var(--lyrics-panel-width);
}

.song-info-stage--song-collapsing .lyrics-editor-column {
  flex-basis: var(--lyrics-panel-width);
  opacity: 1;
  transform: translateX(0);
  pointer-events: auto;
}

.song-info-stage--lyrics-expanding .lyrics-editor-textarea,
.song-info-stage--lyrics-collapsing .lyrics-editor-textarea,
.song-info-stage--song-expanding .song-info-content,
.song-info-stage--song-collapsing .song-info-content {
  scrollbar-width: none;
}

.song-info-stage--lyrics-expanding .lyrics-editor-textarea::-webkit-scrollbar,
.song-info-stage--lyrics-collapsing .lyrics-editor-textarea::-webkit-scrollbar,
.song-info-stage--song-expanding .song-info-content::-webkit-scrollbar,
.song-info-stage--song-collapsing .song-info-content::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.song-info-column,
.lyrics-editor-column {
  position: relative;
  display: flex;
  height: 100%;
  min-height: 0;
  max-height: min(860px, calc(100dvh - var(--song-info-viewport-y)));
  flex-direction: column;
  transition:
    flex-basis 360ms cubic-bezier(0.4, 0, 0.2, 1),
    width 360ms cubic-bezier(0.4, 0, 0.2, 1),
    opacity 360ms cubic-bezier(0.4, 0, 0.2, 1),
    transform 360ms cubic-bezier(0.4, 0, 0.2, 1),
    max-height 360ms cubic-bezier(0.4, 0, 0.2, 1);
}

.song-info-main,
.lyrics-editor-panel {
  flex: 1 1 0;
  min-height: 0;
  height: auto;
  max-height: min(860px, calc(100dvh - var(--song-info-viewport-y)));
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    max-height 360ms cubic-bezier(0.4, 0, 0.2, 1);
}

.song-info-column {
  flex: 0 1 var(--song-info-main-width);
  min-width: 0;
  animation: song-info-column-in 520ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.song-info-main {
  overflow: hidden;
}

.lyrics-editor-column {
  flex: 1 1 var(--lyrics-panel-width);
  min-width: min(320px, 100%);
  animation: lyrics-editor-column-in 560ms cubic-bezier(0.16, 1, 0.3, 1) 40ms both;
}

.song-info-stage--lyrics-expanded .lyrics-editor-column {
  max-height: min(860px, calc(100dvh - var(--song-info-viewport-y)));
  height: min(860px, calc(100dvh - var(--song-info-viewport-y)));
}

.lyrics-editor-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--lyrics-editor-panel-border);
  border-radius: 22px;
  background: var(--lyrics-editor-panel-bg);
  box-shadow: var(--lyrics-editor-panel-shadow);
  backdrop-filter: blur(24px) saturate(150%);
  -webkit-backdrop-filter: blur(24px) saturate(150%);
  transform: translateX(0) scale(1);
  transition:
    border-color 160ms ease,
    background-color 160ms ease;
}

.lyrics-editor-panel--expanded {
  transform: translateX(0) scale(1);
}

.modal-external-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 52px;
  padding: 6px 18px;
  margin-bottom: 10px;
  border: 1px solid var(--modal-external-header-border);
  border-radius: 16px;
  background: var(--modal-external-header-bg);
  box-shadow: var(--modal-external-header-shadow);
  backdrop-filter: blur(18px) saturate(145%);
  -webkit-backdrop-filter: blur(18px) saturate(145%);
  flex-shrink: 0;
}

.song-info-header-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.song-info-edit-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  padding: 0;
  color: var(--lyrics-editor-button-color);
  line-height: 1;
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    color 160ms ease;
}

.song-info-edit-toggle:hover,
.song-info-edit-toggle--active {
  background: transparent;
  color: #ec4141;
}

.song-info-cover {
  position: relative;
  padding: 0;
  color: inherit;
  cursor: default;
  /* 开启独立渲染复合层，解决绝对定位子元素引入导致的 Webkit/Chromium 溢出圆角裁剪失效 Bug */
  transform: translateZ(0);
  border-radius: 12px;
  overflow: hidden;
}

.song-info-cover:disabled {
  opacity: 1;
}

.song-info-cover--editable {
  cursor: pointer;
}

.song-info-cover--editable:hover {
  border-color: rgba(236, 65, 65, 0.35);
}

.song-info-cover-overlay {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  background: rgba(15, 23, 42, 0.62);
  color: #fff;
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  /* 显式赋予底部左/右两侧圆角，与外层容器完美的 12px 物理圆角无缝重叠 */
  border-radius: 0 0 12px 12px;
}

.song-info-edit-input {
  width: 100%;
  min-width: 0;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.64);
  padding: 9px 11px;
  color: rgb(17 24 39);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.2;
  outline: none;
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    box-shadow 160ms ease;
}

.song-info-edit-input:focus {
  border-color: rgba(236, 65, 65, 0.45);
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 0 3px rgba(236, 65, 65, 0.1);
}

.song-info-edit-input--title {
  padding: 10px 12px;
  font-size: clamp(21px, 2.6vw, 28px);
  font-weight: 800;
}

.song-info-edit-input--artist {
  font-size: 16px;
}

.song-info-edit-input--compact {
  height: 32px;
  padding: 6px 8px;
  font-size: 13px;
}

.song-info-edit-error {
  margin-bottom: 14px;
  border: 1px solid rgba(236, 65, 65, 0.22);
  border-radius: 12px;
  background: rgba(236, 65, 65, 0.08);
  padding: 10px 12px;
  color: #ec4141;
  font-size: 12px;
  line-height: 1.5;
}

.song-info-stage--dark .song-info-edit-input {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.9);
}

.song-info-stage--dark .song-info-edit-input:focus {
  border-color: rgba(236, 65, 65, 0.42);
  background: rgba(255, 255, 255, 0.1);
}

.lyrics-editor-header {
  padding-right: 18px;
}

.lyrics-editor-heading {
  display: flex;
  align-items: center;
  gap: 18px;
  min-width: 0;
}

.lyrics-editor-expand-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--lyrics-editor-expand-color);
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    color 160ms ease;
}

.lyrics-editor-expand-button:hover {
  background: transparent;
  color: #ec4141;
}

.song-info-stage--dark .lyrics-editor-expand-button:hover {
  border-color: rgba(236, 65, 65, 0.4);
  color: #ff8b8b;
}

.lyrics-editor-title {
  flex-shrink: 0;
  color: var(--lyrics-editor-title-color);
  font-size: 18px;
  font-weight: 800;
  line-height: 1.2;
}

.lyrics-editor-inline-song {
  display: flex;
  align-items: center;
  gap: 12px;
  animation: lyrics-summary-in 160ms ease both;
}

.lyrics-editor-inline-song--hidden {
  opacity: 0;
  visibility: hidden;
}

.lyrics-editor-cover {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 10px;
  background: rgba(148, 163, 184, 0.14);
}

.lyrics-editor-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.lyrics-editor-textarea {
  flex: 1;
  box-sizing: border-box;
  width: 100%;
  min-height: 420px;
  resize: none;
  border: 0;
  background: transparent;
  padding: 18px;
  color: var(--lyrics-editor-text-color);
  font-family: "Sarasa Gothic SC", "Sarasa Mono SC", "Sarasa Gothic", "Sarasa Mono", sans-serif;
  font-size: 13px;
  line-height: 1.7;
  outline: none;
}

.lyrics-editor-panel--expanded .lyrics-editor-textarea {
  min-height: 0;
}

.modal-action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 88px;
  height: 44px;
  border: 1px solid var(--lyrics-editor-button-border);
  border-radius: 10px;
  background: var(--lyrics-editor-button-bg);
  box-shadow: var(--lyrics-editor-button-shadow);
  padding: 0 16px;
  color: var(--lyrics-editor-button-color);
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
  backdrop-filter: blur(16px) saturate(145%);
  -webkit-backdrop-filter: blur(16px) saturate(145%);
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    color 160ms ease,
    box-shadow 160ms ease;
}

@keyframes lyrics-summary-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes song-info-column-in {
  from {
    transform: translateX(-24px);
  }

  to {
    transform: translateX(0);
  }
}

@keyframes lyrics-editor-column-in {
  from {
    transform: translateX(24px);
  }

  to {
    transform: translateX(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .song-info-stage,
  .song-info-column,
  .lyrics-editor-column,
  .lyrics-editor-panel {
    transition-duration: 0ms;
  }

  .song-info-column,
  .lyrics-editor-column,
  .lyrics-editor-inline-song {
    animation: none;
  }
}

.lyrics-editor-textarea::placeholder {
  color: var(--lyrics-editor-placeholder-color);
}

.lyrics-editor-error {
  margin: 0 18px 12px;
  border: 1px solid rgba(236, 65, 65, 0.22);
  border-radius: 12px;
  background: rgba(236, 65, 65, 0.08);
  padding: 10px 12px;
  color: #ec4141;
  font-size: 12px;
  line-height: 1.5;
}

.modal-external-actions {
  position: absolute;
  top: calc(100% + var(--song-info-footer-gap));
  right: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: var(--song-info-footer-height);
  background: transparent;
  pointer-events: auto;
}

.lyrics-editor-actions {
  gap: clamp(10px, 1.4vw, 20px);
}

.modal-action-button--wide {
  min-width: 184px;
}

.modal-action-button:hover:not(:disabled) {
  border-color: rgba(236, 65, 65, 0.38);
  color: #ec4141;
}

.modal-action-button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.modal-action-button--primary {
  border-color: transparent;
  background: #ec4141;
  color: #fff;
}

.song-info-stage--dark .modal-action-button--primary {
  background: #ec4141;
  color: #fff;
}

@media (max-width: 1100px) {
  .song-info-stage {
    --song-info-footer-height: clamp(42px, 6vh, 48px);
    --song-info-footer-gap: 10px;
    --song-info-viewport-x: clamp(180px, 24vw, 280px);
    --song-info-viewport-y: clamp(120px, 20vh, 190px);
    flex-direction: column;
    overflow-y: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
    width: min(100%, calc(100vw - var(--song-info-viewport-x)));
    height: calc(100dvh - var(--song-info-viewport-y));
    max-height: calc(100dvh - var(--song-info-viewport-y));
  }

  .song-info-stage::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }

  .modal-external-actions {
    position: static;
    justify-content: center;
    margin-top: var(--song-info-footer-gap);
  }

  .song-info-stage--lyrics-expanded .song-info-column,
  .song-info-stage--lyrics-expanding .song-info-column {
    position: absolute;
    inset: 0;
  }

  .song-info-column,
  .lyrics-editor-column,
  .song-info-main,
  .lyrics-editor-panel {
    max-height: none;
  }

  .song-info-column,
  .song-info-stage--lyrics-collapsing .song-info-column {
    flex: 0 0 auto;
    width: 100%;
    height: auto;
  }

  .song-info-main {
    flex: 0 0 auto;
    height: auto;
    overflow: visible;
  }

  .song-info-content {
    overflow: visible;
  }

  .lyrics-editor-column,
  .song-info-stage--lyrics-collapsing .lyrics-editor-column {
    flex: 0 0 min(440px, calc(100dvh - var(--song-info-viewport-y)));
    width: 100%;
    min-width: 0;
    min-height: 360px;
  }

  .song-info-stage--lyrics-expanded .lyrics-editor-column,
  .song-info-stage--lyrics-expanding .lyrics-editor-column {
    flex-basis: auto;
    max-height: calc(100dvh - var(--song-info-viewport-y));
    height: calc(100dvh - var(--song-info-viewport-y));
  }

  .lyrics-editor-textarea {
    min-height: 280px;
  }

  .lyrics-editor-panel--expanded .lyrics-editor-textarea {
    min-height: 0;
  }

  .lyrics-editor-heading {
    gap: 12px;
  }
}

@media (max-width: 760px) {
  .song-info-stage {
    --song-info-viewport-x: clamp(96px, 20vw, 132px);
    --song-info-viewport-y: clamp(72px, 16vh, 112px);
    --song-info-footer-height: 42px;
    border-radius: 18px;
  }

  .song-info-hero {
    flex-direction: row;
    align-items: center;
    gap: 14px;
  }

  .song-info-cover {
    width: 84px;
    height: 84px;
  }

  .song-info-name {
    font-size: 22px;
  }

  .song-info-detail-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .song-info-footer,
  .lyrics-editor-actions {
    gap: 8px;
  }

  .modal-action-button {
    min-width: 76px;
    height: 38px;
    padding-inline: 11px;
    font-size: 13px;
  }

  .modal-action-button--wide {
    min-width: 152px;
  }
}

@media (max-width: 520px) {
  .song-info-stage {
    --song-info-viewport-x: 64px;
    --song-info-viewport-y: 56px;
    --song-info-footer-height: 42px;
    border-radius: 16px;
  }

  .song-info-content {
    padding: 12px;
  }

  .song-info-hero {
    gap: 10px;
  }

  .song-info-cover {
    width: 64px;
    height: 64px;
  }

  .song-info-detail-grid,
  .song-info-time-grid {
    grid-template-columns: 1fr;
  }

  .modal-action-button--wide {
    min-width: 0;
  }

  .modal-external-header {
    min-height: 48px;
    padding: 5px 14px;
  }

  .lyrics-editor-expand-button {
    width: 32px;
    height: 32px;
  }
}

@media (max-height: 720px) {
  .song-info-stage {
    --song-info-footer-height: 42px;
    --song-info-viewport-y: clamp(88px, 18vh, 140px);
  }

  .modal-external-header {
    min-height: 48px;
    padding-block: 5px;
  }

  .lyrics-editor-textarea {
    min-height: 220px;
    padding-block: 14px;
  }

  .song-info-cover {
    width: clamp(84px, 12vh, 112px);
    height: clamp(84px, 12vh, 112px);
  }
}

.song-info-edit-wrapper {
  position: relative;
  width: 100%;
}

.song-info-edit-label {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 11px;
  font-weight: 700;
  color: #94a3b8;
  letter-spacing: 0.05em;
  pointer-events: none;
  user-select: none;
  transition:
    color 160ms ease,
    opacity 160ms ease;
  z-index: 1;
}

.song-info-edit-wrapper:focus-within .song-info-edit-label {
  color: #ec4141;
}

.song-info-edit-input--with-label {
  padding-left: 56px;
}

.song-info-stage--dark .song-info-edit-label {
  color: rgba(255, 255, 255, 0.4);
}

.song-info-stage--dark .song-info-edit-wrapper:focus-within .song-info-edit-label {
  color: #ec4141;
}

/* 精细防文本误选中与防图片拖拽新增样式 */
.no-text-select {
  -webkit-user-select: none;
  user-select: none;
}

.selectable-text {
  -webkit-user-select: text;
  user-select: text;
}

.modal-external-header,
.song-info-header-title,
.song-info-edit-toggle,
.lyrics-editor-expand-button,
.lyrics-editor-inline-song,
.song-info-cover,
.song-info-cover-overlay,
.song-info-detail-grid,
.song-info-time-grid,
.modal-external-actions,
.modal-action-button {
  -webkit-user-select: none;
  user-select: none;
}

.song-info-stage input,
.song-info-stage textarea,
.song-info-stage [contenteditable='true'],
.song-info-stage .selectable-text {
  -webkit-user-select: text;
  user-select: text;
}

.song-info-cover img {
  -webkit-user-drag: none;
  user-drag: none;
  /* 显式强制赋予 12px 物理圆角，建立第二道物理裁剪防线，杜绝任何直角溢出 */
  border-radius: 12px;
}

.lyrics-editor-cover img {
  -webkit-user-drag: none;
  user-drag: none;
}
</style>
