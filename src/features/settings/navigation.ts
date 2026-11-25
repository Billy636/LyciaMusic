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

export type PersonalizationPage = 'theme' | 'sidebar' | 'footer' | 'desktopLyrics' | 'taskbarPlayer' | 'songNotification';
export type ToolboxPage = 'tags' | 'duplicates';

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
  sidebar: '界面与导航',
  footer: '播放底栏',
  desktopLyrics: '桌面歌词',
  taskbarPlayer: '铃动窗',
  songNotification: '切歌卡片',
} satisfies Record<PersonalizationPage, string>;

export const TOOLBOX_PAGE_LABELS = {
  tags: '歌曲标签管理',
  duplicates: '重复歌曲管理',
} satisfies Record<ToolboxPage, string>;

// Settings navigation is session state, separate from persisted preferences.
export const useSettingsNavigationStore = defineStore('settingsNavigation', () => {
  const activeSection = ref<SettingsSection>('general');
  const personalizationPage = ref<PersonalizationPage | null>(null);
  const toolboxPage = ref<ToolboxPage | null>(null);

  const canGoBack = computed(
    () => (activeSection.value === 'personalization' && personalizationPage.value !== null)
      || (activeSection.value === 'toolbox' && toolboxPage.value !== null),
  );
  const sectionTitle = computed(() => SETTINGS_SECTION_LABELS[activeSection.value]);
  const personalizationTitle = computed(() => (
    personalizationPage.value ? PERSONALIZATION_PAGE_LABELS[personalizationPage.value] : '个性化'
  ));
  const toolboxTitle = computed(() => (
    toolboxPage.value ? TOOLBOX_PAGE_LABELS[toolboxPage.value] : '工具箱'
  ));
  const pageTitle = computed(() => (
    activeSection.value === 'personalization'
      ? personalizationTitle.value
      : activeSection.value === 'toolbox'
        ? toolboxTitle.value
        : sectionTitle.value
  ));

  function selectSection(section: SettingsSection) {
    activeSection.value = section;
    personalizationPage.value = null;
    toolboxPage.value = null;
  }

  function openPersonalizationPage(page: PersonalizationPage) {
    activeSection.value = 'personalization';
    personalizationPage.value = page;
    toolboxPage.value = null;
  }

  function openToolboxPage(page: ToolboxPage) {
    activeSection.value = 'toolbox';
    personalizationPage.value = null;
    toolboxPage.value = page;
  }

  function backToPersonalization() {
    if (activeSection.value === 'personalization') {
      personalizationPage.value = null;
    }
  }

  function backToToolbox() {
    if (activeSection.value === 'toolbox') {
      toolboxPage.value = null;
    }
  }

  function backToSection() {
    if (activeSection.value === 'personalization') backToPersonalization();
    else if (activeSection.value === 'toolbox') backToToolbox();
  }

  function resetNavigation() {
    selectSection('general');
  }

  return {
    activeSection,
    personalizationPage,
    toolboxPage,
    sectionTitle,
    personalizationTitle,
    toolboxTitle,
    pageTitle,
    canGoBack,
    selectSection,
    openPersonalizationPage,
    openToolboxPage,
    backToPersonalization,
    backToToolbox,
    backToSection,
    resetNavigation,
  };
});
