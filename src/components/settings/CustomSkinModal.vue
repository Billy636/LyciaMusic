<script setup lang="ts">
import { usePlayer } from '../../composables/player';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';

const { settings } = usePlayer();
const emit = defineEmits(['close']);

// 选择本地图片
const handleSelectImage = async () => {
  try {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    });
    if (selected && typeof selected === 'string') {
      settings.value.theme.customBgPath = selected;
    }
  } catch (e) {}
};

const handleSave = () => {
  settings.value.theme.mode = 'custom'; // 确认保存时切换到自定义模式
  emit('close');
};
</script>

<template>
  <div class="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
    <div class="bg-[#2b2b2b] w-[400px] rounded-xl shadow-2xl overflow-hidden text-white border border-white/10 flex flex-col">
      
      <div class="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <span class="font-bold text-sm">自定义皮肤</span>
        <button @click="$emit('close')" class="text-white/50 hover:text-white transition"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" /></svg></button>
      </div>

      <div class="p-6 space-y-6">
        <div 
          @click="handleSelectImage"
          class="w-full h-40 bg-[#363636] rounded-lg border-2 border-dashed border-white/20 hover:border-[#EC4141] cursor-pointer flex items-center justify-center overflow-hidden relative group transition-colors"
        >
          <img v-if="settings.theme.customBgPath" :src="convertFileSrc(settings.theme.customBgPath)" class="w-full h-full object-cover" />
          <div v-else class="text-center">
            <div class="text-2xl mb-1">🖼️</div>
            <div class="text-xs text-white/50">点击选择图片</div>
          </div>
          <div class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <span class="text-sm font-medium">更换图片</span>
          </div>
        </div>

        <div class="space-y-4">
          <div class="flex items-center gap-4">
            <span class="text-xs text-white/70 w-12">透明度</span>
            <input 
              type="range" min="0" max="100" 
              :value="(1 - settings.theme.opacity) * 100" 
              @input="(e: any) => settings.theme.opacity = 1 - (e.target.value / 100)"
              class="flex-1 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-[#EC4141]"
            />
          </div>
          <div class="flex items-center gap-4">
            <span class="text-xs text-white/70 w-12">模糊度</span>
            <input 
              type="range" min="0" max="100" 
              v-model.number="settings.theme.blur"
              class="flex-1 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-[#EC4141]"
            />
          </div>
        </div>
      </div>

      <div class="px-6 py-4 flex gap-4 border-t border-white/10">
        <button @click="$emit('close')" class="flex-1 py-2 rounded-full border border-white/20 text-sm hover:bg-white/10 transition">取消</button>
        <button @click="handleSave" class="flex-1 py-2 rounded-full bg-[#ffcdc3] text-[#EC4141] font-bold text-sm hover:bg-[#ffb0a0] transition">保存</button>
      </div>

    </div>
  </div>
</template>