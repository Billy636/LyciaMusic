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

const { currentCover, currentCoverFull, dominantColors, showPlayerDetail } = usePlayer();
const { theme, isDarkTheme, patchTheme } = useThemeSettings();
const { activeWindowMaterial } = useWindowMaterial();
const { loadFullCover } = useCoverCache();
const { isMainWindowLowPower } = useRenderingPower();
const playbackStore = usePlaybackStore();
const { currentSongPath } = storeToRefs(playbackStore);

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

// 监听自定义背景图片路径及尺寸
watch(
  [
    () => theme.value.customBackground?.imagePath,
    () => theme.value.customBackground?.imageWidth,
    () => theme.value.customBackground?.imageHeight
  ],
  async ([path, w, h]) => {
    if (!path) {
      imageNaturalWidth.value = 0;
      imageNaturalHeight.value = 0;
      return;
    }

    // 如果配置中已经带有尺寸，直接使用
    if (w && h) {
      imageNaturalWidth.value = w;
      imageNaturalHeight.value = h;
      return;
    }

    // 否则为旧版配置，需要异步加载元数据并写回
    try {
      const img = new Image();
      img.src = convertFileSrc(path);
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      imageNaturalWidth.value = img.naturalWidth;
      imageNaturalHeight.value = img.naturalHeight;
      
      // 回写补齐配置
      patchTheme({
        customBackground: {
          ...theme.value.customBackground,
          imageWidth: img.naturalWidth,
          imageHeight: img.naturalHeight
        }
      });
    } catch (err) {
      console.error('Failed to load old custom theme background image size', err);
    }
  },
  { immediate: true }
);

const hasWindowMaterial = computed(() => activeWindowMaterial.value !== 'none');
const isMicaWindowMaterial = computed(() => activeWindowMaterial.value === 'mica');
const reduceDynamicEffects = computed(() => showPlayerDetail.value || isMainWindowLowPower.value);
const flowFallbackPalette = ['hsl(220, 28%, 34%)', 'hsl(196, 58%, 56%)', 'hsl(340, 52%, 58%)', 'hsl(42, 72%, 60%)'];
const FLOW_SCENE_TRANSITION_MS = 1180;

interface FlowLayerSnapshot {
  id: number;
  signature: string;
  state: 'entering' | 'current' | 'previous';
  shellClass: string;
  colors: string[];
  baseStyle: {
    opacity: number;
    background: string;
  };
  blobOpacity: number;
  noiseOpacity: number;
  overlayClass: string;
  overlayStyle: {
    opacity: number;
  };
  motionStyle: Record<string, string>;
  reduceDynamicEffects: boolean;
}

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
      blur: 32,
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

const dynamicShellClass = computed(() => {
  if (isMicaWindowMaterial.value) return 'bg-white/40 dark:bg-black/8';
  if (hasWindowMaterial.value) return 'bg-white/60 dark:bg-black/25';
  return 'bg-white dark:bg-[#1a1a1a]';
});

const flowColorBoostFactor = computed(() => theme.value.flowColorBoost / 100);
const flowDepthFactor = computed(() => theme.value.flowDepth / 100);
const flowSpeedFactor = computed(() => theme.value.flowSpeed / 100);
const flowTextureFactor = computed(() => theme.value.flowTexture / 100);

const resolvedFlowColors = computed(() => {
  const colors = dominantColors.value.filter(color => color && color !== 'transparent');
  return colors.length >= 3 ? colors : flowFallbackPalette;
});

const dynamicBaseOpacity = computed(() => {
  const baseOpacity = 0.36 + flowColorBoostFactor.value * 0.15 - flowDepthFactor.value * 0.05;
  return isMicaWindowMaterial.value ? Math.max(0.14, baseOpacity * 0.36) : Math.max(0.34, baseOpacity);
});

const dynamicBlobOpacity = computed(() => {
  const blobOpacity = 0.45 + flowColorBoostFactor.value * 0.18;
  return isMicaWindowMaterial.value ? Math.max(0.18, blobOpacity * 0.34) : Math.min(0.86, blobOpacity);
});

const dynamicNoiseOpacity = computed(() => {
  const noiseOpacity = 0.004 + flowTextureFactor.value * 0.022;
  return isMicaWindowMaterial.value ? noiseOpacity * 0.55 : noiseOpacity;
});

