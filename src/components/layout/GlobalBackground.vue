<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';
import { storeToRefs } from 'pinia';
import { usePlayer } from '../../composables/player';
import { useThemeSettings } from '../../composables/useThemeSettings';
import { useCoverCache } from '../../composables/useCoverCache';
import { usePlaybackStore } from '../../features/playback/store';
import { useWindowMaterial } from '../../composables/windowMaterial';
import { getPreblurredBackgroundUrl } from '../../composables/preblurredBackgroundCache';
import { useRenderingPower } from '../../composables/renderingPower';
import { calculateCoverGeometry } from '../../composables/useThemeBackgroundGeometry';
import {
  getCustomBackgroundRenderTarget,
  loadCustomBackgroundMediaMetadata,
  prepareCustomBackgroundImage,
  resolveCustomBackgroundMediaType,
  type CustomBackgroundRenderTarget,
  type CustomBackgroundMediaType,
} from '../../composables/customBackgroundMedia';
import { useCustomBackgroundPreviewState } from '../../composables/customBackgroundPreviewState';
import FlowBackground from './FlowBackground.vue';

const { currentCover, currentCoverFull, showPlayerDetail, isMiniMode } = usePlayer();
const { theme, isDarkTheme, patchTheme } = useThemeSettings();
const { activeWindowMaterial } = useWindowMaterial();
const { loadFullCover } = useCoverCache();
const { isMainWindowLowPower } = useRenderingPower();
const { isCustomBackgroundPreviewOpen } = useCustomBackgroundPreviewState();
const playbackStore = usePlaybackStore();
const { currentSongPath } = storeToRefs(playbackStore);
const isBackgroundPreparationSuspended = computed(() => isMainWindowLowPower.value || isMiniMode.value);

// --- 大背景物理尺寸动态测量 ---
const containerWidth = ref(window.innerWidth);
const containerHeight = ref(window.innerHeight);

const updateContainerSize = () => {
  const bgEl = document.querySelector('[data-global-background]');
  if (bgEl) {
    const rect = bgEl.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      containerWidth.value = rect.width;
      containerHeight.value = rect.height;
      return;
    }
  }
  containerWidth.value = window.innerWidth;
  containerHeight.value = window.innerHeight;
};

// --- 图片物理原始宽高元数据管理 ---
const imageNaturalWidth = ref(theme.value.customBackground?.imageWidth || 0);
const imageNaturalHeight = ref(theme.value.customBackground?.imageHeight || 0);
const customVideoRef = ref<HTMLVideoElement | null>(null);
const customMediaReady = ref(false);
let customMediaRequestId = 0;

interface RenderedCustomMedia {
  path: string;
  displayPath: string;
  mediaType: CustomBackgroundMediaType;
}

const renderedCustomMedia = ref<RenderedCustomMedia | null>(null);
const customRenderTarget = computed<CustomBackgroundRenderTarget>(() => {
  const fallback = getCustomBackgroundRenderTarget();
  const quantize = (value: number) => Math.max(256, Math.ceil(value / 256) * 256);
  return {
    width: quantize(containerWidth.value * fallback.devicePixelRatio),
    height: quantize(containerHeight.value * fallback.devicePixelRatio),
    devicePixelRatio: fallback.devicePixelRatio,
  };
});

