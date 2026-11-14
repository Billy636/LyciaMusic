<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue';
import { useRoute } from 'vue-router';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { X } from 'lucide-vue-next';
import { useLibraryCollections } from '../../features/collections/useLibraryCollections';
import { useLyrics } from '../../composables/lyrics';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { useFooterSettings } from '../../features/settings/useFooterSettings';
import { useSettingsStore } from '../../features/settings/store';
import { playbackApi } from '../../services/tauri/playbackApi';
import { effectiveFooterLayout, footerAction, FOOTER_ACTIONS } from '../../features/settings/footer';
import { resolveFreeFooterLayout } from '../../features/settings/freeFooterLayout';
import { footerCoverVisible, footerCoverAnchor, footerViewport, footerLivePresentation } from './footerPresentation';
import { useSongHighlights } from '../../features/highlights/useSongHighlights';
import { useToast } from '../../composables/toast';
import type { RemoteDownloadProgress } from '../../types';
import type { FooterMovableId, FooterScene } from '../../types/footer';
import FooterActionButton from './FooterActionButton.vue';
import FooterSongInfo from './FooterSongInfo.vue';
import AudioVisualizer from '../player/AudioVisualizer.vue';
import SongHighlightMarkers from '../player/SongHighlightMarkers.vue';
import FooterContextMenu from '../overlays/FooterContextMenu.vue';
import EqualizerPanel from '../player/EqualizerPanel.vue';

const {
  currentSong, currentCover, isPlaying, volume, currentTime, playMode, showPlaylist, showPlayerDetail,
  togglePlay, nextSong, prevSong, handleVolume, handleVolumeWheel, toggleMute, toggleMode, togglePlaylist,
  togglePlayerDetail, seekTo, formatDuration,
} = usePlaybackController();
const { isFavorite, toggleFavorite } = useLibraryCollections();
const { showDesktopLyrics, showLyricsPlayerSettingsPanel } = useLyrics();
const { addMarker, formatMarkerTime, errorMessage } = useSongHighlights();
const { showToast } = useToast();
const { footer, setBehavior, toggleProgress } = useFooterSettings();
const settingsStore = useSettingsStore();
const switchingOutputMode = ref(false);
const route = useRoute();
const footerRef = ref<HTMLElement | null>(null);
const footerWidth = ref(window.innerWidth);
const scene = computed<FooterScene>(() => showPlayerDetail.value ? 'detail' : 'main');
const behavior = computed(() => footer.value.behavior[scene.value]);
const groups = computed(() => resolveFreeFooterLayout(footer.value, scene.value, footerWidth.value));
const hasCover = computed(() => ['cover', 'song', 'both'].includes(behavior.value.info) && groups.value.infoWidth >= 48);
const isProgressHidden = computed(() => behavior.value.progress === 'hidden');
const isPinned = computed(() => !behavior.value.autoHide);
const isVisualizerEnabled = computed(() => behavior.value.visualizer);

const showContextMenu = ref(false);
const contextMenuX = ref(0), contextMenuY = ref(0);
const showProgressContextMenu = ref(false);
const progressContextMenuX = ref(0), progressContextMenuY = ref(0), progressContextTimeMs = ref(0);
const handleOpenDetail = () => { if (currentSong.value) togglePlayerDetail(); };
const handleFooterClick = (event: MouseEvent) => {
  if (event.defaultPrevented || !currentSong.value || !(event.target instanceof Element)) return;
  // Only one navigation handler for text and blank space. Mode changes may
  // detach the target node, so inspect the original event propagation path.
  if (event.composedPath().some(node => node instanceof Element
    && node.matches('button, a, input, select, textarea, [role="slider"], .footer-popup'))) return;
  handleOpenDetail();
};
const handleProgressContextMenu = (event: MouseEvent) => {
  if (isProgressHidden.value || !currentSong.value || !progressBarRef.value || currentSong.value.duration <= 0) return;
  event.preventDefault();
  const rect = progressBarRef.value.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  progressContextTimeMs.value = Math.round(ratio * currentSong.value.duration * 1000);
  progressContextMenuX.value = Math.max(8, Math.min(event.clientX, window.innerWidth - 230));
  progressContextMenuY.value = Math.max(8, Math.min(event.clientY, window.innerHeight - 56));
  showContextMenu.value = false;
  showProgressContextMenu.value = true;
};
const addProgressHighlight = async () => {
  showProgressContextMenu.value = false;
  try { await addMarker(progressContextTimeMs.value, true); }
  catch (error) { showToast(errorMessage(error), 'error'); }
};

