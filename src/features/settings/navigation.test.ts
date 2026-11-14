import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  SETTINGS_SECTION_LABELS,
  useSettingsNavigationStore,
  type PersonalizationPage,
  type SettingsSection,
} from './navigation';

const personalizationPages: PersonalizationPage[] = ['theme', 'sidebar', 'desktopLyrics'];
const settingsSections: SettingsSection[] = [
  'general',
  'personalization',
  'audioOutput',
  'toolbox',
  'library',
  'remoteLibrary',
  'shortcuts',
  'about',
];
const sectionTitles: Array<[SettingsSection, string]> = [
  ['general', '常规'],
  ['personalization', '个性化'],
  ['audioOutput', '音频输出'],
  ['toolbox', '工具箱'],
  ['library', '本地音乐库'],
  ['remoteLibrary', '远程音乐库'],
  ['shortcuts', '快捷键'],
  ['about', '关于'],
];

describe('settings navigation store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('starts at general settings with no subpage or back action', () => {
    const store = useSettingsNavigationStore();

    expect(store.activeSection).toBe('general');
    expect(store.personalizationPage).toBeNull();
    expect(store.personalizationTitle).toBe('个性化');
    expect(store.pageTitle).toBe('常规');
    expect(store.canGoBack).toBe(false);
  });

  it('exports one label for each of the eight root sections', () => {
    expect(SETTINGS_SECTION_LABELS).toEqual(Object.fromEntries(sectionTitles));
  });

  it.each(sectionTitles)('uses the %s root label as the shared page title', (section, title) => {
    const store = useSettingsNavigationStore();

    store.selectSection(section);

    expect(store.pageTitle).toBe(title);
  });

  it.each([
    ['theme', '外观'],
    ['sidebar', '侧边栏管理'],
    ['desktopLyrics', '桌面歌词'],
  ] as const)('keeps the shared title in sync with the %s subpage and its overview', (page, title) => {
    const store = useSettingsNavigationStore();
    store.selectSection('personalization');

    expect(store.personalizationTitle).toBe('个性化');
    expect(store.pageTitle).toBe('个性化');

    store.openPersonalizationPage(page);

    expect(store.personalizationTitle).toBe(title);
    expect(store.pageTitle).toBe(title);

    store.backToPersonalization();

    expect(store.personalizationTitle).toBe('个性化');
    expect(store.pageTitle).toBe('个性化');
  });

  it.each(personalizationPages)('opens and returns from the %s subpage', (page) => {
    const store = useSettingsNavigationStore();

    store.openPersonalizationPage(page);

    expect(store.activeSection).toBe('personalization');
    expect(store.personalizationPage).toBe(page);
    expect(store.canGoBack).toBe(true);

    store.backToPersonalization();

    expect(store.activeSection).toBe('personalization');
    expect(store.personalizationPage).toBeNull();
    expect(store.canGoBack).toBe(false);
  });

  it.each(settingsSections)('clears the active subpage when selecting %s', (section) => {
    const store = useSettingsNavigationStore();
    store.openPersonalizationPage('desktopLyrics');

    store.selectSection(section);

    expect(store.activeSection).toBe(section);
    expect(store.personalizationPage).toBeNull();
    expect(store.personalizationTitle).toBe('个性化');
    expect(store.pageTitle).toBe(SETTINGS_SECTION_LABELS[section]);
    expect(store.canGoBack).toBe(false);
  });

  it.each(settingsSections)('does not navigate away from the top-level %s page on back', (section) => {
    const store = useSettingsNavigationStore();
    store.selectSection(section);

    store.backToPersonalization();

    expect(store.activeSection).toBe(section);
    expect(store.personalizationPage).toBeNull();
    expect(store.canGoBack).toBe(false);
  });

  it('requires personalization to be active before allowing back navigation', () => {
    const store = useSettingsNavigationStore();
    store.personalizationPage = 'theme';

    expect(store.canGoBack).toBe(false);

    store.backToPersonalization();

    expect(store.activeSection).toBe('general');
    expect(store.personalizationPage).toBe('theme');
  });

  it.each(sectionTitles.filter(([section]) => section !== 'personalization'))(
    'does not let a stale personalization child replace the %s root title',
    (section, title) => {
      const store = useSettingsNavigationStore();
      store.selectSection(section);
      store.personalizationPage = 'theme';

      expect(store.personalizationTitle).toBe('外观');
      expect(store.pageTitle).toBe(title);
      expect(store.canGoBack).toBe(false);
    },
  );

  it('resets navigation to general after visiting a subpage', () => {
    const store = useSettingsNavigationStore();
    store.openPersonalizationPage('sidebar');

    store.resetNavigation();

    expect(store.activeSection).toBe('general');
    expect(store.personalizationPage).toBeNull();
    expect(store.personalizationTitle).toBe('个性化');
    expect(store.pageTitle).toBe('常规');
    expect(store.canGoBack).toBe(false);
  });

  it('shares navigation within one Pinia instance without leaking into another', () => {
    const firstPinia = createPinia();
    const secondPinia = createPinia();
    const firstStore = useSettingsNavigationStore(firstPinia);

    firstStore.openPersonalizationPage('theme');

    const sharedStore = useSettingsNavigationStore(firstPinia);
    const secondStore = useSettingsNavigationStore(secondPinia);

    expect(sharedStore).toBe(firstStore);
    expect(sharedStore.personalizationPage).toBe('theme');
    expect(secondStore.activeSection).toBe('general');
    expect(secondStore.personalizationPage).toBeNull();
    expect(secondStore.canGoBack).toBe(false);

    secondStore.openPersonalizationPage('sidebar');

    expect(firstStore.personalizationPage).toBe('theme');
    expect(secondStore.personalizationPage).toBe('sidebar');
  });
});
