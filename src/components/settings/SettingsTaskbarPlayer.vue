<script setup lang="ts">
import { computed } from 'vue';
import { emitTo } from '@tauri-apps/api/event';
import { Check, Minus, Plus, RotateCcw } from 'lucide-vue-next';
import { useSettings } from '../../features/settings/useSettings';
import SettingsSelect from './SettingsSelect.vue';
import {
  TASKBAR_PLAYER_ACTION_EVENT,
  TASKBAR_PLAYER_MIN_WIDTH,
  TASKBAR_PLAYER_MAX_WIDTH,
  TASKBAR_PLAYER_WINDOW_WIDTH,
  TASKBAR_PLAYER_DEFAULT_TEXT_COLOR,
  normalizeTaskbarWidth,
  normalizeTaskbarTextColor,
  normalizeTaskbarContentMode,
  normalizeTaskbarCoverShape,
  normalizeTaskbarLeftOffset,
  type TaskbarPlayerAction,
} from '../../features/taskbarPlayer/shared';

const { settings, patchSettings } = useSettings();
const contentMode = computed(() => normalizeTaskbarContentMode(settings.value.taskbarContentMode));
const coverShape = computed(() => normalizeTaskbarCoverShape(settings.value.taskbarCoverShape));
const positionLocked = computed(() => settings.value.taskbarPositionLocked);
const leftOffset = computed(() => normalizeTaskbarLeftOffset(settings.value.taskbarLeftOffset));
const contentDescription = computed(() => contentMode.value === 'bilingual'
  ? '原文、译文各一行；没有翻译时显示原文。'
  : contentMode.value === 'lyrics-only' ? '隐藏歌名，专注显示当前歌词。' : '同时显示歌曲名称和当前歌词。');
const contentModeOptions = [
  { value: 'title-lyrics', label: '歌名＋歌词' },
  { value: 'bilingual', label: '双语歌词' },
  { value: 'lyrics-only', label: '仅歌词' },
];
const coverShapeOptions = [
  { value: 'square', label: '圆角方形' },
  { value: 'circle', label: '圆形' },
];
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
function setLeftOffset(value: number) {
  patchSettings({ taskbarLeftOffset: normalizeTaskbarLeftOffset(value) });
}
function onLeftOffsetInput(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.value === '') return;
  setLeftOffset(input.valueAsNumber);
  input.value = String(leftOffset.value);
}
function restoreOffsetInput(event: Event) {
  (event.target as HTMLInputElement).value = String(leftOffset.value);
}
async function alignLeft() {
  if (!settings.value.showTaskbarPlayer) return;
  try {
    await emitTo<TaskbarPlayerAction>('main', TASKBAR_PLAYER_ACTION_EVENT, { type: 'align-left' });
  } catch (error) {
    console.error('Failed to align taskbar player', error);
  }
}
</script>

<template>
  <div class="taskbar-settings space-y-8 text-gray-800 dark:text-gray-100">
    <section>
      <div class="taskbar-setting-row">
        <div>
          <span id="taskbar-enabled-label" class="taskbar-setting-label">开启任务栏播控</span>
          <p class="taskbar-setting-description">在任务栏显示封面、歌词和播放控制。</p>
        </div>
        <button type="button" role="switch" aria-labelledby="taskbar-enabled-label" :aria-checked="settings.showTaskbarPlayer"
          class="taskbar-switch" :class="{ 'is-on': settings.showTaskbarPlayer }" @click="patchSettings({ showTaskbarPlayer: !settings.showTaskbarPlayer })">
          <span aria-hidden="true" />
        </button>
      </div>
    </section>
    <section>
      <h2 class="taskbar-section-title"><span aria-hidden="true" />显示内容</h2>
      <div class="taskbar-setting-row">
        <div>
          <label for="taskbar-content-mode" class="taskbar-setting-label">内容模式</label>
          <p id="taskbar-content-description" class="taskbar-setting-description">{{ contentDescription }}</p>
        </div>
        <SettingsSelect class="taskbar-select" label="内容模式" hide-label trigger-id="taskbar-content-mode" described-by="taskbar-content-description"
          :model-value="contentMode" :options="contentModeOptions" @update:model-value="patchSettings({ taskbarContentMode: normalizeTaskbarContentMode($event) })" />
      </div>
    </section>
    <section>
      <h2 class="taskbar-section-title"><span aria-hidden="true" />封面样式</h2>
      <div class="taskbar-setting-row">
        <label for="taskbar-cover-shape" class="taskbar-setting-label">封面形状</label>
        <SettingsSelect class="taskbar-select" label="封面形状" hide-label trigger-id="taskbar-cover-shape"
          :model-value="coverShape" :options="coverShapeOptions" @update:model-value="patchSettings({ taskbarCoverShape: normalizeTaskbarCoverShape($event) })" />
      </div>
      <div class="taskbar-setting-row">
        <div>
          <span id="taskbar-cover-rotate-label" class="taskbar-setting-label">播放时旋转封面</span>
          <p id="taskbar-cover-rotate-description" class="taskbar-setting-description">{{ coverShape === 'circle' ? '播放时旋转，暂停时保持当前角度。' : '选择圆形封面后可开启。' }}</p>
        </div>
        <button type="button" role="switch" aria-labelledby="taskbar-cover-rotate-label" aria-describedby="taskbar-cover-rotate-description"
          :aria-checked="settings.taskbarCoverRotate" :disabled="coverShape !== 'circle'" class="taskbar-switch"
          :class="{ 'is-on': settings.taskbarCoverRotate }" @click="patchSettings({ taskbarCoverRotate: !settings.taskbarCoverRotate })">
          <span aria-hidden="true" />
        </button>
      </div>
    </section>
    <section>
      <h2 class="taskbar-section-title"><span aria-hidden="true" />窗口位置</h2>
      <div class="taskbar-setting-row">
        <div>
          <span id="taskbar-position-locked-label" class="taskbar-setting-label">锁定位置</span>
          <p class="taskbar-setting-description">锁定后隐藏拖动手柄，避免误触移动。</p>
        </div>
        <button type="button" role="switch" aria-labelledby="taskbar-position-locked-label" :aria-checked="positionLocked"
          class="taskbar-switch" :class="{ 'is-on': positionLocked }" @click="patchSettings({ taskbarPositionLocked: !positionLocked })">
          <span aria-hidden="true" />
        </button>
      </div>
      <div class="taskbar-setting-row">
        <div>
          <label for="taskbar-left-offset" class="taskbar-setting-label">向左偏移</label>
          <p id="taskbar-left-offset-description" class="taskbar-setting-description">相对默认位置向左移动，拖动后同步更新。</p>
        </div>
        <div class="taskbar-position-controls">
          <div class="taskbar-offset-stepper">
            <button type="button" aria-label="减少向左偏移" :disabled="leftOffset === 0" @click="setLeftOffset(leftOffset - 10)"><Minus :size="14" /></button>
            <input id="taskbar-left-offset" type="number" min="0" step="1" :value="leftOffset" aria-describedby="taskbar-left-offset-description"
              @change="onLeftOffsetInput" @blur="restoreOffsetInput" />
            <span class="taskbar-offset-unit" aria-hidden="true">px</span>
            <button type="button" aria-label="增加向左偏移" @click="setLeftOffset(leftOffset + 10)"><Plus :size="14" /></button>
          </div>
          <button type="button" class="taskbar-position-action" :disabled="!settings.showTaskbarPlayer" @click="alignLeft">贴左边缘</button>
          <button type="button" class="taskbar-position-action" :disabled="leftOffset === 0" @click="setLeftOffset(0)"><RotateCcw :size="13" />恢复默认</button>
        </div>
      </div>
    </section>
    <section>
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]" aria-hidden="true" />窗口样式
      </h2>
      <div class="taskbar-setting-row">
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
      <div class="taskbar-setting-row">
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
      <div class="taskbar-setting-row">
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
    </section>
  </div>
