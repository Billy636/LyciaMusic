<script setup lang="ts">
import CustomSkinModal from './CustomSkinModal.vue';
import { useSettingsThemeControls } from '../../composables/useSettingsThemeControls';

const TEXT = {
  paletteTitle: '\u914d\u8272\u65b9\u6848',
  darkScheme: '\u6df1\u8272',
  lightScheme: '\u6d45\u8272',
  customEmoji: '\u{1F3A8}',
  customTitle: '\u81ea\u5b9a\u4e49\u76ae\u80a4',
  customHint: '\u4f7f\u7528\u56fe\u7247\u3001\u906e\u7f69\u548c\u524d\u666f\u6837\u5f0f',
  customShort: '\u81ea\u5b9a\u4e49',
  dynamicTitle: '\u52a8\u6001\u80cc\u666f',
  dynamicHint: '\u8ddf\u968f\u5c01\u9762\u53d8\u5316',
  dynamicOff: '\u5173\u95ed',
  dynamicFlow: '\u6d41\u5149',
  dynamicBlur: '\u9759\u6001\u6a21\u7cca',
  dynamicDisabledHint: '\u81ea\u5b9a\u4e49\u76ae\u80a4\u6216\u7a97\u53e3\u6750\u8d28\u542f\u7528\u65f6\uff0c\u52a8\u6001\u80cc\u666f\u4f1a\u81ea\u52a8\u505c\u7528\u3002',
  windowMaterialTitle: '\u7a97\u53e3\u6750\u8d28',
  windowMaterialBlur: '\u6bdb\u73bb\u7483',
  windowMaterialUnsupportedHint: '\u4ec5 Windows 10 / 11 \u652f\u6301\u3002',
  windowMaterialTransparencyHint: '\u9700\u5728\u7cfb\u7edf\u8bbe\u7f6e\u4e2d\u5f00\u542f\u900f\u660e\u6548\u679c\u540e\u624d\u53ef\u7528\u3002',
  windowMaterialConflictHint: '\u5173\u95ed\u52a8\u6001\u80cc\u666f\u6216\u81ea\u5b9a\u4e49\u76ae\u80a4\u540e\u53ef\u7528\u3002',
  windowMaterialWin11Only: '\u4ec5 Windows 11 \u652f\u6301',
};

const FLOW_TEXT = {
  panelTitle: '\u6d41\u5149\u5fae\u8c03',
  colorBoost: '\u8272\u5f69\u5f3a\u5ea6',
  depth: '\u660e\u6697\u6df1\u5ea6',
  speed: '\u6d41\u52a8\u901f\u5ea6',
  texture: '\u7eb9\u7406\u5f3a\u5ea6',
  subtle: '\u67d4\u548c',
  vivid: '\u9c9c\u8273',
  airy: '\u901a\u900f',
  deep: '\u6df1\u9083',
  calm: '\u8212\u7f13',
  brisk: '\u7075\u52a8',
  clean: '\u5e72\u51c0',
  textured: '\u7ec6\u817b',
  toggleLabel: '\u5c55\u5f00\u6216\u6536\u8d77\u6d41\u5149\u5fae\u8c03',
};

const BLUR_TEXT = {
  panelTitle: '\u906e\u7f69\u6d53\u5ea6',
  tint: '\u906e\u7f69\u6d53\u6de1',
  clear: '\u901a\u900f',
  solid: '\u5b9e\u8272',
  toggleLabel: '\u5c55\u5f00\u6216\u6536\u8d77\u6bdb\u73bb\u7483\u5fae\u8c03',
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
  showFlowTuning,
  showBlurTuning,
  setColorScheme,
  setDynamicType,
  toggleWindowMaterial,
  openCustomModal,
  toggleFlowTuning,
  toggleBlurTuning,
  setFlowColorBoost,
  setFlowDepth,
  setFlowSpeed,
  setFlowTexture,
  setWindowBlurTint,
} = useSettingsThemeControls();
</script>

