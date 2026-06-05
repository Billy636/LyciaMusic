import { computed } from 'vue';
import { storeToRefs } from 'pinia';

import { usePlayer } from './player';
import { useAppThemeSync } from './useAppThemeSync';
import { useExternalPathBridge } from './useExternalPathBridge';
import { useAppShellTheme } from './useAppShellTheme';
import { useMiniPlayerWindowBridge } from './useMiniPlayerWindowBridge';
import { useTaskbarPlayerBridge } from './useTaskbarPlayerBridge';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { useTrayMenuEvents } from './useTrayMenuEvents';
import { useAddToPlaylistDialog } from '../features/collections/addToPlaylistDialog';
import { useHomeRouteSync } from './useHomeRouteSync';
import { usePlayerViewState } from './usePlayerViewState';
import { usePlayerLibraryView } from '../features/library/usePlayerLibraryView';
import { useRoute, useRouter } from 'vue-router';
import { shouldShowPlayerFooter } from './appShellFooterState';
import { runStartupRouteRepaint } from './startupRouteRepaint';
import { releaseStartupCompositionMask, waitForStartupRevealReadiness } from './startupCompositionMask';
import { clearStartupThemePaint } from './startupTheme';
import { useUiStore } from '../shared/stores/ui';
import { useMainWindowRenderingPower } from './renderingPower';

export function useAppShell() {
  const {
    init,
    playQueue,
    currentSong,
    isMiniMode,
    showPlayerDetail,
    handleExternalPaths,
    libraryScanProgress,
  } = usePlayer();
  const {
    showAddToPlaylistModal,
    playlistAddTargetSongs,
    closeAddToPlaylistDialog,
    addSelectedSongsToPlaylist,
  } = useAddToPlaylistDialog();

  const {
    hasWindowMaterial,
    isMicaWindowMaterial,
    whenInitialThemeSynced,
    rebuildStartupMaterialBeforeShow,
  } = useAppThemeSync();
  const {
    mainBlurStyle,
    mainContainerClass,
    footerBlurStyle,
    footerContainerClass,
  } = useAppShellTheme({
    showPlayerDetail,
    hasWindowMaterial,
    isMicaWindowMaterial,
  });

  const route = useRoute();
  const router = useRouter();
  const { skipNextPageTransition, startupCompositionMaskVisible } = storeToRefs(useUiStore());
  const { currentViewMode, filterCondition, currentFolderFilter, activeRootPath } = usePlayerViewState();
  const { folderTree, searchQuery } = usePlayerLibraryView();
  let startupCompositionMaskStartedAt = 0;

  useMainWindowRenderingPower();

  const prepareStartupTransparentComposition = async () => {
    await whenInitialThemeSynced();
    startupCompositionMaskVisible.value = hasWindowMaterial.value;
    startupCompositionMaskStartedAt = startupCompositionMaskVisible.value ? performance.now() : 0;
    clearStartupThemePaint();
    await runStartupRouteRepaint({
      router,
      hasWindowMaterial,
      skipNextPageTransition,
    });
    if (hasWindowMaterial.value) {
      await rebuildStartupMaterialBeforeShow();
      await waitForStartupRevealReadiness();
    }
  };

  const finishStartupTransparentComposition = async () => {
    if (!startupCompositionMaskVisible.value) {
      return;
    }

    void releaseStartupCompositionMask({
      startedAt: startupCompositionMaskStartedAt,
      hide: () => {
        startupCompositionMaskVisible.value = false;
      },
    });
  };

  const { isExternalDragActive } = useExternalPathBridge({
    handleExternalPaths,
    beforeWindowShow: prepareStartupTransparentComposition,
    afterWindowShow: finishStartupTransparentComposition,
  });

  useHomeRouteSync({
    route,
    router,
    currentViewMode,
    filterCondition,
    currentFolderFilter,
    activeRootPath,
    folderTree,
    searchQuery,
  });

  useMiniPlayerWindowBridge();
  useTaskbarPlayerBridge();
  useKeyboardShortcuts();
  useTrayMenuEvents(router);

  init();

  const isFooterVisible = computed(() => shouldShowPlayerFooter(playQueue.value, currentSong.value));
  const libraryScanPercent = computed(() => {
    if (!libraryScanProgress.value) return 0;
    if (libraryScanProgress.value.total <= 0) return 8;
    const percent = (libraryScanProgress.value.current / libraryScanProgress.value.total) * 100;
    return Math.min(100, Math.max(6, percent));
  });
  const libraryScanPhaseLabel = computed(() => {
    switch (libraryScanProgress.value?.phase) {
      case 'collecting':
        return '扫描文件';
      case 'parsing':
        return '解析元数据';
      case 'writing':
        return '写入音乐库';
      case 'complete':
        return '扫描完成';
      case 'error':
        return '扫描失败';
      default:
        return '扫描音乐库';
    }
  });
  const libraryScanFolderLabel = computed(() => {
    if (!libraryScanProgress.value || libraryScanProgress.value.folder_total <= 1) {
      return '';
    }

    return `文件夹 ${libraryScanProgress.value.folder_index}/${libraryScanProgress.value.folder_total}`;
  });

  const handleGlobalAdd = (playlistId: string) => {
    addSelectedSongsToPlaylist(playlistId);
  };

  return {
    isMiniMode,
    showPlayerDetail,
    isExternalDragActive,
    libraryScanProgress,
    libraryScanPhaseLabel,
    libraryScanFolderLabel,
    libraryScanPercent,
    isFooterVisible,
    mainContainerClass,
    mainBlurStyle,
    footerContainerClass,
    footerBlurStyle,
    showAddToPlaylistModal,
    playlistAddTargetSongs,
    closeAddToPlaylistDialog,
    handleGlobalAdd,
  };
}
