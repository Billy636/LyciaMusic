<script setup lang="ts">
import { Moon, Sun } from 'lucide-vue-next';
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePlayerViewState } from '../../composables/usePlayerViewState';
import { useThemeSettings } from '../../composables/useThemeSettings';
import { getCurrentWindow } from '@tauri-apps/api/window'; 
import { useSettings } from '../../features/settings/useSettings';
import { hideMainWindowToTray } from '../../composables/renderingPower';
import { useLibrarySearchIndex } from '../../composables/useLibrarySearchIndex';

const router = useRouter();
const route = useRoute();
const { searchQuery, setSearch, isMiniMode } = usePlayerViewState();
const appWindow = getCurrentWindow();
const TITLE_BAR_CONTROL_SELECTOR = 'button, a, input, select, textarea, [role="button"]';
const { settings } = useSettings();
const { isDarkTheme, toggleThemeMode } = useThemeSettings();
const { searchIndexBuilding, searchIndexProgress } = useLibrarySearchIndex();
const rotation = ref(0); // For settings icon animation
const lastNonSettingsRoute = ref(route.path === '/settings' ? '/' : route.fullPath);
const isSettingsRoute = computed(() => route.path === '/settings');
const themeToggleTitle = computed(() => (isDarkTheme.value ? '切换浅色' : '切换深色'));
const searchDraft = ref(searchQuery.value);
const isSearchDraftDirty = computed(() => searchDraft.value !== searchQuery.value);

const rotateSettings = () => {
  rotation.value += 180;
};

const toggleSettingsPage = async () => {
  rotateSettings();

  if (isSettingsRoute.value) {
    await router.push(lastNonSettingsRoute.value || '/');
    return;
  }

  await router.push('/settings');
};

watch(
  () => route.fullPath,
  (fullPath) => {
    if (route.path !== '/settings') {
      lastNonSettingsRoute.value = fullPath;
    }
  },
  { immediate: true },
);

const toggleTaskbarPlayer = () => {
  settings.value.showTaskbarPlayer = !settings.value.showTaskbarPlayer;
};

// 最小化
const minimize = async () => {
  await appWindow.minimize();
};

// 最大化/还原
const toggleMaximize = async () => { 
  try {
    const isMax = await appWindow.isMaximized();
    if (isMax) {
      await appWindow.unmaximize();
    } else {
      await appWindow.maximize();
    }
  } catch (error) {
    console.error('Failed to toggle maximize:', error);
  }
};

const isTitleBarControlTarget = (event: Event) => {
  const target = event.target;
  return target instanceof Element && target.closest(TITLE_BAR_CONTROL_SELECTOR) !== null;
};

const handleTitleBarPointerDown = (event: PointerEvent) => {
  if (event.isPrimary === false || event.button !== 0 || isTitleBarControlTarget(event)) return;

  event.preventDefault();
  void appWindow.startDragging().catch((error) => {
    console.error('Failed to start window dragging:', error);
  });
};

const handleTitleBarDoubleClick = (event: MouseEvent) => {
  if (isTitleBarControlTarget(event)) return;
  void toggleMaximize();
};

// 关闭
const closeWindow = async () => { 
  if (settings.value.closeToTray) {
    await hideMainWindowToTray(appWindow);
  } else {
    await appWindow.close();
  }
};

const commitSearch = (value: string) => {
  searchDraft.value = value;
  setSearch(value);
};

const handleInput = (event: Event) => {
  searchDraft.value = (event.target as HTMLInputElement).value;
};

watch(searchQuery, (value) => {
  if (value !== searchDraft.value) {
    searchDraft.value = value;
  }
});

const goBack = () => { router.back(); };
</script>

