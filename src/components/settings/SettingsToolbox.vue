<script setup lang="ts">
import { ref } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import RenamePreviewModal, { RenamePreview } from './RenamePreviewModal.vue';
import { useToast } from '../../composables/toast';

const toast = useToast();

const targetPath = ref('');
const mode = ref<'tags' | 'rules' | 'auto'>('auto');
const customTemplate = ref('{track}. {title}');
const removeTrackPrefix = ref(true);
const removeSourcePrefix = ref(false);

const isScanning = ref(false);
const showPreview = ref(false);
const previewItems = ref<RenamePreview[]>([]);

const presets = [
  { label: '歌名 - 歌手', example: '七里香 - 周杰伦', value: '{title} - {artist}' },
  { label: '歌手 - 歌名', example: '周杰伦 - 七里香', value: '{artist} - {title}' },
  { label: '轨道. 歌名', example: '01. 七里香', value: '{track}. {title}' },
];

const selectFolder = async () => {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择要整理的文件夹',
    });
    if (selected && typeof selected === 'string') {
      targetPath.value = selected;
    }
  } catch (e) {
    console.error(e);
  }
};

const handleScan = async () => {
  if (!targetPath.value) return;
  isScanning.value = true;
  try {
    const config = {
      mode: mode.value,
      template: customTemplate.value,
      remove_track_prefix: removeTrackPrefix.value,
      remove_source_prefix: removeSourcePrefix.value,
    };
    const res = await invoke<RenamePreview[]>('preview_rename', {
      rootPath: targetPath.value,
      config,
    });
    previewItems.value = res;
    showPreview.value = true;
  } catch (e) {
    console.error(e);
    toast.showToast(`扫描失败: ${e}`, 'error');
  } finally {
    isScanning.value = false;
  }
};

const handleApply = async (validItems: RenamePreview[]) => {
  try {
    const operations = validItems.map(item => ({
      original_path: item.original_path,
      new_name: item.new_name
    }));
    
    const count = await invoke<number>('apply_rename', { operations });
    toast.showToast(`成功重命名 ${count} 个文件`, 'success');
    showPreview.value = false;
  } catch (e) {
    console.error(e);
    toast.showToast(`应用修改失败: ${e}`, 'error');
  }
};

const insertVariable = (variable: string) => {
  customTemplate.value += variable;
};

const variables = [
  { code: '{title}', name: '标题' },
  { code: '{artist}', name: '歌手' },
  { code: '{album}', name: '专辑' },
  { code: '{year}', name: '年份' },
  { code: '{track}', name: '轨道号' },
];
</script>

