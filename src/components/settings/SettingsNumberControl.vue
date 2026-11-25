<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Minus, Plus, RotateCcw } from 'lucide-vue-next';

/**
 * 统一的数值控件：减号 + 滑条 + 加号 + 可直接输入的数字 + 恢复默认。
 * min/max/step 均为「显示单位」；factor 用于把真实值换算成显示值
 * （例如 0.5~3 的字号倍率显示为 50%~300%，factor = 100）。
 */
const props = withDefaults(defineProps<{
  modelValue: number;
  min: number;
  max: number;
  step?: number;
  factor?: number;
  unit?: string;
  defaultValue: number;
  label: string;
  precision?: number;
  disabled?: boolean;
}>(), {
  step: 1,
  factor: 1,
  unit: '',
  precision: 2,
  disabled: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: number];
}>();

const displayValue = computed(() => formatDisplay(props.modelValue * props.factor));
const rangeTitle = computed(() => `可输入范围：${props.min} ~ ${props.max}${props.unit}（超出范围无效）`);
const fillPercent = computed(() => {
  const span = props.max - props.min;
  if (span <= 0) return 0;
  return Math.min(100, Math.max(0, ((displayValue.value - props.min) / span) * 100));
});
const isDefault = computed(() => Math.abs(props.modelValue - props.defaultValue) < 0.0001);
const numberDraft = ref(String(displayValue.value));

function formatDisplay(value: number) {
  if (!Number.isFinite(value)) return props.min;
  const rounded = Number(value.toFixed(props.precision));
  return Math.min(props.max, Math.max(props.min, rounded));
}

watch(displayValue, (value) => {
  if (document.activeElement !== numberInput.value) numberDraft.value = String(value);
});

const numberInput = ref<HTMLInputElement | null>(null);

function commitDisplay(value: number) {
  if (!Number.isFinite(value)) return false;
  const real = Number((value / props.factor).toFixed(4));
  emit('update:modelValue', real);
  return true;
}

function stepBy(direction: -1 | 1) {
  const next = Math.min(props.max, Math.max(props.min, displayValue.value + direction * props.step));
  if (commitDisplay(next)) numberDraft.value = String(formatDisplay(next));
}

function onRangeInput(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  commitDisplay(value);
}

/** 越界、空值、非数字一律视为无效输入，回退到当前值。 */
function onNumberChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const raw = input.value.trim();
  const parsed = Number(raw);
  if (raw === '' || !Number.isFinite(parsed) || parsed < props.min || parsed > props.max) {
    numberDraft.value = String(displayValue.value);
    input.value = numberDraft.value;
    return;
  }
  const normalized = formatDisplay(parsed);
  numberDraft.value = String(normalized);
  input.value = numberDraft.value;
  commitDisplay(normalized);
}

function onNumberBlur(event: Event) {
  (event.target as HTMLInputElement).value = String(displayValue.value);
  numberDraft.value = String(displayValue.value);
}

function reset() {
  commitDisplay(props.defaultValue * props.factor);
  numberDraft.value = String(formatDisplay(props.defaultValue * props.factor));
}
</script>

<template>
  <div class="settings-number-control" :class="{ 'is-disabled': disabled }">
    <button type="button" class="snc-adjust" :disabled="disabled || displayValue <= min"
      :aria-label="`减少${label}`" @click="stepBy(-1)"><Minus :size="15" /></button>
    <input class="snc-range" type="range" :min="min" :max="max" :step="step" :value="displayValue"
      :aria-label="label" :title="rangeTitle" :disabled="disabled"
      :style="{ '--fill': `${fillPercent}%` }" @input="onRangeInput" />
    <button type="button" class="snc-adjust" :disabled="disabled || displayValue >= max"
      :aria-label="`增加${label}`" @click="stepBy(1)"><Plus :size="15" /></button>
    <label class="snc-number-wrap">
      <input ref="numberInput" class="snc-number" type="number" :min="min" :max="max" :step="step"
        :value="numberDraft" :title="rangeTitle" :aria-label="`${label}数值（可输入 ${min} 到 ${max}）`"
        :disabled="disabled" @change="onNumberChange" @blur="onNumberBlur" />
      <span v-if="unit" class="snc-unit" aria-hidden="true">{{ unit }}</span>
    </label>
    <button type="button" class="snc-reset" :disabled="disabled || isDefault" :title="`恢复默认：${formatDisplay(defaultValue * factor)}${unit}`"
      :aria-label="`恢复默认${label}`" @click="reset"><RotateCcw :size="15" /></button>
  </div>
</template>

<style scoped>
.settings-number-control {
  display: grid;
  grid-template-columns: 26px minmax(60px, 1fr) 26px auto 26px;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
}
.settings-number-control.is-disabled { opacity: .45; }
.snc-adjust,
.snc-reset {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 28px;
  border-radius: 6px;
  color: var(--app-text-secondary, #6b7280);
  transition: background-color 150ms, color 150ms;
}
.snc-adjust:hover:not(:disabled),
.snc-reset:hover:not(:disabled) { color: #ec4141; background: rgb(236 65 65 / .08); }
.snc-adjust:disabled,
.snc-reset:disabled { opacity: .3; cursor: default; }
.snc-number-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  min-width: 56px;
  padding: 4px 6px;
  border: 1px solid rgb(128 128 128 / .22);
  border-radius: 7px;
  transition: border-color 150ms, box-shadow 150ms;
}
.snc-number-wrap:focus-within { border-color: rgb(236 65 65 / .55); box-shadow: 0 0 0 3px rgb(236 65 65 / .1); }
.snc-number {
  width: 34px;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: inherit;
  text-align: right;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  appearance: textfield;
}
.snc-number::-webkit-inner-spin-button,
.snc-number::-webkit-outer-spin-button { margin: 0; appearance: none; }
.snc-unit { font-size: 11px; color: var(--app-text-secondary, #6b7280); }
.snc-range {
  width: 100%;
  min-width: 0;
  height: 5px;
  appearance: none;
  border-radius: 999px;
  background: linear-gradient(to right, #ec4141 var(--fill), rgb(128 128 128 / 20%) var(--fill));
  cursor: pointer;
}
.snc-range::-webkit-slider-thumb {
  appearance: none;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgb(0 0 0 / 22%);
}
.snc-range::-moz-range-thumb {
  width: 15px;
  height: 15px;
  border: 0;
  border-radius: 50%;
  background: #fff;
}
.snc-range:focus-visible,
.snc-adjust:focus-visible,
.snc-reset:focus-visible { outline: 2px solid #ec4141; outline-offset: 3px; }
@media (max-width: 640px) {
  .settings-number-control { grid-template-columns: 24px minmax(50px, 1fr) 24px auto 24px; gap: 5px; }
}
</style>
