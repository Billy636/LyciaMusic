<script setup lang="ts">
import { GripVertical } from 'lucide-vue-next';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';

import { LYRICS_READING_ORDER_OPTIONS, type LyricsReadingRole } from '../../composables/lyrics/readingOrder';
import { usePlaybackStore } from '../../features/playback/store';
import { useSettingsStore } from '../../features/settings/store';
import { useLyricsReadingOrderControl, type LyricsReadingOrderScope } from './useLyricsReadingOrderControl';

const props = withDefaults(defineProps<{ inline?: boolean }>(), { inline: false });
const emit = defineEmits<{ open: [] }>();
const settingsStore = useSettingsStore();
const playbackStore = usePlaybackStore();
const {
  songPath, hasSong, scope, expanded, selectionToken, hasSongOverride,
  selectedOrder, selectedOption, canReset,
  openOptions, closeOptions, setScope: setReadingOrderScope, selectOrder, reset,
} = useLyricsReadingOrderControl(
  () => settingsStore.settings.lyrics,
  () => playbackStore.currentSong?.path ?? '',
  (patch) => settingsStore.patchSettings({ lyrics: patch }),
);

const controlId = `lyrics-reading-order-${useId()}`;
const headingId = `${controlId}-heading`;
const optionsId = `${controlId}-options`;
const controlRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const optionsRef = ref<HTMLElement | null>(null);
let mounted = false;
const popupStyle = ref<Record<string, string>>({});
const announcement = ref('');
const drag = ref<{
  role: LyricsReadingRole;
  pointerId: number;
  token: number;
  roles: LyricsReadingRole[];
} | null>(null);
const displayedRoles = computed(() => drag.value?.roles ?? selectedOption.value.roles);
const roleLabels: Record<LyricsReadingRole, string> = {
  main: '原文', translation: '翻译', roman: '罗马音',
};
const songLabel = computed(() => playbackStore.currentSong?.title || playbackStore.currentSong?.name || songPath.value);
const scopeLabel = computed(() => scope.value === 'song' ? '当前歌曲' : '默认');
const statusLabel = computed(() => scope.value === 'default'
  ? '用于未单独设置的歌曲'
  : hasSongOverride.value ? '本曲已自定义' : '跟随默认');
const resetSelection = computed(() => {
  const path = songPath.value;
  const targetScope = scope.value;
  return () => {
    reset(path, targetScope);
    if (props.inline && !expanded.value) openOptions();
  };
});

function setScope(value: LyricsReadingOrderScope) {
  setReadingOrderScope(value);
  if (props.inline && !expanded.value) openOptions();
}

async function expandOptions() {
  emit('open');
  openOptions();
  updatePopupPosition();
  const token = selectionToken.value;
  await nextTick();
  if (expanded.value && token === selectionToken.value) {
    updatePopupPosition();
    optionsRef.value?.querySelector<HTMLButtonElement>('.reading-order-drag-item')?.focus({ preventScroll: true });
  }
}

function toggleOptions() {
  if (expanded.value) closeOptions();
  else void expandOptions();
}

function closeFromKeyboard(event: KeyboardEvent) {
  if (event.defaultPrevented || event.key !== 'Escape' || !expanded.value) return;
  event.preventDefault();
  event.stopPropagation();
  closeOptions();
  triggerRef.value?.focus();
}

function syncKeyboardListener() {
  document.removeEventListener('keydown', closeFromKeyboard, true);
  if (mounted && !props.inline) document.addEventListener('keydown', closeFromKeyboard, true);
}

