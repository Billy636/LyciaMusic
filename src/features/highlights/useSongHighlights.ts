import { invoke } from '@tauri-apps/api/core';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';

import type { Song, SongHighlightMarker } from '../../types';
import { usePlaybackController } from '../playback/usePlaybackController';
import { usePlaybackStore } from '../playback/store';

const NOTICE_DURATION_MS = 5_000;

interface AddSongHighlightResult {
  markers: SongHighlightMarker[];
  markerId: string;
  created: boolean;
  previousPositionMs: number | null;
}

interface HighlightNotice {
  path: string;
  markerId: string;
  created: boolean;
  previousPositionMs: number | null;
  label: string;
}

const markers = ref<SongHighlightMarker[]>([]);
const isLoading = ref(false);
const notice = ref<HighlightNotice | null>(null);
let initialized = false;
let loadSequence = 0;
let noticeTimer: ReturnType<typeof window.setTimeout> | null = null;
let noticeStartedAt = 0;
let noticeRemainingMs = NOTICE_DURATION_MS;

const errorMessage = (error: unknown) => (
  error instanceof Error ? error.message : String(error)
);

const isHighlightSupported = (song: Song | null | undefined) => !!song
  && song.source_type !== 'remote'
  && !song.cue_source_path
  && !song.path.includes('::track');

const clearNoticeTimer = () => {
  if (noticeTimer !== null) {
    window.clearTimeout(noticeTimer);
    noticeTimer = null;
  }
};

const closeNotice = () => {
  clearNoticeTimer();
  notice.value = null;
  noticeRemainingMs = NOTICE_DURATION_MS;
};

const startNoticeTimer = (duration = NOTICE_DURATION_MS) => {
  clearNoticeTimer();
  noticeRemainingMs = duration;
  noticeStartedAt = Date.now();
  noticeTimer = window.setTimeout(closeNotice, duration);
};

const pauseNoticeTimer = () => {
  if (noticeTimer === null) return;
  noticeRemainingMs = Math.max(0, noticeRemainingMs - (Date.now() - noticeStartedAt));
  clearNoticeTimer();
};

const resumeNoticeTimer = () => {
  if (!notice.value || noticeTimer !== null) return;
  startNoticeTimer(Math.max(250, noticeRemainingMs));
};

