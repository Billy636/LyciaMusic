import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

export type SettingsSection =
  | 'general'
  | 'personalization'
  | 'audioOutput'
  | 'toolbox'
  | 'library'
  | 'remoteLibrary'
  | 'shortcuts'
  | 'about';

export type PersonalizationPage = 'theme' | 'sidebar' | 'footer' | 'desktopLyrics' | 'taskbarPlayer';

export const SETTINGS_SECTION_LABELS = {
  general: '常规',
  personalization: '个性化',
  audioOutput: '音频输出',
  toolbox: '工具箱',
  library: '本地音乐库',
  remoteLibrary: '远程音乐库',
  shortcuts: '快捷键',
  about: '关于',
} satisfies Record<SettingsSection, string>;

export const PERSONALIZATION_PAGE_LABELS = {
  theme: '外观',
  sidebar: '侧边栏管理',
  footer: '播放底栏',
  desktopLyrics: '桌面歌词',
  taskbarPlayer: '任务栏播控',
} satisfies Record<PersonalizationPage, string>;

// Settings navigation is session state, separate from persisted preferences.
export const useSettingsNavigationStore = defineStore('settingsNavigation', () => {
  const activeSection = ref<SettingsSection>('general');
  const personalizationPage = ref<PersonalizationPage | null>(null);

  const canGoBack = computed(
    () => activeSection.value === 'personalization' && personalizationPage.value !== null,
  );
  const personalizationTitle = computed(() => (
    personalizationPage.value ? PERSONALIZATION_PAGE_LABELS[personalizationPage.value] : '个性化'
  ));
  const pageTitle = computed(() => (
    activeSection.value === 'personalization'
      ? personalizationTitle.value
      : SETTINGS_SECTION_LABELS[activeSection.value]
  ));

  function selectSection(section: SettingsSection) {
    activeSection.value = section;
    personalizationPage.value = null;
  }

  function openPersonalizationPage(page: PersonalizationPage) {
    activeSection.value = 'personalization';
    personalizationPage.value = page;
  }

  function backToPersonalization() {
    if (canGoBack.value) {
      personalizationPage.value = null;
    }
  }

  function resetNavigation() {
    selectSection('general');
  }

  return {
    activeSection,
    personalizationPage,
    personalizationTitle,
    pageTitle,
    canGoBack,
    selectSection,
    openPersonalizationPage,
    backToPersonalization,
    resetNavigation,
  };
});
