<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue';

const TEXT = {
  other: '\u5176\u4ed6',
  losslessRate: '\u65e0\u635f\u5360\u6bd4',
};

const props = defineProps<{
  hires: number;
  superQuality: number;
  highQuality: number;
  other: number;
}>();

const useAnimatedNumber = (target: number, duration = 1500) => {
  const current = ref(0);

  const animate = () => {
    const start = current.value;
    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 4);
      current.value = start + (target - start) * ease;

      if (progress < 1) {
        requestAnimationFrame(tick);
      }
    };

    requestAnimationFrame(tick);
  };

  watch(() => target, animate);
  onMounted(animate);
  return current;
};

const total = computed(() => props.hires + props.superQuality + props.highQuality + props.other);

const rawData = computed(() => [
  { id: 'hires', name: 'HR', label: 'Hi-Res', value: props.hires, startColor: '#f59e0b', endColor: '#fbbf24', bgClass: 'bg-gradient-to-br from-amber-400 to-amber-600', shadowColor: 'rgba(245, 158, 11, 0.5)' },
  { id: 'sq', name: 'SQ', label: 'Super Quality', value: props.superQuality, startColor: '#3b82f6', endColor: '#60a5fa', bgClass: 'bg-gradient-to-br from-blue-400 to-blue-600', shadowColor: 'rgba(59, 130, 246, 0.5)' },
  { id: 'hq', name: 'HQ', label: 'High Quality', value: props.highQuality, startColor: '#10b981', endColor: '#34d399', bgClass: 'bg-gradient-to-br from-emerald-400 to-emerald-600', shadowColor: 'rgba(16, 185, 129, 0.5)' },
  { id: 'other', name: TEXT.other, label: 'Standard', value: props.other, startColor: '#6b7280', endColor: '#9ca3af', bgClass: 'bg-gradient-to-br from-gray-400 to-gray-600', shadowColor: 'rgba(107, 114, 128, 0.5)' },
]);

const hoveredSegmentId = ref<string | null>(null);

const segments = computed(() => {
  if (total.value === 0) {
    return [];
  }

  let currentAngle = 0;
  const radius = 40;
  const circumference = 2 * Math.PI * radius;

  return rawData.value
    .map(item => {
      const percentage = (item.value / total.value) * 100;
      const dashArray = (percentage / 100) * circumference;
      const segment = {
        ...item,
        percentage,
        displayPercentage: percentage.toFixed(1),
        strokeDasharray: `${dashArray} ${circumference - dashArray}`,
        strokeDashoffset: -currentAngle,
      };
      currentAngle += (percentage / 100) * circumference;
      return segment;
    })
    .filter(segment => segment.value > 0);
});

const losslessCount = computed(() => props.hires + props.superQuality);
const losslessPercentRaw = computed(() => (total.value === 0 ? 0 : (losslessCount.value / total.value) * 100));
const animatedLosslessPercent = useAnimatedNumber(losslessPercentRaw.value, 2000);
</script>

<template>
  <div class="flex flex-col md:flex-row items-center justify-center gap-12 p-8 w-full max-w-4xl mx-auto">
    <div class="relative group cursor-default">
      <div class="absolute inset-0 bg-pink-500/20 rounded-full blur-3xl transform scale-75 opacity-50 group-hover:opacity-80 transition-opacity duration-1000"></div>

      <div class="relative w-64 h-64 md:w-80 md:h-80 transition-transform duration-500 hover:scale-105">
        <svg class="w-full h-full transform -rotate-90 drop-shadow-2xl" viewBox="0 0 100 100">
          <defs>
            <linearGradient v-for="segment in rawData" :key="`grad-${segment.id}`" :id="`grad-${segment.id}`" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" :stop-color="segment.startColor" />
              <stop offset="100%" :stop-color="segment.endColor" />
            </linearGradient>
          </defs>

          <circle cx="50" cy="50" r="40" fill="none" stroke="#e5e7eb" class="dark:stroke-white/5" stroke-width="8" />

          <circle
            v-for="(segment, index) in segments"
            :key="segment.id"
            cx="50"
            cy="50"
            r="40"
            fill="none"
            :stroke="`url(#grad-${segment.id})`"
            :stroke-width="hoveredSegmentId === segment.id ? 10 : 8"
            stroke-linecap="round"
            :stroke-dasharray="segment.strokeDasharray"
            :stroke-dashoffset="segment.strokeDashoffset"
            class="transition-all duration-300 cursor-pointer"
            :class="{ 'opacity-30': hoveredSegmentId && hoveredSegmentId !== segment.id }"
            @mouseenter="hoveredSegmentId = segment.id"
            @mouseleave="hoveredSegmentId = null"
            style="transform-origin: 50px 50px;"
          >
            <animate attributeName="stroke-dashoffset" :from="segment.strokeDashoffset + 251.2" :to="segment.strokeDashoffset" dur="1s" calcMode="spline" keySplines="0.16 1 0.3 1" fill="freeze" :begin="`${index * 0.1}s`" />
          </circle>
        </svg>

        <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div class="text-center">
            <span class="block text-4xl md:text-5xl font-black text-gray-900 dark:text-white tracking-tighter tabular-nums">
              {{ animatedLosslessPercent.toFixed(1) }}<span class="text-xl md:text-2xl text-pink-500">%</span>
            </span>
            <span class="text-xs md:text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-widest mt-1">{{ TEXT.losslessRate }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="flex flex-col gap-4 min-w-[200px] w-full max-w-xs">
      <div
        v-for="(segment, index) in segments"
        :key="segment.id"
        class="group/item relative p-3 rounded-xl transition-all duration-300 cursor-pointer overflow-hidden border border-transparent animate-slide-in"
        :class="[hoveredSegmentId === segment.id ? 'bg-gray-100/80 dark:bg-white/10 border-gray-200 dark:border-white/10 scale-105' : 'hover:bg-gray-50 dark:hover:bg-white/10']"
        @mouseenter="hoveredSegmentId = segment.id"
        @mouseleave="hoveredSegmentId = null"
        :style="{ animationDelay: `${0.5 + index * 0.1}s` }"
      >
        <div class="absolute bottom-0 left-0 h-1 transition-all duration-1000 ease-out opacity-20 dark:opacity-40" :class="segment.bgClass" :style="{ width: hoveredSegmentId === segment.id ? '100%' : '0%' }"></div>

        <div class="flex items-center justify-between mb-1">
          <div class="flex items-center gap-3">
            <div class="w-3 h-3 rounded-full shadow-lg" :class="segment.bgClass" :style="{ boxShadow: `0 0 10px ${segment.shadowColor}` }"></div>
            <span class="font-bold text-gray-700 dark:text-gray-200">{{ segment.name }}</span>
            <span class="text-[10px] text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-white/10 px-1 rounded">{{ segment.label }}</span>
          </div>
          <span class="font-mono font-medium text-gray-900 dark:text-white tabular-nums">{{ segment.value.toLocaleString() }}</span>
        </div>

        <div class="w-full h-1.5 bg-gray-100 dark:bg-white/10 rounded-full mt-2 overflow-hidden">
          <div class="h-full rounded-full transition-all duration-1000 ease-out" :class="segment.bgClass" :style="{ width: `${segment.percentage}%` }"></div>
        </div>

        <div class="flex justify-end mt-1">
          <span class="text-xs text-gray-700 dark:text-gray-300 font-medium">{{ segment.displayPercentage }}%</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.animate-slide-in {
  opacity: 0;
  animation: slideIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateX(20px);
  }

  to {
    opacity: 1;
    transform: translateX(0);
  }
}
</style>
