<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { ChevronDown, Minus, Plus, RotateCcw } from 'lucide-vue-next';
import CustomSkinModal from './CustomSkinModal.vue';
import { useSettingsThemeControls } from '../../composables/useSettingsThemeControls';
import type { WindowMaterialMode } from '../../composables/windowMaterial';

const TEXT = {
  paletteTitle: '\u914d\u8272\u65b9\u6848',
  darkScheme: '\u6df1\u8272',
  lightScheme: '\u6d45\u8272',
  systemScheme: '\u8ddf\u968f\u7cfb\u7edf',
  customEmoji: '\u{1F3A8}',
  customTitle: '\u81ea\u5b9a\u4e49\u76ae\u80a4',
  customHint: '\u4f7f\u7528\u56fe\u7247\u3001\u906e\u7f69\u548c\u524d\u666f\u6837\u5f0f',
  customShort: '\u81ea\u5b9a\u4e49',
  editCustom: '\u4fee\u6539\u81ea\u5b9a\u4e49\u76ae\u80a4',
  dynamicTitle: '\u52a8\u6001\u80cc\u666f',
  dynamicHint: '\u8ddf\u968f\u5c01\u9762\u53d8\u5316',
  dynamicOff: '\u5173\u95ed',
  dynamicFlow: '\u6d41\u5149',
  dynamicFlowGpuBadge: '高GPU',
  dynamicFlowHint: '持续动画会增加 GPU 开销，实际占用取决于窗口大小和设备；低功耗设备可选择静态模糊。',
  dynamicBlur: '\u9759\u6001\u6a21\u7cca',
  dynamicMist: '雾染',
  dynamicDisabledHint: '\u81ea\u5b9a\u4e49\u76ae\u80a4\u6216\u7a97\u53e3\u6750\u8d28\u542f\u7528\u65f6\uff0c\u52a8\u6001\u80cc\u666f\u4f1a\u81ea\u52a8\u505c\u7528\u3002',
  windowMaterialTitle: '\u7a97\u53e3\u6750\u8d28',
  windowMaterialAcrylic: '亚克力',
  windowMaterialMica: '云母',
  windowMaterialBlur: '\u6bdb\u73bb\u7483',
  windowMaterialTransparent: '透明',
  windowMaterialAcrylicHint: '模糊透出窗口背后的内容',
  windowMaterialMicaHint: '取色于桌面壁纸，不透出其他窗口',
  windowMaterialBlurHint: '传统半透明模糊，可调节遮罩浓度',
  windowMaterialTransparentHint: '清晰透出窗口背后的内容，可调节背景不透明度',
  windowMaterialVersionHint: '当前 Windows 版本不支持此材质。',
  windowMaterialBlurVersionHint: '支持 Windows 10 1809 起及 Windows 11 21H2；不支持 Windows 11 22H2 及更新版本。',
  windowMaterialUnsupportedHint: '\u4ec5 Windows 10 / 11 \u652f\u6301\u3002',
  windowMaterialTransparencyHint: '\u9700\u5728\u7cfb\u7edf\u8bbe\u7f6e\u4e2d\u5f00\u542f\u900f\u660e\u6548\u679c\u540e\u624d\u53ef\u7528\u3002',
  windowMaterialTransparencyGroupHint: '亚克力、云母和毛玻璃需要开启系统透明效果；透明模式可直接使用。',
  windowMaterialConflictHint: '\u5173\u95ed\u52a8\u6001\u80cc\u666f\u6216\u81ea\u5b9a\u4e49\u76ae\u80a4\u540e\u53ef\u7528\u3002',
  windowMaterialWin11Only: '\u4ec5 Windows 11 \u652f\u6301',
};

const BLUR_TEXT = {
  panelTitle: '\u906e\u7f69\u6d53\u5ea6',
};

const TRANSPARENT_TEXT = {
  panelTitle: '背景不透明度',
};

