<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { getVersion } from '@tauri-apps/api/app';

const appVersion = ref('');

// Use absolute path for development/runtime if needed, 
// but for production the user requested static /app.png. 
// However, I will stick to the previous request of using /app.png directly in template for static asset.
// But I need to be careful not to break the "Logo must use static asset" rule I just followed.
// I will keep the template using /app.png.

onMounted(async () => {
  try {
    appVersion.value = await getVersion();
  } catch (e) {
    console.error('Failed to get version:', e);
    appVersion.value = 'Unknown';
  }
});
</script>

<template>
  <div class="flex flex-col items-center justify-center h-full space-y-8 animate-in fade-in zoom-in-95 duration-300 pb-20">
    
    <!-- Logo & Title -->
    <div class="flex flex-col items-center text-center space-y-6">
      <div class="flex items-center justify-center">
         <!-- Static asset path as requested -->
         <img 
           src="/app.png" 
           alt="Logo" 
           class="w-40 h-40 object-cover rounded-full shadow-2xl border-4 border-white/10" 
         />
      </div>
      
      <div class="space-y-1">
        <h1 class="text-3xl font-bold text-gray-800 dark:text-white tracking-tight">Lycia Music</h1>
        <p class="text-sm font-medium text-gray-500 dark:text-gray-400">v{{ appVersion }}</p>
      </div>
      
      <p class="text-gray-600 dark:text-gray-300 max-w-sm">
        一个现代化的本地音乐播放器，可管理音乐标签
      </p>
    </div>

    <!-- Actions -->
    <div class="flex gap-4">
      <a 
        href="https://github.com/Billy636/LyciaMusic" 
        target="_blank"
        class="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-800 dark:text-white transition active:scale-95 font-medium no-underline cursor-pointer"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
        GitHub 仓库
      </a>

      <a 
        href="https://github.com/Billy636/LyciaMusic/releases" 
        target="_blank"
        class="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#EC4141] text-white hover:bg-[#d13a3a] shadow-lg shadow-red-500/20 transition active:scale-95 font-medium no-underline cursor-pointer"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clip-rule="evenodd" /></svg>
        检查更新
      </a>
    </div>

    <!-- Copyright -->
    <div class="text-xs text-gray-400 dark:text-gray-600 mt-8">
      © 2026 LyciaMusic Developer. All Rights Reserved.
    </div>

  </div>
</template>