function updatePopupPosition() {
  if (props.inline || !expanded.value || !triggerRef.value) return;
  const trigger = triggerRef.value.getBoundingClientRect();
  const panel = triggerRef.value.closest('.player-side-panel')?.getBoundingClientRect() ?? trigger;
  const topEdge = Math.max(16, panel.top);
  const bottomEdge = Math.min(window.innerHeight - 16, panel.bottom);
  if (trigger.bottom <= topEdge || trigger.top >= bottomEdge) {
    closeOptions();
    return;
  }
  const width = Math.min(280, window.innerWidth - 32);
  const maxHeight = Math.max(0, bottomEdge - topEdge);
  const height = Math.min(optionsRef.value?.offsetHeight || 156, maxHeight);
  // Dock to the drawer's right edge, just like the adjacent font popover.
  const preferredLeft = panel.right;
  const left = preferredLeft + width <= window.innerWidth - 16
    ? preferredLeft : Math.max(16, panel.left - width);
  popupStyle.value = {
    position: 'fixed', left: `${Math.round(left)}px`,
    top: `${Math.round(Math.min(Math.max(trigger.top, topEdge), bottomEdge - height))}px`,
    width: `${width}px`, maxHeight: `${maxHeight}px`,
  };
}

function handleOutsidePointer(event: MouseEvent) {
  if (props.inline) return;
  const target = event.target as Node | null;
  if (!target || controlRef.value?.contains(target) || optionsRef.value?.contains(target)) return;
  closeOptions();
}

function persistRoles(roles: readonly LyricsReadingRole[], token: number) {
  const option = LYRICS_READING_ORDER_OPTIONS.find((item) =>
    item.roles.length === roles.length && item.roles.every((role, index) => role === roles[index]));
  if (option && selectOrder(option.value, token)) announcement.value = `读取顺序：${option.label}`;
}

function startDrag(event: PointerEvent, role: LyricsReadingRole) {
  if (event.button !== 0 || !event.isPrimary || !expanded.value || !optionsRef.value || drag.value) return;
  event.preventDefault();
  (event.currentTarget as HTMLButtonElement).focus({ preventScroll: true });
  drag.value = { role, pointerId: event.pointerId, token: selectionToken.value, roles: [...selectedOption.value.roles] };
  // Capture on the stable popup, not a row that moves while the list reorders.
  optionsRef.value.setPointerCapture(event.pointerId);
}

function moveDrag(event: PointerEvent) {
  const active = drag.value;
  if (!active || event.pointerId !== active.pointerId) return;
  event.preventDefault();
  const rows = Array.from(optionsRef.value?.querySelectorAll<HTMLElement>('[data-reading-role]') ?? []);
  let closestIndex = -1;
  let closestDistance = Number.POSITIVE_INFINITY;
  rows.forEach((row, index) => {
    const rect = row.getBoundingClientRect();
    const distance = Math.abs(event.clientY - rect.top - rect.height / 2);
    if (distance < closestDistance) {
      closestIndex = index;
      closestDistance = distance;
    }
  });
  const currentIndex = active.roles.indexOf(active.role);
  if (closestIndex < 0 || closestIndex === currentIndex) return;
  const roles = [...active.roles];
  roles.splice(currentIndex, 1);
  roles.splice(closestIndex, 0, active.role);
  drag.value = { ...active, roles };
}

function cancelDrag() {
  const active = drag.value;
  drag.value = null;
  if (active && optionsRef.value?.hasPointerCapture(active.pointerId)) {
    optionsRef.value.releasePointerCapture(active.pointerId);
  }
}

function finishDrag(event: PointerEvent) {
  const active = drag.value;
  if (!active || event.pointerId !== active.pointerId) return;
  const rect = optionsRef.value?.getBoundingClientRect();
  const droppedInside = rect && event.clientX >= rect.left && event.clientX <= rect.right
    && event.clientY >= rect.top && event.clientY <= rect.bottom;
  cancelDrag();
  if (droppedInside && active.roles.some((role, index) => role !== selectedOption.value.roles[index])) {
    persistRoles(active.roles, active.token);
  }
}

async function moveRole(role: LyricsReadingRole, direction: -1 | 1) {
  if (!expanded.value || drag.value) return;
  const roles: LyricsReadingRole[] = [...selectedOption.value.roles];
  const index = roles.indexOf(role);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= roles.length) return;
  roles.splice(index, 1);
  roles.splice(target, 0, role);
  const token = selectionToken.value;
  persistRoles(roles, token);
  await nextTick();
  if (expanded.value && token === selectionToken.value) {
    optionsRef.value?.querySelector<HTMLButtonElement>(`[data-reading-role="${role}"] button`)?.focus({ preventScroll: true });
  }
}

