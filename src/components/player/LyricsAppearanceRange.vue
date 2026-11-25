<script setup lang="ts">
import { RotateCcw } from 'lucide-vue-next';
import { computed, useId } from 'vue';

const props = withDefaults(defineProps<{
  label: string;
  modelValue: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  format?: 'scale' | 'offset' | 'time';
  decreaseLabel?: string;
  increaseLabel?: string;
}>(), {
  format: 'scale',
  decreaseLabel: '−',
  increaseLabel: '+',
});

const emit = defineEmits<{
  'update:modelValue': [value: number];
  commit: [];
}>();

const rangeId = `lyrics-appearance-range-${useId()}`;
const labelId = `${rangeId}-label`;
const valueText = computed(() => {
  const value = Math.round(props.modelValue * (props.format === 'scale' ? 100 : 1));
  const sign = props.format !== 'scale' && value > 0 ? '+' : '';
  return `${sign}${value}${props.format === 'time' ? ' ms' : '%'}`;
});
const progress = computed(() => {
  if (props.max <= props.min) return 0;
  return Math.min(100, Math.max(0, (props.modelValue - props.min) / (props.max - props.min) * 100));
});
const canReset = computed(() => Math.abs(props.modelValue - props.defaultValue) > 1e-10);

function updateValue(value: number) {
  const roundedValue = Number(value.toFixed(10));
  emit('update:modelValue', Math.min(props.max, Math.max(props.min, roundedValue)));
}

function previewValue(event: Event) {
  updateValue(Number((event.currentTarget as HTMLInputElement).value));
}

function adjustValue(direction: -1 | 1) {
  updateValue(props.modelValue + props.step * direction);
  emit('commit');
}

function resetValue() {
  emit('update:modelValue', props.defaultValue);
  emit('commit');
}

function commitValue() {
  emit('commit');
}
</script>

<template>
  <div class="appearance-range">
    <div class="appearance-range-header">
      <label :id="labelId" :for="rangeId" class="appearance-range-label">{{ label }}</label>
      <div class="appearance-range-actions">
        <span class="appearance-range-value">{{ valueText }}</span>
        <button
          v-if="canReset"
          type="button"
          class="appearance-range-button appearance-range-reset"
          :aria-label="`重置${label}`"
          @click="resetValue"
        >
          <RotateCcw :size="13" :stroke-width="1.8" aria-hidden="true" />
        </button>
      </div>
    </div>
    <div class="appearance-range-control">
      <button
        type="button"
        class="appearance-range-button"
        :aria-label="`减小${label}`"
        :disabled="modelValue <= min"
        @click="adjustValue(-1)"
      >
        {{ decreaseLabel }}
      </button>
      <input
        :id="rangeId"
        type="range"
        class="appearance-range-input"
        :min="min"
        :max="max"
        :step="step"
        :value="modelValue"
        :aria-labelledby="labelId"
        :aria-valuetext="valueText"
        :style="{ '--range-progress': `${progress}%` }"
        @input="previewValue"
        @change="commitValue"
        @blur="commitValue"
        @pointercancel="commitValue"
      >
      <button
        type="button"
        class="appearance-range-button"
        :aria-label="`增大${label}`"
        :disabled="modelValue >= max"
        @click="adjustValue(1)"
      >
        {{ increaseLabel }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.appearance-range {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.appearance-range-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 26px;
}

.appearance-range-label {
  min-width: 0;
  color: color-mix(in srgb, currentColor 82%, transparent);
  font-size: 13px;
  font-weight: 500;
}

.appearance-range-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
}

.appearance-range-control {
  display: flex;
  align-items: center;
  gap: 10px;
}

.appearance-range-value {
  min-width: 36px;
  margin-right: 4px;
  color: color-mix(in srgb, currentColor 50%, transparent);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.appearance-range-button {
  display: inline-flex;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid color-mix(in srgb, currentColor 8%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, currentColor 4%, transparent);
  color: color-mix(in srgb, currentColor 60%, transparent);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: color 140ms ease, background-color 140ms ease, border-color 140ms ease;
}

.appearance-range-button:hover:not(:disabled) {
  border-color: color-mix(in srgb, currentColor 18%, transparent);
  background: color-mix(in srgb, currentColor 12%, transparent);
  color: color-mix(in srgb, currentColor 95%, transparent);
}

.appearance-range-button:disabled {
  opacity: 0.32;
  cursor: default;
}

.appearance-range-reset {
  border-color: transparent;
  background: transparent;
  color: color-mix(in srgb, currentColor 45%, transparent);
}

.appearance-range-input {
  appearance: none;
  display: block;
  flex: 1;
  width: 0;
  min-width: 0;
  height: 24px;
  margin: 0;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  touch-action: pan-y;
}

.appearance-range-input::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(to right, color-mix(in srgb, currentColor 80%, transparent) var(--range-progress), color-mix(in srgb, currentColor 18%, transparent) var(--range-progress));
}

.appearance-range-input::-moz-range-track {
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(to right, color-mix(in srgb, currentColor 80%, transparent) var(--range-progress), color-mix(in srgb, currentColor 18%, transparent) var(--range-progress));
}

.appearance-range-input::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  margin-top: -4px;
  border: 0;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}

.appearance-range-input::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border: 0;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}

.appearance-range-button:focus-visible,
.appearance-range-input:focus-visible {
  outline: 2px solid color-mix(in srgb, currentColor 75%, transparent);
  outline-offset: 3px;
}

@media (pointer: coarse) {
  .appearance-range-button {
    width: 40px;
    height: 40px;
  }

  .appearance-range-input {
    height: 40px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .appearance-range-button {
    transition: none;
  }
}
</style>