const {
  theme,
  showCustomModal,
  colorScheme,
  materialMode,
  isWindowMaterialDisabled,
  isWindowMaterialButtonDisabled,
  getWindowMaterialModeDisabledReason,
  windowMaterialDisabledReason,
  isDynamicBgDisabled,
  showBlurTuning,
  showTransparentTuning,
  setColorScheme,
  setDynamicType,
  toggleWindowMaterial,
  openCustomModal,
  toggleBlurTuning,
  setWindowBlurTint,
  toggleTransparentTuning,
  setWindowTransparentOpacity,
  toggleRetainMaterialOnUnfocus,
} = useSettingsThemeControls();

type SelectableWindowMaterialMode = Exclude<WindowMaterialMode, 'none'>;
const materialOptions: readonly { mode: SelectableWindowMaterialMode; label: string; tunable: boolean }[] = [
  { mode: 'acrylic', label: TEXT.windowMaterialAcrylic, tunable: false },
  { mode: 'mica', label: TEXT.windowMaterialMica, tunable: false },
  { mode: 'blur', label: TEXT.windowMaterialBlur, tunable: true },
  { mode: 'transparent', label: TEXT.windowMaterialTransparent, tunable: true },
];
const materialControlId = useId();
const materialTuningPanelId = `${materialControlId}-tuning`;
const materialTuningSliderId = `${materialControlId}-slider`;
const isMaterialTuningExpanded = (mode: SelectableWindowMaterialMode) => (
  materialMode.value === mode && (mode === 'blur' ? showBlurTuning.value : mode === 'transparent' && showTransparentTuning.value)
);
const showMaterialTuning = computed(() => (
  isMaterialTuningExpanded('blur') || isMaterialTuningExpanded('transparent')
));
const showRetainMaterialOnUnfocus = computed(() => {
  const mode = materialMode.value;
  return (mode === 'acrylic' || mode === 'mica')
    && getWindowMaterialModeDisabledReason(mode) === null;
});
const materialTuningMode = ref<'blur' | 'transparent'>('blur');
watch(
  () => showMaterialTuning.value ? materialMode.value : null,
  (mode) => {
    if (mode === 'blur' || mode === 'transparent') materialTuningMode.value = mode;
  },
  { immediate: true },
);
const materialTuningTitle = computed(() => (
  materialTuningMode.value === 'transparent' ? TRANSPARENT_TEXT.panelTitle : BLUR_TEXT.panelTitle
));
const materialTuningValue = computed(() => (
  materialTuningMode.value === 'transparent' ? theme.value.windowTransparentOpacity : theme.value.windowBlurTint
));
const toggleMaterialTuning = (mode: SelectableWindowMaterialMode) => {
  if (mode === 'blur') toggleBlurTuning();
  else if (mode === 'transparent') toggleTransparentTuning();
};
const setMaterialTuningValue = (value: number) => {
  if (materialMode.value === 'transparent') setWindowTransparentOpacity(value);
  else if (materialMode.value === 'blur') setWindowBlurTint(value);
};

const getWindowMaterialHint = (mode: Exclude<WindowMaterialMode, 'none'>) => {
  const reason = getWindowMaterialModeDisabledReason(mode);
  if (reason === 'windows') return TEXT.windowMaterialUnsupportedHint;
  if (reason === 'windows11') return TEXT.windowMaterialWin11Only;
  if (reason === 'unsupported') {
    return mode === 'blur' ? TEXT.windowMaterialBlurVersionHint : TEXT.windowMaterialVersionHint;
  }
  if (reason === 'transparency') return TEXT.windowMaterialTransparencyHint;
  if (reason === 'theme-conflict') return TEXT.windowMaterialConflictHint;
  return {
    acrylic: TEXT.windowMaterialAcrylicHint,
    mica: TEXT.windowMaterialMicaHint,
    blur: TEXT.windowMaterialBlurHint,
    transparent: TEXT.windowMaterialTransparentHint,
  }[mode];
};
</script>