const isDraggingProgress = ref(false);
const isDraggingVolume = ref(false);
const volumeBarRef = ref<HTMLElement | null>(null);
let volumePointerId: number | null = null;
const progressBarRef = ref<HTMLElement | null>(null);
const dragTime = ref(0);
const displayProgress = computed(() => {
  if (!currentSong.value || currentSong.value.duration <= 0) return 0;
  return Math.max(0, Math.min(100, (isDraggingProgress.value ? dragTime.value : currentTime.value) / currentSong.value.duration * 100));
});
const currentTimeStr = computed(() => formatDuration(isDraggingProgress.value ? dragTime.value : currentTime.value));
const totalTimeStr = computed(() => currentSong.value ? formatDuration(currentSong.value.duration) : '0:00');
const updateProgressFromEvent = (event: PointerEvent) => {
  if (!progressBarRef.value || !currentSong.value || currentSong.value.duration <= 0) return;
  const rect = progressBarRef.value.getBoundingClientRect();
  if (rect.width <= 0) return;
  dragTime.value = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * currentSong.value.duration;
};
const startProgressDrag = (event: PointerEvent) => {
  if (isProgressHidden.value || !currentSong.value || currentSong.value.duration <= 0) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement)?.setPointerCapture?.(event.pointerId);
  isDraggingProgress.value = true;
  updateProgressFromEvent(event);
};
const stopProgressDrag = async (commit = true) => {
  if (!isDraggingProgress.value) return;
  const time = dragTime.value;
  isDraggingProgress.value = false;
  if (commit) {
    try { await seekTo(time); }
    catch { showToast('调整播放进度失败，请重试', 'error'); }
  }
};
const onGlobalPointerMove = (event: PointerEvent) => {
  if (isDraggingVolume.value && event.pointerId === volumePointerId) {
    event.preventDefault(); updateVolumeFromPointer(event.clientY);
  }
  if (isDraggingProgress.value) { event.preventDefault(); updateProgressFromEvent(event); }
};
const onGlobalPointerUp = () => { finishVolumeDrag(); void stopProgressDrag(); };
const onGlobalPointerCancel = () => { finishVolumeDrag(); void stopProgressDrag(false); };
const setVolumePercent = (value: number) => {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  void handleVolume({ target: { value: String(percent) } } as unknown as Event)
    .catch(() => showToast('调整音量失败，请重试', 'error'));
};
const updateVolumeFromPointer = (clientY: number) => {
  const rect = volumeBarRef.value?.getBoundingClientRect();
  if (!rect || rect.height <= 0) return;
  setVolumePercent((rect.bottom - clientY) / rect.height * 100);
};
const startVolumeDrag = (event: PointerEvent) => {
  if (event.button !== 0 || !event.isPrimary) return;
  event.preventDefault(); clearVolumeTimer();
  volumePointerId = event.pointerId;
  isDraggingVolume.value = true;
  volumeBarRef.value?.setPointerCapture(event.pointerId);
  updateVolumeFromPointer(event.clientY);
};
const cancelVolumeDrag = () => {
  const pointerId = volumePointerId;
  volumePointerId = null; isDraggingVolume.value = false;
  if (pointerId !== null && volumeBarRef.value?.hasPointerCapture(pointerId)) {
    volumeBarRef.value.releasePointerCapture(pointerId);
  }
};
const finishVolumeDrag = () => {
  if (!isDraggingVolume.value) return;
  cancelVolumeDrag();
  if (!popupRef.value?.matches(':hover')) volumeLeave();
};
const adjustVolumeFromKeyboard = (event: KeyboardEvent) => {
  const offsets: Record<string, number> = { ArrowUp: 5, ArrowRight: 5, ArrowDown: -5, ArrowLeft: -5, PageUp: 10, PageDown: -10 };
  if (event.key !== 'Home' && event.key !== 'End' && offsets[event.key] === undefined) return;
  event.preventDefault(); event.stopPropagation();
  setVolumePercent(event.key === 'Home' ? 0 : event.key === 'End' ? 100 : volume.value + offsets[event.key]);
};
const seekWithKeyboard = (event: KeyboardEvent) => {
  if (!currentSong.value || isProgressHidden.value) return;
  const offsets: Record<string, number> = { ArrowLeft: -5, ArrowRight: 5, ArrowDown: -5, ArrowUp: 5 };
  const duration = currentSong.value.duration;
  if (event.key !== 'Home' && event.key !== 'End' && offsets[event.key] === undefined) return;
  event.preventDefault(); event.stopPropagation();
  const time = event.key === 'Home' ? 0 : event.key === 'End' ? duration : currentTime.value + offsets[event.key];
  void seekTo(Math.max(0, Math.min(duration, time))).catch(() => showToast('调整播放进度失败，请重试', 'error'));
};
watch([scene, isProgressHidden, () => currentSong.value?.path], () => { void stopProgressDrag(false); showProgressContextMenu.value = false; });