<template>
  <div class="max-w-3xl space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300 pb-10">
    
    <!-- 头部说明 -->
    <div class="mb-8">
      <h2 class="text-2xl font-bold text-gray-800 dark:text-white mb-2">音乐工具箱</h2>
      <p class="text-gray-500 dark:text-gray-400 text-sm">提供批量重命名等进阶管理功能。</p>
    </div>

    <div class="space-y-8">
      
      <!-- 1. 选择目标 -->
      <section class="space-y-4">
        <h3 class="text-base font-bold text-gray-800 dark:text-gray-200 border-l-4 border-[#EC4141] pl-3">1. 选择目标文件夹</h3>
        <div class="flex items-center gap-3">
          <div class="flex-1 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-gray-600 dark:text-gray-300 truncate">
            {{ targetPath || '请选择要整理的文件夹...' }}
          </div>
          <button 
            @click="selectFolder"
            class="px-5 py-2.5 rounded-xl bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-white text-sm font-medium transition active:scale-95"
          >
            浏览...
          </button>
        </div>
      </section>

      <!-- 2. 操作模式 -->
      <section class="space-y-4">
        <h3 class="text-base font-bold text-gray-800 dark:text-gray-200 border-l-4 border-[#EC4141] pl-3">2. 操作模式</h3>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label 
            class="cursor-pointer border rounded-xl p-4 flex flex-col gap-2 transition-all relative overflow-hidden"
            :class="mode === 'tags' ? 'border-[#EC4141] bg-red-50/50 dark:bg-red-500/10' : 'border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5'"
          >
            <div class="flex items-center gap-2">
              <input type="radio" v-model="mode" value="tags" class="text-[#EC4141] focus:ring-[#EC4141]" />
              <span class="font-bold text-gray-800 dark:text-gray-200">标准化重命名</span>
            </div>
            <p class="text-xs text-gray-500 dark:text-gray-400 pl-6">读取标签元数据，按模板重命名。标签缺失则跳过。</p>
          </label>

          <label 
            class="cursor-pointer border rounded-xl p-4 flex flex-col gap-2 transition-all"
            :class="mode === 'rules' ? 'border-[#EC4141] bg-red-50/50 dark:bg-red-500/10' : 'border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5'"
          >
            <div class="flex items-center gap-2">
              <input type="radio" v-model="mode" value="rules" class="text-[#EC4141] focus:ring-[#EC4141]" />
              <span class="font-bold text-gray-800 dark:text-gray-200">文件名清洗</span>
            </div>
            <p class="text-xs text-gray-500 dark:text-gray-400 pl-6">仅对当前文件名进行修剪（如去前缀），不依赖标签。</p>
          </label>

          <label 
            class="cursor-pointer border rounded-xl p-4 flex flex-col gap-2 transition-all"
            :class="mode === 'auto' ? 'border-[#EC4141] bg-red-50/50 dark:bg-red-500/10' : 'border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5'"
          >
            <div class="flex items-center gap-2">
              <input type="radio" v-model="mode" value="auto" class="text-[#EC4141] focus:ring-[#EC4141]" />
              <span class="font-bold text-gray-800 dark:text-gray-200">智能自动 (推荐)</span>
            </div>
            <p class="text-xs text-gray-500 dark:text-gray-400 pl-6">优先尝试标签重命名；若标签缺失，自动降级为清洗模式。</p>
          </label>
        </div>
      </section>

      <!-- 3. 命名模板 (仅 Tags/Auto 模式) -->
      <section v-if="mode !== 'rules'" class="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
        <h3 class="text-base font-bold text-gray-800 dark:text-gray-200 border-l-4 border-[#EC4141] pl-3">3. 命名模板配置</h3>
        
        <div class="bg-gray-50 dark:bg-white/5 rounded-xl p-5 border border-gray-200 dark:border-white/10 space-y-5">
          <div class="flex flex-wrap gap-3">
            <button 
              v-for="preset in presets" 
              :key="preset.value"
              @click="customTemplate = preset.value"
              class="px-3 py-1.5 rounded-lg text-xs font-medium border transition"
              :class="customTemplate === preset.value ? 'bg-[#EC4141] text-white border-[#EC4141]' : 'bg-white dark:bg-white/5 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-white/10 hover:border-gray-300'"
            >
              {{ preset.label }}
              <span class="opacity-60 ml-1">({{ preset.example }})</span>
            </button>
          </div>

          <div class="relative">
            <input 
              type="text" 
              v-model="customTemplate" 
              placeholder="输入自定义模板..." 
              class="w-full pl-4 pr-4 py-3 rounded-lg bg-white dark:bg-black/20 border border-gray-200 dark:border-white/10 focus:outline-none focus:ring-2 focus:ring-[#EC4141] focus:border-transparent text-gray-800 dark:text-gray-100 font-mono text-sm"
            />
          </div>
          
          <div class="space-y-3">
            <div class="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">点击变量插入到末尾:</div>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
              <button 
                v-for="v in variables" 
                :key="v.code"
                @click="insertVariable(v.code)"
                class="flex flex-col items-center p-2 rounded-lg bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 hover:border-[#EC4141] dark:hover:border-[#EC4141] transition group"
              >
                <span class="text-xs font-mono font-bold text-gray-700 dark:text-gray-300 group-hover:text-[#EC4141]">{{ v.code }}</span>
                <span class="text-[10px] text-gray-400 mt-1">{{ v.name }}</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- 4. 清洗规则 (仅 Rules/Auto 模式) -->
      <section v-if="mode !== 'tags'" class="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
        <h3 class="text-base font-bold text-gray-800 dark:text-gray-200 border-l-4 border-[#EC4141] pl-3">
          {{ mode === 'auto' ? '4. 降级清洗规则 (当标签缺失时)' : '3. 清洗规则' }}
        </h3>
        
        <div class="space-y-2">
          <label class="flex items-center gap-3 p-3 bg-gray-50 dark:bg-white/5 rounded-xl cursor-pointer hover:bg-gray-100 dark:hover:bg-white/10 transition">
            <input type="checkbox" v-model="removeTrackPrefix" class="rounded text-[#EC4141] focus:ring-[#EC4141] w-5 h-5 border-gray-300 dark:border-gray-600" />
            <div class="flex-1">
              <div class="text-sm font-medium text-gray-800 dark:text-gray-200">去除序号前缀</div>
              <div class="text-xs text-gray-500">例如: <span class="font-mono">01. Song</span> -> <span class="font-mono">Song</span></div>
            </div>
          </label>

          <label class="flex items-center gap-3 p-3 bg-gray-50 dark:bg-white/5 rounded-xl cursor-pointer hover:bg-gray-100 dark:hover:bg-white/10 transition">
            <input type="checkbox" v-model="removeSourcePrefix" class="rounded text-[#EC4141] focus:ring-[#EC4141] w-5 h-5 border-gray-300 dark:border-gray-600" />
            <div class="flex-1">
              <div class="text-sm font-medium text-gray-800 dark:text-gray-200">去除来源前缀</div>
              <div class="text-xs text-gray-500">例如: <span class="font-mono">[网易云] Song</span> -> <span class="font-mono">Song</span></div>
            </div>
          </label>
        </div>
      </section>

      <!-- 底部操作栏 -->
      <div class="pt-4 border-t border-gray-100 dark:border-white/5 flex justify-end">
        <button 
          @click="handleScan"
          :disabled="!targetPath || isScanning"
          class="px-8 py-3 rounded-xl bg-[#EC4141] text-white font-bold shadow-lg hover:bg-[#d13a3a] hover:shadow-xl hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none flex items-center gap-2"
        >
          <svg v-if="isScanning" class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          {{ isScanning ? '扫描中...' : '扫描并预览' }}
        </button>
      </div>

    </div>

    <!-- 预览弹窗 -->
    <RenamePreviewModal 
      :visible="showPreview" 
      :items="previewItems" 
      @update:visible="showPreview = $event"
      @confirm="handleApply"
    />
  </div>
</template>