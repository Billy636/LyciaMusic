<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import type { LyricLine } from '../../composables/lyrics';
import {
  LIGHT_LYRIC_PROGRESS_FRAME_MS,
  findLightLyricIndexByTime,
  getLightLyricRenderableWords,
  resolveLightLyricLineProgress,
  resolveLightLyricActiveWord,
  resolveLightLyricWordFillProgress,
} from './lightLyricPlayerModel';

const props = withDefaults(defineProps<{
  lyricLines?: LyricLine[];
  currentTime?: number;
  playing?: boolean;
  showTranslation?: boolean;
  showRomaji?: boolean;
  lineGap?: number;
  title?: string;
  artist?: string;
  album?: string;
}>(), {
  lyricLines: () => [],
  currentTime: 0,
  playing: true,
  showTranslation: true,
  showRomaji: false,
  lineGap: 1,
  title: '',
  artist: '',
  album: '',
});

const emit = defineEmits<{
  (e: 'line-click', line: LyricLine): void;
}>();

const EXTERNAL_SYNC_DRIFT_SECONDS = 0.35;

// 平滑滚动所需要的状态和 DOM 引用
const playerRef = ref<HTMLDivElement | null>(null);
const lyricLineRefs = ref<(HTMLElement | null)[]>([]);
const containerHeight = ref(450);
const isUserInteracting = ref(false);
const isMountedAndCentered = ref(false);

// 对齐比例：默认且硬性使用 0.5（物理正中心）
const anchorRatio = ref(0.5);

// 处理 lyricLineRefs 的生命周期 null 清理，防止歌曲切换或 DOM 卸载后旧引用残留
function setLyricLineRef(el: any, index: number) {
  if (el) {
    lyricLineRefs.value[index] = el as HTMLElement;
  } else {
    lyricLineRefs.value[index] = null;
  }
}

// 动态堆栈样式：用 50% 物理中心实时计算上下 padding 留白，提供完美的原生滚动位移余量
const stackStyle = computed(() => {
  const topPad = containerHeight.value * anchorRatio.value;
  const bottomPad = containerHeight.value * (1 - anchorRatio.value);
  return {
    paddingTop: `${topPad}px`,
    paddingBottom: `${bottomPad}px`,
    '--light-line-gap': props.lineGap.toString()
  };
});

const progressTime = ref(props.currentTime);
let progressFrameId = 0;
let lastFrameTime = 0;
let anchorPlaybackTime = props.currentTime;
let anchorFrameTime = 0;

const activeLineIndex = computed(() => findLightLyricIndexByTime(props.lyricLines, progressTime.value));
const activeLine = computed(() => props.lyricLines[activeLineIndex.value]);
const nextActiveLine = computed(() => props.lyricLines[activeLineIndex.value + 1]);
const activeWord = computed(() => resolveLightLyricActiveWord(activeLine.value, progressTime.value));
const activeLineProgress = computed(() => resolveLightLyricLineProgress(activeLine.value, nextActiveLine.value, progressTime.value));
const hasProgressLine = computed(() => activeLineIndex.value >= 0 && Boolean(activeLine.value));
const lineGapStyle = computed(() => ({ '--light-line-gap': props.lineGap.toString() }));

function isCreditLine(text: string): boolean {
  if (!text) return false;

  const cleanText = text.trim().toLowerCase();

  // 1. 如果行文本包含了歌手名称，判定为歌曲元数据置顶展示行 (Credit)
  if (props.artist && cleanText.includes(props.artist.trim().toLowerCase())) {
    return true;
  }

  // 2. 如果行文本包含了歌曲标题名称
  if (props.title) {
    const mainTitle = props.title.split('(')[0].split('《')[0].trim().toLowerCase();
    if (mainTitle && cleanText.includes(mainTitle)) {
      return true;
    }
  }

  // 3. 通用的歌曲元数据连接符判定
  if (cleanText.includes(' - ') || cleanText.includes(' / ')) {
    return true;
  }

  const creditKeywords = [
    /^作\s*词/i,
    /^作\s*曲/i,
    /^编\s*曲/i,
    /^词\s*：/i,
    /^曲\s*：/i,
    /^词\s*:/i,
    /^曲\s*:/i,
    /^监\s*制/i,
    /^录\s*音/i,
    /^混\s*音/i,
    /^吉\s*他/i,
    /^贝\s*斯/i,
    /^鼓\s*：/i,
    /^鼓\s*:/i,
    /^弦\s*乐/i,
    /^和\s*声/i,
    /^制\s*作\s*人/i,
    /^企\s*划/i,
    /^发\s*行/i,
    /^音\s*乐\s*制\s*作/i,
    /^由\s*.*提供/i,
    /^OP\s*：/i,
    /^SP\s*：/i,
    /^OP\s*:/i,
    /^SP\s*:/i
  ];
  return creditKeywords.some(regex => regex.test(text.trim()));
}