const flowMotionStyle = computed(() => {
  const speedFactor = flowSpeedFactor.value;
  const duration1 = 18 - speedFactor * 8;
  const duration2 = 22 - speedFactor * 9;
  const duration3 = 26 - speedFactor * 10;

  return {
    '--mesh-duration-1': `${duration1.toFixed(2)}s`,
    '--mesh-duration-2': `${duration2.toFixed(2)}s`,
    '--mesh-duration-3': `${duration3.toFixed(2)}s`,
  };
});

const dynamicBaseStyle = computed(() => {
  const [base, accent, edge, glow] = resolvedFlowColors.value;
  const depthFactor = flowDepthFactor.value;

  return {
    opacity: dynamicBaseOpacity.value,
    background: [
      `radial-gradient(circle at 18% 18%, ${accent} 0%, transparent ${38 + depthFactor * 8}%)`,
      `radial-gradient(circle at 82% 78%, ${glow || edge || base} 0%, transparent ${42 + depthFactor * 10}%)`,
      `linear-gradient(135deg, ${base} 0%, ${edge || accent || base} 100%)`,
    ].join(', '),
  };
});

const dynamicOverlayClass = computed(() => {
  if (isMicaWindowMaterial.value) return 'bg-white/[0.02] dark:bg-black/[0.08]';
  if (hasWindowMaterial.value) return 'bg-white/[0.02] dark:bg-black/[0.16]';
  return 'bg-white/[0.03] dark:bg-black/[0.22]';
});

const dynamicOverlayStyle = computed(() => {
  const overlayOpacity = 0.91 + flowDepthFactor.value * 0.26 - flowColorBoostFactor.value * 0.08;
  return { opacity: Math.min(1.1, Math.max(0.80, overlayOpacity)) };
});

// signature 只追踪「需要触发整层切换」的极少数条件
// 颜色变化通过 CSS transition-colors 在当前层内平滑渐变
const flowSceneSignature = computed(() => {
  if (activeBackgroundInfo.value?.type !== 'flow') return null;
  return JSON.stringify({
    shellClass: dynamicShellClass.value,
    reduceDynamicEffects: reduceDynamicEffects.value,
  });
});

const flowScene = computed(() => {
  if (activeBackgroundInfo.value?.type !== 'flow') {
    return null;
  }

  const colors = [...resolvedFlowColors.value];
  const baseStyle = { ...dynamicBaseStyle.value };
  const overlayStyle = { ...dynamicOverlayStyle.value };
  const motionStyle = { ...flowMotionStyle.value };

  return {
    signature: flowSceneSignature.value!,
    shellClass: dynamicShellClass.value,
    colors,
    baseStyle,
    blobOpacity: dynamicBlobOpacity.value,
    noiseOpacity: dynamicNoiseOpacity.value,
    overlayClass: dynamicOverlayClass.value,
    overlayStyle,
    motionStyle,
    reduceDynamicEffects: reduceDynamicEffects.value,
  };
});

const flowLayers = ref<FlowLayerSnapshot[]>([]);
const preblurredStaticBgSrc = ref('');
const isStaticBgPreblurred = ref(false);

let flowLayerId = 0;
let flowTransitionTimer: ReturnType<typeof setTimeout> | null = null;
let flowEnterAnimationFrame: number | null = null;
let fullCoverRequestId = 0;
let preblurRequestId = 0;

function clearFlowTransitionTimer() {
  if (flowTransitionTimer) {
    clearTimeout(flowTransitionTimer);
    flowTransitionTimer = null;
  }
}

function clearFlowEnterAnimationFrame() {
  if (flowEnterAnimationFrame !== null) {
    cancelAnimationFrame(flowEnterAnimationFrame);
    flowEnterAnimationFrame = null;
  }
}

function buildFlowLayerSnapshot(scene: NonNullable<typeof flowScene.value>): FlowLayerSnapshot {
  return {
    id: ++flowLayerId,
    signature: scene.signature,
    state: 'entering',
    shellClass: scene.shellClass,
    colors: scene.colors,
    baseStyle: scene.baseStyle,
    blobOpacity: scene.blobOpacity,
    noiseOpacity: scene.noiseOpacity,
    overlayClass: scene.overlayClass,
    overlayStyle: scene.overlayStyle,
    motionStyle: scene.motionStyle,
    reduceDynamicEffects: scene.reduceDynamicEffects,
  };
}

