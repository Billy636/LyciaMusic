<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useCoverCache } from '../../composables/useCoverCache';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { usePlaybackStore } from '../../features/playback/store';
import FooterContextMenu from "../overlays/FooterContextMenu.vue";
import { footerCoverVisible, footerCoverAnchor, footerViewport } from '../layout/footerPresentation';
import { useFooterSettings } from '../../features/settings/useFooterSettings';
import { resolveFreeFooterLayout } from '../../features/settings/freeFooterLayout';
import { useRenderingPower } from '../../composables/renderingPower';
import { useCoverTilt } from './useCoverTilt';
import { useCoverRotation } from './useCoverRotation';

const props = defineProps<{
  isExpanded?: boolean;
  isResizingWindow?: boolean;
  isCoverFocused?: boolean;
  isFocusTransitioning?: boolean;
}>();
const emit = defineEmits<{ (event: 'toggle-focus'): void }>();

const { footer } = useFooterSettings();
const mainHasCover = computed(() => ['cover', 'song', 'both'].includes(footer.value.behavior.main.info)
  && (!footerViewport.value.width || resolveFreeFooterLayout(footer.value, 'main', footerViewport.value.width).infoWidth >= 48));
// Without a main-page thumbnail, keep the cover at its large-cover geometry
// even when collapsed: only opacity changes, never a flight from empty space.
const usesLargeCoverLayout = computed(() => !!props.isExpanded || !mainHasCover.value);
const isCircleCover = computed(() => footer.value.coverShape[usesLargeCoverLayout.value ? 'detail' : 'main'] === 'circle');
const isCoverFocusMove = ref(false);
watch([() => !!props.isExpanded, () => !!props.isCoverFocused], ([expanded, focused], [wasExpanded, wasFocused]) => {
  // Only an in-page layout toggle uses the focus timing. A remembered layout
  // must expand directly from the thumbnail with the same easing as its geometry.
  isCoverFocusMove.value = expanded && wasExpanded && focused !== wasFocused;
});
const skipCoverTransition = ref(false);
let transitionResetFrame = 0;
watch(mainHasCover, () => {
  cancelAnimationFrame(transitionResetFrame);
  if (props.isExpanded) { skipCoverTransition.value = false; return; }
  // Changing the main info mode must not flash a large cover while collapsing
  // its thumbnail. Snap hidden geometry before re-enabling page transitions.
  skipCoverTransition.value = true;
  transitionResetFrame = requestAnimationFrame(() => {
    transitionResetFrame = requestAnimationFrame(() => { skipCoverTransition.value = false; });
  });
});
onBeforeUnmount(() => cancelAnimationFrame(transitionResetFrame));

const coverTransitionStyle = computed(() => {
  const instant = (props.isResizingWindow && props.isExpanded)
    || (skipCoverTransition.value && !props.isExpanded);
  const opacityDuration = mainHasCover.value ? '700ms' : '300ms';
  return {
    '--cover-layout-duration': instant || !mainHasCover.value ? '0ms' : '700ms',
    '--cover-shape-duration': instant ? '0ms' : '700ms',
    '--cover-opacity-duration': instant ? '0ms' : opacityDuration,
    '--cover-move-duration': instant ? '0ms' : isCoverFocusMove.value
      ? 'var(--player-cover-focus-duration, 600ms)' : opacityDuration,
    '--cover-move-easing': isCoverFocusMove.value
      ? 'var(--player-cover-focus-easing, cubic-bezier(0.4, 0, 0.2, 1))'
      : 'var(--cover-layout-easing)',
  };
});

const {
  currentSong, currentCover, currentCoverPath, currentCoverFull, isPlaying, dominantColors
} = usePlaybackController();
const { getFullCoverUrl, loadFullCover, preloadFullCovers, retainFullCoverPaths } = useCoverCache();
const playbackStore = usePlaybackStore();
const { playQueuePaths, tempQueuePaths } = storeToRefs(playbackStore);

const showContextMenu = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const currentSongPath = computed(() => currentSong.value?.path ?? '');

const toggleCoverFocus = () => {
  if (!props.isExpanded || props.isResizingWindow || showContextMenu.value) return;
  emit('toggle-focus');
};

const handleCoverKeydown = (event: KeyboardEvent) => {
  if (!props.isExpanded) return;
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) toggleCoverFocus();
};

const handleContextMenu = (e: MouseEvent) => {
  if (!currentSong.value) return;
  e.preventDefault();
  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
  showContextMenu.value = true;
};