const remoteDownloadProgress = ref<RemoteDownloadProgress | null>(null);
const isCurrentRemoteDownloadActive = computed(() => !!remoteDownloadProgress.value && !remoteDownloadProgress.value.done
  && remoteDownloadProgress.value.uri === currentSong.value?.path);
const remoteDownloadText = computed(() => remoteDownloadProgress.value?.percent == null
  ? '正在加载远程歌曲' : `正在加载远程歌曲 ${Math.round(remoteDownloadProgress.value.percent)}%`);

type Popup = 'more' | 'equalizer' | 'volume';
const popup = ref<Popup | null>(null);
const popupRef = ref<HTMLElement | null>(null);
const moreAnchor = () => footerRef.value?.querySelector<HTMLButtonElement>('[data-footer-action="more"]') ?? footerRef.value;
const popupLeft = ref(0), popupBottom = ref(88);
let popupAnchor: HTMLElement | null = null;
let suppressVolumeFocus = false;
let volumeTimer: ReturnType<typeof setTimeout> | undefined;
const clearVolumeTimer = () => { if (volumeTimer) clearTimeout(volumeTimer); volumeTimer = undefined; };
const positionPopup = (kind: Popup, anchor: HTMLElement) => {
  const rect = anchor.getBoundingClientRect();
  const width = kind === 'equalizer' ? 600 : kind === 'volume' ? 36 : 232;
  popupLeft.value = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12));
  popupBottom.value = kind === 'volume'
    ? Math.max(12, window.innerHeight - rect.top)
    : Math.max(12, window.innerHeight - (footerRef.value?.getBoundingClientRect().top ?? rect.top) + 8);
};
const openPopup = async (kind: Popup, anchor: HTMLElement, focus = false) => {
  clearVolumeTimer();
  if (kind !== 'volume') cancelVolumeDrag();
  popupAnchor = popupRef.value?.contains(anchor) ? moreAnchor() : anchor;
  positionPopup(kind, popupAnchor ?? anchor);
  popup.value = kind;
  if (focus) {
    await nextTick();
    if (popup.value === kind) popupRef.value?.querySelector<HTMLElement>('input, button, [role="slider"]')?.focus();
  }
};
const closePopup = (restoreFocus = false) => {
  clearVolumeTimer(); cancelVolumeDrag(); popup.value = null;
  if (restoreFocus && popupAnchor?.isConnected) {
    suppressVolumeFocus = true;
    popupAnchor.focus();
    void nextTick(() => { suppressVolumeFocus = false; });
  }
};
const openSongContextMenu = (x: number, y: number) => {
  closePopup();
  showProgressContextMenu.value = false;
  showContextMenu.value = false;
  if (!currentSong.value) return;
  contextMenuX.value = Math.max(8, Math.min(x, window.innerWidth - 230));
  contextMenuY.value = y;
  showContextMenu.value = true;
};
const volumeEnter = (id: FooterMovableId, event: MouseEvent | FocusEvent) => {
  if (suppressVolumeFocus || showContextMenu.value || showProgressContextMenu.value
    || id !== 'volume' || popup.value && popup.value !== 'volume') return;
  void openPopup('volume', event.currentTarget as HTMLElement);
};
const volumeLeave = () => {
  clearVolumeTimer();
  volumeTimer = setTimeout(() => {
    if (popup.value === 'volume' && !isDraggingVolume.value && !popupRef.value?.contains(document.activeElement)) closePopup();
  }, 300);
};
const actionLabel = (id: FooterMovableId) => {
  if (id === 'play') return isPlaying.value ? '暂停' : '播放';
  if (id === 'pin') return isPinned.value ? '取消固定当前底栏' : '固定当前底栏';
  if (id === 'progress') return isProgressHidden.value ? '显示当前进度条' : '隐藏当前进度条';
  if (id === 'visualizer') return isVisualizerEnabled.value ? '关闭音频频谱' : '开启音频频谱';
  if (id === 'favorite') return currentSong.value && isFavorite(currentSong.value) ? '取消收藏' : '收藏';
  if (id === 'mode') return ['列表循环', '单曲循环', '随机播放'][playMode.value];
  if (id === 'wasapiExclusive') return switchingOutputMode.value ? '正在切换音频输出模式'
    : settingsStore.settings.audio.outputMode === 'wasapiExclusive' ? '关闭 WASAPI 独占' : '开启 WASAPI 独占（其他软件可能无声）';
  if (id === 'volumeBalance') return settingsStore.settings.audio.volumeBalance.enabled ? '关闭音量平衡' : '开启音量平衡';
  return footerAction(id).label;
};
const actionDisabled = (id: FooterMovableId) => (id === 'favorite' && !currentSong.value)
  || (id === 'wasapiExclusive' && switchingOutputMode.value);