// 只有 signature 变了（颜色/shell 切换）才触发溶解过场
watch(flowSceneSignature, (newSig) => {
  if (!newSig) {
    clearFlowTransitionTimer();
    clearFlowEnterAnimationFrame();
    flowLayers.value = [];
    return;
  }

  const nextScene = flowScene.value!;
  const currentLayer = flowLayers.value.find(layer => layer.state === 'current');
  if (!currentLayer) {
    const initialLayer = buildFlowLayerSnapshot(nextScene);
    flowLayers.value = [initialLayer];
    void nextTick(() => {
      clearFlowEnterAnimationFrame();
      flowEnterAnimationFrame = requestAnimationFrame(() => {
        flowLayers.value = flowLayers.value.map(layer => (
          layer.id === initialLayer.id
            ? { ...layer, state: 'current' }
            : layer
        ));
        flowEnterAnimationFrame = null;
      });
    });
    return;
  }

  const nextLayer = buildFlowLayerSnapshot(nextScene);
  flowLayers.value = [
    { ...currentLayer, state: 'previous' },
    nextLayer,
  ];

  void nextTick(() => {
    clearFlowEnterAnimationFrame();
    flowEnterAnimationFrame = requestAnimationFrame(() => {
      flowLayers.value = flowLayers.value.map(layer => (
        layer.id === nextLayer.id
          ? { ...layer, state: 'current' }
          : layer
      ));
      flowEnterAnimationFrame = null;
    });
  });

  clearFlowTransitionTimer();
  flowTransitionTimer = setTimeout(() => {
    flowLayers.value = flowLayers.value.filter(layer => layer.state === 'current');
    flowTransitionTimer = null;
  }, FLOW_SCENE_TRANSITION_MS);
}, { immediate: true });

// 所有视觉参数变化时直接 patch 当前层（利用模板上已有的 CSS transition 平滑渐变）
watch(
  [resolvedFlowColors, dynamicBaseStyle, dynamicBlobOpacity, dynamicNoiseOpacity, dynamicOverlayClass, dynamicOverlayStyle, flowMotionStyle],
  () => {
    const nextScene = flowScene.value;
    if (!nextScene) return;
    flowLayers.value = flowLayers.value.map(layer =>
      layer.state === 'current'
        ? {
            ...layer,
            colors: nextScene.colors,
            baseStyle: nextScene.baseStyle,
            blobOpacity: nextScene.blobOpacity,
            noiseOpacity: nextScene.noiseOpacity,
            overlayClass: nextScene.overlayClass,
            overlayStyle: nextScene.overlayStyle,
            motionStyle: nextScene.motionStyle,
          }
        : layer,
    );
  },
);

