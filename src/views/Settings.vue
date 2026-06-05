<script setup lang="ts">
import { ref } from 'vue';
import SettingsAbout from "../components/settings/SettingsAbout.vue";
import SettingsDesktopLyrics from "../components/settings/SettingsDesktopLyrics.vue";
import SettingsGeneral from "../components/settings/SettingsGeneral.vue";
import SettingsLibrary from "../components/settings/SettingsLibrary.vue";
import SettingsRemoteLibrary from "../components/settings/SettingsRemoteLibrary.vue";
import SettingsShortcuts from "../components/settings/SettingsShortcuts.vue";
import SettingsSidebar from "../components/settings/SettingsSidebar.vue";
import SettingsTheme from "../components/settings/SettingsTheme.vue";
import SettingsToolbox from "../components/settings/SettingsToolbox.vue";
import SettingsAudioOutput from "../components/settings/SettingsAudioOutput.vue";

const activeTab = ref<'general' | 'theme' | 'sidebar' | 'desktopLyrics' | 'audioOutput' | 'toolbox' | 'library' | 'remoteLibrary' | 'shortcuts' | 'about'>('general');

const tabs = [
  { id: 'general', name: '常规' },
  { id: 'theme', name: '外观' },
  { id: 'sidebar', name: '侧边栏管理' },
  { id: 'desktopLyrics', name: '桌面歌词' },
  { id: 'audioOutput', name: '音频输出' },
  { id: 'toolbox', name: '工具箱' },
  { id: 'library', name: '本地音乐库' },
  { id: 'remoteLibrary', name: '远程音乐库' },
  { id: 'shortcuts', name: '快捷键' },
  { id: 'about', name: '关于' },
];
</script>

<template>
  <div class="flex h-full flex-1 overflow-hidden transition-colors duration-500">
    <aside class="z-10 flex w-[220px] shrink-0 flex-col border-r border-white/20 p-4 dark:border-white/5 md:w-[240px]">
      <nav class="custom-scrollbar flex-1 space-y-1.5 overflow-y-auto overflow-x-hidden">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="relative flex w-full cursor-pointer items-center rounded-md px-4 py-2.5 text-left text-sm transition-all duration-300 active:scale-[0.97]"
          :class="activeTab === tab.id ? 'translate-x-1 bg-black/10 font-semibold text-black shadow-sm dark:bg-white/10 dark:text-white' : 'font-medium text-gray-800 hover:translate-x-1 hover:bg-black/5 hover:text-black dark:text-gray-200 dark:hover:bg-white/5 dark:hover:text-white'"
          @click="activeTab = tab.id as any"
        >
          <div
            v-if="activeTab === tab.id"
            class="absolute left-0 top-1/2 h-[18px] w-1 -translate-y-1/2 rounded-r-md bg-[#EC4141]"
          ></div>
          {{ tab.name }}
        </button>
      </nav>
    </aside>

    <main :class="activeTab === 'about' ? 'relative h-full min-w-0 flex-1 overflow-hidden px-10 py-10 xl:px-16' : 'custom-scrollbar relative h-full min-w-0 flex-1 overflow-y-auto px-10 py-10 xl:px-16'">
      <div class="w-full pb-16">
        <SettingsGeneral v-if="activeTab === 'general'" />
        <SettingsTheme v-else-if="activeTab === 'theme'" />
        <SettingsSidebar v-else-if="activeTab === 'sidebar'" />
        <SettingsDesktopLyrics v-else-if="activeTab === 'desktopLyrics'" />
        <SettingsAudioOutput v-else-if="activeTab === 'audioOutput'" />
        <SettingsToolbox v-else-if="activeTab === 'toolbox'" />
        <SettingsLibrary v-else-if="activeTab === 'library'" />
        <SettingsRemoteLibrary v-else-if="activeTab === 'remoteLibrary'" />
        <SettingsShortcuts v-else-if="activeTab === 'shortcuts'" />
        <SettingsAbout v-else-if="activeTab === 'about'" />

        <div v-else class="flex h-[50vh] flex-col items-center justify-center space-y-4 text-gray-400">
          <div class="text-4xl opacity-50">施工中</div>
          <div>当前设置模块正在整理中。</div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
</style>
