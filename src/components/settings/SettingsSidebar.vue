<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, ref } from 'vue';
import { GripVertical, House } from 'lucide-vue-next';
import {
  getOrderedSidebarNavigation,
  getSidebarHomepageId,
  getVisibleSidebarNavigation,
  type SidebarNavigationId,
} from '../../features/settings/sidebarNavigation';
import { useSettings } from '../../features/settings/useSettings';
import SidebarNavigationIcon from '../layout/SidebarNavigationIcon.vue';
import SettingsSelect from './SettingsSelect.vue';

const { settings, patchSidebar } = useSettings();
const items = computed(() => getOrderedSidebarNavigation(settings.value.sidebar));
const visibleItems = computed(() => getVisibleSidebarNavigation(settings.value.sidebar));
const homepageId = computed(() => getSidebarHomepageId(settings.value.sidebar));
const homepageOptions = computed<{ value: SidebarNavigationId; label: string }[]>(() =>
  visibleItems.value.length
    ? visibleItems.value.map(item => ({ value: item.id, label: item.label }))
    : [{ value: 'localMusic', label: '本地音乐' }],
);
const list = ref<HTMLOListElement | null>(null);
const announcement = ref('');
const drag = ref<{
  id: SidebarNavigationId;
  pointerId: number;
  startX: number;
  startY: number;
  handle: HTMLButtonElement;
  active: boolean;
  beforeId: SidebarNavigationId | null;
  order: SidebarNavigationId[] | null;
} | null>(null);

function isVisible(item: (typeof items.value)[number]) {
  return item.visibilityKey === 'showPlaylistLibrary'
    ? settings.value.sidebar.showPlaylistLibrary !== false
    : settings.value.sidebar[item.visibilityKey];
}

function toggleItem(item: (typeof items.value)[number]) {
  if (drag.value) return;
  const nextSidebar = { ...settings.value.sidebar, [item.visibilityKey]: !isVisible(item) };
  patchSidebar({
    [item.visibilityKey]: nextSidebar[item.visibilityKey],
    homepageId: getSidebarHomepageId(nextSidebar),
  });
}

function changeHomepage(value: string) {
  const option = homepageOptions.value.find(option => option.value === value);
  if (option) patchSidebar({ homepageId: option.value });
}

function announcePosition(id: SidebarNavigationId) {
  const index = items.value.findIndex(item => item.id === id);
  announcement.value = `${items.value[index].label}已移至第 ${index + 1} 位`;
}

function focusHandle(id: SidebarNavigationId) {
  void nextTick(() => list.value?.querySelector<HTMLButtonElement>(`[data-reorder="${id}"]`)?.focus({ preventScroll: true }));
}