<template>
  <div 
    data-window-drag-handle
    class="h-16 flex items-center justify-between px-6  select-none shrink-0 relative z-[60]"
    @pointerdown="handleTitleBarPointerDown"
    @dblclick="handleTitleBarDoubleClick"
  >
    <div class="flex items-center gap-4 relative z-10">
      <button 
        @click="goBack" 
        class="w-8 h-8 rounded-full bg-white/5 dark:bg-white/5 hover:bg-white/20 dark:hover:bg-white/20 flex items-center justify-center text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white transition-colors focus:outline-none cursor-pointer border border-black/10 dark:border-white/10"
        title="后退"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 -ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <div class="group relative bg-white/5 dark:bg-white/5 hover:bg-white/10 dark:hover:bg-white/10 focus-within:bg-white/20 dark:focus-within:bg-white/10 focus-within:ring-2 focus-within:ring-[#EC4141]/20 pl-2 pr-3 py-1.5 rounded-full text-sm flex items-center transition-all w-60 ml-2 border border-black/10 dark:border-white/20">
        <button
          type="button"
          class="p-1 mr-1 rounded-full text-gray-900 dark:text-gray-100 group-focus-within:text-[#EC4141] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
          :class="{ 'text-[#EC4141] dark:text-[#ff8b8b] bg-black/5 dark:bg-white/10': isSearchDraftDirty }"
          title="搜索"
          aria-label="提交搜索"
          @click="commitSearch(searchDraft)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
        <input 
          type="text" 
          placeholder="搜索音乐..." 
          class="bg-transparent outline-none w-full placeholder-gray-700 dark:placeholder-gray-300 text-gray-800 dark:text-gray-100 text-xs font-medium"
          :value="searchDraft"
          @input="handleInput"
          @keydown.enter.prevent="commitSearch(searchDraft)"
        />
        <button v-if="searchDraft || searchQuery" @click="commitSearch('')" class="text-gray-500 dark:text-gray-400 hover:text-[#EC4141] ml-1 cursor-pointer">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
          </svg>
        </button>
        <span
          v-if="searchIndexBuilding"
          class="absolute left-4 top-full mt-1 text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap pointer-events-none"
        >正在建立拼音索引 {{ searchIndexProgress }}%</span>
      </div>
    </div>

    <div class="flex items-center gap-2 relative z-10">
      <button
        type="button"
        class="rounded-md p-2 transition-all duration-300 ease-out cursor-pointer"
        :class="isSettingsRoute
          ? 'text-[#EC4141] dark:text-[#ff8b8b]'
          : 'text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5'"
        :aria-pressed="isSettingsRoute"
        @click.stop="toggleSettingsPage"
        title="设置"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-5 w-5 transition-transform duration-300 ease-out"
          :style="{ transform: `rotate(${rotation}deg)` }"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
      <button
        type="button"
        class="p-2 text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition-colors cursor-pointer"
        :title="themeToggleTitle"
        :aria-label="themeToggleTitle"
        @click.stop="toggleThemeMode"
      >
        <Sun v-if="isDarkTheme" class="h-5 w-5" :stroke-width="2" />
        <Moon v-else class="h-5 w-5" :stroke-width="2" />
      </button>
      <div class="h-4 w-px bg-gray-400/30 mx-2"></div>
      <div class="flex items-center gap-1">
        <button type="button" @click.stop="isMiniMode = true" class="p-2 text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition-colors cursor-pointer" title="Mini 模式">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <!-- 左上角带缺口的外侧大矩形 -->
            <path d="M13 6H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V13" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            <!-- 左上角的实心嵌套小矩形 (7x5) -->
            <rect x="4" y="6" width="7" height="5" rx="1" fill="currentColor" />
          </svg>
        </button>
        <button
          v-if="settings.showTaskbarPlayerIcon"
          type="button"
          class="p-2 transition-colors cursor-pointer rounded-md"
          :class="settings.showTaskbarPlayer
            ? 'text-[#EC4141] dark:text-[#ff8b8b]'
            : 'text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5'"
          @click.stop="toggleTaskbarPlayer"
          title="任务栏播控"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <!-- 右下角带缺口的外侧大矩形 -->
            <path d="M11 18H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2V11" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            <!-- 右下角的实心填充小矩形 (7x5) -->
            <rect x="13" y="13" width="7" height="5" rx="1" fill="currentColor" />
          </svg>
        </button>
        <button type="button" aria-label="最小化" title="最小化" @click.stop="minimize" class="p-2 text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition-colors cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 12H6" /></svg></button>
        <button type="button" aria-label="最大化或还原" title="最大化或还原" @click.stop="toggleMaximize" class="p-2 text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition-colors cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" stroke-width="2" /></svg></button>
        <button type="button" aria-label="关闭" title="关闭" @click.stop="closeWindow" class="p-2 text-gray-900 dark:text-gray-100 hover:text-white hover:bg-[#EC4141] rounded-md transition-colors cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
      </div>
    </div>
  </div>
</template>
