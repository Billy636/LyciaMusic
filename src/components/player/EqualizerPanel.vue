<script setup lang="ts">
import { computed, nextTick, ref, watch, onScopeDispose } from 'vue';
import { storeToRefs } from 'pinia';
import { useSettingsStore } from '../../features/settings/store';
import { RefreshCw, Plus } from 'lucide-vue-next';
import type { EqualizerSettings } from '../../types';
import { playbackApi } from '../../services/tauri/playbackApi';
import ModernModal from '../common/ModernModal.vue';

// 支持嵌入模式配置，默认 false
withDefaults(defineProps<{
  embedded?: boolean;
}>(), {
  embedded: false
});

// 10 段频率标度友好简写
const FREQ_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];

// 经典预设定义 (正增益预设自带合理的 Preamp 负增益 headroom 衰减以防过载)
const PRESETS = [
  { name: '平直', preamp: 0.0, gains: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0] },
  { name: '低音增强', preamp: -3.5, gains: [5.5, 4.5, 3.0, 1.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0] },
  { name: '摇滚', preamp: -4.5, gains: [5.0, 4.0, 2.0, -1.0, -2.0, -1.0, 1.0, 3.0, 4.5, 5.0] },
  { name: '流行', preamp: -3.0, gains: [-1.5, -0.5, 1.0, 2.5, 3.0, 2.0, 0.5, -1.0, -1.5, -2.0] },
  { name: '爵士', preamp: -3.0, gains: [3.5, 2.5, 1.5, 2.0, -0.5, -1.0, 0.5, 1.5, 2.5, 3.0] },
  { name: '古典', preamp: -3.5, gains: [4.0, 3.0, 2.0, 1.5, -1.0, -1.5, 0.0, 1.5, 2.5, 3.5] },
  { name: '人声增强', preamp: -3.0, gains: [-3.0, -2.0, -1.0, 1.0, 3.0, 4.0, 3.5, 2.0, 0.5, -1.0] },
];

const settingsStore = useSettingsStore();
const { settings } = storeToRefs(settingsStore);

// 声明基于 Pinia 状态的只读计算属性以提供单一数据源
const eq = computed(() => settings.value.audio.equalizer);

const normalizeEqValue = (value: number) => Math.max(-12.0, Math.min(12.0, Math.round(value * 10) / 10));
const normalizeGains = (gains: number[]) => gains.map(normalizeEqValue);

// 本地草稿状态
const displayPreamp = ref(eq.value.preamp);
const displayGains = ref([...eq.value.gains]);
const isEditingSlider = ref(false);

watch(
  eq,
  nextEq => {
    if (isEditingSlider.value) return;
    displayPreamp.value = nextEq.preamp;
    displayGains.value = [...nextEq.gains];
  },
  { deep: true }
);

// 预设管理相关状态
const showSaveDialog = ref(false);
const showEditDialog = ref(false);
const presetToDelete = ref<{ id: string; name: string } | null>(null);
const presetList = ref<HTMLElement | null>(null);
const newPresetName = ref('');
const editPresetName = ref('');
const editPresetId = ref('');
const selectedPresetId = computed(() => eq.value.currentPresetId ?? null);

// 保存当前设置为预设
const handleSavePreset = () => {
  if (newPresetName.value.trim()) {
    settingsStore.saveEqualizerPreset(newPresetName.value.trim());
    newPresetName.value = '';
    showSaveDialog.value = false;
  }
};

// 更新现有预设
const handleUpdatePreset = () => {
  const targetId = editPresetId.value || selectedPresetId.value;
  if (targetId && editPresetName.value.trim()) {
    settingsStore.updateEqualizerPreset(targetId, editPresetName.value.trim());
    editPresetName.value = '';
    editPresetId.value = '';
    showEditDialog.value = false;
  }
};


// 双击打开特定预设的重命名对话框
const openEditDialogForPreset = (preset: { id: string; name: string }) => {
  editPresetId.value = preset.id;
  editPresetName.value = preset.name;
  showEditDialog.value = true;
};