const localCoverUrl = ref('');
const bigCoverLoaded = ref(false);
const fullCoverLoading = ref(false);
const reflectionCoverUrl = ref('');
let fullCoverRequestId = 0;
const currentLocalCoverUrl = computed(() => {
  if (props.isExpanded && currentCoverPath.value !== currentSongPath.value) {
    return '';
  }

  return localCoverUrl.value;
});
const currentBigCoverUrl = computed(() => (
  props.isExpanded && currentCoverFull.value && currentCoverFull.value !== currentLocalCoverUrl.value
    ? currentCoverFull.value
    : ''
));

const getRetainedFullCoverPaths = (path: string) => {
  if (!path) {
    return [];
  }

  const retainedPaths: string[] = [path];
  const pushUniquePath = (candidatePath: string | undefined) => {
    if (!candidatePath || retainedPaths.includes(candidatePath)) {
      return;
    }

    retainedPaths.push(candidatePath);
  };

  // Temp queue items will be played before the regular queue.
  pushUniquePath(tempQueuePaths.value[0]);

  const queue = playQueuePaths.value;
  const currentIndex = queue.indexOf(path);
  if (currentIndex >= 0 && queue.length > 1) {
    pushUniquePath(queue[(currentIndex - 1 + queue.length) % queue.length]);
    pushUniquePath(queue[(currentIndex + 1) % queue.length]);
  }

  return retainedPaths.slice(0, 4);
};

watch(currentCover, (cover) => {
  localCoverUrl.value = cover || '';
}, { immediate: true });

watch([currentSongPath, () => props.isExpanded], async ([path, isExpanded]) => {
  const cachedFullCoverUrl = path ? getFullCoverUrl(path) : '';
  bigCoverLoaded.value = Boolean(cachedFullCoverUrl);
  fullCoverLoading.value = false;

  if (!path || !isExpanded) {
    fullCoverRequestId += 1;
    return;
  }

  const retainedPaths = getRetainedFullCoverPaths(path);
  retainFullCoverPaths(retainedPaths);

  if (cachedFullCoverUrl) {
    currentCoverFull.value = cachedFullCoverUrl;
    preloadFullCovers(retainedPaths.filter(candidatePath => candidatePath !== path));
    return;
  }

  const requestId = ++fullCoverRequestId;
  const fullCoverLoad = loadFullCover(path);
  fullCoverLoading.value = true;
  preloadFullCovers(retainedPaths.filter(candidatePath => candidatePath !== path));

  try {
    const fullCoverUrl = await fullCoverLoad;
    if (requestId !== fullCoverRequestId || path !== currentSongPath.value || !props.isExpanded) return;
    currentCoverFull.value = fullCoverUrl || '';
    fullCoverLoading.value = false;
  } catch {
    if (requestId !== fullCoverRequestId || path !== currentSongPath.value || !props.isExpanded) return;
    currentCoverFull.value = '';
    fullCoverLoading.value = false;
  }
}, { immediate: true });

watch(() => props.isExpanded, (isExpanded) => {
  if (isExpanded) {
    return;
  }

  if (document.activeElement === detailCoverRef.value) detailCoverRef.value?.blur();
  bigCoverLoaded.value = false;
  fullCoverLoading.value = false;
  reflectionCoverUrl.value = '';
});

watch([currentSongPath, currentLocalCoverUrl, currentBigCoverUrl, () => props.isExpanded], ([path, localUrl, bigUrl, isExpanded]) => {
  if (!path) {
    reflectionCoverUrl.value = '';
    return;
  }

  if (!isExpanded) {
    reflectionCoverUrl.value = '';
    return;
  }

  const nextReflectionUrl = localUrl || bigUrl || '';
  if (nextReflectionUrl === reflectionCoverUrl.value) {
    return;
  }

  reflectionCoverUrl.value = nextReflectionUrl;
}, { immediate: true });

const onBigCoverLoad = () => {
  bigCoverLoaded.value = true;
  fullCoverLoading.value = false;
};

const onBigCoverError = () => {
  bigCoverLoaded.value = false;
  fullCoverLoading.value = false;
};

const detailCoverRef = ref<HTMLElement | null>(null);
const tiltSurfaceRef = ref<HTMLElement | null>(null);
const rotationSurfaceRef = ref<HTMLElement | null>(null);
const reflectionRotationRef = ref<HTMLElement | null>(null);
const { isMainWindowLowPower, mainWindowRenderingSnapshot } = useRenderingPower();
useCoverRotation(rotationSurfaceRef, reflectionRotationRef,
  () => isCircleCover.value && !!currentSong.value,
  () => isPlaying.value && !isMainWindowLowPower.value
    && (!!props.isExpanded || (mainHasCover.value && footerCoverVisible.value)), 700);
useCoverTilt(detailCoverRef, tiltSurfaceRef, () => !!props.isExpanded
  && !props.isResizingWindow
  && !showContextMenu.value
  && !isMainWindowLowPower.value
  && mainWindowRenderingSnapshot.value.windowFocused);
