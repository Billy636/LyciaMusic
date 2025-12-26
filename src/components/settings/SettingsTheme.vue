<script setup lang="ts">
import { ref } from 'vue';
import { usePlayer } from '../../composables/player';
import CustomSkinModal from './CustomSkinModal.vue';
import { convertFileSrc } from '@tauri-apps/api/core';

const { settings } = usePlayer();
const showCustomModal = ref(false);

const setMode = (mode: 'light' | 'dark') => {
  settings.value.theme.mode = mode;
  settings.value.theme.enableDynamicBg = false; // 关闭动态
};

const toggleDynamic = () => {
  settings.value.theme.enableDynamicBg = !settings.value.theme.enableDynamicBg;
};
</script>

<template>
  <div class="max-w-4xl animate-in fade-in slide-in-from-bottom-2 duration-300">
    
    <div class="grid grid-cols-2 gap-8">
      <div class="space-y-4">
        <h2 class="text-sm font-bold text-gray-800">官方主题</h2>
        <div class="grid grid-cols-3 gap-4">
          <div @click="setMode('dark')" class="cursor-pointer group">
            <div class="aspect-square rounded-lg bg-[#2b2b2b] border-2 relative overflow-hidden shadow-sm" :class="settings.theme.mode === 'dark' && !settings.theme.enableDynamicBg ? 'border-[#EC4141]' : 'border-transparent group-hover:border-gray-300'">
              <div class="absolute inset-0 flex items-center justify-center">
                 <span class="text-2xl">🌑</span>
              </div>
              <div v-if="settings.theme.mode === 'dark' && !settings.theme.enableDynamicBg" class="absolute bottom-0 right-0 bg-[#EC4141] text-white rounded-tl-lg p-1 shadow-md">
                 <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>
              </div>
            </div>
            <div class="text-xs text-center mt-2 text-gray-600">酷炫黑</div>
          </div>

           <div @click="setMode('light')" class="cursor-pointer group">
            <div class="aspect-square rounded-lg bg-white border-2 relative overflow-hidden shadow-sm" :class="settings.theme.mode === 'light' && !settings.theme.enableDynamicBg ? 'border-[#EC4141]' : 'border-transparent group-hover:border-gray-300'">
              <div class="absolute top-0 left-0 right-0 h-4 bg-[#EC4141]"></div>
              <div class="absolute inset-0 flex items-center justify-center pt-4">
                 <span class="text-xl">⚪</span>
              </div>
              <div v-if="settings.theme.mode === 'light' && !settings.theme.enableDynamicBg" class="absolute bottom-0 right-0 bg-[#EC4141] text-white rounded-tl-lg p-1 shadow-md">
                 <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>
              </div>
            </div>
            <div class="text-xs text-center mt-2 text-gray-600">官方白</div>
          </div>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-sm font-bold text-gray-800">个性化</h2>
        <div class="space-y-3">
          
          <div 
            @click="toggleDynamic" 
            class="flex items-center justify-between p-3 rounded-lg border-2 cursor-pointer transition-all bg-white/50"
            :class="settings.theme.enableDynamicBg ? 'border-[#EC4141] bg-red-50/50' : 'border-gray-100 hover:border-gray-300'"
          >
             <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white shadow-sm">🎵</div>
                <div>
                  <div class="text-sm font-medium text-gray-800">跟随歌曲封面</div>
                  <div class="text-xs text-gray-500">背景随播放内容自动变化</div>
                </div>
             </div>
             <div class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors" :class="settings.theme.enableDynamicBg ? 'bg-[#EC4141]' : 'bg-gray-300'">
                <span class="inline-block h-3 w-3 transform rounded-full bg-white transition duration-200 ease-in-out shadow" :class="settings.theme.enableDynamicBg ? 'translate-x-5' : 'translate-x-1'" />
             </div>
          </div>

          <div 
            @click="showCustomModal = true"
            class="flex items-center justify-between p-3 rounded-lg border-2 cursor-pointer transition-all bg-white/50"
            :class="settings.theme.mode === 'custom' && !settings.theme.enableDynamicBg ? 'border-[#EC4141] bg-red-50/50' : 'border-gray-100 hover:border-gray-300'"
          >
             <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-gray-200 overflow-hidden flex items-center justify-center shadow-sm">
                   <img v-if="settings.theme.customBgPath" :src="convertFileSrc(settings.theme.customBgPath)" class="w-full h-full object-cover" />
                   <span v-else>🖼️</span>
                </div>
                <div>
                  <div class="text-sm font-medium text-gray-800">自定义皮肤</div>
                  <div class="text-xs text-gray-500">上传图片并调整模糊度</div>
                </div>
             </div>
             <button class="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded transition">设置</button>
          </div>

        </div>
      </div>
    </div>

    <CustomSkinModal v-if="showCustomModal" @close="showCustomModal = false" />
  </div>
</template>