watch(
  [() => activeBackgroundInfo.value?.type, currentSongPath],
  async ([backgroundType, path]) => {
    if (backgroundType !== 'blur' || !path) {
      fullCoverRequestId += 1;
      return;
    }

    const requestId = ++fullCoverRequestId;

    try {
      const fullCoverUrl = await loadFullCover(path);
      if (
        requestId !== fullCoverRequestId
        || currentSongPath.value !== path
        || activeBackgroundInfo.value?.type !== 'blur'
      ) {
        return;
      }

      playbackStore.currentCoverFull = fullCoverUrl || playbackStore.currentCover;
    } catch {
      if (
        requestId !== fullCoverRequestId
        || currentSongPath.value !== path
        || activeBackgroundInfo.value?.type !== 'blur'
      ) {
        return;
      }

      playbackStore.currentCoverFull = playbackStore.currentCover;
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
  [() => activeBackgroundInfo.value?.type, bgImageSrc, staticBlurAmount, staticBrightness],
  async ([backgroundType, src, blur, brightness]) => {
    const requestId = ++preblurRequestId;
    preblurredStaticBgSrc.value = '';
    isStaticBgPreblurred.value = false;

    if (backgroundType !== 'blur' || !src) {
      return;
    }

    const preblurredUrl = await getPreblurredBackgroundUrl(src, {
      blur,
      brightness,
    });

    if (
      requestId !== preblurRequestId
      || activeBackgroundInfo.value?.type !== 'blur'
      || bgImageSrc.value !== src
    ) {
      return;
    }

    preblurredStaticBgSrc.value = preblurredUrl;
    isStaticBgPreblurred.value = preblurredUrl !== src;
  },
  { immediate: true },
);

onMounted(() => {
  updateContainerSize();
  window.addEventListener('resize', updateContainerSize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateContainerSize);
  clearFlowTransitionTimer();
  clearFlowEnterAnimationFrame();
  fullCoverRequestId += 1;
  preblurRequestId += 1;
});

const staticMaskClass = computed(() => {
  if (isMicaWindowMaterial.value) return 'bg-white/40 dark:bg-black/35';
  return 'bg-white/50 dark:bg-black/50';
});

const staticImageOpacity = computed(() => (isMicaWindowMaterial.value ? 0.35 : 1));

const materialScrimStyle = computed(() => {
  if (!hasWindowMaterial.value) {
    return null;
  }

  if (isDarkTheme.value) {
    return {
      backgroundColor: isMicaWindowMaterial.value ? 'rgba(14, 16, 18, 0.42)' : 'rgba(12, 14, 16, 0.34)',
    };
  }

  return {
    backgroundColor: isMicaWindowMaterial.value ? 'rgba(248, 249, 251, 0.62)' : 'rgba(250, 250, 252, 0.5)',
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
  const tx = (info.translateX || 0) * containerWidth.value;
  const ty = (info.translateY || 0) * containerHeight.value;

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
        ? 'bg-black'
        : hasWindowMaterial
          ? 'bg-transparent'
          : 'bg-[#fafafa] dark:bg-[#121212]',
      isMainWindowLowPower ? 'global-background--low-power' : '',
    ]"
  >
    <div
      v-if="hasWindowMaterial"
      class="absolute inset-0 z-[1] transition-colors duration-500"
      :style="materialScrimStyle"
    ></div>

    <transition name="fade">
      <div
        v-if="activeBackgroundInfo?.isDynamic && flowLayers.length > 0"
        class="absolute inset-0 overflow-hidden"
      >
        <div
          v-for="layer in flowLayers"
          :key="layer.id"
          class="flow-layer absolute inset-0 overflow-hidden"
          :class="[
            layer.shellClass,
            layer.state === 'previous'
              ? 'flow-layer-previous'
              : layer.state === 'entering'
                ? 'flow-layer-entering'
                : 'flow-layer-current',
          ]"
          :style="layer.motionStyle"
        >
          <div
            class="absolute inset-0 transition-colors duration-[1500ms]"
            :style="layer.baseStyle"
          ></div>

          <div
            v-if="!layer.reduceDynamicEffects"
            class="absolute inset-0 filter blur-[120px]"
            :style="{ opacity: layer.blobOpacity }"
          >
            <div
              class="absolute top-[-10%] left-[-10%] h-[60%] w-[60%] rounded-full mix-blend-multiply transition-colors duration-[1500ms] dark:mix-blend-screen animate-mesh-1"
              :style="{ backgroundColor: layer.colors[1] }"
            ></div>
            <div
              class="absolute bottom-[-10%] right-[-10%] h-[60%] w-[60%] rounded-full mix-blend-multiply transition-colors duration-[1500ms] dark:mix-blend-screen animate-mesh-2"
              :style="{ backgroundColor: layer.colors[2] || layer.colors[0] }"
            ></div>
            <div
              class="absolute top-[20%] right-[-10%] h-[70%] w-[70%] rounded-full mix-blend-multiply transition-colors duration-[1500ms] dark:mix-blend-screen animate-mesh-3"
              :style="{ backgroundColor: layer.colors[3] || layer.colors[1] }"
            ></div>
          </div>

          <div
            v-if="!layer.reduceDynamicEffects"
            class="absolute inset-0 z-10 bg-noise pointer-events-none"
            :style="{ opacity: layer.noiseOpacity }"
          ></div>

          <div
            class="absolute inset-0 z-20"
            :class="layer.overlayClass"
            :style="layer.overlayStyle"
          ></div>
        </div>
      </div>
    </transition>

    <transition name="fade-fast">
      <div
        v-if="activeBackgroundInfo?.type === 'blur' && bgImageSrc"
        :key="bgImageSrc"
        class="absolute inset-0"
      >
        <div class="absolute inset-0 z-10 transition-colors duration-500" :class="staticMaskClass"></div>
        <img
          :src="preblurredStaticBgSrc || bgImageSrc"
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
      <div v-if="activeBackgroundInfo?.type === 'custom' && bgImageSrc" class="absolute inset-0 global-background-container overflow-hidden">
        <div
          v-if="activeBackgroundInfo.maskAlpha !== undefined && activeBackgroundInfo.maskAlpha > 0"
          class="absolute inset-0 z-10 transition-all duration-300 pointer-events-none"
          :style="{
            backgroundColor: activeBackgroundInfo.maskColor || '#000000',
            opacity: activeBackgroundInfo.maskAlpha,
          }"
        ></div>

        <!-- 完美的物理双层解耦图片布局 -->
        <div
          v-if="customBgGeometry"
          class="absolute"
          :style="{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: `${customBgGeometry.width}px`,
            height: `${customBgGeometry.height}px`,
            transform: 'translate(-50%, -50%)',
          }"
        >
          <img
            :src="bgImageSrc"
            class="absolute block max-w-none max-h-none select-none pointer-events-none transition-all duration-700"
            :style="{
              width: '100%',
              height: '100%',
              transform: `translate3d(${customBgTransform.tx}px, ${customBgTransform.ty}px, 0) scale(${customBgTransform.scale})`,
              transformOrigin: 'center center',
              filter: `blur(${activeBackgroundInfo.blur}px)`,
              opacity: activeBackgroundInfo.opacity ?? 1.0,
            }"
          />
        </div>
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

