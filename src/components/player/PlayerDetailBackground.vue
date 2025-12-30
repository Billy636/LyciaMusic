<script setup lang="ts">
import { usePlayer } from '../../composables/player';

const { dominantColors } = usePlayer();
</script>

<template>
  <div class="absolute inset-0 z-0 overflow-hidden pointer-events-none select-none">
    <!-- 基础深色背景层 -->
    <div class="absolute inset-0 bg-[#080808] z-0"></div>
    
    <!-- 主色调柔和层 -->
    <div 
      class="absolute inset-0 transition-colors duration-[2000ms] opacity-[0.35]" 
      :style="{ backgroundColor: dominantColors[0] }"
    ></div>
    
    <!-- 动态高斯模糊网格 (核心渲染层) -->
    <!-- 使用巨大的 blur 值和 scale 确保边缘平滑 -->
    <div class="absolute inset-0 filter blur-[120px] opacity-[0.85] scale-125">
      <!-- 较大的主色块 -->
      <div 
        class="absolute top-[-10%] left-[-10%] w-[100%] h-[100%] rounded-full mix-blend-soft-light animate-mesh-1 transition-colors duration-[2000ms]"
        :style="{ backgroundColor: dominantColors[1] || dominantColors[0] }"
      ></div>
      
      <!-- 次要色块 -->
      <div 
        class="absolute bottom-[-10%] right-[-10%] w-[100%] h-[100%] rounded-full mix-blend-soft-light animate-mesh-2 transition-colors duration-[2000ms]"
        :style="{ backgroundColor: dominantColors[2] || dominantColors[1] || dominantColors[0] }"
      ></div>
      
      <!-- 辅助高亮色块 -->
      <div 
        v-if="dominantColors[3]"
        class="absolute top-[20%] right-[10%] w-[80%] h-[80%] rounded-full mix-blend-overlay animate-mesh-3 transition-colors duration-[2000ms]"
        :style="{ backgroundColor: dominantColors[3] }"
      ></div>

      <!-- 额外的中心混合色块，增加色彩丰富度 -->
      <div 
        class="absolute top-[30%] left-[30%] w-[60%] h-[60%] rounded-full mix-blend-screen animate-mesh-4 transition-colors duration-[3000ms] opacity-40"
        :style="{ backgroundColor: dominantColors[0] }"
      ></div>
    </div>

    <!-- 噪点纹理 (增加质感) -->
    <div class="absolute inset-0 opacity-[0.04] pointer-events-none z-10 bg-noise"></div>

    <!-- 暗化渐变层，提升文字可读性和空间感 -->
    <div class="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/45 z-20"></div>
  </div>
</template>

<style scoped>
.bg-noise {
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3%3Ffilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/feTurbulence%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
}

/* 更缓慢、更平滑的动画 */
@keyframes mesh-1 {
  0% { transform: translate(0, 0) scale(1) rotate(0deg); }
  33% { transform: translate(15%, 15%) scale(1.1) rotate(120deg); }
  66% { transform: translate(-10%, 20%) scale(0.9) rotate(240deg); }
  100% { transform: translate(0, 0) scale(1) rotate(360deg); }
}

@keyframes mesh-2 {
  0% { transform: translate(0, 0) scale(1.1) rotate(0deg); }
  33% { transform: translate(-20%, 10%) scale(0.95) rotate(-120deg); }
  66% { transform: translate(15%, -15%) scale(1.15) rotate(-240deg); }
  100% { transform: translate(0, 0) scale(1.1) rotate(-360deg); }
}

@keyframes mesh-3 {
  0% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(-15%, -15%) scale(1.05); }
  100% { transform: translate(0, 0) scale(1); }
}

@keyframes mesh-4 {
  0% { transform: translate(-10%, 10%) scale(1); }
  50% { transform: translate(10%, -10%) scale(1.2); }
  100% { transform: translate(-10%, 10%) scale(1); }
}

.animate-mesh-1 { animation: mesh-1 60s linear infinite; }
.animate-mesh-2 { animation: mesh-2 70s linear infinite; }
.animate-mesh-3 { animation: mesh-3 80s ease-in-out infinite; }
.animate-mesh-4 { animation: mesh-4 90s ease-in-out infinite; }
</style>