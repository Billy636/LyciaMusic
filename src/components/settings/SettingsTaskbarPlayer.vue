<script setup lang="ts">
import { computed } from 'vue';
import { Check, Minus, Plus, RotateCcw } from 'lucide-vue-next';
import { useSettings } from '../../features/settings/useSettings';
import { TASKBAR_PLAYER_MIN_WIDTH, TASKBAR_PLAYER_MAX_WIDTH, TASKBAR_PLAYER_WINDOW_WIDTH, TASKBAR_PLAYER_DEFAULT_TEXT_COLOR, normalizeTaskbarWidth, normalizeTaskbarTextColor } from '../../features/taskbarPlayer/shared';

const { settings, patchSettings } = useSettings();
const opacity = computed(() => settings.value.taskbarBackgroundOpacity);
const transparency = computed(() => 100 - opacity.value);
const width = computed(() => normalizeTaskbarWidth(settings.value.taskbarWindowWidth));
const widthFill = computed(() => (width.value - TASKBAR_PLAYER_MIN_WIDTH) / (TASKBAR_PLAYER_MAX_WIDTH - TASKBAR_PLAYER_MIN_WIDTH) * 100);
const textColor = computed(() => normalizeTaskbarTextColor(settings.value.taskbarTextColor));
const textColors = [
  { value: '#ffffff', label: '白色' }, { value: '#273449', label: '墨色' },
  { value: '#ec4141', label: '经典红' }, { value: '#60a5fa', label: '澄蓝' },
  { value: '#34d399', label: '青绿' }, { value: '#fbbf24', label: '暖金' },
];
function setTextColor(value: string) {
  patchSettings({ taskbarTextColor: normalizeTaskbarTextColor(value) });
}
function onColorInput(event: Event) {
  setTextColor((event.target as HTMLInputElement).value);
}
function setWidth(value: number) {
  patchSettings({ taskbarWindowWidth: normalizeTaskbarWidth(value) });
}
function onWidthInput(event: Event) {
  setWidth(Number((event.target as HTMLInputElement).value));
}
function setTransparency(value: number) {
  patchSettings({ taskbarBackgroundOpacity: 100 - Math.min(100, Math.max(0, value)) });
}
function onInput(event: Event) {
  setTransparency(Number((event.target as HTMLInputElement).value));
}
</script>