<template>
  <div class="w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        {{ TEXT.paletteTitle }}
      </h2>
      <div class="">
        <div class="grid grid-cols-1 gap-3 md:grid-cols-4">
          <button
            type="button"
            class="group flex flex-col items-start gap-2 rounded-xl border px-4 py-3 text-left transition-all"
            :class="colorScheme === 'system' ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm text-[#EC4141]' : 'border-white/30 hover:border-[#EC4141]/40 hover:bg-white/40 dark:border-white/5 dark:hover:border-white/10 dark:hover:bg-white/10 text-gray-800 dark:text-gray-200'"
            @click="setColorScheme('system')"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 opacity-90 transition-transform group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"></rect><path d="M8 20h8"></path><path d="M12 16v4"></path></svg>
            <span class="text-sm font-semibold">{{ TEXT.systemScheme }}</span>
          </button>

          <button
            type="button"
            class="group flex flex-col items-start gap-2 rounded-xl border px-4 py-3 text-left transition-all"
            :class="colorScheme === 'dark' ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm text-[#EC4141]' : 'border-white/30 hover:border-[#EC4141]/40 hover:bg-white/40 dark:border-white/5 dark:hover:border-white/10 dark:hover:bg-white/10 text-gray-800 dark:text-gray-200'"
            @click="setColorScheme('dark')"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 opacity-90 transition-transform group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
            <span class="text-sm font-semibold">{{ TEXT.darkScheme }}</span>
          </button>

          <button
            type="button"
            class="group flex flex-col items-start gap-2 rounded-xl border px-4 py-3 text-left transition-all"
            :class="colorScheme === 'light' ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm text-[#EC4141]' : 'border-white/30 hover:border-[#EC4141]/40 hover:bg-white/40 dark:border-white/5 dark:hover:border-white/10 dark:hover:bg-white/10 text-gray-800 dark:text-gray-200'"
            @click="setColorScheme('light')"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 opacity-90 transition-transform group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
            <span class="text-sm font-semibold">{{ TEXT.lightScheme }}</span>
          </button>

          <div class="relative">
            <button
              type="button"
              class="group flex w-full flex-col items-start gap-2 rounded-xl border px-4 py-3 pr-12 text-left transition-all"
              :class="colorScheme === 'custom' ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm text-[#EC4141]' : 'border-white/30 hover:border-[#EC4141]/40 hover:bg-white/40 dark:border-white/5 dark:hover:border-white/10 dark:hover:bg-white/10 text-gray-800 dark:text-gray-200'"
              @click="setColorScheme('custom')"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 opacity-90 transition-transform group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.47a1 1 0 00.99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.84l.58-3.47a2 2 0 00-1.34-2.23z"></path></svg>
              <span class="text-sm font-semibold">{{ TEXT.customShort }}</span>
            </button>

            <button
              type="button"
              class="absolute bottom-3 right-3 rounded-full p-1 text-[#EC4141]/70 opacity-60 transition-all duration-300 hover:bg-[#EC4141]/10 hover:opacity-100 focus-visible:bg-[#EC4141]/10 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EC4141]/40"
              :title="TEXT.editCustom"
              :aria-label="TEXT.editCustom"
              @click.stop="openCustomModal"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        {{ TEXT.dynamicTitle }}
      </h2>
      <div class="space-y-4">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-medium">
          <span
            :class="isDynamicBgDisabled
              ? 'text-gray-500 dark:text-white/45'
              : 'text-gray-800 dark:text-gray-200'"
          >
            {{ TEXT.dynamicHint }}
          </span>
          <span v-if="isDynamicBgDisabled" class="text-amber-600 dark:text-amber-400">
            {{ TEXT.dynamicDisabledHint }}
          </span>
        </div>

        <div :class="isDynamicBgDisabled ? 'pointer-events-none opacity-50' : ''">
          <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <button
              type="button"
              class="rounded-xl border px-4 py-3 text-left transition-all"
              :class="theme.dynamicBgType === 'none'
                ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm'
                : 'border-gray-200/70 hover:border-[#EC4141]/40 hover:bg-white/40 dark:border-white/10 dark:hover:bg-white/10'"
              @click="setDynamicType('none')"
            >
              <div class="text-sm font-semibold text-gray-800 dark:text-gray-200">{{ TEXT.dynamicOff }}</div>
            </button>

            <button
              type="button"
              class="rounded-xl border px-4 py-3 text-left transition-all"
              :class="theme.dynamicBgType === 'flow'
                ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm'
                : 'border-gray-200/70 hover:border-[#EC4141]/40 hover:bg-white/40 dark:border-white/10 dark:hover:bg-white/10'"
              :title="TEXT.dynamicFlowHint"
              @click="setDynamicType('flow')"
            >
              <div class="flex items-center gap-2">
                <span class="text-sm font-semibold text-gray-800 dark:text-gray-200">{{ TEXT.dynamicFlow }}</span>
                <span class="shrink-0 rounded bg-red-100/60 px-1.5 py-0.5 text-[10px] font-medium text-[#EC4141] dark:bg-red-500/15">
                  {{ TEXT.dynamicFlowGpuBadge }}
                </span>
              </div>
            </button>

            <button
              type="button"
              class="rounded-xl border px-4 py-3 text-left transition-all"
              :class="theme.dynamicBgType === 'blur'
                ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm'
                : 'border-gray-200/70 hover:border-[#EC4141]/40 hover:bg-white/40 dark:border-white/10 dark:hover:bg-white/10'"
              @click="setDynamicType('blur')"
            >
              <div class="text-sm font-semibold text-gray-800 dark:text-gray-200">{{ TEXT.dynamicBlur }}</div>
            </button>

            <button
              type="button"
              class="rounded-xl border px-4 py-3 text-left transition-all"
              :class="theme.dynamicBgType === 'mist'
                ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm'
                : 'border-gray-200/70 hover:border-[#EC4141]/40 hover:bg-white/40 dark:border-white/10 dark:hover:bg-white/10'"
              :aria-pressed="theme.dynamicBgType === 'mist'"
              @click="setDynamicType('mist')"
            >
              <div class="text-sm font-semibold text-gray-800 dark:text-gray-200">{{ TEXT.dynamicMist }}</div>
            </button>
          </div>

      </div>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        {{ TEXT.windowMaterialTitle }}
      </h2>
      <div
        class=""
        :class="isWindowMaterialDisabled ? 'opacity-50' : ''"
      >
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div
            v-for="option in materialOptions"
            :key="option.mode"
            class="material-option"
            :class="{
              'is-selected': materialMode === option.mode,
              'is-disabled': isWindowMaterialButtonDisabled(option.mode),
            }"
          >
            <button
              type="button"
              class="material-choice"
              :disabled="isWindowMaterialButtonDisabled(option.mode)"
              :aria-pressed="materialMode === option.mode"
              :title="getWindowMaterialHint(option.mode)"
              @click="toggleWindowMaterial(option.mode)"
            >
              {{ option.label }}
            </button>
            <button
              v-if="option.tunable"
              type="button"
              class="material-tuning-trigger"
              :class="{ 'is-expanded': isMaterialTuningExpanded(option.mode) }"
              :disabled="isWindowMaterialButtonDisabled(option.mode)"
              :aria-label="`${isMaterialTuningExpanded(option.mode) ? '收起' : '展开'}${option.label}调节`"
              :aria-expanded="isMaterialTuningExpanded(option.mode)"
              :aria-controls="materialTuningPanelId"
              :title="isWindowMaterialButtonDisabled(option.mode)
                ? getWindowMaterialHint(option.mode)
                : `${isMaterialTuningExpanded(option.mode) ? '收起' : '展开'}调节`"
              @click="toggleMaterialTuning(option.mode)"
            >
              <ChevronDown :size="16" aria-hidden="true" />
            </button>
          </div>
        </div>

        <transition name="material-expand">
          <div v-show="showMaterialTuning" :id="materialTuningPanelId" class="material-tuning-panel">
            <div class="material-tuning-panel-inner">
              <div class="material-tuning-row">
                <label :for="materialTuningSliderId" class="material-tuning-label text-sm font-medium text-gray-800 dark:text-gray-100">
                  {{ materialTuningTitle }}
                </label>
                <div class="material-slider-controls">
                  <button type="button" class="material-adjust-button app-text-secondary"
                    :aria-label="`降低${materialTuningTitle}`" :disabled="materialTuningValue === 0"
                    @click="setMaterialTuningValue(materialTuningValue - 5)">
                    <Minus :size="16" aria-hidden="true" />
                  </button>
                  <input
                    :id="materialTuningSliderId"
                    :value="materialTuningValue"
                    :aria-valuetext="`${materialTuningValue}%`"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    class="material-slider"
                    :style="{ '--fill': `${materialTuningValue}%` }"
                    @input="setMaterialTuningValue(Number(($event.target as HTMLInputElement).value))"
                  />
                  <button type="button" class="material-adjust-button app-text-secondary"
                    :aria-label="`提高${materialTuningTitle}`" :disabled="materialTuningValue === 100"
                    @click="setMaterialTuningValue(materialTuningValue + 5)">
                    <Plus :size="16" aria-hidden="true" />
                  </button>
                  <output :for="materialTuningSliderId" class="text-right text-sm tabular-nums text-gray-800 dark:text-gray-100">
                    {{ materialTuningValue }}%
                  </output>
                  <button type="button" class="material-adjust-button app-text-secondary"
                    :aria-label="`恢复默认${materialTuningTitle}`" title="恢复默认" :disabled="materialTuningValue === 50"
                    @click="setMaterialTuningValue(50)">
                    <RotateCcw :size="15" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </transition>

        <transition name="flow-panel">
          <div
            v-if="showRetainMaterialOnUnfocus"
            class="mt-4 flex items-center justify-between rounded-xl border border-gray-200/50 bg-white/20 px-4 py-3 shadow-xs dark:border-white/5 dark:bg-white/5"
          >
            <div class="space-y-0.5">
              <div class="text-sm font-semibold text-gray-800 dark:text-gray-200">
                失去焦点时保持材质效果
              </div>
              <div class="text-xs text-gray-500 dark:text-white/45">
                开启后，窗口失去焦点时仍保留亚克力或云母效果
              </div>
            </div>
            <button
              type="button"
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shrink-0"
              :class="theme.retainMaterialOnUnfocus ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
              @click="toggleRetainMaterialOnUnfocus"
            >
              <span
                class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
                :class="theme.retainMaterialOnUnfocus ? 'translate-x-6' : 'translate-x-1'"
              />
            </button>
          </div>
        </transition>
      </div>
      <p v-if="windowMaterialDisabledReason === 'windows'" class="text-xs text-amber-600 dark:text-amber-400">
        {{ TEXT.windowMaterialUnsupportedHint }}
      </p>
      <p v-else-if="windowMaterialDisabledReason === 'transparency'" class="text-xs text-amber-600 dark:text-amber-400">
        {{ TEXT.windowMaterialTransparencyGroupHint }}
      </p>
      <p v-else-if="windowMaterialDisabledReason === 'theme-conflict'" class="text-xs text-amber-600 dark:text-amber-400">
        {{ TEXT.windowMaterialConflictHint }}
      </p>
    </section>

    <CustomSkinModal v-if="showCustomModal" @close="showCustomModal = false" />
  </div>
