import {
  computed,
  onUnmounted,
  ref,
  watch,
  type Ref,
} from 'vue';
import { storeToRefs } from 'pinia';

import type { ScanLibraryOptions } from '../../composables/playerLibraryScan';
import type { Song } from '../../types';
import { useLibraryStore } from './store';

const HERO_MIN_VISIBLE_MS = 700;
const HERO_SUCCESS_DWELL_MS = 900;

interface UseSongTableLibraryStateOptions {
  currentViewMode: Ref<string>;
  searchQuery: Ref<string>;
  librarySongs: Ref<Song[]>;
  addLibraryFolder: () => Promise<unknown>;
  scanLibrary: (options?: ScanLibraryOptions) => Promise<unknown>;
}

export function useSongTableLibraryState({
  currentViewMode,
  searchQuery,
  librarySongs,
  addLibraryFolder,
  scanLibrary,
}: UseSongTableLibraryStateOptions) {
  const libraryStore = useLibraryStore();
  const { libraryFolders, libraryScanProgress, libraryScanSession } = storeToRefs(libraryStore);
  const showHeroScanCard = ref(false);
  let heroScanHideTimer: ReturnType<typeof setTimeout> | null = null;

  const hasSearchQuery = computed(() => searchQuery.value.trim().length > 0);
  const isLibraryEmpty = computed(() =>
    libraryStore.canonicalSongPaths.length === 0 && librarySongs.value.length === 0,
  );
  const isLibraryScanRunning = computed(() =>
    !!libraryScanProgress.value && !libraryScanProgress.value.done && !libraryScanProgress.value.failed,
  );
  const hasHeroLibrarySession = computed(() =>
    libraryScanSession.value?.trigger === 'first-import'
    && libraryScanSession.value?.visibility === 'hero',
  );
  const isHeroLibraryScan = computed(() =>
    currentViewMode.value === 'all'
    && hasHeroLibrarySession.value,
  );
  const isSilentBootstrapScan = computed(() =>
    currentViewMode.value === 'all'
    && libraryScanSession.value?.trigger === 'bootstrap'
    && libraryScanSession.value?.visibility === 'silent'
    && isLibraryScanRunning.value,
  );
  const showLibraryOnboarding = computed(
    () =>
      currentViewMode.value === 'all'
      && !hasSearchQuery.value
      && isLibraryEmpty.value
      && libraryFolders.value.length === 0
      && !showHeroScanCard.value,
  );
  const showFolderEmpty = computed(() => currentViewMode.value === 'folder' && !hasSearchQuery.value);
  const showLibraryChecking = computed(
    () =>
      currentViewMode.value === 'all'
      && !hasSearchQuery.value
      && isLibraryEmpty.value
      && libraryFolders.value.length > 0
      && isSilentBootstrapScan.value
      && !showHeroScanCard.value,
  );
  const showLibraryEmptyResult = computed(
    () =>
      currentViewMode.value === 'all'
      && !hasSearchQuery.value
      && isLibraryEmpty.value
      && libraryFolders.value.length > 0
      && !showLibraryChecking.value
      && !showHeroScanCard.value,
  );
  const libraryScanPercent = computed(() => {
    if (!libraryScanProgress.value) return 0;
    if (libraryScanProgress.value.total <= 0) return 12;
    const percent = (libraryScanProgress.value.current / libraryScanProgress.value.total) * 100;
    return Math.min(100, Math.max(8, percent));
  });
  const libraryScanPhaseLabel = computed(() => {
    switch (libraryScanProgress.value?.phase) {
      case 'collecting':
        return '\u626b\u63cf\u6587\u4ef6';
      case 'parsing':
        return '\u89e3\u6790\u4fe1\u606f';
      case 'writing':
        return '\u5199\u5165\u97f3\u4e50\u5e93';
      case 'complete':
        return '\u5bfc\u5165\u5b8c\u6210';
      case 'error':
        return '\u5bfc\u5165\u5931\u8d25';
      default:
        return '\u51c6\u5907\u5bfc\u5165';
    }
  });
  const libraryScanFolderLabel = computed(() => {
    if (!libraryScanProgress.value || libraryScanProgress.value.folder_total <= 1) {
      return '';
    }

    return `\u6587\u4ef6\u5939 ${libraryScanProgress.value.folder_index}/${libraryScanProgress.value.folder_total}`;
  });
  const heroScanStatus = computed<'scanning' | 'success' | 'error'>(() => {
    if (libraryScanProgress.value?.failed) {
      return 'error';
    }

    if (libraryScanProgress.value?.done) {
      return 'success';
    }

    return 'scanning';
  });
  const emptyStateMessage = computed(() => {
    if (hasSearchQuery.value) return '\u672a\u627e\u5230\u5339\u914d\u7684\u6b4c\u66f2';
    if (showFolderEmpty.value) return '\u8be5\u6587\u4ef6\u5939\u5185\u6682\u65e0\u6b4c\u66f2';
    if (currentViewMode.value === 'playlist') return '\u6b4c\u5355\u6682\u65e0\u6b4c\u66f2';
    return '\u5217\u8868\u4e3a\u7a7a';
  });

  const clearHeroScanHideTimer = () => {
    if (heroScanHideTimer) {
      clearTimeout(heroScanHideTimer);
      heroScanHideTimer = null;
    }
  };

  const retryHeroLibraryScan = async () => {
    const sourcePath = libraryScanSession.value?.sourcePath;
    if (!sourcePath) {
      await addLibraryFolder();
      return;
    }

    await scanLibrary({
      trigger: 'first-import',
      visibility: 'hero',
      sourcePath,
    });
  };

  watch(
    [hasHeroLibrarySession, isHeroLibraryScan, () => libraryScanProgress.value?.done, () => libraryScanProgress.value?.failed],
    ([hasHeroSession, isHeroVisible, done, failed]) => {
      clearHeroScanHideTimer();

      if (!hasHeroSession) {
        showHeroScanCard.value = false;
        return;
      }

      showHeroScanCard.value = !!isHeroVisible;

      if (failed || !done) {
        return;
      }

      const startedAt = libraryScanSession.value?.startedAt ?? Date.now();
      const waitMs = Math.max(0, HERO_MIN_VISIBLE_MS - (Date.now() - startedAt)) + HERO_SUCCESS_DWELL_MS;
      heroScanHideTimer = setTimeout(() => {
        showHeroScanCard.value = false;
        if (libraryScanSession.value?.trigger === 'first-import' && libraryScanSession.value?.visibility === 'hero') {
          libraryStore.setLibraryScanSession(null);
        }
        heroScanHideTimer = null;
      }, waitMs);
    },
    { immediate: true },
  );

  onUnmounted(() => {
    clearHeroScanHideTimer();
  });

  return {
    showHeroScanCard,
    hasSearchQuery,
    showLibraryOnboarding,
    showFolderEmpty,
    showLibraryChecking,
    showLibraryEmptyResult,
    libraryScanPercent,
    libraryScanPhaseLabel,
    libraryScanFolderLabel,
    heroScanStatus,
    emptyStateMessage,
    retryHeroLibraryScan,
  };
}
