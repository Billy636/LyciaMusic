<script setup lang="ts">
import { useRouter } from 'vue-router';
import { usePlayer } from '../../composables/player';
import { getCurrentWindow } from '@tauri-apps/api/window'; 

const router = useRouter();
const { searchQuery, setSearch } = usePlayer();
const appWindow = getCurrentWindow();

// 最小化
const minimize = async () => { 
  await appWindow.minimize(); 
};

// 最大化/还原
const toggleMaximize = async () => { 
  const isMax = await appWindow.isMaximized();
  if (isMax) {
    await appWindow.unmaximize();
  } else {
    await appWindow.maximize();
  }
};

// 关闭
const closeWindow = async () => { 
  await appWindow.close(); 
};

const handleInput = (e: Event) => { setSearch((e.target as HTMLInputElement).value); };
const goBack = () => { router.back(); };
</script>

<template>
  <div 
    data-tauri-drag-region
    class="h-16 flex items-center justify-between px-6  select-none shrink-0 relative z-[60]"
  >
    <div class="flex items-center gap-4 relative z-10">
      <button 
        @click="goBack" 
        class="w-8 h-8 rounded-full bg-white/5 dark:bg-white/5 hover:bg-white/20 dark:hover:bg-white/20 flex items-center justify-center text-gray-600 dark:text-gray-300 transition-colors focus:outline-none cursor-pointer border border-black/10 dark:border-white/10"
        title="后退"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 -ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <div class="group bg-white/5 dark:bg-white/5 hover:bg-white/10 dark:hover:bg-white/10 focus-within:bg-white/20 dark:focus-within:bg-white/10 focus-within:ring-2 focus-within:ring-[#EC4141]/20 pl-4 pr-3 py-1.5 rounded-full text-sm flex items-center transition-all w-60 ml-2 border border-black/10 dark:border-white/20">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-500 dark:text-gray-300 mr-2 group-focus-within:text-[#EC4141]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input 
          type="text" 
          placeholder="搜索音乐..." 
          class="bg-transparent outline-none w-full placeholder-gray-500 dark:placeholder-gray-400 text-gray-800 dark:text-gray-100 text-xs font-medium"
          :value="searchQuery"
          @input="handleInput"
        />
        <button v-if="searchQuery" @click="setSearch('')" class="text-gray-500 hover:text-[#EC4141] ml-1 cursor-pointer">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
          </svg>
        </button>
      </div>
    </div>

    <div class="flex items-center gap-2 relative z-10">
      <router-link to="/settings" class="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors cursor-pointer" title="设置">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </router-link>
      <div class="h-4 w-px bg-gray-400/30 mx-2"></div>
      <div class="flex items-center gap-1">
        <button @click.stop="minimize" class="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition-colors cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 12H6" /></svg></button>
        <button @click.stop="toggleMaximize" class="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition-colors cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" stroke-width="2" /></svg></button>
        <button @click.stop="closeWindow" class="p-2 text-gray-600 dark:text-gray-400 hover:text-white hover:bg-[#EC4141] rounded-md transition-colors cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
      </div>
    </div>
  </div>
</template>