<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';

import { useCustomThemeModal } from '../../composables/useCustomThemeModal';
import { calculateCoverGeometry } from '../../composables/useThemeBackgroundGeometry';

const emit = defineEmits(['close']);
const {
  preview,
  handleSelectImage,
  handleCancel: discardThemeDraft,
  handleSave: applyThemeDraft,
} = useCustomThemeModal();

const foregroundOptions = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
] as const;

const isDarkForeground = computed(() => preview.value.foregroundStyle === 'dark');

const handleCancel = () => {
  discardThemeDraft();
  emit('close');
};

const handleSave = () => {
  applyThemeDraft();
  emit('close');
};

// --- 背景物理与视口几何管理 ---
const containerRef = ref<HTMLDivElement | null>(null);
const isDragging = ref(false);
let startX = 0;
let startY = 0;
let startTranslateX = 0;
let startTranslateY = 0;

const viewportWidth = ref(0);
const viewportHeight = ref(0);
const imageNaturalWidth = ref(preview.value.imageWidth || 0);
const imageNaturalHeight = ref(preview.value.imageHeight || 0);

// 模糊安全膨胀（防漏底保守化）
const blurCompensation = computed(() => Math.min(0.08, (preview.value.blur || 0) * 0.002));
const renderScale = computed(() => Math.max(1.0, (preview.value.scale || 1.0) + blurCompensation.value));

// 共享几何尺寸计算
const viewportGeometry = computed(() => {
  return calculateCoverGeometry(
    viewportWidth.value,
    viewportHeight.value,
    imageNaturalWidth.value,
    imageNaturalHeight.value
  );
});

// 计算当前图片在 Viewport 中是否存在可拖拽物理余地
const canDrag = computed(() => {
  if (!preview.value.imagePath || !viewportGeometry.value || viewportWidth.value <= 0 || viewportHeight.value <= 0) return false;

  const safeScale = Math.max(1.0, (preview.value.scale || 1.0) + blurCompensation.value);
  const scaledImgW = viewportGeometry.value.width * safeScale;
  const scaledImgH = viewportGeometry.value.height * safeScale;

  const maxTxPx = Math.max(0, (scaledImgW - viewportWidth.value) / 2);
  const maxTyPx = Math.max(0, (scaledImgH - viewportHeight.value) / 2);

  return maxTxPx > 0.5 || maxTyPx > 0.5;
});

// 探测大背景的宽高比以对齐几何
const getActualBackgroundRatio = () => {
  const bgEl = document.querySelector('[data-global-background]');
  if (bgEl) {
    const rect = bgEl.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return rect.width / rect.height;
    }
  }
  return window.innerWidth / window.innerHeight;
};

// 动态更新 Viewport 尺寸
const updateViewportSize = () => {
  if (!containerRef.value) return;
  const containerRect = containerRef.value.getBoundingClientRect();
  const W_max = containerRect.width;
  const H_max = containerRect.height;

  if (W_max <= 0 || H_max <= 0) return;

  const R_win = getActualBackgroundRatio();

  let w = W_max;
  let h = W_max / R_win;

  if (h > H_max) {
    h = H_max;
    w = H_max * R_win;
  }

  viewportWidth.value = Math.floor(w);
  viewportHeight.value = Math.floor(h);
};

// --- 精密防漏底边界 Clamp 函数 ---
const getClampedTranslation = (tx: number, ty: number, scale = preview.value.scale) => {
  if (!viewportGeometry.value) {
    return { tx: 0, ty: 0 };
  }

  const safeScale = Math.max(1.0, scale + blurCompensation.value);
  const scaledImgW = viewportGeometry.value.width * safeScale;
  const scaledImgH = viewportGeometry.value.height * safeScale;

  // 根据物理公式，平移最大像素限制为 (S * W_img - W) / 2
  const maxTxPx = Math.max(0, (scaledImgW - viewportWidth.value) / 2);
  const maxTyPx = Math.max(0, (scaledImgH - viewportHeight.value) / 2);

  // 转换比例值为像素
  const txPx = tx * viewportWidth.value;
  const tyPx = ty * viewportHeight.value;

  // 物理 Clamp 限幅
  const clampedTxPx = Math.max(-maxTxPx, Math.min(maxTxPx, txPx));
  const clampedTyPx = Math.max(-maxTyPx, Math.min(maxTyPx, tyPx));

  return {
    tx: clampedTxPx / viewportWidth.value,
    ty: clampedTyPx / viewportHeight.value,
  };
};

// --- 拖拽与缩放事件同步 Inline 处理 ---
const handlePointerDown = (e: PointerEvent) => {
  if (!preview.value.imagePath || !canDrag.value) return;
  
  e.preventDefault();

  const container = e.currentTarget as HTMLDivElement;
  startX = e.clientX;
  startY = e.clientY;
  startTranslateX = preview.value.translateX || 0;
  startTranslateY = preview.value.translateY || 0;
  
  container.setPointerCapture(e.pointerId);
  isDragging.value = true;
};

