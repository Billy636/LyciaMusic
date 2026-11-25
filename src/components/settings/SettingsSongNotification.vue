<script setup lang="ts">
import { Check, RotateCcw } from 'lucide-vue-next';
import { computed } from 'vue';
import { useSettings } from '../../features/settings/useSettings';
import SettingsSelect from './SettingsSelect.vue';
import {
  SONG_NOTIFICATION_DEFAULT_BACKGROUND_COLOR,
  normalizeSongNotificationBackgroundColor,
  normalizeSongNotificationBackgroundMode,
  normalizeSongNotificationFrameShape,
  normalizeSongNotificationModules,
  type SongNotificationModule,
} from '../../features/songNotification/shared';

const { settings, patchSettings } = useSettings();

const frameShape = computed(() => normalizeSongNotificationFrameShape(settings.value.songNotificationFrameShape));
const frameShapeOptions = [
  { value: 'rounded', label: '圆角矩形' },
  { value: 'pill', label: '胶囊圆形' },
  { value: 'square', label: '方形' },
];
const backgroundMode = computed(() => normalizeSongNotificationBackgroundMode(settings.value.songNotificationBackgroundMode));
const backgroundModeOptions = [
  { value: 'live', label: '封面虚化背景色' },
  { value: 'color', label: '自定义背景色' },
];
const backgroundColor = computed(() => normalizeSongNotificationBackgroundColor(settings.value.songNotificationBackgroundColor));
const backgroundColors = [
  { value: '#ffffff', label: '白色' }, { value: '#273449', label: '墨色' },
  { value: '#ec4141', label: '经典红' }, { value: '#60a5fa', label: '澄蓝' },
  { value: '#34d399', label: '青绿' }, { value: '#fbbf24', label: '暖金' },
];

const modules = computed(() => normalizeSongNotificationModules(settings.value.songNotificationModules));
const moduleOptions: readonly { key: SongNotificationModule; title: string; hint: string }[] = [
  { key: 'main', title: '主窗口播放底栏', hint: '播放器底部的上一首 / 下一首按钮' },
  { key: 'taskbar', title: '铃动窗', hint: '桌面底栏铃动窗的切歌按钮' },
  { key: 'desktopLyrics', title: '桌面歌词', hint: '桌面歌词悬浮工具条的切歌按钮' },
  { key: 'tray', title: '托盘菜单', hint: '系统托盘菜单中的切歌按钮' },
];

