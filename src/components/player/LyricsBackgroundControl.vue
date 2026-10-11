<script setup lang="ts">
import { computed, useId } from 'vue';
import { Check } from 'lucide-vue-next';
import { useThemeSettings } from '../../composables/useThemeSettings';
import {
  normalizePlayerBackgroundSettings,
  type PlayerBackgroundSettings,
} from '../../features/settings/playerBackground';

type BackgroundMode = PlayerBackgroundSettings['playerBackgroundMode'];
type BackgroundPalette = PlayerBackgroundSettings['playerBackgroundPalette'];

const { theme, patchTheme } = useThemeSettings();
const background = computed(() => normalizePlayerBackgroundSettings(theme.value));
const hasPalette = computed(() => background.value.playerBackgroundMode !== 'original');
const hasMotion = computed(() => background.value.playerBackgroundMode === 'soft');
const controlId = useId();
const modeLabelId = `${controlId}-mode`;
const paletteLabelId = `${controlId}-palette`;
const motionLabelId = `${controlId}-motion`;
const modes: readonly { value: BackgroundMode; label: string; description: string }[] = [
  { value: 'original', label: '原背景', description: '沿用当前播放页效果' },
  { value: 'soft', label: '柔光流动', description: '柔和光晕，舒缓流动' },
  { value: 'gradient', label: '静态渐变', description: '安静的双色渐变' },
];
const palettes: readonly { value: BackgroundPalette; label: string; swatch: string }[] = [
  { value: 'indigo', label: '靛蓝', swatch: 'linear-gradient(135deg, #527b87, #505882, #705578)' },
  { value: 'rose', label: '暖霞', swatch: 'linear-gradient(135deg, #ad8964, #965f72, #714b65)' },
  { value: 'teal', label: '青川', swatch: 'linear-gradient(135deg, #578b7c, #457b89, #506486)' },
  { value: 'cover', label: '跟随封面', swatch: 'conic-gradient(#879b7a, #ba986c, #a8798f, #608c9c, #879b7a)' },
];

function setMode(mode: BackgroundMode) {
  if (mode !== background.value.playerBackgroundMode) patchTheme({ playerBackgroundMode: mode });
}

function setPalette(palette: BackgroundPalette) {
  if (palette !== background.value.playerBackgroundPalette) patchTheme({ playerBackgroundPalette: palette });
}

function toggleMotion() {
  patchTheme({ playerBackgroundMotion: !background.value.playerBackgroundMotion });
}
</script>

<template>
  <section class="appearance-background-controls" aria-label="播放页背景设置">
    <div class="appearance-control-group">
      <span :id="modeLabelId" class="appearance-control-label">背景样式</span>
      <div class="appearance-background-modes" role="group" :aria-labelledby="modeLabelId">
        <button
          v-for="mode in modes"
          :key="mode.value"
          type="button"
          class="appearance-background-mode"
          :aria-pressed="background.playerBackgroundMode === mode.value"
          @click="setMode(mode.value)"
        >
          <span class="appearance-background-preview" :data-mode="mode.value" aria-hidden="true">
            <span class="appearance-background-preview-cover"></span>
            <span class="appearance-background-preview-lines"><i></i><i></i><i></i></span>
          </span>
          <span class="appearance-background-mode-copy">
            <span class="appearance-background-mode-label">{{ mode.label }}</span>
            <span class="appearance-background-mode-description">{{ mode.description }}</span>
          </span>
          <span class="appearance-background-check" aria-hidden="true">
            <Check v-if="background.playerBackgroundMode === mode.value" :size="14" />
          </span>
        </button>
      </div>
    </div>

    <Transition name="appearance-background-reveal">
      <div v-if="hasPalette" class="appearance-background-reveal" :inert="!hasPalette" :aria-hidden="!hasPalette">
        <div class="appearance-background-reveal-content">
          <div class="appearance-control-group appearance-control-group--divided">
            <span :id="paletteLabelId" class="appearance-control-label">背景配色</span>
            <div class="appearance-background-palettes" role="group" :aria-labelledby="paletteLabelId">
              <button
                v-for="palette in palettes"
                :key="palette.value"
                type="button"
                class="appearance-background-palette"
                :aria-pressed="background.playerBackgroundPalette === palette.value"
                @click="setPalette(palette.value)"
              >
                <span class="appearance-background-swatch" :style="{ background: palette.swatch }" aria-hidden="true"></span>
                <span>{{ palette.label }}</span>
                <span class="appearance-background-check" aria-hidden="true">
                  <Check v-if="background.playerBackgroundPalette === palette.value" :size="12" />
                </span>
              </button>
            </div>
          </div>
          <Transition name="appearance-background-reveal">
            <div v-if="hasMotion" class="appearance-background-reveal" :inert="!hasMotion" :aria-hidden="!hasMotion">
              <div class="appearance-background-reveal-content">
                <div class="appearance-switch-row appearance-control-group--divided">
                  <span :id="motionLabelId" class="appearance-control-label">慢速流动</span>
                  <button
                    type="button"
                    role="switch"
                    class="appearance-switch"
                    :aria-labelledby="motionLabelId"
                    :aria-checked="background.playerBackgroundMotion"
                    @click="toggleMotion"
                  >
                    <span class="appearance-switch-track" aria-hidden="true"><span></span></span>
                  </button>
                </div>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.appearance-background-controls { display: flex; flex-direction: column; }