const actionActive = (id: FooterMovableId) => ({
  favorite: !!currentSong.value && isFavorite(currentSong.value), mode: false, queue: showPlaylist.value,
  volume: volume.value === 0, desktopLyrics: showDesktopLyrics.value, equalizer: popup.value === 'equalizer',
  wasapiExclusive: settingsStore.settings.audio.outputMode === 'wasapiExclusive',
  volumeBalance: settingsStore.settings.audio.volumeBalance.enabled,
  pin: isPinned.value, progress: !isProgressHidden.value, lyricsStyle: showLyricsPlayerSettingsPanel.value, visualizer: isVisualizerEnabled.value,
  more: popup.value === 'more', previous: false, play: false, next: false,
})[id];
const actionWheel = (id: FooterMovableId, event: WheelEvent) => {
  if (id !== 'volume') return;
  event.preventDefault(); event.stopPropagation();
  void handleVolumeWheel(event).catch(() => showToast('调整音量失败，请重试', 'error'));
};
const activateAction = async (id: FooterMovableId, event: MouseEvent, fromMenu = false) => {
  showContextMenu.value = false; showProgressContextMenu.value = false;
  const anchor = event.currentTarget as HTMLElement;
  if (id === 'more') {
    if (popup.value === 'more') closePopup(); else await openPopup('more', anchor, true);
    return;
  }
  if (id === 'equalizer') {
    if (popup.value === 'equalizer') closePopup(); else await openPopup('equalizer', anchor, true);
    return;
  }
  if (id === 'volume') {
    if (fromMenu) await openPopup('volume', anchor, true);
    else toggleMute();
    return;
  }
  closePopup();
  switch (id) {
    case 'previous': await prevSong(); break;
    case 'play': await togglePlay(); break;
    case 'next': await nextSong(); break;
    case 'favorite': if (currentSong.value) await toggleFavorite(currentSong.value); break;
    case 'mode': toggleMode(); break;
    case 'queue': togglePlaylist(); break;
    case 'desktopLyrics': showDesktopLyrics.value = !showDesktopLyrics.value; break;
    case 'lyricsStyle': showLyricsPlayerSettingsPanel.value = !showLyricsPlayerSettingsPanel.value; break;
    case 'pin': setBehavior(scene.value, { autoHide: !behavior.value.autoHide }); break;
    case 'progress': toggleProgress(scene.value); break;
    case 'visualizer': setBehavior(scene.value, { visualizer: !behavior.value.visualizer }); break;
    case 'volumeBalance':
      settingsStore.patchSettings({ audio: { volumeBalance: { enabled: !settingsStore.settings.audio.volumeBalance.enabled } } });
      break;
    case 'wasapiExclusive': {
      if (switchingOutputMode.value) break;
      const outputMode = settingsStore.settings.audio.outputMode === 'wasapiExclusive' ? 'shared' : 'wasapiExclusive';
      switchingOutputMode.value = true;
      try {
        await playbackApi.setAudioOutputMode(outputMode);
        settingsStore.patchSettings({ audio: { outputMode } });
      } catch (error) {
        console.error('Failed to update audio output mode:', error);
        showToast('切换音频输出模式失败', 'error');
      } finally {
        switchingOutputMode.value = false;
      }
      break;
    }
  }
};
const handleOutsidePointer = (event: PointerEvent) => {
  const target = event.target as HTMLElement;
  if (popupRef.value?.contains(target) || target.closest('[data-footer-action]')) return;
  if (target.closest('[role="alertdialog"]') || target.closest('[role="dialog"]')) return;
  closePopup(); showProgressContextMenu.value = false;
};
const handlePopupKeydown = (event: KeyboardEvent) => {
  if (!popup.value || event.key !== 'Escape') return;
  if (document.querySelector('[role="alertdialog"], [role="dialog"][aria-modal="true"]')) return;
  event.preventDefault(); event.stopImmediatePropagation(); closePopup(true);
};
const openFooterContextMenu = (event: MouseEvent) => {
  // The seek bar and highlight markers retain their dedicated context menus.
  if (event.defaultPrevented) return;
  event.preventDefault(); event.stopPropagation();
  openSongContextMenu(event.clientX, event.clientY);
};
const openFooterMenuFromKeyboard = (event: KeyboardEvent) => {
  if (event.defaultPrevented) return;
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
  event.preventDefault(); event.stopPropagation();
  const anchor = event.target instanceof HTMLElement ? event.target : footerRef.value;
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  openSongContextMenu(rect.left + rect.width / 2, rect.top);
};
// Unrelated audio patches also replace AppSettings; do not close the EQ while
// its sliders are committing audio settings. Only layout changes dismiss it.
watch([
  scene,
  () => JSON.stringify(footer.value.placement),
  () => JSON.stringify(effectiveFooterLayout(footer.value, scene.value)),
  () => JSON.stringify(footer.value.spacing[footer.value.linked ? 'main' : scene.value]),
], () => closePopup());

