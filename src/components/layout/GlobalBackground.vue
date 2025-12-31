<script setup lang="ts">
import { usePlayer } from '../../composables/player';
import { computed } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';

const { settings, currentCover, dominantColors } = usePlayer();

// 计算当前应该显示的背景图
const activeBackgroundInfo = computed(() => {
  const theme = settings.value.theme;

  // 1. 优先判断是否是“自定义皮肤”模式且有图片
  if (theme.mode === 'custom' && theme.customBackground.imagePath) {
    return {
      src: theme.customBackground.imagePath, 
      blur: theme.customBackground.blur,
      opacity: theme.customBackground.opacity,
      maskColor: theme.customBackground.maskColor,
      maskAlpha: theme.customBackground.maskAlpha,
      scale: theme.customBackground.scale,
      isDynamic: false,
      type: 'custom'
    };
  }

  // 2. 其次判断动态背景风格
  if (theme.dynamicBgType === 'flow') {
    return {
      src: currentCover.value, 
      blur: 60,                
      opacity: 0.9,
      isDynamic: true,
      type: 'flow'
    };
  } else if (theme.dynamicBgType === 'blur') {
    return {
      src: currentCover.value,
      blur: 50,
      opacity: 0.7, // 静态模糊建议亮度稍低
      scale: 1.5,
      isDynamic: false,
      type: 'blur'
    };
  }

  // 3. 否则不显示图片背景（使用默认纯色）
  return null;
});

const bgImageSrc = computed(() => {
  if (!activeBackgroundInfo.value?.src) return '';
  // 如果是网络图片(http)直接返回，如果是本地路径则转换
  if (activeBackgroundInfo.value.src.startsWith('http') || activeBackgroundInfo.value.src.startsWith('data:')) {
    return activeBackgroundInfo.value.src;
  }
  return convertFileSrc(activeBackgroundInfo.value.src);
});
</script>

<template>
  <div 
    class="fixed inset-0 z-0 overflow-hidden pointer-events-none transition-colors duration-500"
    :class="[settings.theme.mode === 'custom' ? 'bg-black' : 'bg-[#fafafa] dark:bg-[#121212]']"
  >
    
    <!-- 动态网格渐变背景 (Apple Music 风格) -->
    <transition name="fade">
      <div v-if="activeBackgroundInfo?.isDynamic" class="absolute inset-0 overflow-hidden bg-white dark:bg-[#1a1a1a]">
        <!-- 基础色层 (降低不透明度，透出白底) -->
        <div class="absolute inset-0 transition-colors duration-[1500ms] opacity-20" :style="{ backgroundColor: dominantColors[0] }"></div>
        
        <!-- 动画色块 -->
        <div class="absolute inset-0 filter blur-[120px] opacity-50">
          <div 
            class="absolute top-[-10%] left-[-10%] w-[80%] h-[80%] rounded-full mix-blend-multiply dark:mix-blend-screen animate-mesh-1 transition-colors duration-[1500ms]"
            :style="{ backgroundColor: dominantColors[1] }"
          ></div>
          <div 
            class="absolute bottom-[-10%] right-[-10%] w-[80%] h-[80%] rounded-full mix-blend-multiply dark:mix-blend-screen animate-mesh-2 transition-colors duration-[1500ms]"
            :style="{ backgroundColor: dominantColors[2] || dominantColors[0] }"
          ></div>
          <div 
            class="absolute top-[20%] right-[-10%] w-[70%] h-[70%] rounded-full mix-blend-multiply dark:mix-blend-screen animate-mesh-3 transition-colors duration-[1500ms]"
            :style="{ backgroundColor: dominantColors[3] || dominantColors[1] }"
          ></div>
        </div>

        <!-- 噪点层 -->
        <div class="absolute inset-0 opacity-[0.015] pointer-events-none z-10 bg-noise"></div>
        
        <!-- 环境光遮罩 (在浅色模式下极淡) -->
        <div class="absolute inset-0 bg-white/5 dark:bg-black/40 z-20"></div>
      </div>
    </transition>

    <!-- 静态模糊背景 (Static Blur) -->
    <transition name="fade-fast">
      <div 
        v-if="activeBackgroundInfo?.type === 'blur' && bgImageSrc" 
        :key="bgImageSrc"
        class="absolute inset-0 bg-black"
        :style="{ filter: `brightness(${activeBackgroundInfo.opacity})` }"
      >
        <div class="absolute inset-0 bg-black/20 z-10"></div>
        <img 
          :src="bgImageSrc" 
          class="w-full h-full object-cover transition-all duration-1000 z-0"
          :style="{ 
            filter: `blur(${activeBackgroundInfo.blur}px)`,
            transform: `scale(${activeBackgroundInfo.scale})`
          }"
        />
      </div>
    </transition>

    <!-- 自定义图片背景 (Custom Skin) -->
    <transition name="fade">
      <div v-if="activeBackgroundInfo?.type === 'custom' && bgImageSrc" class="absolute inset-0">
        <!-- 蒙层 (Mask Layer) -->
        <div 
          v-if="activeBackgroundInfo.maskAlpha !== undefined && activeBackgroundInfo.maskAlpha > 0"
          class="absolute inset-0 z-10 transition-all duration-300"
          :style="{ 
            backgroundColor: activeBackgroundInfo.maskColor || '#000000',
            opacity: activeBackgroundInfo.maskAlpha
          }" 
        ></div>
        
        <!-- 背景图 -->
        <img 
          :src="bgImageSrc" 
          class="w-full h-full object-cover transition-all duration-700 z-0"
          :style="{ 
            filter: `blur(${activeBackgroundInfo.blur}px) brightness(${activeBackgroundInfo.opacity ?? 1.0})`,
            transform: `scale(${activeBackgroundInfo.scale || 1.05})`
          }"
        />
      </div>
    </transition>

    <div v-if="!activeBackgroundInfo" class="absolute inset-0 bg-white dark:bg-[#121212] transition-colors duration-300"></div>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 1s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.fade-fast-enter-active, .fade-fast-leave-active { transition: opacity 0.5s ease; }
.fade-fast-enter-from, .fade-fast-leave-to { opacity: 0; }

.bg-noise {
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3%3Ffilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/feTurbulence%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
}

@keyframes mesh-1 {
  0% { transform: translate(0, 0) scale(1) rotate(0deg); }
  33% { transform: translate(10%, 10%) scale(1.1) rotate(120deg); }
  66% { transform: translate(-5%, 15%) scale(0.9) rotate(240deg); }
  100% { transform: translate(0, 0) scale(1) rotate(360deg); }
}

@keyframes mesh-2 {
  0% { transform: translate(0, 0) scale(1.1) rotate(0deg); }
  33% { transform: translate(-15%, 5%) scale(0.9) rotate(-120deg); }
  66% { transform: translate(10%, -10%) scale(1.2) rotate(-240deg); }
  100% { transform: translate(0, 0) scale(1.1) rotate(-360deg); }
}

@keyframes mesh-3 {
  0% { transform: translate(0, 0) scale(0.9) rotate(0deg); }
  33% { transform: translate(5%, -15%) scale(1.2) rotate(120deg); }
  66% { transform: translate(-10%, 5%) scale(1) rotate(240deg); }
  100% { transform: translate(0, 0) scale(0.9) rotate(360deg); }
}

.animate-mesh-1 { animation: mesh-1 7s linear infinite; }
.animate-mesh-2 { animation: mesh-2 9s linear infinite; }
.animate-mesh-3 { animation: mesh-3 11s linear infinite; }
</style>