<template>
  <div class="w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        {{ TEXT.paletteTitle }}
      </h2>
      <div class="">
        <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
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

          <button
            type="button"
            class="group flex flex-col items-start gap-2 rounded-xl border px-4 py-3 text-left transition-all"
            :class="colorScheme === 'custom' ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm text-[#EC4141]' : 'border-white/30 hover:border-[#EC4141]/40 hover:bg-white/40 dark:border-white/5 dark:hover:border-white/10 dark:hover:bg-white/10 text-gray-800 dark:text-gray-200'"
            @click="setColorScheme('custom'); openCustomModal()"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 opacity-90 transition-transform group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.47a1 1 0 00.99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.84l.58-3.47a2 2 0 00-1.34-2.23z"></path></svg>
            <span class="text-sm font-semibold">{{ TEXT.customShort }}</span>
          </button>
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
          <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
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

            <div class="relative">
              <button
                type="button"
                class="w-full rounded-xl border px-4 py-3 pr-12 text-left transition-all"
                :class="theme.dynamicBgType === 'flow'
                  ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm'
                  : 'border-gray-200/70 hover:border-[#EC4141]/40 hover:bg-white/40 dark:border-white/10 dark:hover:bg-white/10'"
                @click="setDynamicType('flow')"
              >
                <div class="text-sm font-semibold text-gray-800 dark:text-gray-200">{{ TEXT.dynamicFlow }}</div>
              </button>

              <button
                type="button"
                class="absolute bottom-3 right-3 rounded-full p-1 text-[#EC4141]/70 opacity-40 transition-all duration-300 hover:bg-[#EC4141]/10 hover:opacity-100"
                :class="showFlowTuning && theme.dynamicBgType === 'flow' ? 'bg-[#EC4141]/10 opacity-100' : ''"
                :aria-label="FLOW_TEXT.toggleLabel"
                @click.stop="toggleFlowTuning"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-4 w-4 transition-transform duration-300"
                  :class="showFlowTuning && theme.dynamicBgType === 'flow' ? 'rotate-180' : ''"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>

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
          </div>

          <transition name="flow-panel">
            <div
              v-if="theme.dynamicBgType === 'flow' && showFlowTuning && !isDynamicBgDisabled"
              class="mt-4 rounded-2xl border border-[#EC4141]/15 bg-white/50 p-4 shadow-sm dark:border-white/8 dark:bg-black/25"
            >
              <div class="mb-4 flex items-center justify-between gap-3">
                <div>
                  <div class="text-sm font-semibold text-gray-900 dark:text-gray-100">{{ FLOW_TEXT.panelTitle }}</div>
                  <div class="text-xs text-gray-600 dark:text-white/60">Lycia Flow</div>
                </div>
                <div class="rounded-full bg-[#EC4141]/10 px-2.5 py-1 text-[11px] font-medium text-[#EC4141]">
                  {{ theme.flowColorBoost }} / {{ theme.flowDepth }} / {{ theme.flowSpeed }} / {{ theme.flowTexture }}
                </div>
              </div>

              <div class="space-y-4">
              <label class="block">
                <div class="mb-1.5 flex items-center justify-between gap-4">
                  <div>
                    <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ FLOW_TEXT.colorBoost }}</div>
                  </div>
                  <div class="text-xs font-medium tabular-nums text-[#EC4141]">{{ theme.flowColorBoost }}</div>
                </div>
                <input
                  :value="theme.flowColorBoost"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  class="flow-slider"
                  @input="setFlowColorBoost(Number(($event.target as HTMLInputElement).value))"
                />
                <div class="mt-1 flex items-center justify-between text-[11px] text-gray-500 dark:text-white/50">
                  <span>{{ FLOW_TEXT.subtle }}</span>
                  <span>{{ FLOW_TEXT.vivid }}</span>
                </div>
              </label>

              <label class="block">
                <div class="mb-1.5 flex items-center justify-between gap-4">
                  <div>
                    <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ FLOW_TEXT.depth }}</div>
                  </div>
                  <div class="text-xs font-medium tabular-nums text-[#EC4141]">{{ theme.flowDepth }}</div>
                </div>
                <input
                  :value="theme.flowDepth"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  class="flow-slider"
                  @input="setFlowDepth(Number(($event.target as HTMLInputElement).value))"
                />
                <div class="mt-1 flex items-center justify-between text-[11px] text-gray-500 dark:text-white/50">
                  <span>{{ FLOW_TEXT.airy }}</span>
                  <span>{{ FLOW_TEXT.deep }}</span>
                </div>
              </label>

              <label class="block">
                <div class="mb-1.5 flex items-center justify-between gap-4">
                  <div>
                    <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ FLOW_TEXT.speed }}</div>
                  </div>
                  <div class="text-xs font-medium tabular-nums text-[#EC4141]">{{ theme.flowSpeed }}</div>
                </div>
                <input
                  :value="theme.flowSpeed"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  class="flow-slider"
                  @input="setFlowSpeed(Number(($event.target as HTMLInputElement).value))"
                />
                <div class="mt-1 flex items-center justify-between text-[11px] text-gray-500 dark:text-white/50">
                  <span>{{ FLOW_TEXT.calm }}</span>
                  <span>{{ FLOW_TEXT.brisk }}</span>
                </div>
              </label>

              <label class="block">
                <div class="mb-1.5 flex items-center justify-between gap-4">
                  <div>
                    <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ FLOW_TEXT.texture }}</div>
                  </div>
                  <div class="text-xs font-medium tabular-nums text-[#EC4141]">{{ theme.flowTexture }}</div>
                </div>
                <input
                  :value="theme.flowTexture"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  class="flow-slider"
                  @input="setFlowTexture(Number(($event.target as HTMLInputElement).value))"
                />
                <div class="mt-1 flex items-center justify-between text-[11px] text-gray-500 dark:text-white/50">
                  <span>{{ FLOW_TEXT.clean }}</span>
                  <span>{{ FLOW_TEXT.textured }}</span>
                </div>
              </label>
            </div>
          </div>
        </transition>

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
        <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
          <button
            type="button"
            class="rounded-xl border px-4 py-3 text-left transition-all"
            :class="[
              materialMode === 'acrylic'
                ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm'
                : 'border-gray-200/70 hover:border-[#EC4141]/40 hover:bg-white/40 dark:border-white/10 dark:hover:bg-white/10',
              isWindowMaterialButtonDisabled('acrylic') ? 'cursor-not-allowed opacity-45' : '',
            ]"
            :disabled="isWindowMaterialButtonDisabled('acrylic')"
            :aria-disabled="isWindowMaterialButtonDisabled('acrylic')"
            :title="getWindowMaterialModeDisabledReason('acrylic') === 'windows11' ? TEXT.windowMaterialWin11Only : ''"
            @click="toggleWindowMaterial('acrylic')"
          >
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm font-semibold text-gray-800 dark:text-gray-200">Acrylic</span>
            </div>
          </button>

          <button
            type="button"
            class="rounded-xl border px-4 py-3 text-left transition-all"
            :class="[
              materialMode === 'mica'
                ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm'
                : 'border-gray-200/70 hover:border-[#EC4141]/40 hover:bg-white/40 dark:border-white/10 dark:hover:bg-white/10',
              isWindowMaterialButtonDisabled('mica') ? 'cursor-not-allowed opacity-45' : '',
            ]"
            :disabled="isWindowMaterialButtonDisabled('mica')"
            :aria-disabled="isWindowMaterialButtonDisabled('mica')"
            :title="getWindowMaterialModeDisabledReason('mica') === 'windows11' ? TEXT.windowMaterialWin11Only : ''"
            @click="toggleWindowMaterial('mica')"
          >
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm font-semibold text-gray-800 dark:text-gray-200">Mica</span>
            </div>
          </button>

          <div class="relative">
            <button
              type="button"
              class="w-full rounded-xl border px-4 py-3 pr-12 text-left transition-all"
              :class="[
                materialMode === 'blur'
                  ? 'border-[#EC4141] bg-[#EC4141]/8 shadow-sm'
                  : 'border-gray-200/70 hover:border-[#EC4141]/40 hover:bg-white/40 dark:border-white/10 dark:hover:bg-white/10',
                isWindowMaterialButtonDisabled('blur') ? 'cursor-not-allowed opacity-45' : '',
              ]"
              :disabled="isWindowMaterialButtonDisabled('blur')"
              :aria-disabled="isWindowMaterialButtonDisabled('blur')"
              @click="toggleWindowMaterial('blur')"
            >
              <div class="flex items-center justify-between gap-3">
                <span class="text-sm font-semibold text-gray-800 dark:text-gray-200">{{ TEXT.windowMaterialBlur }}</span>
              </div>
            </button>

            <button
              type="button"
              class="absolute bottom-3 right-3 rounded-full p-1 text-[#EC4141]/70 opacity-40 transition-all duration-300 hover:bg-[#EC4141]/10 hover:opacity-100"
              :class="showBlurTuning && materialMode === 'blur' ? 'bg-[#EC4141]/10 opacity-100' : ''"
              :aria-label="BLUR_TEXT.toggleLabel"
              @click.stop="toggleBlurTuning"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4 transition-transform duration-300"
                :class="showBlurTuning && materialMode === 'blur' ? 'rotate-180' : ''"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>

        <transition name="flow-panel">
          <div
            v-if="materialMode === 'blur' && showBlurTuning"
            class="mt-4 rounded-2xl border border-[#EC4141]/15 bg-white/50 p-4 shadow-sm dark:border-white/8 dark:bg-black/25"
          >
            <div class="mb-4 flex items-center justify-between gap-3">
              <div class="text-sm font-semibold text-gray-900 dark:text-gray-100">{{ BLUR_TEXT.panelTitle }}</div>
              <div class="rounded-full bg-[#EC4141]/10 px-2.5 py-1 text-[11px] font-medium text-[#EC4141]">
                {{ theme.windowBlurTint }}
              </div>
            </div>

            <label class="block">
              <input
                :value="theme.windowBlurTint"
                type="range"
                min="0"
                max="100"
                step="1"
                class="flow-slider"
                @input="setWindowBlurTint(Number(($event.target as HTMLInputElement).value))"
              />
              <div class="mt-1 flex items-center justify-between text-[11px] text-gray-500 dark:text-white/50">
                <span>{{ BLUR_TEXT.clear }}</span>
                <span>{{ BLUR_TEXT.solid }}</span>
              </div>
            </label>
          </div>
        </transition>
      </div>
      <p v-if="windowMaterialDisabledReason === 'windows'" class="text-xs text-amber-600 dark:text-amber-400">
        {{ TEXT.windowMaterialUnsupportedHint }}
      </p>
      <p v-else-if="windowMaterialDisabledReason === 'transparency'" class="text-xs text-amber-600 dark:text-amber-400">
        {{ TEXT.windowMaterialTransparencyHint }}
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

.flow-slider {
  width: 100%;
  height: 6px;
  border-radius: 9999px;
  appearance: none;
  background: linear-gradient(90deg, rgba(236, 65, 65, 0.18), rgba(236, 65, 65, 0.62));
  outline: none;
}

.flow-slider::-webkit-slider-thumb {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.95);
  border-radius: 9999px;
  appearance: none;
  background: #ec4141;
  box-shadow: 0 4px 10px rgba(236, 65, 65, 0.35);
  cursor: pointer;
}

.flow-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.95);
  border-radius: 9999px;
  background: #ec4141;
  box-shadow: 0 4px 10px rgba(236, 65, 65, 0.35);
  cursor: pointer;
}
</style>