// 先记录删除目标，确认前不改变预设或当前音效。
const handleDeletePresetById = (presetId: string) => {
  const preset = settingsStore.userPresets.find(p => p.id === presetId);
  if (preset) presetToDelete.value = { id: preset.id, name: preset.name };
};

const confirmDeletePreset = async () => {
  if (!presetToDelete.value) return;
  const presetId = presetToDelete.value.id;
  presetToDelete.value = null;
  settingsStore.deleteEqualizerPreset(presetId);
  await nextTick();
  // 原删除按钮已移除，将焦点留在预设区域，方便继续操作。
  presetList.value?.querySelector<HTMLButtonElement>('button')?.focus();
};

// 判断特定的内置预设是否处于激活高亮状态
const isBuiltInPresetActive = (preset: typeof PRESETS[0]) => {
  return (
    eq.value.enabled &&
    selectedPresetId.value === null &&
    eq.value.preamp === preset.preamp &&
    JSON.stringify(eq.value.gains) === JSON.stringify(preset.gains)
  );
};

// 加载预设
const handleLoadPreset = (presetId: string) => {
  settingsStore.loadEqualizerPreset(presetId);
};

// 统一的、强健的 Pinia 状态修改函数，包含属性保留与非深合并展开防御
const commitSettings = (patch: Partial<EqualizerSettings>) => {
  const currentEq = settings.value.audio.equalizer;

  // 参数裁剪与校验业务逻辑
  let preampVal = patch.preamp;
  if (preampVal !== undefined) {
    preampVal = normalizeEqValue(preampVal);
  }

  let gainsVal = patch.gains;
  if (gainsVal !== undefined) {
    gainsVal = normalizeGains(gainsVal);
  }

  const mergedEq = {
    ...currentEq,
    ...patch,
  };

  if (preampVal !== undefined) mergedEq.preamp = preampVal;
  if (gainsVal !== undefined) mergedEq.gains = gainsVal;

  // 手动调整 preamp/gains 时自动清空预设 ID，避免状态残留。
  // 如果 patch 中显式提供了 currentPresetId (包含为 null)，则说明是加载或应用预设，不做干扰。
  if ((patch.preamp !== undefined || patch.gains !== undefined) && !('currentPresetId' in patch)) {
    mergedEq.currentPresetId = null;
  }

  settingsStore.patchSettings({
    audio: {
      ...settings.value.audio, // 展开以保护 outputMode, volumeBalance 等配置不被非深合并覆盖
      equalizer: mergedEq,
    },
  });
};

// 幂等的结束编辑并最终提交方法
const finishEditing = async () => {
  if (!isEditingSlider.value) return; // 幂等性防御，防止多源事件并发触发
  isEditingSlider.value = false;

  const finalPreamp = displayPreamp.value;
  const finalGains = [...displayGains.value];

  if (import.meta.env.DEV) {
    console.log(`[EqualizerPanel] finishEditing. Preamp: ${finalPreamp}, Gains: [${finalGains.join(',')}]`);
  }

  // 1. 强制最终值底层同步，即使失败也继续 commit Pinia，保障容错和重试
  try {
    await playbackApi.flushEqualizerSettings(eq.value.enabled, finalPreamp, finalGains);
    if (import.meta.env.DEV) {
      console.log(`[EqualizerPanel] flushEqualizerSettings resolved successfully.`);
    }
  } catch (err) {
    console.warn('[EqualizerPanel] flushEqualizerSettings failed, committing to Pinia anyway:', err);
  }

  // 2. 一次性提交全局 settings
  commitSettings({
    preamp: finalPreamp,
    gains: finalGains
  });
};

// 处理滑块高频滑动
const handlePreampInput = (val: number) => {
  isEditingSlider.value = true;
  displayPreamp.value = normalizeEqValue(val);
  
  if (import.meta.env.DEV) {
    console.log(`[EqualizerPanel] Dragging PRE: ${displayPreamp.value}. Direct sync requested.`);
  }
  
  playbackApi.requestEqualizerSettings(eq.value.enabled, displayPreamp.value, displayGains.value);
};

// 处理滑块释放，幂等扫尾
const handlePreampChange = (val: number) => {
  displayPreamp.value = normalizeEqValue(val);
  void finishEditing();
};

