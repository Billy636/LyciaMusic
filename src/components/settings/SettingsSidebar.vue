<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { GripVertical, House } from 'lucide-vue-next';
import {
  getOrderedSidebarNavigation,
  getSidebarHomepageId,
  getVisibleSidebarNavigation,
  type SidebarNavigationId,
} from '../../features/settings/sidebarNavigation';
import { useSettings } from '../../features/settings/useSettings';
import { useSidebarNavigationReorder } from '../../features/settings/useSidebarNavigationReorder';
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
const { drag, placeholderStyle, getRowStyle, beginDrag, cancelDrag, handleLostPointerCapture } = useSidebarNavigationReorder(
  list,
  () => items.value.map(item => item.id),
  (order, id) => {
    settings.value.sidebar.navigationOrder = order;
    announcePosition(id);
    focusHandle(id);
  },
);

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
  if (drag.value) return;
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
        class="navigation-list relative flex flex-col rounded-xl"
        :class="{ 'is-reordering': drag?.active }"
        aria-label="侧边栏导航顺序"
        @keydown.esc.prevent.stop="cancelDrag"
        @dragstart.prevent
      >
        <li v-if="placeholderStyle" class="navigation-drop-slot" :style="placeholderStyle" aria-hidden="true"></li>
        <li
          v-for="item in items"
          :key="item.id"
          :data-navigation-id="item.id"
          class="navigation-setting-row relative p-4 flex items-center gap-3 border-b border-[var(--settings-divider)] hover:bg-white/40 dark:hover:bg-white/10 rounded-lg"
          :class="{
            'is-dragged': drag?.active && drag.id === item.id,
            'is-shifting': drag?.active && drag.id !== item.id,
          }"
          :style="getRowStyle(item.id)"
        >
          <button
            type="button"
            :data-reorder="item.id"
            :aria-label="`调整${item.label}顺序，使用上下方向键移动`"
            title="拖动排序，或使用上下方向键"
            class="reorder-handle shrink-0 p-1.5 -ml-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#EC4141]"
            @pointerdown.prevent.stop="beginDrag($event, item.id)"
            @lostpointercapture="handleLostPointerCapture"
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
            <span class="navigation-item-label text-sm font-medium text-gray-800 dark:text-gray-200">{{ item.label }}</span>
            <span v-if="homepageId === item.id" class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-[#EC4141] bg-red-100/60 dark:bg-red-500/15">首页</span>
          </button>
          <button
            type="button"
            role="switch"
            :aria-label="`显示${item.label}导航入口`"
            :aria-checked="isVisible(item)"
            :disabled="!!drag"
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
.navigation-list {
  isolation: isolate;
  overflow-anchor: none;
}

.navigation-list.is-reordering {
  cursor: grabbing;
  user-select: none;
}

.navigation-setting-row {
  z-index: 1;
  transition: background-color 160ms ease, box-shadow 160ms ease;
}

.navigation-setting-row:last-child {
  border-bottom-color: transparent;
}

.navigation-setting-row.is-shifting {
  pointer-events: none;
  will-change: transform;
}

.navigation-setting-row.is-dragged {
  --drag-text: #27272a;
  --drag-handle: #71717a;
  z-index: 3;
  pointer-events: none;
  will-change: transform;
  border-bottom-color: transparent;
  background: rgb(244 244 245 / .98);
  box-shadow: 0 8px 24px rgb(15 23 42 / .09), 0 2px 6px rgb(15 23 42 / .04), inset 0 0 0 1px rgb(236 65 65 / .18);
}

.dark .navigation-setting-row.is-dragged {
  --drag-text: #f4f4f5;
  --drag-handle: #a1a1aa;
  background: rgb(41 41 44 / .98);
  box-shadow: 0 8px 24px rgb(0 0 0 / .22), 0 2px 6px rgb(0 0 0 / .12), inset 0 0 0 1px rgb(236 65 65 / .18);
}

.navigation-setting-row.is-dragged .navigation-item-label {
  color: var(--drag-text);
}

.navigation-setting-row.is-dragged .reorder-handle {
  color: var(--drag-handle);
}

.navigation-drop-slot {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 0;
  pointer-events: none;
  list-style: none;
  border: 1px dashed rgb(236 65 65 / .3);
  border-radius: 8px;
  background: rgb(236 65 65 / .04);
}

.dark .navigation-drop-slot {
  background: rgb(236 65 65 / .06);
}

.reorder-handle {
  cursor: grab;
  touch-action: none;
}

.reorder-handle:active {
  cursor: grabbing;
}

@media (prefers-reduced-motion: reduce) {
  .navigation-setting-row {
    transition: none;
  }
}
</style>