function toggleModule(key: SongNotificationModule) {
  const current = normalizeSongNotificationModules(settings.value.songNotificationModules);
  patchSettings({ songNotificationModules: { ...current, [key]: !current[key] } });
}
function setBackgroundColor(value: string) {
  patchSettings({ songNotificationBackgroundColor: normalizeSongNotificationBackgroundColor(value) });
}
function onColorInput(event: Event) {
  setBackgroundColor((event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="song-card-settings text-gray-800 dark:text-gray-100">
    <section>
      <h2 class="song-card-section-title"><span aria-hidden="true" />外观</h2>
      <div class="song-card-row">
        <label for="song-card-frame-shape" class="song-card-label">背景框形状</label>
        <SettingsSelect class="song-card-select" label="背景框形状" hide-label trigger-id="song-card-frame-shape"
          :model-value="frameShape" :options="frameShapeOptions"
          @update:model-value="patchSettings({ songNotificationFrameShape: normalizeSongNotificationFrameShape($event) })" />
      </div>
      <div class="song-card-row">
        <label for="song-card-background-mode" class="song-card-label">背景颜色</label>
        <SettingsSelect class="song-card-select" label="背景颜色" hide-label trigger-id="song-card-background-mode"
          :model-value="backgroundMode" :options="backgroundModeOptions"
          @update:model-value="patchSettings({ songNotificationBackgroundMode: normalizeSongNotificationBackgroundMode($event) })" />
      </div>
      <div v-if="backgroundMode === 'color'" class="song-card-row">
        <span class="song-card-label">自定义背景色</span>
        <div class="song-card-colors" role="group" aria-label="切歌提示预设背景颜色">
          <button v-for="preset in backgroundColors" :key="preset.value" type="button"
            :aria-label="preset.label" :title="preset.label" :aria-pressed="backgroundColor === preset.value"
            class="song-card-color"
            :style="{ backgroundColor: preset.value, color: ['#ffffff', '#fbbf24'].includes(preset.value) ? '#273449' : '#ffffff' }"
            @click="setBackgroundColor(preset.value)">
            <Check v-if="backgroundColor === preset.value" :size="12" :stroke-width="2.5" />
          </button>
          <label class="song-card-custom-color">自定义
            <input type="color" aria-label="自定义切歌提示背景颜色" :value="backgroundColor" @input="onColorInput" />
          </label>
          <button type="button" aria-label="恢复默认背景色" title="恢复默认" :disabled="backgroundColor === SONG_NOTIFICATION_DEFAULT_BACKGROUND_COLOR"
            class="song-card-reset" @click="setBackgroundColor(SONG_NOTIFICATION_DEFAULT_BACKGROUND_COLOR)"><RotateCcw :size="14" /></button>
        </div>
      </div>
    </section>
    <section>
      <h2 class="song-card-section-title"><span aria-hidden="true" />接入模块</h2>
      <div v-for="option in moduleOptions" :key="option.key" class="song-card-row">
        <div class="song-card-copy">
          <span :id="`song-card-module-${option.key}`" class="song-card-label">{{ option.title }}</span>
          <p class="song-card-hint">{{ option.hint }}</p>
        </div>
        <button type="button" role="switch" :aria-labelledby="`song-card-module-${option.key}`"
          :aria-checked="modules[option.key]" class="song-card-switch" :class="{ 'is-on': modules[option.key] }"
          @click="toggleModule(option.key)">
          <span aria-hidden="true" />
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.song-card-settings { display: flex; flex-direction: column; gap: 24px; }
.song-card-section-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; }
.song-card-section-title > span { height: 16px; width: 4px; border-radius: 999px; background: #ec4141; }
.song-card-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 16px; min-height: 58px; padding: 10px 2px; border-bottom: 1px solid var(--settings-divider); }
.song-card-row:last-child { border-bottom: 0; }
.song-card-label { font-size: 14px; font-weight: 500; }
.song-card-copy { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.song-card-hint { max-width: 46ch; font-size: 12px; line-height: 1.5; color: var(--app-text-secondary); }
.song-card-select { width: 224px; max-width: 100%; flex-shrink: 0; }
.song-card-select :deep(.settings-select-trigger:not(:hover):not(:focus-visible):not(.is-open)) { background: transparent; border-color: transparent; box-shadow: none; }
.song-card-switch { width: 44px; height: 24px; padding: 3px; border-radius: 999px; flex-shrink: 0; background: #d1d5db; transition: background-color 160ms; }
.song-card-switch span { display: block; width: 18px; height: 18px; border-radius: 50%; background: white; box-shadow: 0 1px 3px rgb(0 0 0 / .12); transition: transform 160ms; }
:global(.dark .song-card-switch) { background: #374151; }
.song-card-switch.is-on { background: #ec4141; }
.song-card-switch.is-on span { transform: translateX(20px); }
.song-card-switch:focus-visible { outline: 2px solid #ec4141; outline-offset: 4px; }
.song-card-colors { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 10px 12px; }
.song-card-color { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: 1px solid rgb(128 128 128 / .2); border-radius: 50%; flex-shrink: 0; }
.song-card-color[aria-pressed='true'] { box-shadow: 0 0 0 2px #ec4141 inset; }
.song-card-custom-color { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--app-text-secondary); cursor: pointer; }
.song-card-custom-color input { width: 24px; height: 24px; padding: 0; border: 0; background: transparent; cursor: pointer; }
.song-card-reset { display: inline-flex; align-items: center; justify-content: center; padding: 4px; color: var(--app-text-secondary); }
.song-card-reset:disabled { opacity: .3; cursor: default; }
</style>