// 处理频段高频滑动
const handleGainInput = (index: number, val: number) => {
  isEditingSlider.value = true;
  const nextGains = [...displayGains.value];
  nextGains[index] = normalizeEqValue(val);
  displayGains.value = nextGains;
  
  if (import.meta.env.DEV) {
    console.log(`[EqualizerPanel] Dragging Band ${FREQ_LABELS[index]}: ${nextGains[index]}. Direct sync requested.`);
  }

  playbackApi.requestEqualizerSettings(eq.value.enabled, displayPreamp.value, nextGains);
};

// 频段滑块释放，幂等扫尾
const handleGainChange = (index: number, val: number) => {
  const nextGain = normalizeEqValue(val);
  const nextGains = [...displayGains.value];
  nextGains[index] = nextGain;
  displayGains.value = nextGains;
  void finishEditing();
};

// 重置为 Flat 状态
const handleReset = () => {
  displayPreamp.value = 0.0;
  displayGains.value = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
  commitSettings({
    preamp: displayPreamp.value,
    gains: displayGains.value,
    currentPresetId: null,
  });
};

// 应用音效预设
const handleApplyPreset = (preset: typeof PRESETS[0]) => {
  displayPreamp.value = preset.preamp;
  displayGains.value = [...preset.gains];
  commitSettings({
    enabled: true,
    preamp: displayPreamp.value,
    gains: displayGains.value,
    currentPresetId: null,
  });
};

// 滚轮微调管理
let wheelDebounceTimer: any = null;

const startWheelEditing = () => {
  isEditingSlider.value = true;
  if (wheelDebounceTimer) {
    clearTimeout(wheelDebounceTimer);
  }
  wheelDebounceTimer = setTimeout(() => {
    wheelDebounceTimer = null;
    if (import.meta.env.DEV) {
      console.log('[EqualizerPanel] Wheel scroll stopped. Triggering finishEditing.');
    }
    void finishEditing();
  }, 300);
};

// 鼠标滚轮微调 Preamp 音量
const handlePreampWheel = (e: WheelEvent) => {
  e.preventDefault();
  if (!eq.value.enabled) return;
  startWheelEditing();
  const step = e.deltaY < 0 ? 0.1 : -0.1;
  displayPreamp.value = normalizeEqValue(displayPreamp.value + step);
  
  playbackApi.requestEqualizerSettings(eq.value.enabled, displayPreamp.value, displayGains.value);
};

// 鼠标滚轮微调 10 段 EQ 频段增益
const handleGainWheel = (e: WheelEvent, index: number) => {
  e.preventDefault();
  if (!eq.value.enabled) return;
  startWheelEditing();
  const step = e.deltaY < 0 ? 0.1 : -0.1;
  const nextGains = [...displayGains.value];
  nextGains[index] = normalizeEqValue(nextGains[index] + step);
  displayGains.value = nextGains;
  
  playbackApi.requestEqualizerSettings(eq.value.enabled, displayPreamp.value, nextGains);
};

// 组件局部生命周期清理，决不 cancel 全局调度器
onScopeDispose(() => {
  if (wheelDebounceTimer) {
    clearTimeout(wheelDebounceTimer);
    wheelDebounceTimer = null;
  }
});
</script>