const firstRealLyricIndex = computed(() => {
  const lines = props.lyricLines || [];
  for (let i = 0; i < lines.length; i++) {
    const text = getLineText(lines[i]).trim();
    if (text === '') continue;

    if (!isCreditLine(text)) {
      return i;
    }
  }
  return lines.length;
});

function resetProgressAnchor() {
  progressTime.value = props.currentTime;
  anchorPlaybackTime = props.currentTime;
  anchorFrameTime = typeof performance !== 'undefined' ? performance.now() : 0;
}

function stopProgressLoop() {
  if (progressFrameId !== 0) {
    cancelAnimationFrame(progressFrameId);
    progressFrameId = 0;
  }
  lastFrameTime = 0;
}

function shouldRunProgressLoop() {
  return props.playing && hasProgressLine.value && typeof requestAnimationFrame === 'function';
}

function startProgressLoop() {
  stopProgressLoop();
  if (!shouldRunProgressLoop()) return;

  anchorPlaybackTime = progressTime.value;
  anchorFrameTime = performance.now();
  lastFrameTime = 0;

  const tick = (frameTime: number) => {
    if (!shouldRunProgressLoop()) {
      stopProgressLoop();
      return;
    }

    if (lastFrameTime === 0 || frameTime - lastFrameTime >= LIGHT_LYRIC_PROGRESS_FRAME_MS) {
      progressTime.value = anchorPlaybackTime + Math.max(0, frameTime - anchorFrameTime) / 1000;
      lastFrameTime = frameTime;
    }

    progressFrameId = requestAnimationFrame(tick);
  };

  progressFrameId = requestAnimationFrame(tick);
}

function syncExternalPlaybackTime(force = false) {
  const drift = Math.abs(props.currentTime - progressTime.value);
  if (!force && props.playing && drift <= EXTERNAL_SYNC_DRIFT_SECONDS) return;

  resetProgressAnchor();
  startProgressLoop();
}

function getWordStyle(visibleIndex: number, wordIndex: number) {
  if (visibleIndex !== activeLineIndex.value) {
    return { '--word-progress': '0%' };
  }

  const progress = resolveLightLyricWordFillProgress(activeLine.value, wordIndex, progressTime.value);
  return { '--word-progress': `${Math.round(progress * 10000) / 100}%` };
}

function getLineFillStyle(visibleIndex: number) {
  if (visibleIndex !== activeLineIndex.value || activeLine.value?.words?.length) {
    return { '--line-progress': '0%' };
  }

  return { '--line-progress': `${Math.round(activeLineProgress.value * 10000) / 100}%` };
}

function getLineText(line: LyricLine) {
  return line.text || line.words?.map((word) => word.text).join('') || '';
}

// 空间平面距离渐隐与缩放样式计算
function getLineDistanceStyle(lineIndex: number) {
  const distance = Math.abs(lineIndex - activeLineIndex.value);

  // 随着距离拉远，歌词行柔和缩小并逐步变暗淡出
  const scale = Math.max(0.92, 1 - distance * 0.02);
  const opacity = Math.max(0.12, 0.55 - (distance - 1) * 0.15);

  return {
    opacity: opacity.toFixed(2),
    transform: `scale(${scale.toFixed(3)})`
  };
}

// 融合渐隐景深样式与潜在填充样式
function getLineStyle(index: number) {
  return {
    ...getLineDistanceStyle(index),
    ...getLineFillStyle(index)
  };
}