defineExpose({ detailCoverRef });
</script>

<template>
  <div class="pointer-events-none" @contextmenu="handleContextMenu">
    
    <!-- Album Art -->
    <div 
      ref="detailCoverRef"
      class="shared-cover absolute aspect-square z-50 will-change-transform"
      role="button"
      :tabindex="props.isExpanded ? 0 : -1"
      :aria-hidden="!props.isExpanded"
      :aria-pressed="!!props.isCoverFocused"
      :aria-label="props.isCoverFocused ? '恢复封面与歌词布局' : '居中欣赏封面，隐藏歌词'"
      :class="[
        usesLargeCoverLayout ? 'top-[45%] left-[calc(75px+18%)] -translate-x-1/2 -translate-y-1/2 w-[clamp(220px,45vh,580px)]' : 'top-[calc(100vh-64px)] left-[16px] translate-x-0 translate-y-0 w-12',
        isCircleCover ? 'rounded-[50%]' : usesLargeCoverLayout ? 'rounded-2xl' : 'rounded-lg',
        props.isExpanded ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none',
      ]"
      :style="[coverTransitionStyle, {
        left: !usesLargeCoverLayout && footerCoverAnchor ? `${footerCoverAnchor.x}px` : undefined,
        top: !usesLargeCoverLayout && footerCoverAnchor ? `${footerCoverAnchor.y}px` : undefined,
        width: !usesLargeCoverLayout && footerCoverAnchor ? `${footerCoverAnchor.width}px` : undefined,
        transform: usesLargeCoverLayout && props.isCoverFocused
          ? 'translate3d(calc(32vw - 75px), 0, 0)' : 'translate3d(0, 0, 0)',
        zIndex: props.isCoverFocused || props.isFocusTransitioning ? 55 : undefined,
        opacity: props.isExpanded || (mainHasCover && footerCoverVisible) ? 1 : 0,
      }]"
      @click.left.stop="toggleCoverFocus"
      @keydown="handleCoverKeydown"
    >
      <!-- Keep the hit area stationary; only this inner surface tilts. -->
      <div
        ref="tiltSurfaceRef"
        class="cover-tilt-surface relative w-full h-full rounded-[inherit] pointer-events-none"
        :style="{
          boxShadow: props.isExpanded && isPlaying
            ? `0 30px 60px -12px rgba(0,0,0,0.6), 0 18px 36px -18px rgba(0,0,0,0.7), 0 0 80px -20px ${dominantColors[0]}44`
            : (props.isExpanded ? '0 10px 20px -5px rgba(0,0,0,0.4)' : 'none'),
        }"
      >
        <!-- Main Cover Container -->
        <div ref="rotationSurfaceRef" class="cover-rotation-surface relative z-20 w-full h-full rounded-[inherit]">
          <transition name="song-switch-cover" mode="out-in">
            <div :key="currentSongPath" class="w-full h-full rounded-[inherit] overflow-hidden relative isolate z-20">
              <img v-if="currentLocalCoverUrl" :key="`thumb:${currentSongPath}:${currentLocalCoverUrl}`" :src="currentLocalCoverUrl" class="absolute inset-0 w-full h-full object-cover select-none transition-[transform,filter,opacity] duration-[240ms] ease-out z-10" :class="props.isExpanded ? (fullCoverLoading ? 'scale-[1.03] blur-[10px] brightness-90' : 'scale-100 blur-0 brightness-100') : 'scale-100 blur-0 brightness-100'" draggable="false" decoding="async" />
              <img v-if="currentBigCoverUrl" :key="`big:${currentSongPath}:${currentBigCoverUrl}`" :src="currentBigCoverUrl" @load="onBigCoverLoad" @error="onBigCoverError" class="absolute inset-0 w-full h-full object-cover select-none transition-opacity duration-[240ms] ease-out z-20" :class="[props.isExpanded ? 'scale-100' : 'scale-100', bigCoverLoaded ? 'opacity-100' : 'opacity-0']" draggable="false" decoding="async" />
              <div v-if="!currentLocalCoverUrl && !currentBigCoverUrl" class="absolute inset-0 w-full h-full bg-white/5 flex items-center justify-center text-white/10 z-0">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-32 w-32" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
              </div>
            </div>
          </transition>
        </div>

        <!-- Glass Table Reflection Layer -->
        <transition name="reflection-reveal" appear>
          <div v-if="props.isExpanded" class="absolute top-[calc(100%+2px)] left-0 w-full h-[65%] pointer-events-none z-10 reflection-wrapper overflow-hidden">
            <div class="absolute inset-0 reflection-glass overflow-hidden">
              <div class="absolute top-0 left-0 w-full aspect-square scale-y-[-1]">
                <div ref="reflectionRotationRef" class="reflection-mask cover-rotation-surface w-full h-full overflow-hidden" :class="isCircleCover ? 'rounded-[50%]' : 'rounded-2xl'">
                  <transition name="song-switch-cover" mode="out-in">
                    <div :key="currentSongPath" class="w-full h-full relative">
                      <img v-if="reflectionCoverUrl" :src="reflectionCoverUrl" class="absolute top-0 left-0 w-full aspect-square object-cover transition-opacity duration-[240ms] ease-out" draggable="false" decoding="async" />
                    </div>
                  </transition>
                </div>
              </div>
            </div>
          </div>
        </transition>
      </div>
    </div>

    <FooterContextMenu 
      :visible="showContextMenu" 
      :x="contextMenuX" 
      :y="contextMenuY" 
      :song="currentSong"
      @close="showContextMenu = false"
    />

  </div>