</template>

<style scoped>
.flow-panel-enter-active,
.flow-panel-leave-active {
  transition: opacity 0.24s ease, transform 0.24s ease;
}

.flow-panel-enter-from,
.flow-panel-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.material-option {
  display: flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
  border: 1px solid rgb(148 163 184 / .22);
  border-radius: 12px;
  color: #1f2937;
  transition: border-color 180ms, background-color 180ms;
}
.dark .material-option {
  border-color: rgb(255 255 255 / .1);
  color: #e5e7eb;
}
.material-option:not(.is-selected):not(.is-disabled):hover {
  border-color: rgb(236 65 65 / .4);
  background: rgb(236 65 65 / .03);
}
.material-option.is-selected {
  border-color: #ec4141;
  background: rgb(236 65 65 / .08);
  color: #ec4141;
}
.material-option.is-disabled { opacity: .45; }
.material-choice {
  flex: 1;
  min-width: 0;
  min-height: 48px;
  padding: 12px 16px;
  border-radius: 11px;
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.material-choice:disabled,
.material-tuning-trigger:disabled { cursor: not-allowed; }
.material-tuning-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 40px;
  height: 36px;
  margin-right: 6px;
  border-left: 1px solid var(--settings-divider);
  border-radius: 0 6px 6px 0;
  color: var(--app-text-secondary);
  cursor: pointer;
  transition: color 180ms, background-color 180ms;
}
.material-tuning-trigger:not(:disabled):hover,
.material-tuning-trigger.is-expanded {
  color: #ec4141;
  background: rgb(236 65 65 / .08);
}
.material-tuning-trigger svg { transition: transform 220ms ease; }
.material-tuning-trigger.is-expanded svg { transform: rotate(180deg); }
.material-choice:focus-visible,
.material-tuning-trigger:focus-visible { box-shadow: inset 0 0 0 2px rgb(236 65 65 / .65); }