const handlePointerMove = (e: PointerEvent) => {
  if (!isDragging.value || viewportWidth.value <= 0 || viewportHeight.value <= 0) return;
  
  const deltaX = e.clientX - startX;
  const deltaY = e.clientY - startY;
  
  const rawTx = startTranslateX + deltaX / viewportWidth.value;
  const rawTy = startTranslateY + deltaY / viewportHeight.value;
  
  // 在事件中当场执行物理 Clamp 限制，极速渲染
  const clamped = getClampedTranslation(rawTx, rawTy);
  
  preview.value.translateX = clamped.tx;
  preview.value.translateY = clamped.ty;
};

const endDrag = (e: PointerEvent) => {
  if (!isDragging.value) return;
  const container = e.currentTarget as HTMLDivElement;
  if (container.hasPointerCapture(e.pointerId)) {
    try {
      container.releasePointerCapture(e.pointerId);
    } catch {}
  }
  isDragging.value = false;
};

const handlePointerUp = (e: PointerEvent) => {
  endDrag(e);
};

const handlePointerCancel = (e: PointerEvent) => {
  endDrag(e);
};

const handleLostPointerCapture = (e: PointerEvent) => {
  endDrag(e);
};

const handleWheel = (e: WheelEvent) => {
  if (!preview.value.imagePath || viewportWidth.value <= 0 || viewportHeight.value <= 0) return;

  // 阻止外层容器联动滚动
  e.preventDefault();

  const viewportElement = document.getElementById('skin-preview-viewport');
  if (!viewportElement) return;

  const viewportRect = viewportElement.getBoundingClientRect();
  
  // 1. 计算以 Viewport 物理几何中心为原点的鼠标坐标
  const cursorX = e.clientX - viewportRect.left - viewportWidth.value / 2;
  const cursorY = e.clientY - viewportRect.top - viewportHeight.value / 2;

  // 2. 物理平移像素值
  const oldScale = preview.value.scale || 1.0;
  const oldTxPx = (preview.value.translateX || 0) * viewportWidth.value;
  const oldTyPx = (preview.value.translateY || 0) * viewportHeight.value;

  // 3. 滚轮步进，强制限制 minScale = 1.0
  const zoomStep = 0.05;
  const delta = e.deltaY < 0 ? zoomStep : -zoomStep;
  let nextScale = oldScale + delta;
  nextScale = Math.max(1.0, Math.min(2.0, nextScale));
  nextScale = Math.round(nextScale * 100) / 100;

  if (nextScale === oldScale) return;

  // 4. 精密悬浮锚点物理公式
  const ratio = nextScale / oldScale;
  const nextTxPx = cursorX - (cursorX - oldTxPx) * ratio;
  const nextTyPx = cursorY - (cursorY - oldTyPx) * ratio;

  const nextTx = nextTxPx / viewportWidth.value;
  const nextTy = nextTyPx / viewportHeight.value;

  // 5. 当场执行 Clamp 并写入 Vue ref
  const clamped = getClampedTranslation(nextTx, nextTy, nextScale);

  preview.value.scale = nextScale;
  preview.value.translateX = clamped.tx;
  preview.value.translateY = clamped.ty;
};

// --- 低频安全补偿 Clamp 触发器 ---
watch(
  [viewportWidth, viewportHeight, imageNaturalWidth, imageNaturalHeight, () => preview.value.scale],
  () => {
    if (viewportWidth.value <= 0 || viewportHeight.value <= 0) return;
    const clamped = getClampedTranslation(preview.value.translateX || 0, preview.value.translateY || 0);
    preview.value.translateX = clamped.tx;
    preview.value.translateY = clamped.ty;
  }
);

// --- 挂载与销毁生命周期生命体征 ---
let resizeObserver: ResizeObserver | null = null;

onMounted(async () => {
  updateViewportSize();
  window.addEventListener('resize', updateViewportSize);

  if (typeof ResizeObserver !== 'undefined' && containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      updateViewportSize();
    });
    resizeObserver.observe(containerRef.value);
  }

  // 旧皮肤配置的异步高度模糊补偿与尺寸补齐回写机制
  if (preview.value.imagePath && (!imageNaturalWidth.value || !imageNaturalHeight.value)) {
    try {
      const img = new Image();
      img.src = convertFileSrc(preview.value.imagePath);
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      imageNaturalWidth.value = img.naturalWidth;
      imageNaturalHeight.value = img.naturalHeight;
      preview.value.imageWidth = img.naturalWidth;
      preview.value.imageHeight = img.naturalHeight;
    } catch {}
  }
});