const formatMarkerTime = (positionMs: number) => {
  const totalTenths = Math.max(0, Math.round(positionMs / 100));
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${tenths}`;
};

export function useSongHighlights() {
  const playbackStore = usePlaybackStore();
  const { currentSong, currentTime } = storeToRefs(playbackStore);
  const { isPlaying, seekTo, togglePlay } = usePlaybackController();

  const loadMarkers = async (song = currentSong.value) => {
    const sequence = ++loadSequence;
    closeNotice();
    if (!song || !isHighlightSupported(song)) {
      markers.value = [];
      isLoading.value = false;
      return;
    }

    isLoading.value = true;
    try {
      const nextMarkers = await invoke<SongHighlightMarker[]>('get_song_highlight_markers', {
        path: song.path,
      });
      if (sequence === loadSequence && currentSong.value?.path === song.path) {
        markers.value = nextMarkers;
      }
    } finally {
      if (sequence === loadSequence) {
        isLoading.value = false;
      }
    }
  };

  if (!initialized) {
    initialized = true;
    watch(
      () => currentSong.value?.path,
      () => {
        void loadMarkers().catch(() => {
          markers.value = [];
        });
      },
      { immediate: true },
    );
  }

  const requireSupportedSong = () => {
    const song = currentSong.value;
    if (!song) {
      throw new Error('当前没有可打点的歌曲');
    }
    if (song.source_type === 'remote') {
      throw new Error('远程歌曲暂不支持高潮打点');
    }
    if (song.cue_source_path || song.path.includes('::track')) {
      throw new Error('CUE 分轨暂不支持高潮打点');
    }
    return song;
  };

  const playMarker = async (marker: SongHighlightMarker) => {
    await seekTo(marker.positionMs / 1000);
    if (!isPlaying.value) {
      await togglePlay();
    }
  };

  const addMarker = async (positionMs: number, showAdjustmentNotice = true) => {
    const song = requireSupportedSong();
    const result = await invoke<AddSongHighlightResult>('add_song_highlight_marker', {
      path: song.path,
      positionMs: Math.max(0, Math.round(positionMs)),
      durationMs: Math.max(0, Math.round(song.duration * 1000)),
    });
    markers.value = result.markers;

    if (showAdjustmentNotice) {
      const marker = result.markers.find(candidate => candidate.id === result.markerId);
      notice.value = {
        path: song.path,
        markerId: result.markerId,
        created: result.created,
        previousPositionMs: result.previousPositionMs,
        label: result.created
          ? `已添加${marker?.isPrimary ? '主高潮' : '普通标记'}`
          : `已更新${marker?.isPrimary ? '主高潮' : '普通标记'}`,
      };
      startNoticeTimer();
    }
    return result;
  };

  const addAtCurrentTime = (showAdjustmentNotice = true) => (
    addMarker(currentTime.value * 1000, showAdjustmentNotice)
  );

  const moveMarker = async (markerId: string, positionMs: number, playAfterMove = true) => {
    const song = requireSupportedSong();
    const nextMarkers = await invoke<SongHighlightMarker[]>('set_song_highlight_marker_position', {
      path: song.path,
      markerId,
      positionMs: Math.max(0, Math.round(positionMs)),
      durationMs: Math.max(0, Math.round(song.duration * 1000)),
    });
    markers.value = nextMarkers;
    const marker = nextMarkers.find(candidate => candidate.id === markerId);
    if (playAfterMove && marker) {
      await playMarker(marker);
    }
    return marker;
  };

  const adjustRecentMarker = async (deltaMs: number) => {
    const activeNotice = notice.value;
    if (!activeNotice || activeNotice.path !== currentSong.value?.path) return;
    const marker = markers.value.find(candidate => candidate.id === activeNotice.markerId);
    if (!marker) return;
    await moveMarker(marker.id, marker.positionMs + deltaMs, true);
    startNoticeTimer();
  };

  const undoRecentMutation = async () => {
    const activeNotice = notice.value;
    const song = currentSong.value;
    if (!activeNotice || !song || activeNotice.path !== song.path) return;
    markers.value = await invoke<SongHighlightMarker[]>('undo_song_highlight_add', {
      path: song.path,
      markerId: activeNotice.markerId,
      created: activeNotice.created,
      previousPositionMs: activeNotice.previousPositionMs,
    });
    closeNotice();
  };

  const makePrimary = async (markerId: string) => {
    const song = requireSupportedSong();
    markers.value = await invoke<SongHighlightMarker[]>('set_song_highlight_primary', {
      path: song.path,
      markerId,
    });
  };

  const deleteMarker = async (markerId: string) => {
    const song = requireSupportedSong();
    markers.value = await invoke<SongHighlightMarker[]>('delete_song_highlight_marker', {
      path: song.path,
      markerId,
    });
    if (notice.value?.markerId === markerId) {
      closeNotice();
    }
  };

  const playPrimary = async () => {
    requireSupportedSong();
    let primary = markers.value.find(marker => marker.isPrimary);
    if (!primary) {
      await loadMarkers();
      primary = markers.value.find(marker => marker.isPrimary);
    }
    if (!primary) {
      throw new Error('当前歌曲未设置主高潮');
    }
    await playMarker(primary);
  };

  const noticeMarker = computed(() => (
    notice.value
      ? markers.value.find(marker => marker.id === notice.value?.markerId) ?? null
      : null
  ));

  return {
    markers,
    isLoading,
    notice,
    noticeMarker,
    isHighlightSupported,
    formatMarkerTime,
    errorMessage,
    loadMarkers,
    addMarker,
    addAtCurrentTime,
    playMarker,
    playPrimary,
    moveMarker,
    adjustRecentMarker,
    undoRecentMutation,
    makePrimary,
    deleteMarker,
    closeNotice,
    pauseNoticeTimer,
    resumeNoticeTimer,
  };
}
