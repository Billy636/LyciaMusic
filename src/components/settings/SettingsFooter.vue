<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { Check, RotateCcw } from 'lucide-vue-next';
import { useFooterSettings } from '../../features/settings/useFooterSettings';
import type { FooterBehavior, FooterScene } from '../../types/footer';
import FooterLayoutEditor from './FooterLayoutEditor.vue';
import ModernModal from '../common/ModernModal.vue';
import SettingsSelect from './SettingsSelect.vue';

const { footer, setBehavior, setCoverShape, setLinked, resetScene } = useFooterSettings();
const scene = ref<FooterScene>('main');
const behavior = computed(() => footer.value.behavior[scene.value]);
const pending = ref<'link' | 'reset' | null>(null);
function changeBehavior(key: keyof FooterBehavior, event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  changeSelection(key, value);
}
function changeSelection(key: keyof FooterBehavior, value: string) {
  setBehavior(scene.value, { [key]: key === 'autoHide' || key === 'visualizer' ? value === 'true' : value });
}
const mainInfoOptions = [
  { value: 'cover', label: '封面' }, { value: 'song', label: '封面与歌曲' },
  { value: 'time', label: '播放时间' }, { value: 'both', label: '歌曲与时间' }, { value: 'none', label: '不显示' },
];
const coverShapeOptions = [{ value: 'square', label: '方形' }, { value: 'circle', label: '圆形' }];
const infoOptions = computed(() => scene.value === 'detail'
  ? mainInfoOptions.filter(option => option.value === 'time' || option.value === 'none')
  : mainInfoOptions);
const progressOptions = [{ value: 'always', label: '始终' }, { value: 'hover', label: '悬停' }, { value: 'hidden', label: '隐藏' }] as const;
const progressIndex = computed(() => Math.max(0, progressOptions.findIndex(option => option.value === behavior.value.progress)));
const progressColors = [
  { value: '#ec4141', label: '经典红' }, { value: '#f472b6', label: '柔粉' },
  { value: '#60a5fa', label: '澄蓝' }, { value: '#34d399', label: '青绿' },
  { value: '#fbbf24', label: '暖金' }, { value: '#d4d4d8', label: '浅灰' },
];
const colorPopoverId = useId();
const colorControl = ref<HTMLElement | null>(null);
const colorButton = ref<HTMLButtonElement | null>(null);
const colorPopover = ref<HTMLElement | null>(null);
const showColorPopover = ref(false);
function closeColorPopover(restoreFocus = false) {
  showColorPopover.value = false;
  if (restoreFocus) colorButton.value?.focus({ preventScroll: true });
}
async function toggleColorPopover() {
  showColorPopover.value = !showColorPopover.value;
  if (showColorPopover.value) {
    await nextTick();
    const selected = colorPopover.value?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    const first = colorPopover.value?.querySelector<HTMLButtonElement>('button');
    (selected ?? first)?.focus({ preventScroll: true });
  }
}
function colorOutside(event: PointerEvent) {
  if (!colorControl.value?.contains(event.target as Node)) closeColorPopover();
}
function colorFocusIn(event: FocusEvent) {
  // Only a confirmed new focus target can dismiss the panel. During focusout,
  // activeElement can temporarily be body (including when opening a native
  // color picker); closing then removes the button before its click fires.
  if (event.target === document.body || event.target === document.documentElement) return;
  if (showColorPopover.value && event.target instanceof Node
    && !colorControl.value?.contains(event.target)) closeColorPopover();
}
watch(scene, () => closeColorPopover());
onMounted(() => {
  window.addEventListener('pointerdown', colorOutside);
  window.addEventListener('focusin', colorFocusIn);
});
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', colorOutside);
  window.removeEventListener('focusin', colorFocusIn);
});
function changeLinked(event: Event) {
  (event.target as HTMLInputElement).checked = footer.value.linked;
  if (footer.value.linked) setLinked(false, scene.value); else pending.value = 'link';
}
function confirm() {
  if (pending.value === 'link') setLinked(true, scene.value);
  if (pending.value === 'reset') resetScene(scene.value);
  pending.value = null;
}
const confirmation = computed(() => pending.value === 'link'
  ? '将当前场景的按钮布局、间距、进度条显示与颜色、底栏自动隐藏设置应用到另一个场景。歌曲信息和播放页专属音频频谱始终独立，不会同步。'
  : `恢复当前场景的原版布局、间距和显示设置。${footer.value.linked ? '通用按钮和可同步的显示设置会同时恢复；另一场景的歌曲信息不变。' : ''}不会修改播放状态或音频参数。`);
</script>