onUnmounted(() => {
  window.removeEventListener('resize', updateViewportSize);
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
});

const handleSelectNewImage = async () => {
  const oldImagePath = preview.value.imagePath;
  await handleSelectImage();
  const newImagePath = preview.value.imagePath;

  if (newImagePath && newImagePath !== oldImagePath) {
    preview.value.scale = 1.0;
    preview.value.translateX = 0;
    preview.value.translateY = 0;

    // 获取新选图片的真实宽高并写入持久化 preview 对象中
    try {
      const img = new Image();
      img.src = convertFileSrc(newImagePath);
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      imageNaturalWidth.value = img.naturalWidth;
      imageNaturalHeight.value = img.naturalHeight;
      preview.value.imageWidth = img.naturalWidth;
      preview.value.imageHeight = img.naturalHeight;
    } catch (err) {
      console.error('Failed to load image size metadata', err);
      imageNaturalWidth.value = 0;
      imageNaturalHeight.value = 0;
      preview.value.imageWidth = 0;
      preview.value.imageHeight = 0;
    }
  }
};
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div class="flex max-h-[calc(100vh-2rem)] w-full max-w-[500px] flex-col overflow-hidden rounded-2xl border border-white/20 bg-black/40 text-white shadow-2xl backdrop-blur-md">
        <div class="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div class="flex items-center gap-3">
            <span class="text-base font-bold">自定义皮肤</span>
            <button
              @click="handleSelectNewImage"
              class="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-white/90 backdrop-blur-md transition hover:bg-white/10 active:scale-95 shadow-sm cursor-pointer"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-white/70" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clip-rule="evenodd" />
              </svg>
              <span>选择本地图片</span>
            </button>
          </div>
          <button @click="handleCancel" class="text-white/50 transition hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
            </svg>
          </button>
        </div>

        <div class="flex-1 overflow-y-auto">
          <div class="flex flex-col gap-6 p-6">
            <div
              ref="containerRef"
              @pointerdown="handlePointerDown"
              @pointermove="handlePointerMove"
              @pointerup="handlePointerUp"
              @pointercancel="handlePointerCancel"
              @lostpointercapture="handleLostPointerCapture"
              @wheel="handleWheel"
              class="group relative h-48 w-full overflow-hidden rounded-xl border border-white/5 bg-[#1a1a1a] select-none touch-none flex items-center justify-center"
              style="isolation: isolate;"
              :class="{
                'cursor-grab': canDrag && !isDragging,
                'cursor-grabbing': canDrag && isDragging
              }"
            >
              <!-- 比例自适应的真实裁剪 Viewport -->
              <div
                id="skin-preview-viewport"
                class="relative overflow-visible z-10 transition-all duration-300"
                :style="{
                  width: `${viewportWidth}px`,
                  height: `${viewportHeight}px`
                }"
              >
                <div v-if="preview.imagePath" class="absolute inset-0">
                  <!-- 物理双层解耦图片布局 -->
                  <div
                    v-if="viewportGeometry"
                    class="absolute"
                    :style="{
                      position: 'absolute',
                      left: '50%',
                      top: '50%',
                      width: `${viewportGeometry.width}px`,
                      height: `${viewportGeometry.height}px`,
                      transform: 'translate(-50%, -50%)',
                    }"
                  >
                    <img
                      :src="convertFileSrc(preview.imagePath)"
                      class="absolute block max-w-none max-h-none select-none pointer-events-none"
                      :style="{
                        width: '100%',
                        height: '100%',
                        transform: `translate3d(${(preview.translateX || 0) * viewportWidth}px, ${(preview.translateY || 0) * viewportHeight}px, 0) scale(${renderScale})`,
                        transformOrigin: 'center center',
                        filter: `blur(${preview.blur}px)`,
                        opacity: preview.opacity ?? 1.0,
                      }"
                    />
                  </div>

                  <!-- 纯色混合遮罩层，z-index: 5 -->
                  <div
                    class="absolute inset-0 z-[5] pointer-events-none"
                    :style="{ backgroundColor: preview.maskColor, opacity: preview.maskAlpha }"
                  ></div>
                </div>

                <div v-else class="absolute inset-0 flex flex-col items-center justify-center text-white/20 pointer-events-none bg-[#1a1a1a]">
                  <svg xmlns="http://www.w3.org/2000/svg" class="mb-2 h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span class="text-xs">未选择图片</span>
                </div>

                <!-- 镂空遮罩与 dashed 虚线框层，z-index: 10 -->
                <div
                  class="absolute inset-0 z-10 pointer-events-none border border-dashed border-white/50 rounded-[4px] transition-all duration-300"
                  :class="{
                    'shadow-[0_0_0_9999px_rgba(0,0,0,0.65)]': preview.imagePath
                  }"
                ></div>

                <!-- 智能悬浮标签，z-index: 20 -->
                <div
                  v-if="preview.imagePath"
                  class="absolute right-2 top-2 z-20 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-medium tracking-wider text-white/40 backdrop-blur-sm transition-opacity duration-300 group-hover:opacity-0"
                >
                  软件背景区域
                </div>

                <!-- 字体及预览文字层，z-index: 30，移入虚线 Viewport 内部以保证真实预览对比度 -->
                <div 
                  v-if="preview.imagePath" 
                  class="absolute inset-x-0 bottom-0 z-30 px-3 pb-3 pointer-events-none animate-in fade-in duration-300"
                >
                  <div class="flex items-end justify-between gap-3">
                    <div class="min-w-0">
                      <div
                        class="text-[10px] font-medium uppercase tracking-[0.2em]"
                        :class="isDarkForeground ? 'text-black/45' : 'text-white/60'"
                      >
                        字体预览
                      </div>
                      <div
                        class="mt-1 truncate text-base font-bold"
                        :class="isDarkForeground ? 'text-[#111111] drop-shadow-[0_1px_6px_rgba(255,255,255,0.18)]' : 'text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.4)]'"
                      >
                        夜航星
                      </div>
                      <div
                        class="mt-1 truncate text-[12px]"
                        :class="isDarkForeground ? 'text-black/65' : 'text-white/72'"
                      >
                        浅色和深色字体会直接预览在这里
                      </div>
                    </div>

                    <div
                      class="shrink-0 text-[11px] font-semibold"
                      :class="isDarkForeground ? 'text-black/70' : 'text-white/85'"
                    >
                      {{ preview.foregroundStyle === 'light' ? '浅色字体' : '深色字体' }}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="space-y-5">
              <div class="space-y-2">
                <div class="flex items-center justify-between text-xs text-white/60">
                  <span>模糊度</span>
                  <span>{{ preview.blur }}px</span>
                </div>
                <input
                  v-model.number="preview.blur"
                  type="range"
                  min="0"
                  max="50"
                  step="1"
                  class="w-full cursor-pointer appearance-none rounded-lg bg-white/10 accent-[#EC4141]"
                />
              </div>

              <div class="space-y-2">
                <div class="flex items-center justify-between text-xs text-white/60">
                  <span>遮罩浓度</span>
                  <span>{{ Math.round(preview.maskAlpha * 100) }}%</span>
                </div>
                <input
                  v-model.number="preview.maskAlpha"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  class="w-full cursor-pointer appearance-none rounded-lg bg-white/10 accent-[#EC4141]"
                />
              </div>

              <div class="space-y-2">
                <div class="flex items-center justify-between text-xs text-white/60">
                  <span>背景亮度</span>
                  <span>{{ Math.round(preview.opacity * 100) }}%</span>
                </div>
                <input
                  v-model.number="preview.opacity"
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.01"
                  class="w-full cursor-pointer appearance-none rounded-lg bg-white/10 accent-[#EC4141]"
                />
              </div>

              <div class="space-y-2">
                <div class="flex items-center justify-between text-xs text-white/60">
                  <span>画面缩放</span>
                  <span>{{ preview.scale.toFixed(2) }}x</span>
                </div>
                <input
                  v-model.number="preview.scale"
                  type="range"
                  min="1"
                  max="2.0"
                  step="0.01"
                  class="w-full cursor-pointer appearance-none rounded-lg bg-white/10 accent-[#EC4141]"
                />
              </div>

              <div class="space-y-2">
                <div class="flex items-center justify-between text-xs text-white/60">
                  <span>字体颜色</span>
                </div>
                <div class="flex gap-1 rounded-lg bg-white/10 p-1">
                  <button
                    v-for="option in foregroundOptions"
                    :key="option.value"
                    @click="preview.foregroundStyle = option.value"
                    class="flex-1 rounded-md py-1.5 text-xs font-medium transition-all"
                    :class="preview.foregroundStyle === option.value ? 'bg-[#EC4141] text-white shadow-sm' : 'text-white/60 hover:bg-white/5 hover:text-white'"
                  >
                    {{ option.label }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="flex gap-4 border-t border-white/10 bg-[#242424] px-6 py-4">
          <button @click="handleCancel" class="flex-1 rounded-full border border-white/10 py-2.5 text-sm font-medium transition hover:bg-white/5">
            取消
          </button>
          <button
            @click="handleSave"
            :disabled="!preview.imagePath"
            class="flex-1 rounded-full bg-[#EC4141] py-2.5 text-sm font-bold text-white transition hover:bg-[#d13a3a] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[#EC4141]"
          >
            保存并使用
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
input[type='range'] {
  height: 6px;
}

input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  background: white;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.3);
}

.scale-layer {
  -webkit-user-drag: none;
  user-select: none;
  pointer-events: none;
}
</style>