// 媒体加载成功前保留上一份可用背景，避免切换或文件失效时出现黑屏。
watch(
  [
    () => theme.value.mode,
    () => theme.value.customBackground?.imagePath,
    () => theme.value.customBackground?.mediaType,
    () => theme.value.customBackground?.blur,
    () => customRenderTarget.value.width,
    () => customRenderTarget.value.height,
  ],
  async ([mode, path, configuredMediaType, blur]) => {
    const requestId = ++customMediaRequestId;
    if (mode !== 'custom' || !path) {
      renderedCustomMedia.value = null;
      customMediaReady.value = false;
      return;
    }

    const mediaType = resolveCustomBackgroundMediaType(path, configuredMediaType);
    try {
      const prepared = mediaType === 'image'
        ? await prepareCustomBackgroundImage(path, {
            target: customRenderTarget.value,
            blurCssPixels: Number(blur) || 0,
          })
        : await loadCustomBackgroundMediaMetadata(convertFileSrc(path), mediaType);
      if (requestId !== customMediaRequestId) return;

      const sourceWidth = 'sourceWidth' in prepared ? prepared.sourceWidth : prepared.width;
      const sourceHeight = 'sourceHeight' in prepared ? prepared.sourceHeight : prepared.height;
      const displayPath = 'displayPath' in prepared ? prepared.displayPath : path;
      const isPathChanged =
        renderedCustomMedia.value?.displayPath !== displayPath ||
        renderedCustomMedia.value?.mediaType !== mediaType;

      imageNaturalWidth.value = sourceWidth;
      imageNaturalHeight.value = sourceHeight;
      if (isPathChanged) {
        customMediaReady.value = false;
      }
      renderedCustomMedia.value = {
        path,
        displayPath,
        mediaType,
      };

      if (
        theme.value.customBackground.mediaType !== mediaType
        || theme.value.customBackground.imageWidth !== sourceWidth
        || theme.value.customBackground.imageHeight !== sourceHeight
      ) {
        patchTheme({
          customBackground: {
            ...theme.value.customBackground,
            mediaType,
            imageWidth: sourceWidth,
            imageHeight: sourceHeight,
          }
        });
      }
    } catch (err) {
      if (requestId === customMediaRequestId) {
        console.error('Failed to load custom theme background media', err);
      }
    }
  },
  { immediate: true }
);

const hasWindowMaterial = computed(() => activeWindowMaterial.value !== 'none');
const isMicaWindowMaterial = computed(() => activeWindowMaterial.value === 'mica');
const reduceDynamicEffects = computed(() => showPlayerDetail.value || isMainWindowLowPower.value);

const activeBackgroundInfo = computed(() => {
  const currentTheme = theme.value;

  if (currentTheme.mode === 'custom' && currentTheme.customBackground.imagePath) {
    return {
      src: currentTheme.customBackground.imagePath,
      blur: currentTheme.customBackground.blur,
      opacity: currentTheme.customBackground.opacity,
      maskColor: currentTheme.customBackground.maskColor,
      maskAlpha: currentTheme.customBackground.maskAlpha,
      scale: currentTheme.customBackground.scale,
      translateX: currentTheme.customBackground.translateX,
      translateY: currentTheme.customBackground.translateY,
      mediaType: resolveCustomBackgroundMediaType(
        currentTheme.customBackground.imagePath,
        currentTheme.customBackground.mediaType,
      ),
      isDynamic: false,
      type: 'custom' as const,
    };
  }

  if (currentTheme.dynamicBgType === 'flow') {
    return {
      src: currentCover.value,
      blur: 60,
      opacity: 0.9,
      isDynamic: true,
      type: 'flow' as const,
    };
  }

  if (currentTheme.dynamicBgType === 'blur') {
    return {
      src: currentCoverFull.value || currentCover.value,
      blur: 24,
      opacity: 0.75,
      scale: 1.25,
      isDynamic: false,
      type: 'blur' as const,
    };
  }

  return null;
});

const bgImageSrc = computed(() => {
  if (!activeBackgroundInfo.value?.src) return '';

  if (
    activeBackgroundInfo.value.src.startsWith('http') ||
    activeBackgroundInfo.value.src.startsWith('data:')
  ) {
    return activeBackgroundInfo.value.src;
  }

  return convertFileSrc(activeBackgroundInfo.value.src);
});

const customMediaSrc = computed(() => {
  const path = renderedCustomMedia.value?.displayPath;
  if (!path) return '';
  return path.startsWith('http') || path.startsWith('data:') ? path : convertFileSrc(path);
});

const shouldSuspendCustomVideo = computed(() => (
  isMainWindowLowPower.value || isCustomBackgroundPreviewOpen.value || isMiniMode.value
));
const customVideoPlaybackSrc = computed(() => (
  renderedCustomMedia.value?.mediaType === 'video' && !shouldSuspendCustomVideo.value
    ? customMediaSrc.value
    : ''
));

