<script setup lang="ts">
import { usePlayer } from '../../composables/player';
import { open } from '@tauri-apps/plugin-dialog';

const { settings } = usePlayer();

const selectRoot = async () => {
  try {
    const selected = await open({ directory: true, multiple: false, title: "选择默认归档目录" });
    if (selected && typeof selected === 'string') { settings.value.organizeRoot = selected; }
  } catch (err) { console.error(err); }
};

const insertPlaceholder = (ph: string) => { settings.value.organizeRule += ph + '/'; };
</script>

<template>
  <div class="max-w-3xl space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
    
    <div class="space-y-4">
      <h2 class="text-base font-bold text-gray-800 border-l-4 border-[#EC4141] pl-3">启动与外观</h2>
      <div class="bg-white/50 backdrop-blur-sm p-4 rounded-lg border border-gray-100/50">
        <label class="flex items-center gap-2 text-sm text-gray-700">
           <input type="checkbox" class="rounded text-[#EC4141] focus:ring-[#EC4141]" checked disabled />
           <span>开机自动运行 (开发中)</span>
        </label>
        <label class="flex items-center gap-2 text-sm text-gray-700 mt-3">
           <input type="checkbox" class="rounded text-[#EC4141] focus:ring-[#EC4141]" checked />
           <span>开启 GPU 加速</span>
        </label>
      </div>
    </div>

    <div class="space-y-4">
      <h2 class="text-base font-bold text-gray-800 border-l-4 border-[#EC4141] pl-3">文件整理助手</h2>
      <p class="text-xs text-gray-500">当你在歌曲列表右键选择“整理文件”时，我们将依据以下规则移动文件。</p>

      <div class="bg-white/50 backdrop-blur-sm p-5 rounded-lg border border-gray-100/50 space-y-4">
        <div>
          <label class="block text-xs font-semibold text-gray-500 mb-1">默认归档根目录</label>
          <div class="flex gap-2">
            <div class="flex-1 bg-white/80 border border-gray-200 rounded px-3 py-1.5 text-sm text-gray-600 font-mono flex items-center shadow-sm truncate">
              {{ settings.organizeRoot }}
            </div>
            <button @click="selectRoot" class="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-sm transition border border-gray-200">更改</button>
          </div>
        </div>

        <div class="flex items-center justify-between">
          <span class="text-sm text-gray-700">启用自动整理规则</span>
          <button @click="settings.enableAutoOrganize = !settings.enableAutoOrganize" class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none" :class="settings.enableAutoOrganize ? 'bg-[#EC4141]' : 'bg-gray-300'">
            <span class="inline-block h-3 w-3 transform rounded-full bg-white transition duration-200 ease-in-out shadow" :class="settings.enableAutoOrganize ? 'translate-x-5' : 'translate-x-1'" />
          </button>
        </div>

        <div v-if="settings.enableAutoOrganize">
          <label class="block text-xs font-semibold text-gray-500 mb-1">目录结构规则</label>
          <input v-model="settings.organizeRule" type="text" class="w-full text-sm p-2 border border-gray-200 rounded bg-white/80 focus:border-[#EC4141] focus:ring-1 focus:ring-[#EC4141] outline-none font-mono mb-2" />
          <div class="flex flex-wrap gap-2 mb-2">
            <button @click="insertPlaceholder('{Artist}')" class="px-2 py-0.5 bg-white border border-gray-200 rounded text-xs hover:text-[#EC4141] transition">+ 歌手</button>
            <button @click="insertPlaceholder('{Album}')" class="px-2 py-0.5 bg-white border border-gray-200 rounded text-xs hover:text-[#EC4141] transition">+ 专辑</button>
            <button @click="insertPlaceholder('{Title}')" class="px-2 py-0.5 bg-white border border-gray-200 rounded text-xs hover:text-[#EC4141] transition">+ 歌名</button>
          </div>
          <div class="text-[10px] text-gray-500 bg-gray-100/50 p-2 rounded border border-gray-200/50 font-mono break-all">
            预览: {{ settings.organizeRoot }}\{{ settings.organizeRule.replace('{Artist}', '周杰伦').replace('{Album}', '叶惠美').replace('{Title}', '晴天.mp3').replace(/\//g, '\\') }}
          </div>
        </div>
      </div>
    </div>

  </div>
</template>