import { storeToRefs } from 'pinia';

import { usePlayerCore } from '../../composables/playerCore';
import { usePlaybackStore } from './store';
import { useUiStore } from '../../shared/stores/ui';

export function usePlaybackController() {
  const { playbackDomain, windowDomain } = usePlayerCore();
  const playbackStore = usePlaybackStore();
  const uiStore = useUiStore();
  const playbackRefs = storeToRefs(playbackStore);
  const uiRefs = storeToRefs(uiStore);

  const closePlayerDetail = () => {
    uiRefs.showPlayerDetail.value = false;
  };

  return {
    currentSong: playbackRefs.currentSong,
    currentCover: playbackRefs.currentCover,
    currentCoverPath: playbackRefs.currentCoverPath,
    currentCoverFull: playbackRefs.currentCoverFull,
    isPlaying: playbackRefs.isPlaying,
    volume: playbackRefs.volume,
    currentTime: playbackRefs.currentTime,
    playMode: playbackRefs.playMode,
    playQueue: playbackRefs.playQueue,
    showPlaylist: uiRefs.showPlaylist,
    showPlayerDetail: uiRefs.showPlayerDetail,
    showQueue: uiRefs.showQueue,
    dominantColors: uiRefs.dominantColors,
    playSong: playbackDomain.playSong,
    pauseSong: playbackDomain.pauseSong,
    togglePlay: playbackDomain.togglePlay,
    nextSong: playbackDomain.nextSong,
    prevSong: playbackDomain.prevSong,
    seekTo: playbackDomain.seekTo,
    stepSeek: playbackDomain.stepSeek,
    handleVolume: playbackDomain.handleVolume,
    handleVolumeWheel: playbackDomain.handleVolumeWheel,
    toggleMute: playbackDomain.toggleMute,
    toggleMode: playbackDomain.toggleMode,
    togglePlaylist: playbackDomain.togglePlaylist,
    togglePlayerDetail: windowDomain.togglePlayerDetail,
    closePlayerDetail,
    toggleQueue: windowDomain.toggleQueue,
    toggleAlwaysOnTop: windowDomain.toggleAlwaysOnTop,
    clearQueue: playbackDomain.clearQueue,
    addSongToQueue: playbackDomain.addSongToQueue,
    addSongsToQueue: playbackDomain.addSongsToQueue,
    addSongPathsToQueue: playbackDomain.addSongPathsToQueue,
    removeSongFromQueue: playbackDomain.removeSongFromQueue,
    playNext: playbackDomain.playNext,
    formatDuration: playbackDomain.formatDuration,
  };
}