function moveItem(id: SidebarNavigationId, direction: -1 | 1) {
  if (drag.value) return;
  const order = items.value.map(item => item.id);
  const index = order.indexOf(id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;
  order.splice(index, 1);
  order.splice(nextIndex, 0, id);
  settings.value.sidebar.navigationOrder = order;
  announcePosition(id);
  focusHandle(id);
}

function beginDrag(event: PointerEvent, id: SidebarNavigationId) {
  if (event.button !== 0 || drag.value) return;
  const handle = event.currentTarget as HTMLButtonElement;
  handle.focus({ preventScroll: true });
  handle.setPointerCapture(event.pointerId);
  drag.value = {
    id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    handle,
    active: false,
    beforeId: null,
    order: null,
  };
}

function moveDrag(event: PointerEvent) {
  const current = drag.value;
  if (!current || event.pointerId !== current.pointerId) return;
  if (!current.active && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 6) return;
  current.active = true;
  const rows = Array.from(list.value?.querySelectorAll<HTMLElement>('[data-navigation-id]') ?? [])
    .filter(row => row.dataset.navigationId !== current.id);
  const target = rows.find(row => {
    const rect = row.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2;
  });
  const beforeId = target?.dataset.navigationId as SidebarNavigationId | undefined;
  const order = items.value.map(item => item.id).filter(id => id !== current.id);
  order.splice(beforeId ? order.indexOf(beforeId) : order.length, 0, current.id);
  current.beforeId = beforeId ?? null;
  current.order = order.some((id, index) => items.value[index].id !== id) ? order : null;
}

function clearDrag() {
  const current = drag.value;
  drag.value = null;
  if (current?.handle.hasPointerCapture(current.pointerId)) {
    current.handle.releasePointerCapture(current.pointerId);
  }
  return current;
}

function finishDrag(event: PointerEvent) {
  if (event.pointerId !== drag.value?.pointerId) return;
  const current = clearDrag();
  if (!current?.order) return;
  settings.value.sidebar.navigationOrder = current.order;
  announcePosition(current.id);
  focusHandle(current.id);
}

function cancelDrag() {
  clearDrag();
}

onBeforeUnmount(cancelDrag);
onDeactivated(cancelDrag);
</script>

<template>
  <div class="w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        首页
      </h2>
      <div class="p-4 flex items-center justify-between gap-3 rounded-xl hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
        <div class="min-w-0 flex items-center gap-3">
          <span class="w-8 h-8 rounded-full text-[#EC4141] bg-red-100/50 dark:bg-red-500/15 flex items-center justify-center shrink-0">
            <House :size="18" aria-hidden="true" />
          </span>
          <span class="text-sm font-medium text-gray-800 dark:text-gray-200">启动页面</span>
        </div>
        <SettingsSelect class="w-48 max-w-[50%] shrink-0" label="启动页面" hide-label
          :model-value="homepageId" :options="homepageOptions" @update:model-value="changeHomepage" />
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        导航项目
      </h2>
      <ol
        ref="list"
        class="flex flex-col rounded-xl"
        aria-label="侧边栏导航顺序"
        @pointermove="moveDrag"
        @pointerup="finishDrag"
        @pointercancel="cancelDrag"
        @lostpointercapture="cancelDrag"
        @keydown.esc.prevent.stop="cancelDrag"
        @dragstart.prevent
      >
        <li
          v-for="(item, index) in items"
          :key="item.id"
          :data-navigation-id="item.id"
          class="navigation-setting-row relative p-4 flex items-center gap-3 border-b border-[var(--settings-divider)] last:border-0 hover:bg-white/40 dark:hover:bg-white/10 transition-colors rounded-lg"
          :class="{
            'bg-red-100/40 dark:bg-red-500/10 opacity-60': drag?.active && drag.id === item.id,
            'drop-before': drag?.order && drag.beforeId === item.id,
            'drop-after': drag?.order && !drag.beforeId && index === items.length - 1,
          }"
        >
          <button
            type="button"
            :data-reorder="item.id"
            :aria-label="`调整${item.label}顺序，使用上下方向键移动`"
            title="拖动排序，或使用上下方向键"
            class="reorder-handle shrink-0 p-1.5 -ml-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#EC4141]"
            @pointerdown.prevent.stop="beginDrag($event, item.id)"
            @keydown.up.prevent.stop="moveItem(item.id, -1)"
            @keydown.down.prevent.stop="moveItem(item.id, 1)"
            @click.stop
          >
            <GripVertical :size="18" aria-hidden="true" />
          </button>
          <button type="button" class="min-w-0 flex flex-1 items-center gap-3 text-left rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#EC4141]" :aria-label="`${isVisible(item) ? '隐藏' : '显示'}${item.label}`" @click="toggleItem(item)">
            <span class="w-8 h-8 rounded-full bg-gray-100 dark:bg-white/10 flex items-center justify-center shrink-0" :class="isVisible(item) ? 'text-[#EC4141] bg-red-100/50' : 'text-gray-500'">
              <SidebarNavigationIcon :id="item.id" />
            </span>
            <span class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ item.label }}</span>
            <span v-if="homepageId === item.id" class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-[#EC4141] bg-red-100/60 dark:bg-red-500/15">首页</span>
          </button>
          <button
            type="button"
            role="switch"
            :aria-label="`显示${item.label}导航入口`"
            :aria-checked="isVisible(item)"
            class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#EC4141]"
            :class="isVisible(item) ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
            @click.stop="toggleItem(item)"
          >
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="isVisible(item) ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </li>
      </ol>
      <p v-if="!visibleItems.length" class="text-xs app-text-secondary">未开启导航栏目，首页将显示本地音乐。</p>
      <p class="sr-only" role="status" aria-live="polite">{{ announcement }}</p>
    </section>

    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        附加区域
      </h2>
      <div class="p-4 flex items-center justify-between gap-3 rounded-xl hover:bg-white/40 dark:hover:bg-white/10 transition-colors">
        <button type="button" class="flex flex-1 items-center gap-3 text-left rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#EC4141]" :aria-label="`${settings.sidebar.showPlaylists ? '隐藏' : '显示'}歌单快捷列表`" @click="settings.sidebar.showPlaylists = !settings.sidebar.showPlaylists">
          <span class="w-8 h-8 rounded-full bg-gray-100 dark:bg-white/10 flex items-center justify-center shrink-0" :class="settings.sidebar.showPlaylists ? 'text-[#EC4141] bg-red-100/50' : 'text-gray-500'">
            <SidebarNavigationIcon id="playlists" />
          </span>
          <span class="text-sm font-medium text-gray-800 dark:text-gray-200">歌单快捷列表</span>
        </button>
        <button type="button" role="switch" aria-label="显示歌单快捷列表" :aria-checked="settings.sidebar.showPlaylists"
          class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#EC4141]"
          :class="settings.sidebar.showPlaylists ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
          @click="settings.sidebar.showPlaylists = !settings.sidebar.showPlaylists">
          <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.sidebar.showPlaylists ? 'translate-x-6' : 'translate-x-1'" />
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.reorder-handle {
  cursor: grab;
  touch-action: none;
}

.reorder-handle:active {
  cursor: grabbing;
}

.drop-before::before,
.drop-after::after {
  content: '';
  position: absolute;
  left: 0.75rem;
  right: 0.75rem;
  height: 2px;
  border-radius: 1px;
  background: #ec4141;
  pointer-events: none;
}

.drop-before::before {
  top: -1px;
}

.drop-after::after {
  bottom: -1px;
}
</style>