const syncCustomVideoPlayback = async () => {
  const video = customVideoRef.value;
  if (!video) return;

  if (shouldSuspendCustomVideo.value || !customVideoPlaybackSrc.value) {
    video.pause();
    video.removeAttribute('src');
    video.load();
    customMediaReady.value = false;
    return;
  }

  try {
    await video.play();
  } catch {
    // A later canplay event will retry playback.
  }
};

watch(
  [customVideoRef, customVideoPlaybackSrc],
  async () => {
    await nextTick();
    void syncCustomVideoPlayback();
  },
  { immediate: true },
);

const preblurredStaticBgSrc = ref('');
const isStaticBgPreblurred = ref(false);
// Keep the last displayed bitmap while hidden and until its replacement is
// ready. Background song changes must not recreate an invisible image layer.
const staticBackgroundSource = ref('');
const staticBackgroundDisplaySrc = computed(() => preblurredStaticBgSrc.value || staticBackgroundSource.value);
let fullCoverRequestId = 0;
let preblurRequestId = 0;

watch(
  [() => activeBackgroundInfo.value?.type, currentSongPath, isBackgroundPreparationSuspended],
  async ([backgroundType, path, suspended]) => {
    const requestId = ++fullCoverRequestId;
    if (suspended || backgroundType !== 'blur' || !path) {
      return;
    }

    try {
      const fullCoverUrl = await loadFullCover(path);
      if (
        requestId !== fullCoverRequestId
        || isBackgroundPreparationSuspended.value
        || currentSongPath.value !== path
        || activeBackgroundInfo.value?.type !== 'blur'
      ) {
        return;
      }

      if (fullCoverUrl) playbackStore.currentCoverFull = fullCoverUrl;
    } catch {
      if (
        requestId !== fullCoverRequestId
        || isBackgroundPreparationSuspended.value
        || currentSongPath.value !== path
        || activeBackgroundInfo.value?.type !== 'blur'
      ) {
        return;
      }

      // The playback/detail chain owns the thumbnail fallback. A background
      // failure must not overwrite a full cover another consumer has loaded.
    }
  },
  { immediate: true },
);

const staticBlurAmount = computed(() => {
  const info = activeBackgroundInfo.value;
  if (info?.type !== 'blur') {
    return 0;
  }

  return isMicaWindowMaterial.value ? Math.min(info.blur, 26) : info.blur;
});

const staticBrightness = computed(() => {
  const info = activeBackgroundInfo.value;
  return info?.type === 'blur' ? info.opacity : 1;
});

watch(
  [() => activeBackgroundInfo.value?.type, bgImageSrc, staticBlurAmount, staticBrightness, isBackgroundPreparationSuspended],
  async ([backgroundType, src, blur, brightness, suspended]) => {
    const requestId = ++preblurRequestId;
    if (suspended) return;

    if (backgroundType !== 'blur' || !src) {
      staticBackgroundSource.value = '';
      preblurredStaticBgSrc.value = '';
      isStaticBgPreblurred.value = false;
      return;
    }

    if (!staticBackgroundSource.value) {
      staticBackgroundSource.value = src;
    }

    const preblurredUrl = await getPreblurredBackgroundUrl(src, {
      blur,
      brightness,
    });

    if (
      requestId !== preblurRequestId
      || isBackgroundPreparationSuspended.value
      || activeBackgroundInfo.value?.type !== 'blur'
      || bgImageSrc.value !== src
    ) {
      return;
    }

    staticBackgroundSource.value = src;
    preblurredStaticBgSrc.value = preblurredUrl !== src ? preblurredUrl : '';
    isStaticBgPreblurred.value = preblurredUrl !== src;
  },
  { immediate: true },
);

watch(isMiniMode, async (mini, prevMini) => {
  if (prevMini && !mini) {
    await nextTick();
    updateContainerSize();
    setTimeout(updateContainerSize, 100);
  }
});

