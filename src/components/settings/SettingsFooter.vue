<script setup lang="ts">
import { computed, ref } from 'vue';
import { useFooterSettings } from '../../features/settings/useFooterSettings';
import type { FooterBehavior, FooterScene } from '../../types/footer';
import FooterLayoutEditor from './FooterLayoutEditor.vue';
import ModernModal from '../common/ModernModal.vue';
import SettingsSelect from './SettingsSelect.vue';

const { footer, setBehavior, setLinked, resetScene } = useFooterSettings();
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
const infoOptions = [
  { value: 'cover', label: '封面' }, { value: 'song', label: '封面与歌曲' },
  { value: 'time', label: '播放时间' }, { value: 'both', label: '歌曲与时间' }, { value: 'none', label: '不显示' },
];
const progressOptions = [{ value: 'always', label: '始终显示' }, { value: 'hover', label: '悬停时显示' }, { value: 'hidden', label: '隐藏' }];
const autoHideOptions = [{ value: 'false', label: '始终显示' }, { value: 'true', label: '闲置时自动隐藏' }];
const visualizerOptions = [{ value: 'true', label: '开启' }, { value: 'false', label: '关闭' }];
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
  ? '将当前场景的按钮布局和显示设置应用到另一个场景，包括歌曲信息、进度条显示与颜色、底栏自动隐藏。播放页专属的音频频谱保持独立。'
  : `恢复当前场景的原版布局、间距和显示设置。${footer.value.linked ? '通用按钮和显示设置会同步恢复到两个场景。' : ''}不会修改播放状态或音频参数。`);
</script>

<template>
  <div class="footer-settings w-full space-y-6 text-gray-800 dark:text-gray-100">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex rounded-lg bg-black/5 p-1 dark:bg-white/5" aria-label="底栏场景">
        <button v-for="entry in ([['main', '主界面'], ['detail', '播放页']] as const)" :key="entry[0]" type="button" :aria-pressed="scene === entry[0]"
          class="rounded-md px-6 py-2 text-sm transition-colors" :class="scene === entry[0] ? 'bg-white text-[#EC4141] shadow-sm dark:bg-white/10' : 'text-gray-500 dark:text-gray-400'" @click="scene = entry[0]">{{ entry[1] }}</button>
      </div>
      <label class="flex items-center gap-2 text-xs" title="同步按钮布局和显示设置，播放页专属功能除外"><input type="checkbox" class="accent-[#EC4141]" :checked="footer.linked" @change="changeLinked" />两个场景保持一致</label>
    </div>
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full" aria-hidden="true"></span>
        显示设置
      </h2>
      <div class="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <SettingsSelect :key="`info-${scene}`" label="歌曲信息" :model-value="behavior.info" :options="infoOptions" @update:model-value="changeSelection('info', $event)" />
        <SettingsSelect :key="`progress-${scene}`" label="进度条" :model-value="behavior.progress" :options="progressOptions" @update:model-value="changeSelection('progress', $event)" />
        <SettingsSelect :key="`auto-hide-${scene}`" label="底栏显示" :model-value="String(behavior.autoHide)" :options="autoHideOptions" @update:model-value="changeSelection('autoHide', $event)" />
        <SettingsSelect v-if="scene === 'detail'" label="音频频谱" :model-value="String(behavior.visualizer)" :options="visualizerOptions" @update:model-value="changeSelection('visualizer', $event)" />
      </div>
      <div class="flex flex-wrap items-center gap-3 text-[13px]">
        <label class="flex items-center gap-3">
          <span>进度条颜色</span>
          <input type="color" aria-label="进度条颜色" class="progress-color-input"
            :value="behavior.progressColor || '#d4d4d8'" @input="changeBehavior('progressColor', $event)" />
        </label>
        <span class="text-xs text-gray-500 dark:text-gray-400">{{ behavior.progressColor || '默认颜色' }}</span>
        <button type="button" class="text-xs text-[#EC4141] disabled:opacity-40 disabled:cursor-default"
          :disabled="!behavior.progressColor" @click="setBehavior(scene, { progressColor: '' })">恢复默认</button>
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
.progress-color-input { width: 36px; height: 28px; padding: 2px; border: 1px solid rgb(128 128 128 / .25); border-radius: 6px; background: transparent; cursor: pointer; }
</style>