// 统一且可复用的 DOM 精确几何中心定位函数
function scrollToActiveLine(instant = false) {
  if (isUserInteracting.value && !instant) return;

  nextTick(() => {
    const playerEl = playerRef.value;
    if (!playerEl) return;

    // 当 activeLineIndex 小于 0 时（开头），默认定位第一句真正歌词
    const targetIdx = activeLineIndex.value >= 0 
      ? activeLineIndex.value 
      : Math.min(props.lyricLines.length - 1, Math.max(0, firstRealLyricIndex.value));
    
    const activeEl = lyricLineRefs.value[targetIdx];
    if (!activeEl) return;

    const currentContainerHeight = playerEl.clientHeight || 450;
    
    // 几何中心公式计算 targetScrollTop
    const targetScrollTop = activeEl.offsetTop + activeEl.offsetHeight / 2 - currentContainerHeight * anchorRatio.value;

    playerEl.scrollTo({
      top: targetScrollTop,
      behavior: instant ? 'auto' : 'smooth',
    });
  });
}

// 虚拟阻尼滚轮/触控交互防打扰与复位逻辑
let autoScrollTimeout: ReturnType<typeof setTimeout> | null = null;

function markUserInteraction() {
  isUserInteracting.value = true;
  if (autoScrollTimeout) {
    clearTimeout(autoScrollTimeout);
  }
  autoScrollTimeout = setTimeout(() => {
    isUserInteracting.value = false;
    scrollToActiveLine(false); // 用户停止滚动 4 秒后，以高质感 smooth 平滑滚回复位，不带任何跳跃
  }, 4000);
}

function handleLineClick(line: LyricLine) {
  isUserInteracting.value = false;
  if (autoScrollTimeout) {
    clearTimeout(autoScrollTimeout);
    autoScrollTimeout = null;
  }
  // 点击跳转强行触发平滑居中定位，不使用过快动画
  scrollToActiveLine(false);
  emit('line-click', line);
}

// 仅在 activeLineIndex 发生实际值变化时才触发自动滚动，杜绝抖动
watch(activeLineIndex, () => {
  isUserInteracting.value = false;
  if (autoScrollTimeout) {
    clearTimeout(autoScrollTimeout);
    autoScrollTimeout = null;
  }
  scrollToActiveLine(false);
});

watch(() => props.currentTime, () => {
  syncExternalPlaybackTime();
});

watch(() => props.playing, () => {
  syncExternalPlaybackTime(true);
  if (!isUserInteracting.value) {
    scrollToActiveLine(false);
  }
}, { immediate: true });

// 歌词数据变化时，清空 refs 并在渲染就绪后首次瞬间定位（防闪烁）
watch(() => props.lyricLines, () => {
  syncExternalPlaybackTime(true);
  isUserInteracting.value = false;
  if (autoScrollTimeout) {
    clearTimeout(autoScrollTimeout);
    autoScrollTimeout = null;
  }
  
  // 强行清空旧的 DOM 引用，防止内存泄漏和残留
  lyricLineRefs.value = [];
  
  nextTick(() => {
    scrollToActiveLine(true); // 首次瞬间就位
  });
}, { deep: false });

// 监听视口大小变化以保证居中对齐自适应
let resizeObserver: ResizeObserver | null = null;
onMounted(() => {
  if (playerRef.value) {
    containerHeight.value = playerRef.value.clientHeight || 450;
  }

  // 挂载后的首帧渲染管线保护瞬间定位
  nextTick(() => {
    scrollToActiveLine(true);
    // 瞬间定位完成后，重绘尚未触发，此时立即可见，完全消除了闪烁跳变
    isMountedAndCentered.value = true;
  });

  if (typeof ResizeObserver !== 'undefined' && playerRef.value) {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerHeight.value = entry.contentRect.height || 450;
      }
      nextTick(() => {
        scrollToActiveLine(true); // 大小变化时瞬间无缝贴合
      });
    });
    resizeObserver.observe(playerRef.value);
  }
});

onBeforeUnmount(() => {
  stopProgressLoop();
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (autoScrollTimeout) {
    clearTimeout(autoScrollTimeout);
    autoScrollTimeout = null;
  }
});
</script>