.appearance-control-group { display: flex; flex-direction: column; gap: 10px; }
.appearance-control-group--divided { margin-top: 20px; padding-top: 16px; border-top: 1px solid rgb(255 255 255 / 8%); }
.appearance-control-label { color: rgb(255 255 255 / 82%); font-size: 13px; font-weight: 500; }
.appearance-background-modes { display: flex; flex-direction: column; gap: 6px; }
.appearance-background-mode,
.appearance-background-palette { display: flex; min-width: 0; align-items: center; border: 1px solid rgb(255 255 255 / 10%); border-radius: 12px; background: rgb(255 255 255 / 3%); color: rgb(255 255 255 / 55%); text-align: left; transition: color 160ms, background-color 160ms, border-color 160ms; }
.appearance-background-mode { min-height: 62px; gap: 10px; padding: 8px 10px; }
.appearance-background-mode:hover,
.appearance-background-palette:hover { background: rgb(255 255 255 / 7%); color: white; }
.appearance-background-mode[aria-pressed="true"],
.appearance-background-palette[aria-pressed="true"] { border-color: rgb(255 255 255 / 22%); background: rgb(255 255 255 / 13%); color: white; }
.appearance-background-mode-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 4px; }
.appearance-background-mode-label { font-size: 12px; font-weight: 500; }
.appearance-background-mode-description { color: rgb(255 255 255 / 45%); font-size: 10px; line-height: 1.4; }
.appearance-background-check { display: flex; width: 14px; flex-shrink: 0; align-items: center; justify-content: center; color: rgb(255 255 255 / 90%); }
.appearance-background-preview { position: relative; display: block; width: 64px; height: 42px; flex-shrink: 0; overflow: hidden; border: 1px solid rgb(255 255 255 / 10%); border-radius: 7px; background: radial-gradient(ellipse at 15% 20%, #7393a4, transparent 68%), radial-gradient(ellipse at 82% 85%, #655a8b, transparent 75%), #34485f; }
.appearance-background-preview[data-mode="original"] { background: radial-gradient(ellipse at 15% 22%, #9b887b, transparent 70%), radial-gradient(ellipse at 80% 80%, #777378, transparent 70%), #38414d; }
.appearance-background-preview[data-mode="gradient"] { background: linear-gradient(125deg, #5f7991, #414768 55%, #38324d); }
.appearance-background-preview-cover { position: absolute; top: 12px; left: 8px; width: 17px; height: 18px; border-radius: 3px; background: linear-gradient(145deg, #dcd3c4, #a9b8b2); box-shadow: 0 2px 5px rgb(0 0 0 / 15%); }
.appearance-background-preview-lines { position: absolute; top: 14px; left: 33px; right: 7px; display: grid; gap: 4px; }
.appearance-background-preview-lines i { height: 2px; border-radius: 2px; background: rgb(255 255 255 / 40%); }
.appearance-background-preview-lines i:nth-child(2) { background: rgb(255 255 255 / 90%); }
.appearance-background-preview-lines i:last-child { width: 70%; }
.appearance-background-palettes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.appearance-background-palette { min-height: 40px; gap: 7px; padding: 7px 9px; font-size: 11px; }
.appearance-background-palette > span:nth-child(2) { flex: 1; white-space: nowrap; }
.appearance-background-swatch { width: 22px; height: 22px; flex-shrink: 0; border: 1px solid rgb(255 255 255 / 15%); border-radius: 50%; }
.appearance-background-reveal { display: grid; grid-template-rows: 1fr; opacity: 1; }
.appearance-background-reveal-content { min-height: 0; overflow: hidden; }
.appearance-background-reveal-enter-active,
.appearance-background-reveal-leave-active { transition: grid-template-rows 280ms cubic-bezier(.22, 1, .36, 1), opacity 180ms ease, transform 280ms cubic-bezier(.22, 1, .36, 1); }
.appearance-background-reveal-enter-from,
.appearance-background-reveal-leave-to { grid-template-rows: 0fr; opacity: 0; transform: translateY(-6px); }
.appearance-switch-row { display: flex; min-height: 40px; align-items: center; justify-content: space-between; gap: 12px; }
.appearance-switch { display: flex; width: 38px; height: 24px; flex-shrink: 0; align-items: center; justify-content: center; border: 0; border-radius: 20px; background: transparent; }
.appearance-switch-track { display: flex; width: 38px; height: 24px; align-items: center; padding: 3px; border: 1px solid rgb(255 255 255 / 10%); border-radius: 20px; background: rgb(255 255 255 / 10%); transition: border-color 160ms, background-color 160ms; }
.appearance-switch-track > span { width: 16px; height: 16px; flex-shrink: 0; border-radius: 50%; background: white; transition: transform 160ms; }
.appearance-switch[aria-checked="true"] .appearance-switch-track { border-color: rgb(255 255 255 / 25%); background: rgb(255 255 255 / 30%); }
.appearance-switch[aria-checked="true"] .appearance-switch-track > span { transform: translateX(14px); }
.appearance-background-mode:focus-visible,
.appearance-background-palette:focus-visible,
.appearance-switch:focus-visible { outline: 2px solid rgb(255 255 255 / 70%); outline-offset: -2px; }
@media (pointer: coarse) {
  .appearance-background-palette { min-height: 44px; }
  .appearance-switch { width: 44px; height: 44px; }
}
@media (prefers-reduced-motion: reduce) {
  .appearance-background-mode,
  .appearance-background-palette,
  .appearance-switch-track,
  .appearance-switch-track > span,
  .appearance-background-reveal-enter-active,
  .appearance-background-reveal-leave-active { transition: none; }
}
</style>