const isIdle = ref(false);
const pointerInside = ref(false);
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const clearIdleTimer = () => { if (idleTimer) clearTimeout(idleTimer); idleTimer = undefined; };
const mustStayVisible = () => !behavior.value.autoHide || route.path === '/settings' || pointerInside.value
  || popup.value !== null || showContextMenu.value || showProgressContextMenu.value || isDraggingProgress.value
  || showPlaylist.value || showLyricsPlayerSettingsPanel.value || !!footerRef.value?.querySelector(':focus-visible');
const startIdleTimer = () => {
  clearIdleTimer(); isIdle.value = false;
  if (mustStayVisible()) return;
  idleTimer = setTimeout(() => { if (!mustStayVisible()) isIdle.value = true; }, 2000);
};
const handleFooterMouseEnter = () => { pointerInside.value = true; clearIdleTimer(); isIdle.value = false; };
const handleFooterMouseLeave = () => { pointerInside.value = false; startIdleTimer(); };
const handleFooterFocusOut = () => { void nextTick(startIdleTimer); };
watch([scene, () => behavior.value.autoHide, () => route.path, popup, showContextMenu, showProgressContextMenu, isDraggingProgress, showPlaylist, showLyricsPlayerSettingsPanel], startIdleTimer);
watch([hasCover, isIdle, showPlayerDetail], () => {
  footerCoverVisible.value = !showPlayerDetail.value && hasCover.value && !isIdle.value;
}, { immediate: true });

