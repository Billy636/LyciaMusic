<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { ChevronDown } from 'lucide-vue-next';
import type { MatchFields } from '../../features/playlistImport/types';

const props = defineProps<{ modelValue: MatchFields | null; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: MatchFields | null] }>();
const id = useId();
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const opened = ref(false);
const useDefault = ref(true);
const emptyFields = (): MatchFields => ({ title: false, artist: false, album: false, duration: false });
const draft = ref(emptyFields());
const menuStyle = ref<Record<string, string>>({});
const fields = [
  { key: 'title', label: '歌名' },
  { key: 'artist', label: '歌手' },
  { key: 'album', label: '专辑' },
  { key: 'duration', label: '时长' },
] as const;
const summary = computed(() => props.modelValue
  ? `匹配条件：${fields.filter(field => props.modelValue?.[field.key]).map(field => field.label).join('、')}`
  : '匹配条件：默认');

function close() { opened.value = false; }
function closeAndFocus() {
  close();
  trigger.value?.focus({ preventScroll: true });
}
async function open() {
  if (props.disabled || !trigger.value) return;
  useDefault.value = props.modelValue === null;
  draft.value = props.modelValue ? { ...props.modelValue } : emptyFields();
  const rect = trigger.value.getBoundingClientRect();
  const margin = 8, gap = 6, desiredHeight = 290;
  const below = Math.max(0, window.innerHeight - rect.bottom - gap - margin);
  const above = Math.max(0, rect.top - gap - margin);
  const downward = below >= desiredHeight || below >= above;
  const height = Math.min(desiredHeight, downward ? below : above);
  const width = Math.min(224, window.innerWidth - margin * 2);
  menuStyle.value = {
    left: `${Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin))}px`,
    top: `${downward ? rect.bottom + gap : Math.max(margin, rect.top - gap - height)}px`,
    width: `${width}px`, maxHeight: `${height}px`,
  };
  opened.value = true;
  await nextTick();
  if (!downward && menu.value) {
    menuStyle.value.top = `${Math.max(margin, rect.top - gap - menu.value.getBoundingClientRect().height)}px`;
  }
  menu.value?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
}
function toggleDefault(event: Event) {
  useDefault.value = (event.target as HTMLInputElement).checked;
  if (useDefault.value) draft.value = emptyFields();
}
function toggleField(key: keyof MatchFields, event: Event) {
  draft.value[key] = (event.target as HTMLInputElement).checked;
  if (key === 'title' && !draft.value.title) draft.value = emptyFields();
}
function apply() {
  if (!useDefault.value && !draft.value.title) return;
  emit('update:modelValue', useDefault.value ? null : { ...draft.value });
  closeAndFocus();
}
function keydown(event: KeyboardEvent) {
  event.stopPropagation();
  if (event.key === 'Escape') { event.preventDefault(); closeAndFocus(); }
  if (event.key === 'Tab') {
    const items = Array.from(menu.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []);
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
}
function outside(event: PointerEvent) {
  const target = event.target as Node;
  if (!trigger.value?.contains(target) && !menu.value?.contains(target)) close();
}
function scroll(event: Event) {
  if (event.target instanceof Node && menu.value?.contains(event.target)) return;
  close();
}
watch(() => props.disabled, disabled => { if (disabled) close(); });
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
  <div class="match-settings">
    <button ref="trigger" type="button" class="match-settings-trigger" :class="{ active: modelValue, opened }"
      :title="summary" :aria-label="`自定义匹配，${summary}`" aria-haspopup="dialog" :aria-expanded="opened"
      :aria-controls="`${id}-menu`" :disabled="disabled" @click="opened ? close() : open()">
      自定义匹配<ChevronDown :size="14" :class="{ rotated: opened }" aria-hidden="true" />
    </button>
    <Teleport to="body">
      <div v-if="opened" :id="`${id}-menu`" ref="menu" class="match-settings-menu custom-scrollbar"
        role="dialog" aria-label="自定义匹配条件" :style="menuStyle" @keydown="keydown" @keyup.stop>
        <label class="match-field"><input type="checkbox" :checked="useDefault" @change="toggleDefault" />默认</label>
        <div class="custom-fields">
          <label v-for="field in fields" :key="field.key" class="match-field" :class="{ disabled: useDefault || field.key !== 'title' && !draft.title }"
            :title="field.key === 'duration' ? '允许 2 秒误差' : undefined">
            <input type="checkbox" :checked="draft[field.key]" :disabled="useDefault || field.key !== 'title' && !draft.title"
              @change="toggleField(field.key, $event)" />{{ field.label }}
          </label>
        </div>
        <button type="button" class="apply-fields" :disabled="!useDefault && !draft.title" @click="apply">应用</button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.match-settings { margin-left: auto; flex-shrink: 0; }
.match-settings-trigger { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid #80809025; border-radius: 8px; background: #8080900b; color: inherit; font-size: 12px; white-space: nowrap; cursor: pointer; }
.match-settings-trigger.active { color: #d93737; border-color: #ec414166; background: #ec414114; }
.match-settings-trigger:hover, .match-settings-trigger.opened { border-color: #ec414180; }
.match-settings-trigger svg { transition: transform .16s; } .rotated { transform: rotate(180deg); }
.match-settings-menu { position: fixed; z-index: 10040; box-sizing: border-box; overflow-y: auto; padding: 6px; border: 1px solid #949da43d; border-radius: 10px; background: #fff; color: #282830; box-shadow: 0 12px 32px #0003; font-size: 13px; }
.match-field { display: flex; align-items: center; gap: 10px; min-height: 38px; padding: 0 12px; border-radius: 6px; cursor: pointer; user-select: none; }
.match-field:hover:not(.disabled) { background: #ec414114; }
.match-field input { width: 15px; height: 15px; margin: 0; accent-color: #ec4141; }
.match-field.disabled { opacity: .4; cursor: default; }
.custom-fields { border-top: 1px solid #80809025; margin-top: 4px; padding-top: 4px; }
.apply-fields { display: block; width: calc(100% - 12px); margin: 6px; border-radius: 6px; padding: 7px; background: #ec4141; color: #fff; cursor: pointer; }
.apply-fields:hover { background: #d93737; }
button:disabled { opacity: .45; cursor: default; }
button:focus-visible, input:focus-visible { outline: 2px solid #ec4141; outline-offset: 2px; }
.dark .match-settings-trigger { border-color: #ffffff1a; background: #ffffff07; }
.dark .match-settings-trigger.active { color: #ff9393; border-color: #ec414180; background: #ec414114; }
.dark .match-settings-trigger:hover, .dark .match-settings-trigger.opened { border-color: #ec414180; }
.dark .match-settings-menu { background: #2f2f34; color: #eeeef4; border-color: #ffffff24; }
.dark .match-field:hover:not(.disabled) { background: #ffffff17; }
</style>