</template>

<style scoped>
.shared-cover {
  --cover-layout-easing: cubic-bezier(0.22, 1, 0.36, 1);
  /* Only transform changes when focusing; keep the existing thumbnail flight separate. */
  transition:
    top var(--cover-layout-duration) var(--cover-layout-easing),
    left var(--cover-layout-duration) var(--cover-layout-easing),
    width var(--cover-layout-duration) var(--cover-layout-easing),
    height var(--cover-layout-duration) var(--cover-layout-easing),
    translate var(--cover-layout-duration) var(--cover-layout-easing),
    border-radius var(--cover-shape-duration) var(--cover-layout-easing),
    opacity var(--cover-opacity-duration) var(--cover-layout-easing),
    transform var(--cover-move-duration) var(--cover-move-easing);
}

.shared-cover:focus-visible {
  outline: 2px solid rgb(255 255 255 / 0.6);
  outline-offset: 8px;
}

.cover-tilt-surface {
  transform-origin: center;
  transition-property: box-shadow;
  transition-duration: var(--cover-opacity-duration);
  transition-timing-function: var(--cover-layout-easing);
}

.cover-rotation-surface { transform-origin: center; }
.reflection-mask { transition: border-radius var(--cover-shape-duration) var(--cover-layout-easing); }

@media (prefers-reduced-motion: reduce) {
  .shared-cover,
  .cover-tilt-surface,
  .reflection-mask { transition-duration: 0ms !important; }
}
.reflection-wrapper {
  perspective: 1500px;
  transform-origin: top;
  /* rotateX(50deg) 让倒影铺在桌面上 */
  /* skewX(-15deg) 让它变成平行四边形 */
  /* scale(1.1) 补偿旋转带来的视觉缩小，确保边缘对齐 */
  transform: rotateX(40deg) skewX(-18deg) scale(1.01);
  opacity: 0.2;
}

.reflection-glass {
  -webkit-mask-image: linear-gradient(
    to bottom,
    black 0%,
    rgba(0, 0, 0, 0.5) 30%,
    transparent 85%
  );
  mask-image: linear-gradient(
    to bottom,
    black 0%,
    rgba(0, 0, 0, 0.5) 30%,
    transparent 85%
  );
}

.reflection-reveal-enter-active,
.reflection-reveal-appear-active {
  transition:
    transform 560ms cubic-bezier(0.22, 1, 0.36, 1) 220ms,
    opacity 420ms ease-out 220ms,
    filter 560ms cubic-bezier(0.22, 1, 0.36, 1) 220ms;
}

.reflection-reveal-leave-active {
  transition:
    transform 220ms cubic-bezier(0.4, 0, 0.2, 1),
    opacity 180ms ease-in,
    filter 220ms cubic-bezier(0.4, 0, 0.2, 1);
}

.reflection-reveal-enter-from,
.reflection-reveal-appear-from,
.reflection-reveal-leave-to {
  opacity: 0;
  filter: blur(10px);
}

.reflection-reveal-enter-from,
.reflection-reveal-appear-from {
  transform: translateY(-18px) rotateX(58deg) skewX(-22deg) scale(0.96);
}

.reflection-reveal-leave-to {
  transform: translateY(-10px) rotateX(48deg) skewX(-20deg) scale(0.985);
}

/* 切歌时封面交叉淡入淡出 */
.song-switch-cover-enter-active,
.song-switch-cover-leave-active {
  transition:
    opacity 360ms cubic-bezier(0.4, 0, 0.2, 1),
    transform 360ms cubic-bezier(0.4, 0, 0.2, 1);
}

.song-switch-cover-enter-from {
  opacity: 0;
  transform: scale(1.05);
}

.song-switch-cover-leave-to {
  opacity: 0;
  transform: scale(0.98);
}
</style>