onMounted(() => {
  updateContainerSize();
  window.addEventListener('resize', updateContainerSize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateContainerSize);
  fullCoverRequestId += 1;
  preblurRequestId += 1;
  const video = customVideoRef.value;
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
});

const staticMaskClass = computed(() => {
  if (isMicaWindowMaterial.value) return 'bg-white/40 dark:bg-black/35';
  return 'bg-white/50 dark:bg-black/50';
});

const staticImageOpacity = computed(() => (isMicaWindowMaterial.value ? 0.35 : 1));

const materialScrimStyle = computed(() => {
  // Mica already supplies an opaque, theme-aware wallpaper tint. Another
  // full-window scrim washes it out; only translucent materials need one.
  if (!hasWindowMaterial.value || isMicaWindowMaterial.value) {
    return null;
  }

  if (activeWindowMaterial.value === 'transparent') {
    // A barely painted surface keeps WebView2 hit testing working at 0%.
    const opacity = Math.max(1 / 255, theme.value.windowTransparentOpacity / 100);
    return {
      backgroundColor: isDarkTheme.value
        ? `rgba(18, 18, 18, ${opacity})`
        : `rgba(250, 250, 250, ${opacity})`,
    };
  }

  if (isDarkTheme.value) {
    if (activeWindowMaterial.value === 'blur') {
      // Native blur already supplies the adjustable dark tint. A second
      // fixed mask hides the backdrop even at the slider's lowest value.
      // Keep a barely painted surface for WebView2 hit testing.
      return {
        backgroundColor: `rgba(18, 18, 18, ${1 / 255})`,
      };
    }

    return {
      backgroundColor: 'rgba(12, 14, 16, 0.34)',
    };
  }

  return {
    backgroundColor: 'rgba(250, 250, 252, 0.5)',
  };
});

const customBgGeometry = computed(() => {
  if (activeBackgroundInfo.value?.type !== 'custom') return null;
  return calculateCoverGeometry(
    containerWidth.value,
    containerHeight.value,
    imageNaturalWidth.value,
    imageNaturalHeight.value
  );
});

const customBgTransform = computed(() => {
  const info = activeBackgroundInfo.value;
  if (!info || info.type !== 'custom') {
    return { tx: 0, ty: 0, scale: 1.0 };
  }

  const blurComp = Math.min(0.08, (info.blur || 0) * 0.002);
  const renderScale = (info.scale || 1.0) + blurComp;
  
  let tx = (info.translateX || 0) * containerWidth.value;
  let ty = (info.translateY || 0) * containerHeight.value;

  if (
    customBgGeometry.value
    && containerWidth.value > 0
    && containerHeight.value > 0
  ) {
    const scaledImgW = customBgGeometry.value.width * renderScale;
    const scaledImgH = customBgGeometry.value.height * renderScale;

    const maxTxPx = Math.max(0, (scaledImgW - containerWidth.value) / 2);
    const maxTyPx = Math.max(0, (scaledImgH - containerHeight.value) / 2);

    tx = Math.max(-maxTxPx, Math.min(maxTxPx, tx));
    ty = Math.max(-maxTyPx, Math.min(maxTyPx, ty));
  }

  return {
    tx,
    ty,
    scale: renderScale
  };
});
</script>

