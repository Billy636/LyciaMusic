<script setup lang="ts">
import { computed, ref } from 'vue';
import { useFooterSettings } from '../../features/settings/useFooterSettings';
import type { FooterBehavior, FooterScene } from '../../types/footer';
import FooterLayoutEditor from './FooterLayoutEditor.vue';
import ModernModal from '../common/ModernModal.vue';

const { footer, setBehavior, setLinked, resetScene } = useFooterSettings();
const scene = ref<FooterScene>('main');
const behavior = computed(() => footer.value.behavior[scene.value]);
const pending = ref<'link' | 'reset' | null>(null);
function changeBehavior(key: keyof FooterBehavior, event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  setBehavior(scene.value, { [key]: key === 'autoHide' || key === 'visualizer' ? value === 'true' : value });
}
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
        <label class="setting-field">歌曲信息<select :value="behavior.info" @change="changeBehavior('info', $event)"><option value="cover">封面</option><option value="song">封面与歌曲</option><option value="time">播放时间</option><option value="both">歌曲与时间</option><option value="none">不显示</option></select></label>
        <label class="setting-field">进度条<select :value="behavior.progress" @change="changeBehavior('progress', $event)"><option value="always">始终显示</option><option value="hover">悬停时显示</option><option value="hidden">隐藏</option></select></label>
        <label class="setting-field">底栏显示<select :value="String(behavior.autoHide)" @change="changeBehavior('autoHide', $event)"><option value="false">始终显示</option><option value="true">闲置时自动隐藏</option></select></label>
        <label v-if="scene === 'detail'" class="setting-field">音频频谱<select :value="String(behavior.visualizer)" @change="changeBehavior('visualizer', $event)"><option value="true">开启</option><option value="false">关闭</option></select></label>
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
.footer-settings {
  --footer-field-bg: rgb(255 255 255 / .62);
  --footer-field-hover-bg: rgb(255 255 255 / .82);
  --footer-field-border: rgb(148 163 184 / .24);
  --footer-option-bg: #fff;
  --footer-option-text: #1f2937;
  --footer-field-scheme: light;
}
.dark .footer-settings {
  --footer-field-bg: rgb(255 255 255 / .05);
  --footer-field-hover-bg: rgb(255 255 255 / .09);
  --footer-field-border: rgb(255 255 255 / .12);
  --footer-option-bg: #242428;
  --footer-option-text: #f3f4f6;
  --footer-field-scheme: dark;
}
.footer-settings select {
  min-width: 0;
  width: 100%;
  min-height: 38px;
  border: 1px solid var(--footer-field-border);
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 13px;
  background-color: var(--footer-field-bg);
  color: inherit;
  color-scheme: var(--footer-field-scheme);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  cursor: pointer;
  transition: background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}
.footer-settings select:hover {
  background-color: var(--footer-field-hover-bg);
  border-color: rgb(236 65 65 / .3);
}
.footer-settings select:focus-visible {
  outline: none;
  border-color: rgb(236 65 65 / .55);
  box-shadow: 0 0 0 3px rgb(236 65 65 / .12);
}
/* Native option popups need an opaque surface to remain readable over artwork. */
.footer-settings option {
  background-color: var(--footer-option-bg);
  color: var(--footer-option-text);
}
.setting-field { display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
.progress-color-input { width: 36px; height: 28px; padding: 2px; border: 1px solid rgb(128 128 128 / .25); border-radius: 6px; background: transparent; cursor: pointer; }
</style>