<template>
  <div class="footer-settings w-full space-y-6 text-gray-800 dark:text-gray-100">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex rounded-lg bg-black/5 p-1 dark:bg-white/5" aria-label="底栏场景">
        <button v-for="entry in ([['main', '主界面'], ['detail', '播放页']] as const)" :key="entry[0]" type="button" :aria-pressed="scene === entry[0]"
          class="rounded-md px-6 py-2 text-sm transition-colors" :class="scene === entry[0] ? 'bg-white text-[#EC4141] shadow-sm dark:bg-white/10' : 'app-text-secondary'" @click="scene = entry[0]">{{ entry[1] }}</button>
      </div>
      <label class="flex items-center gap-2 text-xs" title="同步按钮布局、间距和进度条等设置；歌曲信息始终按场景独立保存"><input type="checkbox" class="accent-[#EC4141]" :checked="footer.linked" @change="changeLinked" />两个场景保持一致</label>
    </div>
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full" aria-hidden="true"></span>
        显示设置
      </h2>
      <div class="display-rows">
        <div class="display-row">
          <div>
            <label for="footer-song-info" class="display-label">歌曲信息</label>
            <p class="mt-1 text-xs app-text-secondary">{{ scene === 'detail' ? '播放页已展示大封面，底栏仅保留时间或隐藏' : '此项按场景独立保存，不参与同步' }}</p>
          </div>
          <SettingsSelect :key="`info-${scene}`" class="display-info-select" label="歌曲信息" hide-label trigger-id="footer-song-info"
            :model-value="behavior.info" :options="infoOptions" @update:model-value="changeSelection('info', $event)" />
        </div>
        <div class="display-row">
          <span id="footer-progress-label" class="display-label">进度条</span>
          <div class="progress-controls">
            <div class="progress-segments" role="group" aria-labelledby="footer-progress-label">
              <span class="progress-selection" aria-hidden="true" :style="{ transform: `translateX(${progressIndex * 100}%)` }"></span>
              <button v-for="option in progressOptions" :key="option.value" type="button"
                :aria-pressed="behavior.progress === option.value" :class="{ 'is-selected': behavior.progress === option.value }"
                @click="setBehavior(scene, { progress: option.value })">{{ option.label }}</button>
            </div>
            <div ref="colorControl" class="progress-color-control" @keydown.esc.stop.prevent="closeColorPopover(true)">
              <button ref="colorButton" type="button" class="progress-color-trigger" title="进度条颜色"
                aria-label="进度条颜色" aria-haspopup="dialog" :aria-expanded="showColorPopover" :aria-controls="colorPopoverId"
                @click="toggleColorPopover">
                <span :style="{ backgroundColor: behavior.progressColor || '#d4d4d8' }" aria-hidden="true"></span>
              </button>
              <div v-if="showColorPopover" :id="colorPopoverId" ref="colorPopover" class="progress-color-popover" role="dialog" aria-label="进度条颜色">
                <div class="color-popover-heading">进度条颜色</div>
                <div class="color-presets" role="group" aria-label="预设颜色">
                  <button v-for="color in progressColors" :key="color.value" type="button"
                    :title="color.label" :aria-label="color.label" :aria-pressed="behavior.progressColor === color.value"
                    :style="{ backgroundColor: color.value }" @click="setBehavior(scene, { progressColor: color.value })">
                    <Check v-if="behavior.progressColor === color.value" class="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
                <label class="custom-color-row">
                  <span>自定义颜色</span>
                  <input type="color" aria-label="自定义进度条颜色" class="progress-color-input"
                    :value="behavior.progressColor || '#d4d4d8'" @input="changeBehavior('progressColor', $event)" />
                </label>
                <button type="button" class="color-reset" :disabled="!behavior.progressColor" @click="setBehavior(scene, { progressColor: '' })">
                  <RotateCcw class="h-3.5 w-3.5" aria-hidden="true" />恢复默认
                </button>
              </div>
            </div>
          </div>
        </div>
        <div class="display-row">
          <span id="footer-auto-hide-label" class="display-label">闲置时隐藏底栏</span>
          <button type="button" role="switch" aria-labelledby="footer-auto-hide-label" :aria-checked="behavior.autoHide"
            class="display-switch" :class="{ 'is-on': behavior.autoHide }" @click="setBehavior(scene, { autoHide: !behavior.autoHide })">
            <span aria-hidden="true"></span>
          </button>
        </div>
        <div v-if="scene === 'detail'" class="display-row">
          <span id="footer-visualizer-label" class="display-label">音频频谱</span>
          <button type="button" role="switch" aria-labelledby="footer-visualizer-label" :aria-checked="behavior.visualizer"
            class="display-switch" :class="{ 'is-on': behavior.visualizer }" @click="setBehavior(scene, { visualizer: !behavior.visualizer })">
            <span aria-hidden="true"></span>
          </button>
        </div>
      </div>
    </section>
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full" aria-hidden="true"></span>
        封面样式
      </h2>
      <div class="display-rows">
        <div class="display-row">
          <div>
            <label for="footer-cover-shape" class="display-label">封面形状</label>
            <p class="mt-1 text-xs app-text-secondary">圆形封面在播放时缓慢旋转</p>
          </div>
          <SettingsSelect class="display-info-select" label="封面形状" hide-label trigger-id="footer-cover-shape"
            :model-value="footer.coverShape" :options="coverShapeOptions"
            @update:model-value="setCoverShape($event === 'circle' ? 'circle' : 'square')" />
        </div>
      </div>
    </section>
    <section class="space-y-4">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full" aria-hidden="true"></span>
        自定义控件位置
      </h2>
      <FooterLayoutEditor :scene="scene" @reset="pending = 'reset'" />
    </section>
    <ModernModal :visible="pending !== null" :title="pending === 'link' ? '两个场景保持一致' : '恢复原版布局'" :content="confirmation" confirm-text="确认" @confirm="confirm" @cancel="pending = null" />
  </div>