<template>
  <div 
    ref="playerRef" 
    class="light-lyrics-player" 
    :class="{ 'light-lyrics-player--mounted': isMountedAndCentered }"
    :style="lineGapStyle" 
    @wheel="markUserInteraction"
    @mousedown="markUserInteraction"
    @touchstart="markUserInteraction"
  >
    <div
      class="light-lyrics-stack"
      :style="stackStyle"
    >
      <template v-for="(line, index) in lyricLines" :key="`${index}:${line.time}:${line.text}`">
        <!-- 制作团队团队信息行：纯展示 div 容器以防止滑动误触 -->
        <div
          v-if="index < firstRealLyricIndex"
          :ref="el => setLyricLineRef(el, index)"
          class="light-lyric-line light-lyric-line--credit"
          :style="getLineStyle(index)"
        >
          <span class="light-lyric-main">
            {{ getLineText(line) }}
          </span>
          <span v-if="showRomaji && line.romaji" class="light-lyric-subline light-lyric-romaji">
            {{ line.romaji }}
          </span>
          <span v-if="showTranslation && line.translation" class="light-lyric-subline light-lyric-translation">
            {{ line.translation }}
          </span>
        </div>

        <!-- 普通正文歌词句：支持高亮和点击切歌 -->
        <button
          v-else
          :ref="el => setLyricLineRef(el, index)"
          type="button"
          class="light-lyric-line"
          :class="{ 'light-lyric-line--active': index === activeLineIndex }"
          :style="getLineStyle(index)"
          @click="handleLineClick(line)"
        >
          <span class="light-lyric-main">
            <template v-if="line.words && line.words.length > 0">
              <span
                v-for="{ word, index: wordIndex } in getLightLyricRenderableWords(line)"
                :key="`${wordIndex}:${word.start}:${word.text}`"
                class="light-lyric-word"
                :class="{ 'light-lyric-word--active': index === activeLineIndex && activeWord?.index === wordIndex }"
                :style="getWordStyle(index, wordIndex)"
              >
                <span class="light-lyric-word-base">{{ word.text }}</span>
                <span class="light-lyric-word-fill">{{ word.text }}</span>
              </span>
            </template>
            <template v-else>
              <span class="light-lyric-line-text">
                <span class="light-lyric-line-base">{{ getLineText(line) }}</span>
                <span class="light-lyric-line-fill">{{ getLineText(line) }}</span>
              </span>
            </template>
          </span>
          <span v-if="showRomaji && line.romaji" class="light-lyric-subline light-lyric-romaji">
            {{ line.romaji }}
          </span>
          <span v-if="showTranslation && line.translation" class="light-lyric-subline light-lyric-translation">
            {{ line.translation }}
          </span>
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.light-lyrics-player {
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow-y: scroll;
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE10+ */
  box-sizing: border-box;
  padding: 0 32px; /* 增加左右安全边距，防止活跃行放大时字边缘被外层溢出裁剪遮挡 */
  color: rgba(255, 255, 255, 0.95);
  font-family: var(--lyrics-font-family, system-ui, sans-serif);
  
  /* 首帧渲染管线防闪烁淡入 */
  opacity: 0;
  transition: opacity 250ms ease;

  /* 注入 8% 比例的高性能垂直上下边缘渐隐羽化 */
  mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    rgba(0, 0, 0, 0.1) 1%,
    rgba(0, 0, 0, 0.95) 8%,
    rgba(0, 0, 0, 0.95) 92%,
    rgba(0, 0, 0, 0.1) 99%,
    transparent 100%
  );
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    rgba(0, 0, 0, 0.1) 1%,
    rgba(0, 0, 0, 0.95) 8%,
    rgba(0, 0, 0, 0.95) 92%,
    rgba(0, 0, 0, 0.1) 99%,
    transparent 100%
  );
}

.light-lyrics-player::-webkit-scrollbar {
  display: none; /* Chrome, Safari, Edge */
}

.light-lyrics-player--mounted {
  opacity: 1;
}

.light-lyrics-stack {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: calc(26px * var(--light-line-gap, 1)); /* 调大默认间距，增加视口呼吸感 */
  will-change: scroll-position, padding-top, padding-bottom;
}

