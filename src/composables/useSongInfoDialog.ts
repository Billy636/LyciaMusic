import { ref } from 'vue';
import type { Song } from '../types';

const isSongInfoVisible = ref(false);
const currentSongInfo = ref<Song | null>(null);

export function useSongInfoDialog() {
  const openSongInfo = (song: Song) => {
    currentSongInfo.value = song;
    isSongInfoVisible.value = true;
  };

  const closeSongInfo = () => {
    isSongInfoVisible.value = false;
    // 延迟清理对象以保持关闭动画过渡的平滑性
    setTimeout(() => {
      if (!isSongInfoVisible.value) currentSongInfo.value = null;
    }, 300);
  };

  const updateSongInfo = (song: Song) => {
    if (isSongInfoVisible.value && currentSongInfo.value?.path === song.path) {
      currentSongInfo.value = { ...song };
    }
  };

  return {
    isSongInfoVisible,
    currentSongInfo,
    openSongInfo,
    closeSongInfo,
    updateSongInfo,
  };
}
