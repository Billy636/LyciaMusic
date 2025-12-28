<script setup lang="ts">
import { usePlayer } from '../../composables/player';
import { computed } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';

const { settings, currentCover } = usePlayer();

// 计算当前应该显示的背景图
const activeBackgroundInfo = computed(() => {
  const theme = settings.value.theme;

  // 1. 优先判断是否开启“跟随歌曲封面”
  if (theme.enableDynamicBg) {
    return {
      src: currentCover.value, // 如果当前没歌，currentCover 为空，CSS会处理 fallback
      blur: 60,                // 跟随模式默认模糊度高一点，好看
      opacity: 0.9             // 遮罩浓度
    };
  }

  // 2. 其次判断是否是“自定义皮肤”模式且有图片
  if (theme.mode === 'custom' && theme.customBgPath) {
    return {
      src: theme.customBgPath, // Tauri 需要配置好 CSP 允许读取本地图片，或者 convertFileSrc
      blur: theme.blur,
      opacity: theme.opacity
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
  <div class="fixed inset-0 z-[-1] overflow-hidden pointer-events-none bg-[#fafafa] dark:bg-[#121212] transition-colors duration-500">
    
    <transition name="fade">
      <div v-if="activeBackgroundInfo && bgImageSrc" class="absolute inset-0">
        <div 
          class="absolute inset-0 bg-black/30 z-10 transition-all duration-300"
          :style="{ opacity: 1 - activeBackgroundInfo.opacity }" 
        ></div>
        
        <img 
          :src="bgImageSrc" 
          class="w-full h-full object-cover transform scale-105 transition-all duration-700"
          :style="{ filter: `blur(${activeBackgroundInfo.blur}px)` }"
        />
      </div>
    </transition>

    <div v-if="!(activeBackgroundInfo && bgImageSrc)" class="absolute inset-0 bg-white dark:bg-[#121212] transition-colors duration-300"></div>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.5s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>