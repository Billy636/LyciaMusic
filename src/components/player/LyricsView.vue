<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useLyrics } from '../../composables/lyrics';
import { usePlayer } from '../../composables/player';

const { parsedLyrics, currentLyricIndex } = useLyrics();
const { playAt } = usePlayer();

const containerRef = ref<HTMLElement | null>(null);
const isUserScrolling = ref(false);
let scrollTimeout: any = null;

// 歌词滚动配置
const CENTER_OFFSET_PERCENT = 0.35; // 偏上一点，更有高级感
const RESUME_SCROLL_DELAY = 5000; // 手动滚动后恢复自动滚动的延迟

// 每一行歌词的引用
const lineRefs = ref<HTMLElement[]>([]);

// 精确滚动到当前行
const scrollToActiveLine = (immediate = false) => {
  // 如果用户正在手动滚动，则跳过自动滚动
  if (isUserScrolling.value || !containerRef.value || currentLyricIndex.value === -1) return;

  const container = containerRef.value;
  const activeLine = lineRefs.value[currentLyricIndex.value];
  
  if (!activeLine) return;

  const containerHeight = container.clientHeight;
  const lineTop = activeLine.offsetTop;
  const lineHeight = activeLine.clientHeight;
  
  const targetScrollTop = lineTop - (containerHeight * CENTER_OFFSET_PERCENT) + (lineHeight / 2);

  container.scrollTo({
    top: targetScrollTop,
    behavior: immediate ? 'auto' : 'smooth'
  });
};

// 监听当前歌词索引变化，触发滚动
watch(currentLyricIndex, (newIndex) => {
  if (newIndex !== -1) {
    nextTick(() => scrollToActiveLine());
  }
});

// 监听歌词数据变化
watch(parsedLyrics, () => {
  lineRefs.value = [];
  nextTick(() => scrollToActiveLine(true));
}, { deep: true });

// 处理手动滚动标识
const startUserInteraction = () => {
  isUserScrolling.value = true;
  if (scrollTimeout) clearTimeout(scrollTimeout);
  
  scrollTimeout = setTimeout(() => {
    isUserScrolling.value = false;
    scrollToActiveLine();
  }, RESUME_SCROLL_DELAY);
};

const resumeSync = () => {
  isUserScrolling.value = false;
  if (scrollTimeout) clearTimeout(scrollTimeout);
  scrollToActiveLine();
};

onMounted(() => {
  const container = containerRef.value;
  if (container) {
    container.addEventListener('wheel', startUserInteraction, { passive: true });
    container.addEventListener('touchstart', startUserInteraction, { passive: true });
    setTimeout(() => scrollToActiveLine(true), 100);
  }
});

onUnmounted(() => {
  const container = containerRef.value;
  if (container) {
    container.removeEventListener('wheel', startUserInteraction);
    container.removeEventListener('touchstart', startUserInteraction);
  }
  if (scrollTimeout) clearTimeout(scrollTimeout);
});

// 计算动态样式
const getLineStyle = (index: number) => {
  if (currentLyricIndex.value === -1) return { opacity: 0.4 };
  const distance = Math.abs(index - currentLyricIndex.value);
  
  if (index === currentLyricIndex.value) {
    return {
      opacity: 1,
      transform: 'scale(1.1)',
      fontWeight: 'bold',
      filter: 'blur(0px)',
    };
  }
  
  // 衰减
  const opacity = Math.max(0.15, 0.4 - distance * 0.05);
  const blur = Math.min(2, distance * 0.4);
  
  return {
    opacity,
    filter: `blur(${blur}px)`,
  };
};
</script>

<template>
  <div class="relative w-full h-full group/lyrics">
    <div 
      ref="containerRef"
      class="lyrics-view-container custom-scrollbar mask-gradient h-full overflow-y-auto"
    >
      <div class="lyrics-content py-[40vh]">
        <div 
          v-for="(line, index) in parsedLyrics" 
          :key="index"
          :ref="el => { if (el) lineRefs[index] = el as HTMLElement }"
          class="lyric-line group"
          :class="{ active: index === currentLyricIndex }"
          :style="getLineStyle(index)"
          @click="playAt(line.time)"
        >
          <div class="main-text">{{ line.text }}</div>
          <div v-if="line.translation" class="translation-text">{{ line.translation }}</div>
          <div v-if="line.romaji" class="romaji-text">{{ line.romaji }}</div>
        </div>

        <div v-if="parsedLyrics.length === 0" class="no-lyrics flex items-center justify-center h-full text-white/20 text-2xl">
          暂无歌词
        </div>
      </div>
    </div>

    <!-- 恢复同步按钮 -->
    <transition name="fade">
      <button 
        v-if="isUserScrolling"
        @click="resumeSync"
        class="absolute bottom-8 right-0 bg-white/10 hover:bg-white/20 backdrop-blur-md text-white/80 px-4 py-2 rounded-full text-sm font-medium transition flex items-center gap-2 border border-white/10 shadow-xl"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
        恢复同步
      </button>
    </transition>
  </div>
</template>

<style scoped>
.lyrics-view-container {
  scrollbar-width: none;
  scroll-behavior: smooth; 
}

.lyrics-view-container::-webkit-scrollbar {
  display: none;
}

.lyric-line {
  cursor: pointer;
  transition: all 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  transform-origin: left center;
  text-align: left;
  width: 100%;
  padding: 1.5rem 48px 1.5rem 2rem; 
  user-select: none;
  overflow-wrap: break-word;
  word-wrap: break-word;
  white-space: normal;
}

.main-text {
  font-size: 2.8rem;
  line-height: 1.2;
  color: white;
  transition: all 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.translation-text {
  font-size: 1.5rem;
  margin-top: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
}

.romaji-text {
  font-size: 1.1rem;
  margin-top: 0.4rem;
  color: rgba(255, 255, 255, 0.3);
}

.mask-gradient {
  mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    black 15%,
    black 85%,
    transparent 100%
  );
}

.active .main-text {
  color: #fff;
  text-shadow: 0 0 30px rgba(255,255,255,0.2);
}

.lyric-line:not(.active):hover .main-text {
  color: rgba(255, 255, 255, 0.8);
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>