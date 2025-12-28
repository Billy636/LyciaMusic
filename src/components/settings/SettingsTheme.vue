<script setup lang="ts">
import { ref } from 'vue';
import { usePlayer } from '../../composables/player';
import CustomSkinModal from './CustomSkinModal.vue';
import { convertFileSrc } from '@tauri-apps/api/core';

const { settings } = usePlayer();
const showCustomModal = ref(false);

const setMode = (mode: 'light' | 'dark') => {
  settings.value.theme.mode = mode;
  settings.value.theme.enableDynamicBg = false; // 关闭动态，切换到静态主题
};

const toggleDynamic = () => {
  settings.value.theme.enableDynamicBg = !settings.value.theme.enableDynamicBg;
};
</script>

<template>
  <div class="max-w-4xl animate-in fade-in slide-in-from-bottom-2 duration-300">
    
    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
      
      <!-- Theme Mode Selection -->
      <section class="space-y-3">
        <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
          <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
          官方主题
        </h2>
        <div class="bg-white/50 dark:bg-black/40 backdrop-blur-sm rounded-xl border border-gray-100/50 dark:border-white/5 p-4">
          <div class="grid grid-cols-2 gap-4">
            
            <!-- Dark Mode -->
            <button 
              @click="setMode('dark')" 
              class="relative group cursor-pointer transition-all outline-none focus:ring-2 focus:ring-[#EC4141] rounded-xl"
            >
              <div class="aspect-[4/3] rounded-xl bg-[#2b2b2b] border-2 relative overflow-hidden shadow-sm transition-all" 
                :class="settings.theme.mode === 'dark' && !settings.theme.enableDynamicBg ? 'border-[#EC4141] ring-1 ring-[#EC4141]/20' : 'border-transparent group-hover:border-gray-300 dark:group-hover:border-white/20'"
              >
                <div class="absolute inset-0 flex flex-col items-center justify-center opacity-80 group-hover:opacity-100 transition-opacity">
                   <span class="text-3xl filter drop-shadow-lg">🌑</span>
                   <span class="text-xs text-gray-400 mt-2 font-medium">酷炫黑</span>
                </div>
                
                <!-- Active Indicator -->
                <div v-if="settings.theme.mode === 'dark' && !settings.theme.enableDynamicBg" class="absolute top-2 right-2 bg-[#EC4141] text-white rounded-full p-0.5 shadow-md">
                   <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>
                </div>
              </div>
            </button>

            <!-- Light Mode -->
             <button 
              @click="setMode('light')" 
              class="relative group cursor-pointer transition-all outline-none focus:ring-2 focus:ring-[#EC4141] rounded-xl"
            >
              <div class="aspect-[4/3] rounded-xl bg-white border-2 relative overflow-hidden shadow-sm transition-all" 
                :class="settings.theme.mode === 'light' && !settings.theme.enableDynamicBg ? 'border-[#EC4141] ring-1 ring-[#EC4141]/20' : 'border-transparent group-hover:border-gray-300 dark:group-hover:border-white/20'"
              >
                <div class="absolute top-0 left-0 right-0 h-1.5 bg-[#EC4141]"></div>
                <div class="absolute inset-0 flex flex-col items-center justify-center pt-2 opacity-80 group-hover:opacity-100 transition-opacity">
                   <span class="text-3xl filter drop-shadow-sm">⚪</span>
                   <span class="text-xs text-gray-500 mt-2 font-medium">官方白</span>
                </div>

                 <!-- Active Indicator -->
                <div v-if="settings.theme.mode === 'light' && !settings.theme.enableDynamicBg" class="absolute top-2 right-2 bg-[#EC4141] text-white rounded-full p-0.5 shadow-md">
                   <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>
                </div>
              </div>
            </button>

          </div>
        </div>
      </section>

      <!-- Personalization -->
      <section class="space-y-3">
        <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
          <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
          个性化
        </h2>
        <div class="bg-white/50 dark:bg-black/40 backdrop-blur-sm rounded-xl border border-gray-100/50 dark:border-white/5 p-1 space-y-1">
          
          <!-- Dynamic Background Toggle -->
          <div 
            @click="toggleDynamic" 
            class="flex items-center justify-between p-3 rounded-lg border-2 cursor-pointer transition-all bg-white/60 dark:bg-white/5 hover:bg-white/80 dark:hover:bg-white/10"
            :class="settings.theme.enableDynamicBg ? 'border-[#EC4141] bg-red-50/30' : 'border-transparent hover:border-gray-200 dark:hover:border-white/10'"
          >
             <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-gradient-to-br from-[#EC4141] to-pink-500 flex items-center justify-center text-white shadow-sm shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" /></svg>
                </div>
                <div>
                  <div class="text-sm font-bold text-gray-800 dark:text-gray-200">跟随歌曲封面</div>
                  <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">背景颜色随播放内容自动变化</div>
                </div>
             </div>
             <div class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors" :class="settings.theme.enableDynamicBg ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
                <span class="inline-block h-3 w-3 transform rounded-full bg-white transition duration-200 ease-in-out shadow" :class="settings.theme.enableDynamicBg ? 'translate-x-5' : 'translate-x-1'" />
             </div>
          </div>

          <!-- Custom Skin (Placeholder/Partial) -->
          <div 
            @click="showCustomModal = true"
            class="flex items-center justify-between p-3 rounded-lg border-2 cursor-pointer transition-all bg-white/60 dark:bg-white/5 hover:bg-white/80 dark:hover:bg-white/10"
            :class="settings.theme.mode === 'custom' && !settings.theme.enableDynamicBg ? 'border-[#EC4141] bg-red-50/30' : 'border-transparent hover:border-gray-200 dark:hover:border-white/10'"
          >
             <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden flex items-center justify-center shadow-sm shrink-0 border border-gray-100 dark:border-white/5">
                   <img v-if="settings.theme.customBgPath" :src="convertFileSrc(settings.theme.customBgPath)" class="w-full h-full object-cover" />
                   <span v-else class="text-lg">🖼️</span>
                </div>
                <div>
                  <div class="text-sm font-bold text-gray-800 dark:text-gray-200">自定义皮肤</div>
                  <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">上传图片并调整模糊度</div>
                </div>
             </div>
             <button class="text-xs bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 hover:border-[#EC4141] dark:hover:border-[#EC4141] hover:text-[#EC4141] dark:hover:text-[#EC4141] px-3 py-1.5 rounded-md transition shadow-sm text-gray-600 dark:text-gray-300">设置</button>
          </div>

        </div>
      </section>

    </div>

    <CustomSkinModal v-if="showCustomModal" @close="showCustomModal = false" />
  </div>
</template>