let resizeObserver: ResizeObserver | undefined;
watchEffect(() => {
  footerLivePresentation.value = {
    song: currentSong.value, cover: currentCover.value, playing: isPlaying.value,
    playMode: playMode.value, volume: volume.value, expanded: showPlayerDetail.value,
    currentTime: currentTimeStr.value, totalTime: totalTimeStr.value, progress: displayProgress.value,
    downloadLabel: isCurrentRemoteDownloadActive.value ? remoteDownloadText.value : '',
    active: Object.fromEntries([...FOOTER_ACTIONS.map(item => item.id), 'previous', 'play', 'next']
      .map(id => [id, actionActive(id as FooterMovableId)])),
  };
});
let unlistenRemoteDownload: UnlistenFn | undefined;
let disposed = false;
const measureFooter = () => {
  if (!footerRef.value) return;
  const { clientWidth: width, clientHeight: height } = footerRef.value;
  footerWidth.value = width;
  footerViewport.value = { width, height };
  const footerRect = footerRef.value.getBoundingClientRect();
  const coverRect = footerRef.value.querySelector<HTMLElement>('[data-footer-cover]')?.getBoundingClientRect();
  footerCoverAnchor.value = coverRect?.width && coverRect.height
    ? { x: coverRect.left, y: coverRect.top, width: coverRect.width, height: coverRect.height }
    : { x: footerRect.left + 16, y: footerRect.top + (height - 48) / 2, width: 48, height: 48 };
};
const onWindowResize = () => { closePopup(); showProgressContextMenu.value = false; measureFooter(); };
watch([() => behavior.value.info, showPlayerDetail], () => { void nextTick(measureFooter); });
onMounted(async () => {
  measureFooter();
  resizeObserver = new ResizeObserver(measureFooter);
  if (footerRef.value) resizeObserver.observe(footerRef.value);
  window.addEventListener('pointermove', onGlobalPointerMove);
  window.addEventListener('pointerup', onGlobalPointerUp);
  window.addEventListener('pointercancel', onGlobalPointerCancel);
  window.addEventListener('pointerdown', handleOutsidePointer);
  window.addEventListener('keydown', handlePopupKeydown, true);
  window.addEventListener('resize', onWindowResize);
  startIdleTimer();
  try {
    const unlisten = await listen<RemoteDownloadProgress>('remote-download-progress', event => { remoteDownloadProgress.value = event.payload; });
    if (disposed) unlisten(); else unlistenRemoteDownload = unlisten;
  } catch (error) { console.error('Failed to subscribe to download progress', error); }
});
onUnmounted(() => {
  disposed = true; clearIdleTimer(); clearVolumeTimer(); cancelVolumeDrag(); resizeObserver?.disconnect(); unlistenRemoteDownload?.();
  footerCoverVisible.value = true;
  footerCoverAnchor.value = null;
  window.removeEventListener('pointermove', onGlobalPointerMove);
  window.removeEventListener('pointerup', onGlobalPointerUp);
  window.removeEventListener('pointercancel', onGlobalPointerCancel);
  window.removeEventListener('pointerdown', handleOutsidePointer);
  window.removeEventListener('keydown', handlePopupKeydown, true);
  window.removeEventListener('resize', onWindowResize);
});
</script>