<template>
  <div :class="embedded ? 'eq-panel p-0 w-full select-none text-gray-800 dark:text-gray-200' : 'eq-panel p-4 w-[600px] bg-[#FFFFFF] dark:bg-[#1E1E1E] text-gray-800 dark:text-gray-200 rounded-2xl border border-gray-100 dark:border-gray-800 select-none'">
    
    <!-- 顶部状态栏：仅保留开关 (在嵌入模式下隐藏) -->
    <div v-if="!embedded" class="flex items-center justify-between mb-4 pb-2 border-b border-gray-100 dark:border-gray-800">
      <div class="flex items-center gap-2">
        <span class="font-semibold text-sm text-gray-700 dark:text-gray-300">均衡器</span>
        
        <!-- 添加当前数值为预设按钮，仅在开启均衡器状态下显示 -->
        <button
          v-if="eq.enabled"
          @click="showSaveDialog = true"
          class="flex items-center justify-center w-5 h-5 rounded-full border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-[#EC4141] hover:text-[#EC4141] dark:hover:border-[#EC4141] dark:hover:text-[#EC4141] transition-colors cursor-pointer"
          title="添加当前数值为预设"
        >
          <Plus class="w-3 h-3" />
        </button>
      </div>
      
      <!-- 启用/禁用 Toggle 开关 -->
      <button 
        @click="commitSettings({ enabled: !eq.enabled })"
        class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
        :class="eq.enabled ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-600'"
      >
        <span
          class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
          :class="eq.enabled ? 'translate-x-4' : 'translate-x-0'"
        />
      </button>
    </div>

    <!-- 预设选择区：合并内置预设与用户自定义预设，实现自然流式折行，空间不足时自动折行且不超过边界 -->
    <div ref="presetList" class="mb-5 flex flex-wrap gap-1.5">
      <!-- 内置预设 -->
      <button
        v-for="preset in PRESETS"
        :key="preset.name"
        @click="handleApplyPreset(preset)"
        class="px-2.5 py-1 text-xs rounded-lg transition-colors cursor-pointer whitespace-nowrap"
        :class="isBuiltInPresetActive(preset)
          ? 'bg-[#EC4141] text-white shadow-sm' 
          : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400'"
      >
        {{ preset.name }}
      </button>
      
      <!-- 用户自定义预设 -->
      <div
        v-for="preset in settingsStore.userPresets"
        :key="preset.id"
        class="group relative inline-block"
      >
        <button
          @click="handleLoadPreset(preset.id)"
          @dblclick="openEditDialogForPreset(preset)"
          class="px-2.5 py-1 text-xs rounded-lg transition-colors cursor-pointer whitespace-nowrap"
          :class="selectedPresetId === preset.id
            ? 'bg-[#EC4141] text-white shadow-sm' 
            : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400'"
        >
          {{ preset.name }}
        </button>
        
        <!-- 删除圆形叉叉按钮 -->
        <button
          @click.stop="handleDeletePresetById(preset.id)"
          class="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 flex items-center justify-center w-5 h-5 rounded-full bg-[#EC4141] hover:bg-[#d63636] text-white text-xs font-bold shadow-sm transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EC4141] focus-visible:ring-offset-2"
          :title="`删除预设“${preset.name}”`"
          :aria-label="`删除预设“${preset.name}”`"
        >
          ×
        </button>
      </div>
    </div>

    <!-- 均衡器推子区 -->
    <div class="flex justify-between items-stretch h-48 mb-4 mt-2 px-1 gap-0.5">
      <!-- 前级 Preamp 推子 -->
      <div class="flex flex-col items-center justify-between w-[34px] mr-2 border-r border-gray-100 dark:border-gray-800 pr-2">
        <span class="text-[12px] text-gray-600 dark:text-gray-300 font-bold font-mono h-4 flex items-center leading-none">
          {{ displayPreamp > 0 ? '+' : '' }}{{ displayPreamp.toFixed(1) }}
        </span>
        <div
          class="relative w-6 flex-1 my-1 flex justify-center items-center"
          @wheel.prevent.stop="handlePreampWheel"
        >
          <!-- 滑轨背景线 -->
          <div class="absolute w-[3px] h-full bg-gray-100 dark:bg-gray-800 rounded-full pointer-events-none" :class="{ 'opacity-40': !eq.enabled }"></div>
          <!-- 已填充部分高亮 -->
          <div 
            class="absolute w-[3px] rounded-full pointer-events-none"
            :class="eq.enabled ? 'bg-[#EC4141]/60' : 'bg-gray-300 dark:bg-gray-600 opacity-40'"
            :style="{
              bottom: '50%',
              height: displayPreamp >= 0 ? `${(displayPreamp / 12) * 50}%` : '0%'
            }"
          ></div>
          <div 
            class="absolute w-[3px] rounded-full pointer-events-none"
            :class="eq.enabled ? 'bg-[#EC4141]/30' : 'bg-gray-300 dark:bg-gray-600 opacity-40'"
            :style="{
              top: '50%',
              height: displayPreamp < 0 ? `${(Math.abs(displayPreamp) / 12) * 50}%` : '0%'
            }"
          ></div>
          <input
            type="range"
            :value="displayPreamp"
            min="-12.0"
            max="12.0"
            step="0.1"
            :disabled="!eq.enabled"
            @input="(e) => handlePreampInput(Number((e.target as HTMLInputElement).value))"
            @change="(e) => handlePreampChange(Number((e.target as HTMLInputElement).value))"
            orient="vertical"
            class="eq-slider"
            :class="{ 'opacity-50': !eq.enabled }"
          />
        </div>
        <span class="text-[12px] text-gray-600 dark:text-gray-300 font-bold font-mono h-4 flex items-center leading-none" :class="{ 'opacity-40': !eq.enabled }">Pre</span>
      </div>

      <!-- 10 段频段推子 -->
      <div 
        v-for="(gain, index) in displayGains" 
        :key="index" 
        class="flex flex-col items-center justify-between flex-1"
        @wheel.prevent.stop="(e) => handleGainWheel(e, index)"
      >
        <span class="text-[11px] text-gray-600 dark:text-gray-300 font-bold font-mono h-4 flex items-center leading-none">
          {{ gain > 0 ? '+' : '' }}{{ gain.toFixed(1) }}
        </span>
        <div class="relative w-full flex-1 my-1 flex justify-center items-center">
          <!-- 滑轨背景线 -->
          <div class="absolute w-[3px] h-full bg-gray-100 dark:bg-gray-800 rounded-full pointer-events-none" :class="{ 'opacity-40': !eq.enabled }"></div>
          <!-- 已填充部分高亮（正向） -->
          <div 
            class="absolute w-[3px] rounded-full pointer-events-none"
            :class="eq.enabled ? 'bg-[#EC4141]/60' : 'bg-gray-300 dark:bg-gray-600 opacity-40'"
            :style="{
              bottom: '50%',
              height: gain >= 0 ? `${(gain / 12) * 50}%` : '0%'
            }"
          ></div>
          <!-- 已填充部分高亮（负向） -->
          <div 
            class="absolute w-[3px] rounded-full pointer-events-none"
            :class="eq.enabled ? 'bg-[#EC4141]/30' : 'bg-gray-300 dark:bg-gray-600 opacity-40'"
            :style="{
              top: '50%',
              height: gain < 0 ? `${(Math.abs(gain) / 12) * 50}%` : '0%'
            }"
          ></div>
          <input
            type="range"
            :value="gain"
            min="-12.0"
            max="12.0"
            step="0.1"
            :disabled="!eq.enabled"
            @input="(e) => handleGainInput(index, Number((e.target as HTMLInputElement).value))"
            @change="(e) => handleGainChange(index, Number((e.target as HTMLInputElement).value))"
            orient="vertical"
            class="eq-slider"
            :class="{ 'opacity-50': !eq.enabled }"
          />

        </div>
        <span class="text-[11px] text-gray-600 dark:text-gray-300 font-bold h-4 flex items-center leading-none">
          {{ FREQ_LABELS[index] }}
        </span>
      </div>
    </div>

    <!-- 底部控制区 -->
    <div class="flex items-center justify-end mt-3 pt-2 border-t border-gray-100 dark:border-gray-800">
      <button 
        @click="handleReset"
        class="flex items-center gap-1 px-2.5 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 rounded-lg cursor-pointer transition-colors text-xs"
      >
        <RefreshCw class="w-3 h-3" />
        <span>重置</span>
      </button>
    </div>
  </div>

  <ModernModal
    :visible="presetToDelete !== null"
    title="删除预设"
    :content="`确定删除预设“${presetToDelete?.name ?? ''}”吗？删除后无法撤销，当前均衡器音效保持不变。`"
    type="danger"
    confirm-text="删除"
    cancel-text="取消"
    @confirm="confirmDeletePreset"
    @cancel="presetToDelete = null"
  />
  
  <!-- 保存预设对话框 -->
  <div v-if="showSaveDialog" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm" @click.self="showSaveDialog = false">
    <div class="bg-white dark:bg-gray-800 rounded-2xl p-6 w-80 shadow-xl" @click.stop>
      <h3 class="text-lg font-semibold mb-2">保存预设</h3>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">将当前均衡器设置保存为自定义预设</p>
      <input
        v-model="newPresetName"
        placeholder="输入预设名称"
        class="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-600 rounded-lg mb-4 outline-none focus:border-[#EC4141] focus:ring-2 focus:ring-[#EC4141]/20 transition-all"
        @keyup.enter="handleSavePreset"
      />
      <div class="flex justify-end gap-2">
        <button
          @click="showSaveDialog = false"
          class="px-4 py-2 text-sm rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 transition-colors"
        >
          取消
        </button>
        <button
          @click="handleSavePreset"
          class="px-4 py-2 text-sm rounded-lg bg-[#EC4141] text-white hover:bg-[#d63636] transition-colors shadow-sm"
        >
          保存
        </button>
      </div>
    </div>
  </div>
  
  <!-- 编辑预设对话框 -->
  <div v-if="showEditDialog" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm" @click.self="showEditDialog = false">
    <div class="bg-white dark:bg-gray-800 rounded-2xl p-6 w-80 shadow-xl" @click.stop>
      <h3 class="text-lg font-semibold mb-2">编辑预设</h3>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">修改预设名称</p>
      <input
        v-model="editPresetName"
        placeholder="输入预设名称"
        class="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-600 rounded-lg mb-4 outline-none focus:border-[#EC4141] focus:ring-2 focus:ring-[#EC4141]/20 transition-all"
        @keyup.enter="handleUpdatePreset"
      />
      <div class="flex justify-end gap-2">
        <button
          @click="showEditDialog = false"
          class="px-4 py-2 text-sm rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 transition-colors"
        >
          取消
        </button>
        <button
          @click="handleUpdatePreset"
          class="px-4 py-2 text-sm rounded-lg bg-[#EC4141] text-white hover:bg-[#d63636] transition-colors shadow-sm"
        >
          保存
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 竖向滑动推子基础样式 */
.eq-slider {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  outline: none;
  cursor: pointer;
  writing-mode: vertical-lr;
  direction: rtl;
  margin: 0;
  padding: 0;
}