.material-tuning-panel { display: grid; grid-template-rows: 1fr; }
.material-tuning-panel-inner { min-height: 0; overflow: hidden; }
.material-expand-enter-active,
.material-expand-leave-active {
  transition: grid-template-rows 220ms ease, opacity 180ms ease;
}
.material-expand-enter-from,
.material-expand-leave-to { grid-template-rows: 0fr; opacity: 0; }
.material-tuning-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px 24px;
  padding: 20px 0;
  border-bottom: 1px solid var(--settings-divider);
}
.material-tuning-label { flex: 1 1 160px; }
.material-slider-controls {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 32px 46px 32px;
  align-items: center;
  gap: 8px;
  width: min(100%, 420px);
  min-width: 0;
}
.material-adjust-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  cursor: pointer;
  transition: color 160ms, background-color 160ms;
}
.material-adjust-button:not(:disabled):hover { color: #ec4141; background: rgb(236 65 65 / .08); }
.material-adjust-button:disabled { cursor: default; opacity: .3; }
.material-adjust-button:focus-visible { box-shadow: inset 0 0 0 2px rgb(236 65 65 / .65); }
.material-slider {
  width: 100%;
  min-width: 0;
  height: 24px;
  appearance: none;
  background: transparent;
  cursor: pointer;
}
.material-slider::-webkit-slider-runnable-track {
  height: 5px;
  border-radius: 999px;
  background: linear-gradient(to right, #ec4141 var(--fill), rgb(128 128 128 / .2) var(--fill));
}
.material-slider::-moz-range-track {
  height: 5px;
  border-radius: 999px;
  background: linear-gradient(to right, #ec4141 var(--fill), rgb(128 128 128 / .2) var(--fill));
}
.material-slider::-webkit-slider-thumb {
  width: 16px;
  height: 16px;
  margin-top: -5.5px;
  border: 0;
  border-radius: 50%;
  appearance: none;
  background: #fff;
  box-shadow: 0 1px 5px rgb(0 0 0 / .2);
}
.material-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border: 0;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 5px rgb(0 0 0 / .2);
}
.material-slider:focus-visible { outline: 2px solid #ec4141; outline-offset: 3px; border-radius: 6px; }
@media (prefers-reduced-motion: reduce) {
  .material-expand-enter-active,
  .material-expand-leave-active,
  .material-tuning-trigger svg { transition: none; }
}
</style>
