<script setup lang="ts">
import { ref } from 'vue';
import SettingsGeneral from "../components/settings/SettingsGeneral.vue";
import SettingsTheme from "../components/settings/SettingsTheme.vue";
import SettingsToolbox from "../components/settings/SettingsToolbox.vue";
import SettingsAbout from "../components/settings/SettingsAbout.vue";

// 定义 Tabs
const activeTab = ref<'general' | 'theme' | 'toolbox' | 'shortcuts' | 'about'>('general');

const tabs = [
  { id: 'general', name: '常规' },
  { id: 'theme', name: '主题' },
  { id: 'toolbox', name: '工具箱' },
  { id: 'shortcuts', name: '快捷键' },
  { id: 'about', name: '关于' }
];
</script>

<template>
  <div class="flex-1 h-full flex flex-col overflow-hidden transition-colors duration-500">
    
    <header class="h-20 flex items-end px-8 pb-4 shrink-0 sticky top-0 z-10">
      <h1 class="text-3xl font-bold text-gray-800 dark:text-gray-200 mr-12 mb-1 drop-shadow-sm">设置</h1>
      
      <div class="flex gap-8 mb-1.5">
        <button 
          v-for="tab in tabs" 
          :key="tab.id"
          @click="activeTab = tab.id as any"
          class="pb-2 text-base font-medium transition-all relative"
          :class="activeTab === tab.id ? 'text-[#EC4141] font-bold' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'"
        >
          {{ tab.name }}
          <div 
            v-if="activeTab === tab.id" 
            class="absolute bottom-[-2px] left-0 right-0 h-[3px] bg-[#EC4141] rounded-full shadow-sm"
          ></div>
        </button>
      </div>
    </header>

    <section class="flex-1 min-h-0 w-full overflow-y-auto p-8 custom-scrollbar relative">
      <SettingsGeneral v-if="activeTab === 'general'" />
      <SettingsTheme v-else-if="activeTab === 'theme'" />
      <SettingsToolbox v-else-if="activeTab === 'toolbox'" />
      <SettingsAbout v-else-if="activeTab === 'about'" />
      
      <div v-else class="flex flex-col items-center justify-center h-full text-gray-400 space-y-4">
        <div class="text-4xl opacity-50">🚧</div>
        <div>{{ activeTab === 'shortcuts' ? '快捷键设置' : '关于信息' }} 模块正在施工中...</div>
      </div>

      <!-- 底部留白，确保能完全滚出阴影区 -->
      <div class="h-12"></div>
    </section>
  </div>
</template>

<style scoped>
</style>