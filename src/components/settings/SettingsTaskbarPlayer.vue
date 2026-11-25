<script setup lang="ts">
import { computed } from 'vue';
import { emitTo } from '@tauri-apps/api/event';
import { Check, RotateCcw } from 'lucide-vue-next';
import { useSettings } from '../../features/settings/useSettings';
import SettingsSelect from './SettingsSelect.vue';
import SettingsNumberControl from './SettingsNumberControl.vue';
import {
  TASKBAR_PLAYER_ACTION_EVENT,
  TASKBAR_PLAYER_MIN_WIDTH,
  TASKBAR_PLAYER_MAX_WIDTH,
  TASKBAR_PLAYER_MIN_LEFT_OFFSET,
  TASKBAR_PLAYER_MAX_LEFT_OFFSET,
  TASKBAR_PLAYER_WINDOW_WIDTH,
  TASKBAR_PLAYER_DEFAULT_TEXT_COLOR,
  TASKBAR_PLAYER_DEFAULT_BACKGROUND_OPACITY,
  TASKBAR_PLAYER_DEFAULT_BACKGROUND_COLOR,
  normalizeTaskbarWidth,
  normalizeTaskbarBackgroundMode,
  normalizeTaskbarBackgroundColor,
  normalizeTaskbarTextColor,
  normalizeTaskbarContentMode,
  normalizeTaskbarLyricEffect,
  normalizeTaskbarLyricHighlightColor,
  normalizeTaskbarCoverShape,
  normalizeTaskbarFrameShape,
  resolveAllowedCoverShapes,
  normalizeTaskbarLeftOffset,
  type TaskbarPlayerAction,
} from '../../features/taskbarPlayer/shared';

const { settings, patchSettings } = useSettings();
const contentMode = computed(() => normalizeTaskbarContentMode(settings.value.taskbarContentMode));
const lyricEffect = computed(() => normalizeTaskbarLyricEffect(settings.value.taskbarLyricEffect));
const lyricHighlightColor = computed(() => normalizeTaskbarLyricHighlightColor(settings.value.taskbarLyricHighlightColor));
const translationKaraoke = computed(() => settings.value.taskbarTranslationKaraoke !== false);
const coverShape = computed(() => normalizeTaskbarCoverShape(settings.value.taskbarCoverShape));
const positionLocked = computed(() => settings.value.taskbarPositionLocked);
const leftOffset = computed(() => normalizeTaskbarLeftOffset(settings.value.taskbarLeftOffset));
const contentModeOptions = [
  { value: 'adaptive', label: '自适应' },
  { value: 'bilingual', label: '原文＋翻译' },
  { value: 'title-lyrics', label: '歌名＋歌词' },
  { value: 'double-line', label: '当前句＋下一句' },
  { value: 'lyrics-only', label: '仅当前句' },
];
const COVER_SHAPE_LABELS = { square: '方形', rounded: '圆角矩形', circle: '圆形' } as const;
/** 封面形状受外框形状约束：圆框只能圆封面，圆角框配圆角/圆形，方框任意。 */
const coverShapeOptions = computed(() => resolveAllowedCoverShapes(frameShape.value)
  .map(value => ({ value, label: COVER_SHAPE_LABELS[value] })));