watch(expanded, (visible) => { if (!visible) cancelDrag(); }, { flush: 'sync' });
watch(selectedOrder, cancelDrag, { flush: 'sync' });
watch([songPath, scope], () => {
  cancelDrag();
  if (props.inline) openOptions();
}, { flush: 'sync' });
watch(() => props.inline, (inline) => {
  cancelDrag();
  if (inline) openOptions();
  else closeOptions();
  if (mounted) syncKeyboardListener();
}, { immediate: true, flush: 'sync' });

onMounted(() => {
  mounted = true;
  // Capture outside presses even when another panel control stops bubbling.
  window.addEventListener('mousedown', handleOutsidePointer, true);
  // Keyboard-activated buttons emit click without mousedown (e.g. opening fonts).
  window.addEventListener('click', handleOutsidePointer, true);
  window.addEventListener('resize', updatePopupPosition);
  window.addEventListener('scroll', updatePopupPosition, true);
  window.addEventListener('blur', cancelDrag);
  // Dialogs at window capture keep priority; this menu beats the drawer's
  // window-bubble Escape handler regardless of component mounting order.
  syncKeyboardListener();
});

onBeforeUnmount(() => {
  cancelDrag();
  closeOptions();
  mounted = false;
  window.removeEventListener('mousedown', handleOutsidePointer, true);
  window.removeEventListener('click', handleOutsidePointer, true);
  window.removeEventListener('resize', updatePopupPosition);
  window.removeEventListener('scroll', updatePopupPosition, true);
  window.removeEventListener('blur', cancelDrag);
  document.removeEventListener('keydown', closeFromKeyboard, true);
});
</script>

