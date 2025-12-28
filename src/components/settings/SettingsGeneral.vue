<script setup lang="ts">
import { ref } from 'vue';

// Placeholder states for demonstration
const launchOnStartup = ref(false);
const gpuAcceleration = ref(true);
const autoPlay = ref(true);
const normalizeVolume = ref(false);
const downloadPath = ref('D:\\Music\\Downloads');
</script>

<template>
  <div class="max-w-3xl space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
    
    <!-- Startup & Behavior -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        常规与启动
      </h2>
      <div class="bg-white/50 dark:bg-black/40 backdrop-blur-sm rounded-xl border border-gray-100/50 dark:border-white/5 overflow-hidden">
        <div class="p-4 flex items-center justify-between border-b border-gray-100/50 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/5 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">开机自动运行</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">系统启动时自动打开应用</div>
          </div>
          <button @click="launchOnStartup = !launchOnStartup" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="launchOnStartup ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="launchOnStartup ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-gray-100/50 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/5 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">GPU 加速</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">使用显卡硬件加速界面渲染 (需要重启)</div>
          </div>
          <button @click="gpuAcceleration = !gpuAcceleration" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="gpuAcceleration ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="gpuAcceleration ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>
      </div>
    </section>

    <!-- Playback -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        播放设置
      </h2>
      <div class="bg-white/50 dark:bg-black/40 backdrop-blur-sm rounded-xl border border-gray-100/50 dark:border-white/5 overflow-hidden">
        <div class="p-4 flex items-center justify-between border-b border-gray-100/50 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/5 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">自动播放</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">程序启动后自动恢复上次播放</div>
          </div>
           <button @click="autoPlay = !autoPlay" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="autoPlay ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="autoPlay ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-gray-100/50 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/5 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">音量标准化</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">平衡不同歌曲的音量大小</div>
          </div>
          <button @click="normalizeVolume = !normalizeVolume" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="normalizeVolume ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="normalizeVolume ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>
        
        <div class="p-4 flex items-center justify-between border-b border-gray-100/50 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/5 transition-colors">
           <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">输出设备</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">默认系统设备</div>
          </div>
          <button class="text-xs px-3 py-1.5 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded text-gray-600 dark:text-gray-300 hover:text-[#EC4141] hover:border-[#EC4141] transition">管理设备</button>
        </div>
      </div>
    </section>

    <!-- Downloads (Placeholder) -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        下载与缓存
      </h2>
      <div class="bg-white/50 dark:bg-black/40 backdrop-blur-sm rounded-xl border border-gray-100/50 dark:border-white/5 overflow-hidden">
        <div class="p-4 flex flex-col gap-2 hover:bg-white/40 dark:hover:bg-white/5 transition-colors">
          <div class="flex items-center justify-between">
             <div class="text-sm font-medium text-gray-800 dark:text-gray-200">下载目录</div>
             <button class="text-xs text-[#EC4141] hover:underline">更改目录</button>
          </div>
          <div class="flex items-center gap-2">
             <div class="flex-1 bg-white/70 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded px-3 py-2 text-xs text-gray-600 dark:text-gray-300 font-mono truncate">
               {{ downloadPath }}
             </div>
             <button class="px-3 py-2 bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 rounded text-xs hover:bg-gray-50 dark:hover:bg-white/5 transition text-gray-600 dark:text-gray-300">打开文件夹</button>
          </div>
        </div>
         <div class="p-4 flex items-center justify-between border-t border-gray-100/50 dark:border-white/5 hover:bg-white/40 dark:hover:bg-white/5 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">清除缓存</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">释放磁盘空间 (当前占用: 128 MB)</div>
          </div>
          <button class="text-xs px-3 py-1.5 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded text-gray-600 dark:text-gray-300 hover:text-red-500 hover:border-red-500 transition">立即清除</button>
        </div>
      </div>
    </section>

  </div>
</template>