.flow-layer {
  will-change: opacity, transform, filter;
  transition:
    opacity 920ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 920ms cubic-bezier(0.22, 1, 0.36, 1),
    filter 920ms cubic-bezier(0.22, 1, 0.36, 1);
}

.flow-layer-current {
  opacity: 1;
  transform: scale(1);
  filter: blur(0);
}

.flow-layer-entering {
  opacity: 0;
  transform: scale(1.028);
  filter: blur(10px);
}

.flow-layer-previous {
  opacity: 0;
  transform: scale(1.048);
  filter: blur(16px);
}

.bg-noise {
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3%3Ffilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/feTurbulence%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
}

@keyframes mesh-1 {
  0% { transform: translate(-20%, 15%) scale(1) rotate(0deg); }
  25% { transform: translate(30%, -10%) scale(1.1) rotate(90deg); }
  50% { transform: translate(-15%, -25%) scale(0.9) rotate(180deg); }
  75% { transform: translate(25%, 20%) scale(1.05) rotate(270deg); }
  100% { transform: translate(-20%, 15%) scale(1) rotate(360deg); }
}

@keyframes mesh-2 {
  0% { transform: translate(25%, -20%) scale(1.1) rotate(0deg); }
  25% { transform: translate(-30%, -15%) scale(0.9) rotate(-90deg); }
  50% { transform: translate(20%, 25%) scale(1.2) rotate(-180deg); }
  75% { transform: translate(-25%, 10%) scale(1) rotate(-270deg); }
  100% { transform: translate(25%, -20%) scale(1.1) rotate(-360deg); }
}

@keyframes mesh-3 {
  0% { transform: translate(10%, 30%) scale(0.9) rotate(0deg); }
  25% { transform: translate(-25%, -20%) scale(1.2) rotate(90deg); }
  50% { transform: translate(30%, 15%) scale(1) rotate(180deg); }
  75% { transform: translate(-15%, -30%) scale(1.1) rotate(270deg); }
  100% { transform: translate(10%, 30%) scale(0.9) rotate(360deg); }
}

.animate-mesh-1 { animation: mesh-1 var(--mesh-duration-1, 14s) ease-in-out infinite; }
.animate-mesh-2 { animation: mesh-2 var(--mesh-duration-2, 18s) ease-in-out infinite; }
.animate-mesh-3 { animation: mesh-3 var(--mesh-duration-3, 22s) ease-in-out infinite; }

.global-background--low-power,
.global-background--low-power * {
  animation-play-state: paused !important;
  transition: none !important;
  will-change: auto !important;
}
</style>