<template>
  <section ref="controlRef" class="reading-order-control" :class="{ 'reading-order-control--inline': inline }" data-shortcut-capture="true" :aria-labelledby="headingId">
    <div class="reading-order-heading">
      <div>
        <div v-if="!inline" class="reading-order-eyebrow">Reading</div>
        <h3 :id="headingId">歌词读取顺序</h3>
      </div>
      <button
        v-if="canReset"
        type="button"
        class="reading-order-reset"
        :aria-label="scope === 'song' ? '清除当前歌曲的读取顺序，跟随默认' : '重置默认歌词读取顺序'"
        @click="resetSelection"
      >
        {{ scope === 'song' ? '跟随默认' : '重置' }}
      </button>
    </div>

    <div class="reading-order-scope" role="group" aria-label="读取顺序作用范围">
      <button
        type="button"
        :aria-pressed="scope === 'default'"
        aria-label="设置未单独指定歌曲的默认读取顺序"
        @click="setScope('default')"
      >默认</button>
      <button
        type="button"
        :disabled="!hasSong"
        :aria-pressed="scope === 'song'"
        aria-label="为当前歌曲设置读取顺序"
        @click="setScope('song')"
      >当前歌曲</button>
    </div>

    <div class="reading-order-status" aria-live="polite">
      <span v-if="scope === 'song'" class="reading-order-song" :title="songLabel">{{ songLabel }}</span>
      <span>{{ statusLabel }}</span>
    </div>

    <button
      v-if="!inline"
      ref="triggerRef"
      type="button"
      class="reading-order-trigger"
      :class="{ 'reading-order-trigger--expanded': expanded }"
      :aria-label="`${scopeLabel}读取顺序：${selectedOption.label}`"
      :aria-expanded="expanded"
      :aria-controls="optionsId"
      @click="toggleOptions"
      @keydown.down.prevent="expandOptions"
      @keydown.esc="closeFromKeyboard"
    >
      <span class="reading-order-sequence" aria-hidden="true">
        <template v-for="(role, index) in displayedRoles" :key="role">
          <span v-if="index > 0" class="reading-order-arrow">→</span>
          <span class="reading-order-role" :class="{ 'reading-order-role--main': role === 'main' }">{{ roleLabels[role] }}</span>
        </template>
      </span>
      <svg class="reading-order-chevron" :class="{ 'reading-order-chevron--expanded': expanded }" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6" /></svg>
    </button>

    <div
      v-if="inline"
      :id="optionsId"
      ref="optionsRef"
      class="reading-order-inline-options"
      role="region"
      :aria-label="`${scopeLabel}的歌词读取顺序`"
      @pointermove="moveDrag"
      @pointerup="finishDrag"
      @pointercancel="cancelDrag"
      @lostpointercapture="cancelDrag"
      @dragstart.prevent
    >
      <ol class="reading-order-sort-list">
        <li v-for="(role, index) in displayedRoles" :key="role" :data-reading-role="role">
          <button
            type="button"
            class="reading-order-drag-item"
            :class="{ 'reading-order-drag-item--dragging': drag?.role === role }"
            :aria-label="`${roleLabels[role]}，第 ${index + 1} 项；可拖动或使用上下箭头调整顺序`"
            aria-keyshortcuts="ArrowUp ArrowDown"
            @pointerdown="startDrag($event, role)"
            @keydown.up.prevent="moveRole(role, -1)"
            @keydown.down.prevent="moveRole(role, 1)"
          >
            <span class="reading-order-position" aria-hidden="true">{{ index + 1 }}</span>
            <span class="reading-order-item-label">{{ roleLabels[role] }}</span>
            <GripVertical :size="16" class="reading-order-grip" aria-hidden="true" />
          </button>
        </li>
      </ol>
    </div>

    <span class="sr-only" aria-live="polite">{{ announcement }}</span>
  </section>

  <template v-if="!inline">
  <Teleport to="body">
    <transition name="reading-order-popover">
      <div
        v-if="expanded"
        :id="optionsId"
        ref="optionsRef"
        class="reading-order-popover"
        :style="popupStyle"
        data-shortcut-capture="true"
        role="region"
        :aria-label="`${scopeLabel}的歌词读取顺序`"
        @click.stop
        @mousedown.stop
        @pointermove="moveDrag"
        @pointerup="finishDrag"
        @pointercancel="cancelDrag"
        @lostpointercapture="cancelDrag"
        @dragstart.prevent
      >
        <ol class="reading-order-sort-list">
          <li v-for="(role, index) in displayedRoles" :key="role" :data-reading-role="role">
            <button
              type="button"
              class="reading-order-drag-item"
              :class="{ 'reading-order-drag-item--dragging': drag?.role === role }"
              :aria-label="`${roleLabels[role]}，第 ${index + 1} 项；可拖动或使用上下箭头调整顺序`"
              aria-keyshortcuts="ArrowUp ArrowDown"
              @pointerdown="startDrag($event, role)"
              @keydown.up.prevent="moveRole(role, -1)"
              @keydown.down.prevent="moveRole(role, 1)"
            >
              <span class="reading-order-position" aria-hidden="true">{{ index + 1 }}</span>
              <span class="reading-order-item-label">{{ roleLabels[role] }}</span>
              <GripVertical :size="16" class="reading-order-grip" aria-hidden="true" />
            </button>
          </li>
        </ol>
      </div>
    </transition>
  </Teleport>
  </template>
</template>

