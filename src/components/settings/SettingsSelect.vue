<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { Check, ChevronDown } from 'lucide-vue-next';

const props = defineProps<{
  label: string;
  modelValue: string;
  options: readonly { value: string; label: string }[];
  hideLabel?: boolean;
  triggerId?: string;
  describedBy?: string;
  menuZIndex?: number;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const id = useId();
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const opened = ref(false);
const activeIndex = ref(0);
const menuStyle = ref<Record<string, string>>({});
const selectedIndex = computed(() => props.options.findIndex(option => option.value === props.modelValue));
const selectedLabel = computed(() => props.options[selectedIndex.value]?.label ?? '请选择');

function close() { opened.value = false; }
function revealActive() {
  void nextTick(() => menu.value?.querySelector<HTMLElement>(`[data-option-index="${activeIndex.value}"]`)
    ?.scrollIntoView({ block: 'nearest' }));
}
function open() {
  if (!trigger.value || !props.options.length) return;
  const rect = trigger.value.getBoundingClientRect();
  const gap = 6, margin = 8;
  const below = Math.max(0, window.innerHeight - rect.bottom - gap - margin);
  const above = Math.max(0, rect.top - gap - margin);
  const desiredHeight = Math.min(288, props.options.length * 38 + 12);
  const downward = below >= desiredHeight || below >= above;
  const height = Math.min(desiredHeight, downward ? below : above);
  const width = Math.min(rect.width, window.innerWidth - margin * 2);
  menuStyle.value = {
    left: `${Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))}px`,
    top: `${downward ? rect.bottom + gap : Math.max(margin, rect.top - gap - height)}px`,
    width: `${width}px`, maxHeight: `${height}px`,
  };
  activeIndex.value = Math.max(0, selectedIndex.value);
  opened.value = true;
  revealActive();
}
function choose(index: number) {
  const option = props.options[index];
  if (!option) return;
  emit('update:modelValue', option.value);
  close();
  trigger.value?.focus({ preventScroll: true });
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Tab') { close(); return; }
  if (event.key === 'Escape') {
    if (opened.value) { event.preventDefault(); event.stopPropagation(); close(); }
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  if (!opened.value) { open(); return; }
  if (event.key === 'Enter' || event.key === ' ') { choose(activeIndex.value); return; }
  const last = props.options.length - 1;
  activeIndex.value = event.key === 'Home' ? 0 : event.key === 'End' ? last
    : Math.max(0, Math.min(last, activeIndex.value + (event.key === 'ArrowDown' ? 1 : -1)));
  revealActive();
}
function outside(event: PointerEvent) {
  const target = event.target as Node;
  if (!trigger.value?.contains(target) && !menu.value?.contains(target)) close();
}
function scroll(event: Event) {
  if (event.target instanceof Node && menu.value?.contains(event.target)) return;
  close();
}
watch(() => props.modelValue, () => { activeIndex.value = Math.max(0, selectedIndex.value); });
onMounted(() => {
  window.addEventListener('pointerdown', outside);
  window.addEventListener('scroll', scroll, true);
  window.addEventListener('resize', close);
  window.addEventListener('blur', close);
});
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', outside);
  window.removeEventListener('scroll', scroll, true);
  window.removeEventListener('resize', close);
  window.removeEventListener('blur', close);
});
</script>

<template>
  <div class="settings-select-field">
    <span :id="`${id}-label`" :class="{ 'sr-only': hideLabel }">{{ label }}</span>
    <button :id="triggerId" ref="trigger" type="button" role="combobox" aria-haspopup="listbox"
      :aria-labelledby="`${id}-label ${id}-value`" :aria-controls="`${id}-listbox`" :aria-expanded="opened"
      :aria-describedby="describedBy"
      :aria-activedescendant="opened ? `${id}-option-${activeIndex}` : undefined"
      class="settings-select-surface settings-select-trigger" :class="{ 'is-open': opened }"
      @click="opened ? close() : open()" @keydown="keydown" @blur="close">
      <span :id="`${id}-value`" class="min-w-0 truncate">{{ selectedLabel }}</span>
      <ChevronDown class="h-4 w-4 shrink-0 opacity-70 transition-transform" :class="{ 'rotate-180': opened }" aria-hidden="true" />
    </button>
    <Teleport to="body">
      <div v-if="opened" :id="`${id}-listbox`" ref="menu" role="listbox" :aria-labelledby="`${id}-label`"
        class="settings-select-surface settings-select-menu custom-scrollbar"
        :style="[menuStyle, { zIndex: menuZIndex }]" @pointerdown.prevent>
        <div v-for="(option, index) in options" :id="`${id}-option-${index}`" :key="option.value"
          role="option" :aria-selected="modelValue === option.value" :data-option-index="index"
          class="settings-select-option" :class="{ 'is-active': activeIndex === index, 'is-selected': modelValue === option.value }"
          @pointermove="activeIndex = index" @click="choose(index)">
          <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
          <Check v-if="modelValue === option.value" class="h-4 w-4 shrink-0" aria-hidden="true" />
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.settings-select-field { display: flex; flex-direction: column; gap: 8px; min-width: 0; font-size: 13px; }
.settings-select-surface {
  --select-border: rgb(148 163 184 / .24);
  --select-trigger-bg: rgb(255 255 255 / .62);
  --select-menu-bg: rgb(255 255 255 / .86);
  --select-hover-bg: rgb(236 65 65 / .08);
  --select-accent: #c83232;
  color: #1f2937;
  border: 1px solid var(--select-border);
  border-radius: 10px;
  backdrop-filter: blur(24px) saturate(140%);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
}
.dark .settings-select-surface {
  --select-border: rgb(255 255 255 / .14);
  --select-trigger-bg: rgb(255 255 255 / .05);
  --select-menu-bg: rgb(24 32 40 / .86);
  --select-hover-bg: rgb(255 255 255 / .09);
  --select-accent: #ff9393;
  color: #f3f4f6;
}
.settings-select-trigger { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 38px; padding: 8px 12px; background: var(--select-trigger-bg); text-align: left; cursor: pointer; transition: border-color 160ms, box-shadow 160ms; }
.settings-select-trigger:hover { border-color: rgb(236 65 65 / .3); }
.settings-select-trigger:focus-visible, .settings-select-trigger.is-open { outline: none; border-color: rgb(236 65 65 / .55); box-shadow: 0 0 0 3px rgb(236 65 65 / .12); }
.settings-select-menu { position: fixed; z-index: 9500; overflow-y: auto; padding: 5px; box-sizing: border-box; background: var(--select-menu-bg); box-shadow: 0 12px 32px rgb(0 0 0 / .18); font-size: 13px; }
.settings-select-option { display: flex; align-items: center; gap: 12px; min-height: 38px; padding: 8px 12px; border-radius: 6px; cursor: pointer; user-select: none; }
.settings-select-option.is-active { background: var(--select-hover-bg); }
.settings-select-option.is-selected { color: var(--select-accent); font-weight: 500; }
</style>