<template>
  <div
    data-global-background
    class="fixed inset-0 z-0 overflow-hidden pointer-events-none transition-colors duration-500"
    :class="[
      theme.mode === 'custom'
        ? theme.customBackground.foregroundStyle === 'dark' ? 'bg-white' : 'bg-black'
        : hasWindowMaterial
          ? 'bg-transparent'
          : 'bg-[#fafafa] dark:bg-[#121212]',
      isMainWindowLowPower ? 'global-background--low-power' : '',
    ]"
  >
    <div
      v-if="materialScrimStyle"
      class="absolute inset-0 z-[1] transition-colors duration-500"
      :style="materialScrimStyle"
    ></div>

    <transition name="fade">
      <FlowBackground
        v-if="activeBackgroundInfo?.type === 'flow'"
        :cover-src="bgImageSrc"
        :paused="reduceDynamicEffects"
        :dark="isDarkTheme"
      />
    </transition>

    <transition name="fade-fast">
      <div
        v-if="activeBackgroundInfo?.type === 'blur' && staticBackgroundDisplaySrc"
        :key="staticBackgroundSource"
        class="absolute inset-0"
      >
        <div class="absolute inset-0 z-10 transition-colors duration-500" :class="staticMaskClass"></div>
        <img
          :src="staticBackgroundDisplaySrc"
          class="w-full h-full object-cover transition-opacity duration-1000 z-0"
          :style="{
            filter: isStaticBgPreblurred ? 'none' : `blur(${staticBlurAmount}px) brightness(${staticBrightness})`,
            transform: `scale(${activeBackgroundInfo.scale})`,
            opacity: staticImageOpacity,
          }"
        />
      </div>
    </transition>

    <transition name="fade">
      <div
        v-if="activeBackgroundInfo?.type === 'custom' && customMediaSrc && !isMiniMode"
        class="absolute inset-0 global-background-container overflow-hidden"
      >
        <div
          v-if="activeBackgroundInfo.maskAlpha !== undefined && activeBackgroundInfo.maskAlpha > 0"
          class="absolute inset-0 z-10 transition-all duration-300 pointer-events-none"
          :style="{
            backgroundColor: activeBackgroundInfo.maskColor || '#000000',
            opacity: activeBackgroundInfo.maskAlpha,
          }"
        ></div>

        <video
          v-if="customBgGeometry && renderedCustomMedia?.mediaType === 'video'"
          ref="customVideoRef"
          :src="customVideoPlaybackSrc || undefined"
          autoplay
          loop
          muted
          playsinline
          preload="metadata"
          class="absolute block max-w-none max-h-none select-none pointer-events-none transition-opacity duration-700"
          :style="{
            left: '50%',
            top: '50%',
            width: `${customBgGeometry.width}px`,
            height: `${customBgGeometry.height}px`,
            objectFit: 'fill',
            transform: `translate(calc(-50% + ${customBgTransform.tx}px), calc(-50% + ${customBgTransform.ty}px)) scale(${customBgTransform.scale})`,
            transformOrigin: 'center center',
            filter: `blur(${activeBackgroundInfo.blur}px)`,
            opacity: customMediaReady ? (activeBackgroundInfo.opacity ?? 1.0) : 0,
          }"
          @canplay="customMediaReady = true; syncCustomVideoPlayback()"
          @error="customMediaReady = false"
        />
        <img
          v-else-if="customBgGeometry"
          :src="customMediaSrc"
          class="absolute block max-w-none max-h-none select-none pointer-events-none transition-opacity duration-700"
          :style="{
            left: '50%',
            top: '50%',
            width: `${customBgGeometry.width}px`,
            height: `${customBgGeometry.height}px`,
            transform: `translate(calc(-50% + ${customBgTransform.tx}px), calc(-50% + ${customBgTransform.ty}px)) scale(${customBgTransform.scale})`,
            transformOrigin: 'center center',
            opacity: customMediaReady ? (activeBackgroundInfo.opacity ?? 1.0) : 0,
          }"
          @load="customMediaReady = true"
          @error="customMediaReady = false"
        />
      </div>
    </transition>

    <div
      v-if="!activeBackgroundInfo"
      class="absolute inset-0 transition-colors duration-300"
      :class="hasWindowMaterial ? 'bg-transparent' : 'bg-white dark:bg-[#121212]'"
    ></div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 1s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.fade-fast-enter-active,
.fade-fast-leave-active {
  transition: opacity 0.5s ease;
}

.fade-fast-enter-from,
.fade-fast-leave-to {
  opacity: 0;
}

.global-background--low-power,
.global-background--low-power * {
  animation-play-state: paused !important;
  transition: none !important;
  will-change: auto !important;
}
</style>