<style scoped>
.reading-order-control { margin-top: 24px; }
.reading-order-control--inline { margin-top: 0; }
.reading-order-control--inline .reading-order-heading h3 { margin-top: 0; }
.reading-order-inline-options { margin-top: 12px; }
.reading-order-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
.reading-order-eyebrow { color: rgb(255 255 255 / 30%); font-size: 9px; font-weight: 600; letter-spacing: .3em; text-transform: uppercase; }
.reading-order-heading h3 { margin: 6px 0 0; color: rgb(255 255 255 / 85%); font-size: 13px; font-weight: 500; }
.reading-order-reset { flex-shrink: 0; padding: 4px 6px; border-radius: 8px; color: rgb(255 255 255 / 55%); font-size: 11px; }
.reading-order-reset:hover { background: rgb(255 255 255 / 7%); color: white; }
.reading-order-scope { display: flex; gap: 3px; padding: 3px; border: 1px solid rgb(255 255 255 / 10%); border-radius: 12px; background: rgb(255 255 255 / 3%); }
.reading-order-scope button { flex: 1; min-width: 0; min-height: 28px; border-radius: 8px; color: rgb(255 255 255 / 50%); font-size: 11px; font-weight: 500; transition: background-color 160ms, color 160ms; }
.reading-order-scope button[aria-pressed="true"] { background: rgb(255 255 255 / 12%); color: white; }
.reading-order-scope button:disabled { cursor: not-allowed; opacity: .3; }
.reading-order-status { display: flex; justify-content: space-between; gap: 8px; margin: 8px 2px; color: rgb(255 255 255 / 43%); font-size: 10px; line-height: 1.5; }
.reading-order-status > span:last-child { flex-shrink: 0; }
.reading-order-song { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reading-order-trigger { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; min-height: 44px; padding: 10px; border: 1px solid rgb(255 255 255 / 10%); border-radius: 14px; background: rgb(255 255 255 / 3%); text-align: left; transition: background-color 160ms, border-color 160ms; }
.reading-order-trigger:hover, .reading-order-trigger--expanded { border-color: rgb(255 255 255 / 22%); background: rgb(255 255 255 / 7%); }
.reading-order-sequence { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.reading-order-role { padding: 3px 5px; border-radius: 6px; background: rgb(255 255 255 / 6%); color: rgb(255 255 255 / 65%); font-size: 11px; line-height: 1.3; }
.reading-order-role--main { color: rgb(255 255 255 / 90%); }
.reading-order-arrow { color: rgb(255 255 255 / 30%); font-size: 11px; }
.reading-order-chevron { flex-shrink: 0; color: rgb(255 255 255 / 45%); transition: transform 160ms; }
.reading-order-chevron--expanded { transform: rotate(180deg); }
.reading-order-popover { z-index: 120; overflow: auto; padding: 8px; border: 1px solid rgb(255 255 255 / 10%); border-radius: 24px; background: rgb(0 0 0 / 30%); color: white; box-shadow: 0 28px 70px rgb(0 0 0 / 36%); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); overscroll-behavior: contain; }
.reading-order-sort-list { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
.reading-order-drag-item { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid transparent; border-radius: 16px; background: rgb(255 255 255 / 3%); color: rgb(255 255 255 / 80%); text-align: left; cursor: grab; touch-action: none; user-select: none; transition: background-color 160ms, border-color 160ms; }
.reading-order-drag-item:hover { background: rgb(255 255 255 / 7%); }
.reading-order-drag-item--dragging { border-color: rgb(255 255 255 / 25%); background: rgb(255 255 255 / 14%); color: white; cursor: grabbing; }
.reading-order-position { flex-shrink: 0; color: rgb(255 255 255 / 35%); font-size: 11px; font-variant-numeric: tabular-nums; }
.reading-order-item-label { flex: 1; font-size: 13px; font-weight: 500; }
.reading-order-grip { flex-shrink: 0; color: rgb(255 255 255 / 40%); }
.reading-order-drag-item:focus-visible, .reading-order-trigger:focus-visible, .reading-order-scope button:focus-visible, .reading-order-reset:focus-visible { box-shadow: 0 0 0 2px rgb(255 255 255 / 65%); }
.reading-order-popover-enter-active, .reading-order-popover-leave-active { transition: opacity 160ms ease, transform 160ms ease; }
.reading-order-popover-enter-from, .reading-order-popover-leave-to { opacity: 0; transform: translateX(-8px); }
@media (prefers-reduced-motion: reduce) { .reading-order-popover-enter-active, .reading-order-popover-leave-active { transition: none; } }
</style>