</template>

<style scoped>
.display-rows { --display-muted:var(--app-text-secondary); position:relative; z-index:1; container-type:inline-size; }
.display-row { display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:66px; padding:14px 2px; border-bottom:1px solid var(--settings-divider); }
.display-row:last-child { border-bottom:0; }
.display-label { font-size:13px; font-weight:500; }
.display-info-select { width:224px; max-width:100%; flex-shrink:0; }
.display-info-select :deep(.settings-select-trigger:not(:hover):not(:focus-visible):not(.is-open)) { background:transparent; border-color:transparent; box-shadow:none; }
.progress-controls { display:flex; align-items:center; gap:12px; }
.progress-segments { position:relative; display:grid; grid-template-columns:repeat(3, minmax(56px, 1fr)); align-items:center; padding:3px; border-radius:9px; background:rgb(128 128 128 / .075); isolation:isolate; }
.progress-selection { position:absolute; z-index:0; top:3px; bottom:3px; left:3px; width:calc((100% - 6px) / 3); border-radius:6px; background:rgb(255 255 255 / .85); box-shadow:0 1px 4px rgb(0 0 0 / .07); pointer-events:none; transition:transform 240ms cubic-bezier(.22, 1, .36, 1); }
.dark .progress-selection { background:rgb(255 255 255 / .1); box-shadow:inset 0 1px 0 rgb(255 255 255 / .03); }
.progress-segments button { position:relative; z-index:1; min-width:56px; padding:5px 12px; border-radius:6px; color:var(--display-muted); font-size:12px; transition:color 150ms; }
.progress-segments button:hover { color:#ec4141; }
.progress-segments button.is-selected { color:#d73535; }
.dark .progress-segments button.is-selected { color:#ff8b8b; }
.display-switch { width:44px; height:24px; padding:3px; border-radius:999px; flex-shrink:0; background:#d1d5db; transition:background-color 160ms; }
.display-switch span { display:block; width:18px; height:18px; border-radius:50%; background:white; box-shadow:0 1px 3px rgb(0 0 0 / .12); transition:transform 160ms; }
.dark .display-switch { background:#374151; }
.display-switch.is-on { background:#ec4141; }
.display-switch.is-on span { transform:translateX(20px); }
.progress-color-control { position:relative; flex-shrink:0; }
.progress-color-trigger { display:flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:50%; }
.progress-color-trigger:hover, .progress-color-trigger[aria-expanded="true"] { background:rgb(128 128 128 / .1); }
.progress-color-trigger>span { display:block; width:18px; height:18px; border-radius:50%; border:1px solid rgb(128 128 128 / .25); box-shadow:0 0 0 3px rgb(128 128 128 / .07); }
.progress-color-popover { position:absolute; z-index:150; top:calc(100% + 9px); right:0; width:244px; padding:14px; border:1px solid rgb(148 163 184 / .2); border-radius:12px; background:rgb(255 255 255 / .9); box-shadow:0 12px 36px rgb(0 0 0 / .15); backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); }
.dark .progress-color-popover { border-color:rgb(255 255 255 / .1); background:rgb(24 32 40 / .92); }
.color-popover-heading { margin-bottom:12px; font-size:12px; font-weight:500; }
.color-presets { display:flex; justify-content:space-between; gap:8px; }
.color-presets button { display:flex; align-items:center; justify-content:center; width:26px; height:26px; border:1px solid rgb(0 0 0 / .08); border-radius:50%; color:#111827; }
.color-presets button[aria-pressed="true"] { outline:2px solid rgb(128 128 128 / .45); outline-offset:2px; }
.custom-color-row { display:flex; align-items:center; justify-content:space-between; margin-top:14px; padding-top:12px; border-top:1px solid var(--settings-divider); font-size:12px; }
.color-reset { display:flex; align-items:center; justify-content:center; gap:6px; width:100%; margin-top:10px; padding:6px; border-radius:6px; font-size:12px; color:var(--display-muted); }
.color-reset:hover:not(:disabled) { color:#ec4141; background:rgb(236 65 65 / .06); }
.color-reset:disabled { opacity:.4; cursor:default; }
.display-rows button:focus-visible { outline:2px solid rgb(236 65 65 / .65); outline-offset:3px; }
@container (max-width:420px) { .display-row:has(.progress-controls), .display-row:has(.display-info-select) { flex-wrap:wrap; } .progress-controls, .display-info-select { margin-left:auto; } }
@media(prefers-reduced-motion:reduce) { .progress-selection, .progress-segments button, .display-switch, .display-switch span { transition:none; } }
.progress-color-input { width: 36px; height: 28px; padding: 2px; border: 1px solid rgb(128 128 128 / .25); border-radius: 6px; background: transparent; cursor: pointer; }
</style>
