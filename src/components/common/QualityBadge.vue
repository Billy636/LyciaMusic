<script setup lang="ts">
import { computed, ref } from 'vue';

// 接收父组件传来的参数
const props = defineProps<{
  bitrate: number;
  sampleRate: number;
  bitDepth?: number;
  format: string;
}>();

// 控制悬浮提示的显示与隐藏
const isHovered = ref(false);
const badgeRef = ref<HTMLElement | null>(null);
const tooltipStyle = ref({});

// 1. 判断音质等级 (HR / SQ / HQ)
const badgeType = computed(() => {
  // HR: 采样率 > 44.1kHz 或 位深 > 16bit
  if (props.sampleRate > 44100 || (props.bitDepth && props.bitDepth > 16)) {
    return 'HR';
  }
  // SQ: 无损格式 (flac, wav, alac, ape)
  const losslessFormats = ['flac', 'wav', 'alac', 'ape'];
  if (losslessFormats.includes(props.format.toLowerCase())) {
    return 'SQ';
  }
  // HQ: 320k mp3/aac
  if (props.bitrate >= 320000) {
    return 'HQ';
  }
  return null; // 其他情况不显示
});

// 2. 定义颜色样式
const badgeColorClass = computed(() => {
  // 统一使用实心背景风格 (Solid Style)
  const common = 'text-white font-bold border border-transparent';
  switch (badgeType.value) {
    case 'HR':
      return `${common} bg-[#EAB308]`; // 实心金色
    case 'SQ':
      return `${common} bg-sky-500`;   // 实心天蓝色 (原青色 -> 天蓝)
    case 'HQ':
      return `${common} bg-gray-400`;   // 实心灰色
    default:
      return '';
  }
});

// 4. 生成分级提示内容 (Tiered Tooltip Content)
const tooltipContent = computed(() => {
  const fmt = props.format?.toUpperCase() || '';
  const kbps = Math.round((props.bitrate || 0) / 1000);
  
  // Format technical subtitle: e.g. "24bit / 96kHz · FLAC"
  let sub = '';
  if (props.bitDepth) sub += `${props.bitDepth}bit / `;
  if (props.sampleRate) sub += `${props.sampleRate / 1000}kHz · `;
  sub += fmt;

  // Priority 1: Master Quality (bitDepth >= 24)
  if (props.bitDepth && props.bitDepth >= 24) {
    return {
      emoji: '✨',
      title: '母带级超清音质',
      subtitle: sub,
      isMaster: true 
    };
  }

  // Priority 2: CD Quality (Lossless & bitDepth == 16)
  const losslessFormats = ['FLAC', 'WAV', 'ALAC', 'APE'];
  if (losslessFormats.includes(fmt) && (!props.bitDepth || props.bitDepth === 16)) {
     return {
      emoji: '💿',
      title: '无损 CD 音质',
      subtitle: sub,
      isMaster: false
    };
  }

  // Priority 3: HQ (bitrate >= 320k)
  if (props.bitrate >= 320000) {
    return {
      emoji: '🎵',
      title: '高品质音乐',
      subtitle: `${kbps}kbps · ${fmt}`,
      isMaster: false
    };
  }

  // Priority 4: Standard
  return {
    emoji: '',
    title: '标准音质',
    subtitle: `${kbps}kbps · ${fmt}`,
    isMaster: false
  };
});

const showTooltip = () => {
    isHovered.value = true;
    updateTooltipPosition();
};

const hideTooltip = () => {
    isHovered.value = false;
};

const updateTooltipPosition = () => {
    if (badgeRef.value) {
        const rect = badgeRef.value.getBoundingClientRect();
        tooltipStyle.value = {
            top: `${rect.top}px`,
            left: `${rect.left + rect.width / 2}px`,
        };
    }
};

</script>

<template>
  <div 
    v-if="badgeType" 
    ref="badgeRef"
    class="relative flex items-center mt-[2px]"
    @mouseenter="showTooltip"
    @mouseleave="hideTooltip"
  >
    <span 
      class="text-[6px] font-medium border px-0.5 rounded-[3px] cursor-help select-none flex items-center justify-center h-[10px] leading-none transition-colors"
      :class="badgeColorClass"
    >
      {{ badgeType }}
    </span>

    <Teleport to="body">
        <Transition 
          enter-active-class="tooltip-enter-active"
          enter-from-class="opacity-0 scale-90 blur-[8px] translate-y-2"
          enter-to-class="opacity-100 scale-100 blur-0 translate-y-0"
          leave-active-class="transition-all duration-150 ease-in"
          leave-from-class="opacity-100 scale-100 translate-y-0"
          leave-to-class="opacity-0 scale-95 translate-y-1"
        >
        <div 
            v-if="isHovered"
            class="fixed z-[9999] pointer-events-none"
            :style="tooltipStyle"
        >
            <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap">
                <!-- Inner Highlight Ring -->
                <div class="px-3 py-2 bg-white/95 dark:bg-zinc-800/95 backdrop-blur-xl border border-white/20 dark:border-white/10 rounded-lg shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.3)] flex flex-col items-center gap-0.5 ring-1 ring-white/20 dark:ring-white/5">
                    
                    <!-- Line 1: Main Title (Big & Bold) -->
                    <!-- Gold Gradient for Master Quality, normal colors for others -->
                    <!-- Emoji rendered separately to prevent color inheritance -->
                    <div class="flex items-center gap-1 text-xs font-bold leading-normal">
                      <span v-if="tooltipContent.emoji" class="text-base">{{ tooltipContent.emoji }}</span>
                      <span :class="tooltipContent.isMaster ? 'bg-gradient-to-r from-amber-500 to-yellow-600 bg-clip-text text-transparent' : 'text-gray-900 dark:text-gray-100'">
                        {{ tooltipContent.title }}
                      </span>
                    </div>

                    <!-- Line 2: Technical Subtitle (Small & Faded) -->
                    <div class="flex items-center gap-1.5 opacity-60 text-gray-700 dark:text-gray-300">
                        <span class="font-mono text-[10px] tracking-tight">{{ tooltipContent.subtitle }}</span>
                    </div>
                </div>
                
                <!-- Triangle indicator -->
                <div class="w-3 h-3 bg-white/95 dark:bg-zinc-800/95 backdrop-blur-xl border-r border-b border-white/20 dark:border-white/10 transform rotate-45 absolute -bottom-1.5 left-1/2 -translate-x-1/2 shadow-[4px_4px_4px_rgba(0,0,0,0.05)]"></div>
            </div>
        </div>
        </Transition>
    </Teleport>
  </div>

</template>

<style scoped>
/* Separated transition durations for Opacity vs Transform/Filter
   Opacity becomes solid almost instantly (0.05s) to hide X-ray effect,
   while Transform pops smoothly (0.2s) */
.tooltip-enter-active {
  transition-property: opacity, transform, filter;
  transition-duration: 0.05s, 0.2s, 0.2s;
  transition-timing-function: ease-out, cubic-bezier(0.16, 1, 0.3, 1), cubic-bezier(0.16, 1, 0.3, 1);
}
</style>