.light-lyric-line {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  align-items: var(--light-align-items, flex-start);
  border: 0;
  padding: calc(6px * var(--light-line-gap, 1)) 0;
  text-align: var(--lyrics-text-align, left);
  color: rgba(255, 255, 255, 0.35); /* 默认未来行和未激活行降低亮度与透明度 */
  background: transparent;
  opacity: 0.35;
  transform: scale(0.98); /* 非激活行平面轻微缩小 */
  transform-origin: left center; /* 明确默认以靠左为放大原点，防止使用非法的 flex-start 导致浏览器回退到 center 发生向左溢出裁剪 */
  transition: opacity 550ms ease, transform 760ms cubic-bezier(0.34, 1.56, 0.64, 1); /* 物理缩放与滚动曲线联动，带有极微幅超调弹性 */
}

/* 制作团队信息置顶排版样式 */
.light-lyric-line--credit {
  font-size: 0.72em !important;
  align-items: flex-start !important;
  text-align: left !important;
  color: rgba(255, 255, 255, 0.45) !important;
  opacity: 0.45;
  cursor: default;
}

.light-lyric-line:hover {
  opacity: 0.72;
  color: rgba(255, 255, 255, 0.85);
}

.light-lyric-line--active {
  color: rgba(255, 255, 255, 0.98);
  opacity: 1 !important;
  transform: scale(1.04) !important; /* 活跃行微幅平面放大 */
  text-shadow: 0 0 20px rgba(255, 255, 255, 0.12); /* 亮白高级微阴影 */
}

/* 适配不同的对齐方式，由 CSS 容器层自适应设定 transform-origin */
:deep(.lyrics-align-center) .light-lyric-line {
  transform-origin: center center;
}
:deep(.lyrics-align-right) .light-lyric-line {
  transform-origin: right center;
}

.light-lyric-main {
  max-width: min(100%, 920px);
  font-size: calc(max(max(5vh, 2.5vw), 12px) * var(--lyrics-font-scale, 1));
  font-weight: 750;
  line-height: 1.16;
  overflow-wrap: anywhere;
}

.light-lyric-subline {
  max-width: min(100%, 900px);
  margin-top: 0.42em;
  font-size: calc(max(max(2.4vh, 1.2vw), 11px) * var(--lyrics-font-scale, 1));
  font-weight: 600;
  line-height: 1.25;
  color: rgba(255, 255, 255, 0.52);
  overflow-wrap: anywhere;
}

.light-lyric-line--active .light-lyric-subline {
  color: rgba(255, 255, 255, 0.68);
}

.light-lyric-word {
  position: relative;
  display: inline-block;
  white-space: pre-wrap;
}

.light-lyric-line-text {
  position: relative;
  display: inline-block;
  white-space: pre-wrap;
}

.light-lyric-line-fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 100%;
  -webkit-clip-path: inset(0 calc(100% - var(--line-progress, 0%)) 0 0);
  clip-path: inset(0 calc(100% - var(--line-progress, 0%)) 0 0);
  overflow: hidden;
  color: rgba(255, 255, 255, 1);
  white-space: pre-wrap;
  pointer-events: none;
}

.light-lyric-line-base {
  color: currentColor;
}

.light-lyric-word-fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 100%;
  -webkit-clip-path: inset(0 calc(100% - var(--word-progress, 0%)) 0 0);
  clip-path: inset(0 calc(100% - var(--word-progress, 0%)) 0 0);
  overflow: hidden;
  color: rgba(255, 255, 255, 1);
  white-space: pre-wrap;
  pointer-events: none;
}

.light-lyric-word-base {
  color: currentColor;
}

.light-lyric-line--active .light-lyric-word-base {
  color: rgba(255, 255, 255, 0.56);
}

.light-lyric-line--active .light-lyric-word--active .light-lyric-word-base {
  color: rgba(255, 255, 255, 0.34);
}

@media screen and (max-width: 768px) {
  .light-lyric-main {
    font-size: calc(max(8vw, 12px) * var(--lyrics-font-scale, 1));
  }

  .light-lyric-subline {
    font-size: calc(max(3.6vw, 11px) * var(--lyrics-font-scale, 1));
  }
}
</style>
