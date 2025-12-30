<script setup lang="ts">
import { usePlayer } from '../../composables/player';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ref } from 'vue';

const { settings } = usePlayer();
const emit = defineEmits(['close']);

// 预览状态（临时修改，保存后同步到全局）
const preview = ref({ ...settings.value.theme.customBackground });

// 选择本地图片
const handleSelectImage = async () => {
  try {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    });
    if (selected && typeof selected === 'string') {
      preview.value.imagePath = selected;
    }
  } catch (e) {}
};

const handleSave = () => {
  settings.value.theme.customBackground = { ...preview.value };
  settings.value.theme.mode = 'custom';
  settings.value.theme.dynamicBgType = 'none'; // 互斥逻辑
  emit('close');
};
</script>

<template>
  <div class="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
    <div class="bg-[#2b2b2b] w-[500px] rounded-2xl shadow-2xl overflow-hidden text-white border border-white/10 flex flex-col">
      
      <!-- 标题栏 -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <span class="font-bold text-base">自定义皮肤</span>
        <button @click="$emit('close')" class="text-white/50 hover:text-white transition">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
          </svg>
        </button>
      </div>

      <div class="flex flex-col p-6 gap-6">
        
        <!-- 预览区 -->
        <div class="relative w-full h-48 bg-[#1a1a1a] rounded-xl overflow-hidden border border-white/5 group">
          <div v-if="preview.imagePath" class="absolute inset-0">
             <!-- 预览蒙层 -->
             <div 
               class="absolute inset-0 z-10" 
               :style="{ backgroundColor: preview.maskColor, opacity: preview.maskAlpha }"
             ></div>
             <!-- 预览图片 -->
             <img 
               :src="convertFileSrc(preview.imagePath)" 
               class="w-full h-full object-cover"
               :style="{ filter: `blur(${preview.blur}px)`, transform: `scale(${preview.scale})` }"
             />
          </div>
          <div v-else class="absolute inset-0 flex flex-col items-center justify-center text-white/20">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span class="text-xs">未选择图片</span>
          </div>

          <!-- 上传覆盖层 -->
          <div 
            @click="handleSelectImage"
            class="absolute inset-0 bg-black/40 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer z-20"
          >
            <div class="bg-white/20 p-2 rounded-full mb-2">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <span class="text-sm font-medium">选择本地图片</span>
          </div>
        </div>

        <!-- 调节区 -->
        <div class="space-y-5">
          <!-- 模糊度 -->
          <div class="space-y-2">
            <div class="flex justify-between items-center text-xs text-white/60">
              <span>模糊度</span>
              <span>{{ preview.blur }}px</span>
            </div>
            <input 
              type="range" min="0" max="50" step="1"
              v-model.number="preview.blur"
              class="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#EC4141]"
            />
          </div>

          <!-- 蒙层透明度 -->
          <div class="space-y-2">
            <div class="flex justify-between items-center text-xs text-white/60">
              <span>遮罩浓度</span>
              <span>{{ Math.round(preview.maskAlpha * 100) }}%</span>
            </div>
            <input 
              type="range" min="0" max="1" step="0.01"
              v-model.number="preview.maskAlpha"
              class="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#EC4141]"
            />
          </div>

          <!-- 图片亮度 (Opacity) -->
          <div class="space-y-2">
            <div class="flex justify-between items-center text-xs text-white/60">
              <span>背景亮度</span>
              <span>{{ Math.round(preview.opacity * 100) }}%</span>
            </div>
            <input 
              type="range" min="0.1" max="1" step="0.01"
              v-model.number="preview.opacity"
              class="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#EC4141]"
            />
          </div>

          <!-- 缩放 (Optional) -->
          <div class="space-y-2">
            <div class="flex justify-between items-center text-xs text-white/60">
              <span>画面缩放</span>
              <span>{{ preview.scale.toFixed(2) }}x</span>
            </div>
            <input 
              type="range" min="1" max="1.5" step="0.01"
              v-model.number="preview.scale"
              class="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#EC4141]"
            />
          </div>
        </div>
      </div>

      <!-- 底部按钮 -->
      <div class="px-6 py-4 flex gap-4 border-t border-white/10 bg-[#242424]">
        <button @click="$emit('close')" class="flex-1 py-2.5 rounded-full border border-white/10 text-sm font-medium hover:bg-white/5 transition">取消</button>
        <button 
          @click="handleSave" 
          :disabled="!preview.imagePath"
          class="flex-1 py-2.5 rounded-full bg-[#EC4141] text-white font-bold text-sm hover:bg-[#d13a3a] transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#EC4141]"
        >
          保存并使用
        </button>
      </div>

    </div>
  </div>
</template>

<style scoped>
input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  background: white;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 0 10px rgba(0,0,0,0.3);
}
</style>