</template>

<style scoped>
.taskbar-section-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; }
.taskbar-section-title > span { height: 16px; width: 4px; border-radius: 999px; background: #ec4141; }
.taskbar-setting-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; min-height: 66px; padding: 16px 2px; border-bottom: 1px solid var(--settings-divider); }
.taskbar-setting-row:last-child { border-bottom: 0; }
.taskbar-setting-label { font-size: 14px; font-weight: 500; }
.taskbar-setting-description { margin-top: 5px; color: var(--app-text-secondary); font-size: 12px; line-height: 1.6; }
.taskbar-select { width: 224px; max-width: 100%; flex-shrink: 0; }
.taskbar-select :deep(.settings-select-trigger:not(:hover):not(:focus-visible):not(.is-open)) { background: transparent; border-color: transparent; box-shadow: none; }
.taskbar-switch { width: 44px; height: 24px; padding: 3px; border-radius: 999px; flex-shrink: 0; background: #d1d5db; transition: background-color 160ms; }
.taskbar-switch span { display: block; width: 18px; height: 18px; border-radius: 50%; background: white; box-shadow: 0 1px 3px rgb(0 0 0 / .12); transition: transform 160ms; }
:global(.dark .taskbar-switch) { background: #374151; }
.taskbar-switch.is-on { background: #ec4141; }
.taskbar-switch.is-on span { transform: translateX(20px); }
.taskbar-switch:disabled { opacity: .35; cursor: not-allowed; }
.taskbar-switch:focus-visible, .taskbar-position-action:focus-visible { outline: 2px solid #ec4141; outline-offset: 4px; }
.taskbar-position-controls { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 8px; max-width: 100%; }
.taskbar-offset-stepper { display: inline-flex; align-items: center; min-height: 34px; border: 1px solid rgb(128 128 128 / .2); border-radius: 8px; overflow: hidden; }
.taskbar-offset-stepper:focus-within { border-color: rgb(236 65 65 / .55); box-shadow: 0 0 0 3px rgb(236 65 65 / .1); }
.taskbar-offset-stepper button { display: flex; align-items: center; justify-content: center; width: 30px; height: 32px; color: var(--app-text-secondary); }
.taskbar-offset-stepper button:hover:not(:disabled) { background: rgb(128 128 128 / .08); }
.taskbar-offset-stepper button:disabled { opacity: .3; }
.taskbar-offset-stepper input { width: 55px; min-width: 0; background: transparent; border: 0; text-align: right; font-size: 13px; font-variant-numeric: tabular-nums; outline: none; appearance: textfield; }
.taskbar-offset-stepper input::-webkit-inner-spin-button, .taskbar-offset-stepper input::-webkit-outer-spin-button { margin: 0; appearance: none; }
.taskbar-offset-unit { padding: 0 8px 0 4px; color: var(--app-text-secondary); font-size: 12px; }
.taskbar-position-action { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 34px; padding: 6px 9px; border: 1px solid rgb(128 128 128 / .18); border-radius: 8px; font-size: 12px; color: var(--app-text-secondary); transition: background-color 160ms, color 160ms; }
.taskbar-position-action:hover:not(:disabled) { color: #ec4141; background: rgb(236 65 65 / .06); border-color: rgb(236 65 65 / .2); }
.taskbar-position-action:disabled { opacity: .35; cursor: not-allowed; }
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
