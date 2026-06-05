import type { Ref } from 'vue';

import type { Song } from '../../types';
import { useLibraryStore } from '../library/store';
import { useToast } from '../../composables/toast';

interface PlayerPlaybackApi {
  playSong: (song: Song, options?: {
    updateShuffleHistory?: boolean;
    clearShuffleFuture?: boolean;
    preserveQueue?: boolean;
    insertAfterCurrent?: boolean;
  }) => Promise<unknown>;
  pauseSong: () => Promise<unknown>;
  togglePlay: () => Promise<unknown>;
  seekTo: (newTime: number) => Promise<unknown>;
  playAt: (time: number) => Promise<unknown>;
  handleSeek: (event: MouseEvent) => Promise<unknown>;
  stepSeek: (step: number) => Promise<unknown>;
}

interface PlayerQueueApi {
  toggleMode: () => void;
  playNext: (song: Song) => void;
  nextSong: () => void;
  prevSong: () => void;
  clearQueue: () => Promise<unknown>;
  removeSongFromQueue: (song: Song) => void;
  addSongToQueue: (song: Song) => void;
  addSongsToQueue: (songs: Song[]) => void;
}

interface PlayerUiShellApi {
  handleVolume: (event: Event) => Promise<unknown>;
  handleVolumeWheel: (event: WheelEvent) => Promise<unknown>;
  toggleMute: () => Promise<unknown>;
  togglePlaylist: () => void;
  toggleMiniPlaylist: () => void;
  closeMiniPlaylist: () => void;
  handleScan: () => Promise<unknown>;
  removeSongFromList: (song: Song) => Promise<unknown>;
}

interface UsePlaybackActionsOptions {
  currentSong: Ref<Song | null>;
  playMode: Ref<number>;
  getPlayerPlayback: () => PlayerPlaybackApi;
  getPlayerQueue: () => PlayerQueueApi;
  playerUiShell: PlayerUiShellApi;
}

export function usePlaybackActions({
  currentSong,
  playMode,
  getPlayerPlayback,
  getPlayerQueue,
  playerUiShell,
}: UsePlaybackActionsOptions) {
  const handleAutoNext = () => {
    if (playMode.value === 1 && currentSong.value) {
      void getPlayerPlayback().playSong(currentSong.value);
      return;
    }

    getPlayerQueue().nextSong();
  };

  const handleVolume = (event: Event) => playerUiShell.handleVolume(event);
  const handleVolumeWheel = (event: WheelEvent) => playerUiShell.handleVolumeWheel(event);
  const toggleMute = () => playerUiShell.toggleMute();
  const toggleMode = () => getPlayerQueue().toggleMode();
  const togglePlaylist = () => playerUiShell.togglePlaylist();
  const toggleMiniPlaylist = () => playerUiShell.toggleMiniPlaylist();
  const closeMiniPlaylist = () => playerUiShell.closeMiniPlaylist();
  const handleScan = () => playerUiShell.handleScan();
  const playNext = (song: Song) => getPlayerQueue().playNext(song);
  const removeSongFromList = (song: Song) => playerUiShell.removeSongFromList(song);
  const playSong = (song: Song, options?: {
    updateShuffleHistory?: boolean;
    clearShuffleFuture?: boolean;
    preserveQueue?: boolean;
    insertAfterCurrent?: boolean;
  }) =>
    getPlayerPlayback().playSong(song, options);
  const pauseSong = () => getPlayerPlayback().pauseSong();
  const togglePlay = () => getPlayerPlayback().togglePlay();
  const nextSong = () => getPlayerQueue().nextSong();
  const prevSong = () => getPlayerQueue().prevSong();
  const clearQueue = () => getPlayerQueue().clearQueue();
  const removeSongFromQueue = (song: Song) => getPlayerQueue().removeSongFromQueue(song);
  const addSongToQueue = (song: Song) => getPlayerQueue().addSongToQueue(song);
  const addSongsToQueue = (songs: Song[]) => getPlayerQueue().addSongsToQueue(songs);

  const addAlbumToQueueTail = (song: Song) => {
    const libraryStore = useLibraryStore();
    const { showToast } = useToast();

    if (!song) return;

    const albumKey = song.album_key || `${song.album || 'Unknown'}::${song.album_artist || song.artist || 'Unknown'}`;
    if (!albumKey) return;

    const albumSongs = libraryStore.canonicalSongs.filter((s) => {
      const sAlbumKey = s.album_key || `${s.album || 'Unknown'}::${s.album_artist || s.artist || 'Unknown'}`;
      return sAlbumKey === albumKey;
    });

    if (albumSongs.length === 0) {
      showToast('未找到该专辑的歌曲', 'info');
      return;
    }

    const parseNumber = (val: string | number | undefined | null, fallback: number = 0): number => {
      if (val === undefined || val === null) return fallback;
      if (typeof val === 'number') return val;
      const match = val.trim().match(/^\d+/);
      if (!match) return fallback;
      const parsed = Number.parseInt(match[0], 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const sortedSongs = [...albumSongs].sort((left, right) => {
      const leftDisc = parseNumber(left.disc_number, 1);
      const rightDisc = parseNumber(right.disc_number, 1);
      if (leftDisc !== rightDisc) {
        return leftDisc - rightDisc;
      }

      const leftTrack = parseNumber(left.track_number, Infinity);
      const rightTrack = parseNumber(right.track_number, Infinity);
      if (leftTrack !== rightTrack) {
        return leftTrack - rightTrack;
      }

      const leftTitle = left.title || left.name || '';
      const rightTitle = right.title || right.name || '';
      return leftTitle.localeCompare(rightTitle, 'zh-CN') || left.path.localeCompare(right.path, 'zh-CN');
    });

    getPlayerQueue().addSongsToQueue(sortedSongs);
    showToast(`已将专辑《${song.album || '未知专辑'}》添加到播放队尾`, 'success');
  };

  const seekTo = (newTime: number) => getPlayerPlayback().seekTo(newTime);
  const playAt = (time: number) => getPlayerPlayback().playAt(time);
  const handleSeek = (event: MouseEvent) => getPlayerPlayback().handleSeek(event);
  const stepSeek = (step: number) => getPlayerPlayback().stepSeek(step);

  return {
    handleAutoNext,
    handleVolume,
    handleVolumeWheel,
    toggleMute,
    toggleMode,
    togglePlaylist,
    toggleMiniPlaylist,
    closeMiniPlaylist,
    handleScan,
    playNext,
    removeSongFromList,
    playSong,
    pauseSong,
    togglePlay,
    nextSong,
    prevSong,
    clearQueue,
    removeSongFromQueue,
    addSongToQueue,
    addSongsToQueue,
    addAlbumToQueueTail,
    seekTo,
    playAt,
    handleSeek,
    stepSeek,
  };
}