<template>
  <div class="space-y-8">
    <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
      <span class="h-4 w-1 rounded-full bg-[#EC4141]" aria-hidden="true" />窗口样式
    </h2>
    <div class="flex flex-wrap items-center justify-between gap-6 border-b border-[var(--settings-divider)] pb-6">
      <div>
        <label for="taskbar-background-transparency" class="text-sm font-medium text-gray-800 dark:text-gray-100">背景透明度</label>
      </div>
      <div class="taskbar-slider-controls">
        <button type="button" aria-label="降低背景透明度" :disabled="transparency === 0" class="p-2 app-text-secondary disabled:opacity-30" @click="setTransparency(transparency - 5)"><Minus :size="16" /></button>
        <input id="taskbar-background-transparency" type="range" min="0" max="100" step="1" :value="transparency"
          :aria-valuetext="`${transparency}% 透明`" class="taskbar-transparency-slider" :style="{ '--fill': `${transparency}%` }" @input="onInput" />
        <button type="button" aria-label="提高背景透明度" :disabled="transparency === 100" class="p-2 app-text-secondary disabled:opacity-30" @click="setTransparency(transparency + 5)"><Plus :size="16" /></button>
        <span class="text-right text-sm tabular-nums text-gray-800 dark:text-gray-100">{{ transparency }}%</span>
        <button type="button" aria-label="恢复默认透明度" title="恢复默认" :disabled="opacity === 0" class="p-2 app-text-secondary disabled:opacity-30" @click="setTransparency(100)"><RotateCcw :size="16" /></button>
      </div>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-6 border-b border-[var(--settings-divider)] pb-6">
      <div>
        <label for="taskbar-window-width" class="text-sm font-medium text-gray-800 dark:text-gray-100">窗口长度</label>
      </div>
      <div class="taskbar-slider-controls">
        <button type="button" aria-label="缩短窗口" :disabled="width === TASKBAR_PLAYER_MIN_WIDTH" class="p-2 app-text-secondary disabled:opacity-30" @click="setWidth(width - 10)"><Minus :size="16" /></button>
        <input id="taskbar-window-width" type="range" :min="TASKBAR_PLAYER_MIN_WIDTH" :max="TASKBAR_PLAYER_MAX_WIDTH" step="1" :value="width"
          :aria-valuetext="`${width} 像素`" class="taskbar-transparency-slider" :style="{ '--fill': `${widthFill}%` }" @input="onWidthInput" />
        <button type="button" aria-label="加长窗口" :disabled="width === TASKBAR_PLAYER_MAX_WIDTH" class="p-2 app-text-secondary disabled:opacity-30" @click="setWidth(width + 10)"><Plus :size="16" /></button>
        <span class="text-right text-sm tabular-nums text-gray-800 dark:text-gray-100">{{ width }} px</span>
        <button type="button" aria-label="恢复默认窗口长度" title="恢复默认" :disabled="width === TASKBAR_PLAYER_WINDOW_WIDTH" class="p-2 app-text-secondary disabled:opacity-30" @click="setWidth(TASKBAR_PLAYER_WINDOW_WIDTH)"><RotateCcw :size="16" /></button>
      </div>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-6 border-b border-[var(--settings-divider)] pb-6">
      <div>
        <label for="taskbar-text-color" class="text-sm font-medium text-gray-800 dark:text-gray-100">字体颜色</label>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <button v-for="preset in textColors" :key="preset.value" type="button" :aria-label="preset.label" :title="preset.label" :aria-pressed="textColor === preset.value"
          class="flex h-7 w-7 items-center justify-center rounded-full border border-black/10 transition-transform hover:scale-110 dark:border-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#EC4141]"
          :style="{ backgroundColor: preset.value, color: preset.value === '#ffffff' || preset.value === '#fbbf24' ? '#273449' : '#ffffff' }" @click="setTextColor(preset.value)">
          <Check v-if="textColor === preset.value" :size="15" :stroke-width="2.5" />
        </button>
        <label for="taskbar-text-color" class="ml-2 text-sm app-text-secondary">自定义</label>
        <input id="taskbar-text-color" type="color" aria-label="自定义任务栏字体颜色" class="taskbar-color-input" :value="textColor" @input="onColorInput" @change="onColorInput" />
        <button type="button" aria-label="恢复默认字体颜色" title="恢复默认" :disabled="textColor === TASKBAR_PLAYER_DEFAULT_TEXT_COLOR" class="p-2 app-text-secondary disabled:opacity-30" @click="setTextColor(TASKBAR_PLAYER_DEFAULT_TEXT_COLOR)"><RotateCcw :size="16" /></button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.taskbar-slider-controls {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 32px 64px 32px;
  align-items: center;
  gap: 12px;
  width: min(100%, 432px);
}
@media (max-width: 640px) {
  .taskbar-slider-controls { grid-template-columns: 28px minmax(0, 1fr) 28px 56px 28px; gap: 8px; }
}
.taskbar-color-input { width: 36px; height: 28px; padding: 2px; border: 1px solid rgb(128 128 128 / 25%); border-radius: 6px; background: transparent; cursor: pointer; }
.taskbar-transparency-slider {
  width: 100%;
  min-width: 0;
  appearance: none;
  height: 5px;
  border-radius: 999px;
  background: linear-gradient(to right, #ec4141 var(--fill), rgb(128 128 128 / 20%) var(--fill));
  cursor: pointer;
}
.taskbar-transparency-slider::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 5px rgb(0 0 0 / 20%);
}
.taskbar-transparency-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border: 0;
  border-radius: 50%;
  background: #fff;
}
.taskbar-transparency-slider:focus-visible { outline: 2px solid #ec4141; outline-offset: 5px; }
</style>