.eq-slider::-webkit-slider-runnable-track {
  background: transparent;
  border: none;
}

/* 圆润胶囊形旋钮（宽 > 高，带弧度） */
.eq-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 10px;
  border-radius: 5px;
  background: #ffffff;
  border: 1.5px solid #d1d5db;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18), 0 0 0 0 rgba(236, 65, 65, 0);
  transition: box-shadow 0.15s ease, transform 0.12s ease, background 0.15s ease;
  position: relative;
  z-index: 10;
}

.dark .eq-slider::-webkit-slider-thumb {
  background: #374151;
  border-color: #4b5563;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4), 0 0 0 0 rgba(236, 65, 65, 0);
}

.eq-slider:not(:disabled)::-webkit-slider-thumb:hover {
  background: #ffffff;
  border-color: #EC4141;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2), 0 0 0 3px rgba(236, 65, 65, 0.15);
  transform: scaleX(1.1);
}

.dark .eq-slider:not(:disabled)::-webkit-slider-thumb:hover {
  background: #4b5563;
  border-color: #EC4141;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5), 0 0 0 3px rgba(236, 65, 65, 0.2);
  transform: scaleX(1.1);
}

.eq-slider:not(:disabled):active::-webkit-slider-thumb,
.eq-slider:not(:disabled)::-webkit-slider-thumb:active {
  background: #fef2f2;
  border-color: #EC4141;
  box-shadow: 0 2px 8px rgba(236, 65, 65, 0.3), 0 0 0 4px rgba(236, 65, 65, 0.12);
  transform: scaleX(1.15);
}

.dark .eq-slider:not(:disabled):active::-webkit-slider-thumb {
  background: #3f2020;
  border-color: #EC4141;
}

.eq-slider:disabled::-webkit-slider-thumb {
  background: #f3f4f6;
  border-color: #e5e7eb;
  cursor: not-allowed;
  box-shadow: none;
}

.dark .eq-slider:disabled::-webkit-slider-thumb {
  background: #1f2937;
  border-color: #374151;
}
</style>