const frameShape = computed(() => normalizeTaskbarFrameShape(settings.value.taskbarFrameShape));
const frameShapeOptions = [
  { value: 'rounded', label: '圆角矩形' },
  { value: 'pill', label: '胶囊圆形' },
  { value: 'square', label: '方形' },
];
const alwaysOnTop = computed(() => settings.value.taskbarAlwaysOnTop !== false);
const backgroundMode = computed(() => normalizeTaskbarBackgroundMode(settings.value.taskbarBackgroundMode));
const backgroundColor = computed(() => normalizeTaskbarBackgroundColor(settings.value.taskbarBackgroundColor));
const backgroundModeOptions = [
  { value: 'live', label: '封面虚化背景色' },
  { value: 'color', label: '自定义背景色' },
];
// 与「高亮颜色 / 字体颜色」保持同一套色板与顺序。
const backgroundColors = [
  { value: '#ffffff', label: '白色' }, { value: '#273449', label: '墨色' },
  { value: '#ec4141', label: '经典红' }, { value: '#60a5fa', label: '澄蓝' },
  { value: '#34d399', label: '青绿' }, { value: '#fbbf24', label: '暖金' },
];
function setBackgroundColor(value: string) {
  patchSettings({ taskbarBackgroundColor: normalizeTaskbarBackgroundColor(value) });
}
function onBackgroundColorInput(event: Event) {
  setBackgroundColor((event.target as HTMLInputElement).value);
}
const opacity = computed(() => settings.value.taskbarBackgroundOpacity);
const transparency = computed(() => 100 - opacity.value);
// 窗口长度上限与边缘拉伸共用固定口径。
const width = computed(() => normalizeTaskbarWidth(settings.value.taskbarWindowWidth, TASKBAR_PLAYER_MAX_WIDTH));
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
function setLyricHighlightColor(value: string | null) {
  patchSettings({ taskbarLyricHighlightColor: normalizeTaskbarLyricHighlightColor(value) });
}
function onLyricHighlightColorInput(event: Event) {
  setLyricHighlightColor((event.target as HTMLInputElement).value);
}
function setWidth(value: number) {
  patchSettings({ taskbarWindowWidth: normalizeTaskbarWidth(value, TASKBAR_PLAYER_MAX_WIDTH) });
}
function setTransparency(value: number) {
  patchSettings({ taskbarBackgroundOpacity: 100 - Math.min(100, Math.max(0, value)) });
}
function setLeftOffset(value: number) {
  patchSettings({ taskbarLeftOffset: normalizeTaskbarLeftOffset(value) });
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
  <div class="taskbar-settings text-gray-800 dark:text-gray-100">
    <section>
      <h2 class="taskbar-section-title"><span aria-hidden="true" />内容与封面</h2>
      <div class="taskbar-setting-row">
        <div>
          <label for="taskbar-content-mode" class="taskbar-setting-label">显示内容</label>
          <p v-if="contentMode === 'adaptive'" class="mt-1 text-xs app-text-secondary">有译文时显示原文与译文，否则显示当前句与下一句</p>
        </div>
        <SettingsSelect class="taskbar-select" label="显示内容" hide-label trigger-id="taskbar-content-mode"
          :model-value="contentMode" :options="contentModeOptions" @update:model-value="patchSettings({ taskbarContentMode: normalizeTaskbarContentMode($event) })" />
      </div>
      <div class="taskbar-setting-row">
        <label for="taskbar-cover-shape" class="taskbar-setting-label">封面形状</label>
        <SettingsSelect class="taskbar-select" label="封面形状" hide-label trigger-id="taskbar-cover-shape"
          :model-value="coverShape" :options="coverShapeOptions" @update:model-value="patchSettings({ taskbarCoverShape: normalizeTaskbarCoverShape($event) })" />
      </div>
      <div class="taskbar-setting-row">
        <span id="taskbar-cover-rotate-label" class="taskbar-setting-label">播放时旋转封面</span>
        <button type="button" role="switch" aria-labelledby="taskbar-cover-rotate-label"
          :aria-checked="settings.taskbarCoverRotate" :disabled="coverShape !== 'circle'" class="taskbar-switch"
          :class="{ 'is-on': settings.taskbarCoverRotate }" @click="patchSettings({ taskbarCoverRotate: !settings.taskbarCoverRotate })">
          <span aria-hidden="true" />
        </button>
      </div>
    </section>
    <section>
      <h2 class="taskbar-section-title"><span aria-hidden="true" />歌词效果</h2>
      <div class="taskbar-setting-row">
        <div>
          <label for="taskbar-text-color" class="taskbar-setting-label">字体颜色</label>
        </div>
        <div class="taskbar-color-controls">
          <div class="taskbar-color-presets" role="group" aria-label="字体预设颜色">
            <button v-for="preset in textColors" :key="preset.value" type="button" :aria-label="preset.label" :title="preset.label" :aria-pressed="textColor === preset.value"
              class="taskbar-color-preset"
              :style="{ backgroundColor: preset.value, color: preset.value === '#ffffff' || preset.value === '#fbbf24' ? '#273449' : '#ffffff' }" @click="setTextColor(preset.value)">
              <Check v-if="textColor === preset.value" :size="14" :stroke-width="2.5" />
            </button>
          </div>
          <label for="taskbar-text-color" class="taskbar-custom-color">自定义
            <input id="taskbar-text-color" type="color" aria-label="自定义铃动窗字体颜色" class="taskbar-color-input" :value="textColor" @input="onColorInput" @change="onColorInput" />
          </label>
          <button type="button" aria-label="恢复默认字体颜色" title="恢复默认" :disabled="textColor === TASKBAR_PLAYER_DEFAULT_TEXT_COLOR" class="p-2 app-text-secondary disabled:opacity-30" @click="setTextColor(TASKBAR_PLAYER_DEFAULT_TEXT_COLOR)"><RotateCcw :size="16" /></button>
        </div>
      </div>
      <div class="taskbar-setting-row taskbar-lyric-effect-row">
        <span id="taskbar-lyric-effect-label" class="taskbar-setting-label">逐字效果</span>
        <button id="taskbar-lyric-effect" type="button" role="switch" aria-labelledby="taskbar-lyric-effect-label"
          aria-controls="taskbar-lyric-subsettings" :aria-checked="lyricEffect !== 'none'" class="taskbar-switch"
          :class="{ 'is-on': lyricEffect !== 'none' }" @click="patchSettings({ taskbarLyricEffect: lyricEffect === 'none' ? 'karaoke' : 'none' })">
          <span aria-hidden="true" />
        </button>
      </div>
      <div id="taskbar-lyric-subsettings" class="taskbar-lyric-subsettings" :class="{ 'is-expanded': lyricEffect !== 'none' }"
        :aria-hidden="lyricEffect === 'none'" :inert="lyricEffect === 'none'">
        <div class="taskbar-lyric-subsettings-inner">
          <div class="taskbar-lyric-subsettings-panel" role="group" aria-label="逐字效果子设置">
            <div v-if="contentMode === 'bilingual' || contentMode === 'adaptive'" class="taskbar-setting-row">
              <span id="taskbar-translation-karaoke-label" class="taskbar-setting-label">翻译跟随高亮</span>
              <button type="button" role="switch" aria-labelledby="taskbar-translation-karaoke-label"
                :aria-checked="translationKaraoke" :disabled="lyricEffect === 'none'" class="taskbar-switch"
                :class="{ 'is-on': translationKaraoke }" @click="patchSettings({ taskbarTranslationKaraoke: !translationKaraoke })">
                <span aria-hidden="true" />
              </button>
            </div>
            <div class="taskbar-setting-row">
              <label for="taskbar-lyric-highlight-color" class="taskbar-setting-label">高亮颜色</label>
              <div class="taskbar-color-controls">
                <div class="taskbar-color-presets" role="group" aria-label="高亮预设颜色">
                  <button v-for="preset in textColors" :key="preset.value" type="button" :aria-label="`歌词高亮：${preset.label}`" :title="preset.label" :aria-pressed="lyricHighlightColor === preset.value"
                    class="taskbar-color-preset"
                    :style="{ backgroundColor: preset.value, color: preset.value === '#ffffff' || preset.value === '#fbbf24' ? '#273449' : '#ffffff' }" @click="setLyricHighlightColor(preset.value)">
                    <Check v-if="lyricHighlightColor === preset.value" :size="14" :stroke-width="2.5" />
                  </button>
                </div>
                <label for="taskbar-lyric-highlight-color" class="taskbar-custom-color">自定义
                  <input id="taskbar-lyric-highlight-color" type="color" aria-label="自定义歌词高亮颜色" class="taskbar-color-input" :value="lyricHighlightColor ?? textColor" @input="onLyricHighlightColorInput" @change="onLyricHighlightColorInput" />
                </label>
                <button type="button" class="taskbar-color-follow" :aria-pressed="lyricHighlightColor === null" @click="setLyricHighlightColor(null)">跟随字体</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
    <section>
      <h2 class="taskbar-section-title"><span aria-hidden="true" />窗口位置</h2>
      <div class="taskbar-setting-row">
        <div class="taskbar-setting-copy">
          <span id="taskbar-always-on-top-label" class="taskbar-setting-label">始终置顶</span>
          <p class="taskbar-setting-hint">开启后铃动窗始终压在其他窗口之上；关闭后可以被其他窗口覆盖。</p>
        </div>
        <button type="button" role="switch" aria-labelledby="taskbar-always-on-top-label" :aria-checked="alwaysOnTop"
          class="taskbar-switch" :class="{ 'is-on': alwaysOnTop }" @click="patchSettings({ taskbarAlwaysOnTop: !alwaysOnTop })">
          <span aria-hidden="true" />
        </button>
      </div>
      <div class="taskbar-setting-row">
        <div class="taskbar-setting-copy">
          <span id="taskbar-position-locked-label" class="taskbar-setting-label">锁定在桌面底栏</span>
          <p class="taskbar-setting-hint">锁定后铃动窗固定在桌面底栏；点击铃动窗上的锁头即可解锁，在桌面任意位置拖动，重新上锁会自动吸附回底栏。</p>
        </div>
        <button type="button" role="switch" aria-labelledby="taskbar-position-locked-label" :aria-checked="positionLocked"
          class="taskbar-switch" :class="{ 'is-on': positionLocked }" @click="patchSettings({ taskbarPositionLocked: !positionLocked })">
          <span aria-hidden="true" />
        </button>
      </div>
      <div v-if="positionLocked" class="taskbar-setting-row">
        <div>
          <label for="taskbar-left-offset" class="taskbar-setting-label">距左边缘</label>
        </div>
        <div class="taskbar-position-controls">
          <SettingsNumberControl :model-value="leftOffset" :min="TASKBAR_PLAYER_MIN_LEFT_OFFSET" :max="TASKBAR_PLAYER_MAX_LEFT_OFFSET"
            :step="10" unit="px" :default-value="0" label="距左边缘" @update:model-value="setLeftOffset" />
          <button type="button" class="taskbar-position-action" :disabled="!settings.showTaskbarPlayer || leftOffset === 0" @click="alignLeft">贴左边缘</button>
        </div>
      </div>
    </section>
    <section>
      <h2 class="taskbar-section-title"><span aria-hidden="true" />窗口样式</h2>
      <div class="taskbar-setting-row">
        <div>
          <label class="taskbar-setting-label">背景框形状</label>
          <p class="mt-1 text-xs app-text-secondary">展开面板沿用同一弧度；「胶囊圆形」会同时把封面裁成圆形。</p>
        </div>
        <SettingsSelect class="taskbar-select" label="背景框形状" hide-label trigger-id="taskbar-frame-shape"
          :model-value="frameShape" :options="frameShapeOptions"
          @update:model-value="patchSettings({ taskbarFrameShape: normalizeTaskbarFrameShape($event) })" />
      </div>
      <div class="taskbar-setting-row">
        <div>
          <label for="taskbar-background-mode" class="taskbar-setting-label">背景颜色</label>
          <p class="mt-1 text-xs app-text-secondary">封面虚化背景色跟随封面取色虚化；自定义背景色使用固定底色。</p>
        </div>
        <SettingsSelect class="taskbar-select" label="背景颜色" hide-label trigger-id="taskbar-background-mode"
          :model-value="backgroundMode" :options="backgroundModeOptions"
          @update:model-value="patchSettings({ taskbarBackgroundMode: normalizeTaskbarBackgroundMode($event) })" />
      </div>
      <div v-if="backgroundMode === 'color'" class="taskbar-setting-row">
        <div>
          <label for="taskbar-background-color" class="taskbar-setting-label">背景颜色</label>
        </div>
        <div class="taskbar-color-controls">
          <div class="taskbar-color-presets" role="group" aria-label="背景预设颜色">
            <button v-for="preset in backgroundColors" :key="preset.value" type="button" :aria-label="preset.label" :title="preset.label" :aria-pressed="backgroundColor === preset.value"
              class="taskbar-color-preset"
              :style="{ backgroundColor: preset.value, color: preset.value === '#ffffff' || preset.value === '#fbbf24' ? '#273449' : '#ffffff' }" @click="setBackgroundColor(preset.value)">
              <Check v-if="backgroundColor === preset.value" :size="14" :stroke-width="2.5" />
            </button>
          </div>
          <label for="taskbar-background-color" class="taskbar-custom-color">自定义
            <input id="taskbar-background-color" type="color" aria-label="自定义铃动窗背景颜色" class="taskbar-color-input" :value="backgroundColor" @input="onBackgroundColorInput" @change="onBackgroundColorInput" />
          </label>
          <button type="button" aria-label="恢复默认背景颜色" title="恢复默认" :disabled="backgroundColor === TASKBAR_PLAYER_DEFAULT_BACKGROUND_COLOR" class="p-2 app-text-secondary disabled:opacity-30" @click="setBackgroundColor(TASKBAR_PLAYER_DEFAULT_BACKGROUND_COLOR)"><RotateCcw :size="16" /></button>
        </div>
      </div>
      <div class="taskbar-setting-row">
        <div>
          <label for="taskbar-background-transparency" class="taskbar-setting-label">背景透明度</label>
        </div>
        <div class="taskbar-number-controls">
          <SettingsNumberControl :model-value="transparency" :min="0" :max="100" :step="1" unit="%"
            :default-value="100 - TASKBAR_PLAYER_DEFAULT_BACKGROUND_OPACITY" label="背景透明度"
            @update:model-value="setTransparency" />
        </div>
      </div>
      <div class="taskbar-setting-row">
        <div>
          <label for="taskbar-window-width" class="taskbar-setting-label">窗口长度</label>
        </div>
        <div class="taskbar-number-controls">
          <SettingsNumberControl :model-value="width" :min="TASKBAR_PLAYER_MIN_WIDTH" :max="TASKBAR_PLAYER_MAX_WIDTH"
            :step="10" unit="px" :default-value="TASKBAR_PLAYER_WINDOW_WIDTH" label="窗口长度"
            @update:model-value="setWidth" />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.taskbar-settings { display: flex; flex-direction: column; gap: 24px; }
.taskbar-section-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; }
.taskbar-section-title > span { height: 16px; width: 4px; border-radius: 999px; background: #ec4141; }
.taskbar-setting-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 16px; min-height: 58px; padding: 10px 2px; border-bottom: 1px solid var(--settings-divider); }
.taskbar-setting-row:last-child { border-bottom: 0; }
.taskbar-setting-label { font-size: 14px; font-weight: 500; }
.taskbar-setting-copy { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.taskbar-setting-hint { max-width: 46ch; font-size: 12px; line-height: 1.5; color: var(--app-text-secondary); }
.taskbar-lyric-effect-row { border-bottom: 0; }
.taskbar-lyric-subsettings { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows 200ms ease, opacity 160ms ease; }
.taskbar-lyric-subsettings.is-expanded { grid-template-rows: 1fr; opacity: 1; }
.taskbar-lyric-subsettings-inner { min-height: 0; overflow: hidden; }
.taskbar-lyric-subsettings-panel { margin-left: 16px; padding: 0 14px; border-radius: 10px; background: rgb(128 128 128 / .04); }
.taskbar-lyric-subsettings-panel .taskbar-setting-row { min-height: 54px; padding: 10px 0; }
@media (prefers-reduced-motion: reduce) {
  .taskbar-lyric-subsettings { transition: none; }
}
.taskbar-select { width: 224px; max-width: 100%; flex-shrink: 0; }
.taskbar-select :deep(.settings-select-trigger:not(:hover):not(:focus-visible):not(.is-open)) { background: transparent; border-color: transparent; box-shadow: none; }
.taskbar-switch { width: 44px; height: 24px; padding: 3px; border-radius: 999px; flex-shrink: 0; background: #d1d5db; transition: background-color 160ms; }
.taskbar-switch span { display: block; width: 18px; height: 18px; border-radius: 50%; background: white; box-shadow: 0 1px 3px rgb(0 0 0 / .12); transition: transform 160ms; }
:global(.dark .taskbar-switch) { background: #374151; }
.taskbar-switch.is-on { background: #ec4141; }
.taskbar-switch.is-on span { transform: translateX(20px); }
.taskbar-switch:disabled { opacity: .35; cursor: not-allowed; }
.taskbar-switch:focus-visible, .taskbar-position-action:focus-visible { outline: 2px solid #ec4141; outline-offset: 4px; }
.taskbar-position-controls { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 8px; max-width: 100%; width: min(100%, 432px); margin-left: auto; }
.taskbar-position-controls > :first-child { flex: 1 1 240px; min-width: 0; }
.taskbar-number-controls { width: min(100%, 432px); margin-left: auto; }
.taskbar-position-action { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 34px; padding: 6px 9px; border: 1px solid rgb(128 128 128 / .18); border-radius: 8px; font-size: 12px; color: var(--app-text-secondary); transition: background-color 160ms, color 160ms; }
.taskbar-position-action:hover:not(:disabled) { color: #ec4141; background: rgb(236 65 65 / .06); border-color: rgb(236 65 65 / .2); }
.taskbar-position-action:disabled { opacity: .35; cursor: not-allowed; }
.taskbar-color-controls { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 10px 12px; width: min(100%, 432px); margin-left: auto; }
.taskbar-color-presets { display: flex; align-items: center; gap: 10px; padding: 4px 0; }
.taskbar-color-preset { display: flex; flex-shrink: 0; align-items: center; justify-content: center; width: 24px; height: 24px; border: 1px solid rgb(128 128 128 / .2); border-radius: 50%; transition: transform 160ms; }
.taskbar-color-preset:hover { transform: scale(1.1); }
.taskbar-color-preset:focus-visible, .taskbar-color-follow:focus-visible { outline: 2px solid #ec4141; outline-offset: 4px; }
.taskbar-custom-color { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--app-text-secondary); }
.taskbar-color-follow { min-height: 30px; padding: 4px 8px; border-radius: 6px; font-size: 12px; color: var(--app-text-secondary); transition: color 160ms, background-color 160ms; }
.taskbar-color-follow:hover, .taskbar-color-follow[aria-pressed="true"] { color: #ec4141; background: rgb(236 65 65 / .08); }
.taskbar-color-input { width: 30px; height: 26px; padding: 2px; border: 1px solid rgb(128 128 128 / 25%); border-radius: 6px; background: transparent; cursor: pointer; }
</style>
