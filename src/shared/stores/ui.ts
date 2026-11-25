import { ref } from 'vue';
import { defineStore } from 'pinia';

export const SIDEBAR_MIN_WIDTH = 192;
export const SIDEBAR_MAX_WIDTH = 360;

export const defaultDominantColors = ['transparent', 'transparent', 'transparent', 'transparent'];

export const useUiStore = defineStore('ui', () => {
  const sidebarWidth = ref(SIDEBAR_MIN_WIDTH);
  const showPlaylist = ref(false);
  const showMiniPlaylist = ref(false);
  const showPlayerDetail = ref(false);
  // Keep the selected detail layout through page changes and player remounts.
  const isPlayerCoverFocused = ref(false);
  const showVolumePopover = ref(false);
  const skipNextPageTransition = ref(false);
  const startupCompositionMaskVisible = ref(false);
  const dominantColors = ref<string[]>([...defaultDominantColors]);

  function setSidebarWidth(width: number) {
    if (!Number.isFinite(width)) return;
    sidebarWidth.value = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width));
  }

  return {
    sidebarWidth,
    setSidebarWidth,
    showPlaylist,
    showMiniPlaylist,
    showPlayerDetail,
    isPlayerCoverFocused,
    showVolumePopover,
    skipNextPageTransition,
    startupCompositionMaskVisible,
    dominantColors,
  };
});