<template>
  <footer ref="footerRef" class="player-footer relative z-[60] h-20 select-none bg-transparent" aria-label="播放底栏"
    :class="showPlayerDetail ? 'text-white' : 'text-gray-800 dark:text-white'"
    @click="handleFooterClick"
    @mouseenter="handleFooterMouseEnter" @mousemove="handleFooterMouseEnter" @mouseleave="handleFooterMouseLeave"
    @focusin="isIdle = false; clearIdleTimer()" @focusout="handleFooterFocusOut" @contextmenu="openFooterContextMenu" @keydown="openFooterMenuFromKeyboard">
    <div v-if="showPlayerDetail && currentSong && isVisualizerEnabled" class="pointer-events-none absolute inset-x-5 -top-[76px] z-40 h-16 transition-opacity duration-300" :class="isIdle ? 'opacity-25' : 'opacity-100'">
      <AudioVisualizer :active="showPlayerDetail && isVisualizerEnabled" :is-playing="isPlaying" :song-path="currentSong.path" />
    </div>
    <div v-if="!isProgressHidden" ref="progressBarRef" data-player-progress role="slider" tabindex="0" aria-label="播放进度"
      :aria-valuemin="0" :aria-valuemax="currentSong?.duration || 0" :aria-valuenow="isDraggingProgress ? dragTime : currentTime" :aria-valuetext="`${currentTimeStr} / ${totalTimeStr}`"
      class="footer-progress absolute -top-[10px] left-0 z-50 h-[22px] w-full cursor-pointer touch-none"
      :class="{ 'hover-only': behavior.progress === 'hover', dragging: isDraggingProgress }"
      @pointerdown="startProgressDrag" @contextmenu="handleProgressContextMenu" @keydown="seekWithKeyboard">
      <div class="progress-track absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full">
        <div class="progress-fill absolute inset-y-0 left-0 rounded-full bg-zinc-300/30" :style="{ width: `${displayProgress}%`, backgroundColor: behavior.progressColor || undefined }">
          <div class="progress-thumb absolute right-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 translate-x-1/2 rounded-full border border-black/10 bg-white shadow-sm" :style="{ backgroundColor: behavior.progressColor || undefined }"></div>
          <div v-if="isDraggingProgress" class="absolute bottom-4 right-0 translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-900/95 px-2 py-1 text-[11px] tabular-nums text-white">{{ currentTimeStr }} / {{ totalTimeStr }}</div>
        </div>
      </div>
      <SongHighlightMarkers :hidden="false" />
    </div>
    <div class="footer-content h-full" :class="{ 'is-idle': isIdle }" :inert="isIdle || undefined">
      <div class="footer-info-area" :style="{ width: `${groups.infoWidth}px` }">
        <FooterSongInfo :mode="behavior.info" :width="groups.infoWidth" :song="currentSong" :cover="currentCover" :cover-shape="footer.coverShape[scene]"
          :current-time="currentTimeStr" :total-time="totalTimeStr" :expanded="showPlayerDetail"
          :download-label="isCurrentRemoteDownloadActive ? remoteDownloadText : ''"
          @toggle="handleOpenDetail" />
      </div>
      <FooterActionButton v-for="item in groups.bar" :id="item.id" :key="item.id" class="footer-free-button"
        :style="{ left: `${item.x}px`, width: `${item.width}px`, height: `${item.width}px` }"
        :label="actionLabel(item.id)" :active="actionActive(item.id)" :playing="isPlaying"
        :expanded="item.id === 'more' ? popup === 'more' : undefined" :disabled="actionDisabled(item.id)"
        :play-mode="playMode" :volume="volume" :progress-hidden="isProgressHidden" :pinned="isPinned"
        @activate="activateAction(item.id, $event)" @enter="volumeEnter(item.id, $event)" @leave="item.id === 'volume' && volumeLeave()" @wheel="actionWheel(item.id, $event)" />
    </div>
    <Teleport to="body">
      <div v-if="popup" ref="popupRef" class="footer-popup fixed z-[9500]"
        :class="popup === 'volume' ? 'pb-3' : 'overflow-auto rounded-xl border border-black/10 bg-white p-1 text-gray-800 shadow-2xl dark:border-white/10 dark:bg-zinc-900 dark:text-gray-100'"
        :style="{ left: `${popupLeft}px`, bottom: `${popupBottom}px`, maxHeight: popup === 'volume' ? undefined : `calc(100vh - ${popupBottom + 12}px)`, width: popup === 'equalizer' ? 'min(600px, calc(100vw - 24px))' : popup === 'volume' ? '36px' : '232px' }"
        :aria-label="popup === 'equalizer' ? '均衡器' : popup === 'volume' ? '音量' : '更多底栏操作'"
        @pointerdown.stop @mouseenter="clearVolumeTimer" @mouseleave="popup === 'volume' && volumeLeave()" @wheel="popup === 'volume' && actionWheel('volume', $event)">
        <template v-if="popup === 'more'">
          <FooterActionButton v-for="item in groups.more" :id="item.id" :key="item.id" menu :playing="isPlaying" :label="actionLabel(item.id)" :active="actionActive(item.id)" :expanded="item.id === 'more' ? popup === 'more' : undefined" :disabled="actionDisabled(item.id)" :play-mode="playMode" :volume="volume" :progress-hidden="isProgressHidden" :pinned="isPinned" @activate="activateAction(item.id, $event, true)" />
          <p v-if="!groups.more.length" class="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">暂无更多操作</p>
        </template>
        <template v-else-if="popup === 'volume'">
          <!-- Keep the original narrow vertical volume popup and hover bridge. -->
          <div class="absolute top-full left-0 h-4 w-full"></div>
          <div class="flex h-32 w-9 flex-col items-center justify-between rounded-2xl border py-3 shadow-2xl backdrop-blur-md transition-colors"
            :class="showPlayerDetail ? 'bg-[#1c1c1c]/80 border-white/10' : 'bg-white/90 dark:bg-zinc-900/85 border-gray-100 dark:border-white/10'">
            <div class="select-none text-[10px] font-bold transition-colors"
              :class="showPlayerDetail ? 'text-white/60' : 'text-gray-500 dark:text-white/60'">{{ volume }}%</div>
            <div ref="volumeBarRef" role="slider" tabindex="0" aria-label="音量" aria-orientation="vertical" :aria-valuemin="0" :aria-valuemax="100" :aria-valuenow="volume" :aria-valuetext="`${volume}%`"
              class="relative my-1 w-1.5 flex-1 cursor-pointer touch-none rounded-full transition-colors"
              :class="showPlayerDetail ? 'bg-white/15' : 'bg-gray-200 dark:bg-white/15'"
              @pointerdown="startVolumeDrag" @lostpointercapture="finishVolumeDrag" @keydown="adjustVolumeFromKeyboard" @blur="volumeLeave">
              <div class="absolute bottom-0 w-full rounded-full bg-[#EC4141]" :style="{ height: `${volume}%` }"></div>
              <div class="absolute bottom-0 left-1/2 h-3.5 w-3.5 -translate-x-1/2 cursor-grab rounded-full bg-white shadow-sm active:cursor-grabbing" :style="{ bottom: `calc(${volume}% - 7px)` }"></div>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="flex items-center justify-between px-3 py-1 text-xs"><span>均衡器</span><button type="button" title="关闭均衡器面板" class="p-1" @click="closePopup(true)"><X class="h-4 w-4" /></button></div>
          <div class="p-3"><EqualizerPanel embedded /></div>
        </template>
      </div>
      <div v-if="showProgressContextMenu" class="fixed z-[9999] min-w-[210px] rounded-lg border border-black/10 bg-white py-1 text-sm text-gray-800 shadow-xl dark:border-white/10 dark:bg-zinc-900 dark:text-white"
        :style="{ left: `${progressContextMenuX}px`, top: `${progressContextMenuY}px` }" @pointerdown.stop @contextmenu.prevent>
        <button type="button" class="block w-full px-3 py-2 text-left hover:bg-black/5 dark:hover:bg-white/5" @click="addProgressHighlight">在 {{ formatMarkerTime(progressContextTimeMs) }} 添加高潮点</button>
      </div>
    </Teleport>
    <FooterContextMenu :visible="showContextMenu" :x="contextMenuX" :y="contextMenuY" :song="currentSong" @close="showContextMenu = false" />
  </footer>
</template>

<style scoped>
.footer-content { position: relative; transition: opacity 240ms ease; }
.footer-info-area { position: absolute; top: 0; left: 16px; height: 100%; min-width: 0; }
.footer-free-button { position: absolute; top: 50%; transform: translate(-50%, -50%); }
.footer-content.is-idle { opacity: 0; pointer-events: none; }
.progress-track { transition: height 150ms ease, opacity 150ms ease; }
.progress-thumb { opacity: 0; transition: opacity 150ms ease; }
.footer-progress:hover .progress-track, .footer-progress:focus-visible .progress-track, .footer-progress.dragging .progress-track { height: 5px; }
.footer-progress:hover .progress-thumb, .footer-progress:focus-visible .progress-thumb, .footer-progress.dragging .progress-thumb { opacity: 1; }
.footer-progress.hover-only:not(:hover):not(:focus-visible):not(.dragging) { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .footer-content, .progress-track, .progress-thumb { transition: none; } }
</style>
