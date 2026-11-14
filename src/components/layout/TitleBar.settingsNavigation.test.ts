import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { createPinia, disposePinia } from 'pinia';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Vue from 'vue';
import type { VNode } from 'vue';

import {
  SETTINGS_SECTION_LABELS,
  useSettingsNavigationStore,
  type PersonalizationPage,
  type SettingsSection,
} from '../../features/settings/navigation';
import source from './TitleBar.vue?raw';

const { descriptor } = parse(source);
const compiled = compileTemplate({
  source: descriptor.template!.content,
  filename: 'TitleBar.vue',
  id: 'title-bar-settings-navigation-test',
  compilerOptions: { mode: 'function' },
});
const render = new Function('Vue', compiled.code)({
  ...Vue,
  // Keep this node-only test focused on the title bar's rendered controls.
  resolveComponent: (name: string) => name,
}) as (context: Record<string, unknown>, cache: unknown[]) => VNode;
const compiledScript = compileScript(descriptor, { id: 'title-bar-settings-actions-test' });
const executableScript = transpileModule(compiledScript.content, {
  compilerOptions: { target: ScriptTarget.ES2020, module: ModuleKind.CommonJS },
}).outputText;

const rootPages: Array<[SettingsSection, string]> = [
  ['general', '常规'],
  ['personalization', '个性化'],
  ['audioOutput', '音频输出'],
  ['toolbox', '工具箱'],
  ['library', '本地音乐库'],
  ['remoteLibrary', '远程音乐库'],
  ['shortcuts', '快捷键'],
  ['about', '关于'],
];
const childPages: Array<[PersonalizationPage, string]> = [
  ['theme', '外观'],
  ['sidebar', '侧边栏管理'],
  ['desktopLyrics', '桌面歌词'],
];

const createContext = (
  isSettingsRoute = true,
  canGoBack = false,
  activeSection: SettingsSection = 'general',
) => ({
  isSettingsRoute,
  isSettingsLayout: isSettingsRoute,
  settingsPageTitle: canGoBack ? '外观' : SETTINGS_SECTION_LABELS[activeSection],
  isPlaylistLibraryRoute: false,
  settingsNavigation: {
    activeSection,
    pageTitle: canGoBack ? '外观' : SETTINGS_SECTION_LABELS[activeSection],
    personalizationTitle: canGoBack ? '外观' : '个性化',
    canGoBack,
    backToPersonalization: vi.fn(),
  },
  settingsBackTitle: canGoBack ? '返回个性化' : '返回音乐页面',
  handleSettingsBack: vi.fn(),
  settings: { showTaskbarPlayerIcon: false, showTaskbarPlayer: false },
  isMiniMode: false,
  isDarkTheme: false,
  themeToggleTitle: '切换深色',
  rotation: 0,
  searchDraft: '',
  searchQuery: '',
  searchPlaceholder: '搜索歌曲...',
  isSearchDraftDirty: false,
  searchIndexBuilding: false,
  searchIndexProgress: 0,
  commitSearch: vi.fn(),
  handleInput: vi.fn(),
  goBack: vi.fn(),
  toggleSettingsPage: vi.fn(),
  toggleThemeMode: vi.fn(),
  toggleTaskbarPlayer: vi.fn(),
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  closeWindow: vi.fn(),
});

const renderedNodes = (context: ReturnType<typeof createContext>) => {
  const nodes: VNode[] = [];
  const visit = (node: unknown) => {
    if (!Vue.isVNode(node)) return;
    nodes.push(node);
    if (Array.isArray(node.children)) node.children.forEach(visit);
  };
  visit(render(context, []));
  return nodes;
};
const classes = (node: VNode | undefined) => String(node?.props?.class ?? '').split(/\s+/);
const settingsBackButton = (nodes: VNode[]) => nodes.find(node => (
  node.type === 'button' && node.props && 'data-settings-back' in node.props
));

interface TitleBarSetup {
  settingsPageTitle: Vue.Ref<string>;
  settingsBackTitle: Vue.ComputedRef<string>;
  handleSettingsBack: () => void | Promise<void>;
  toggleSettingsPage: () => Promise<void>;
  goBack: () => void;
}

const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach(dispose => dispose());
});

// Run the real script setup to verify routing decisions, not a copy of its logic.
function setupTitleBar(initialPath = '/settings') {
  const instance = createPinia();
  const navigation = useSettingsNavigationStore(instance);
  const route = Vue.reactive({ path: initialPath.split(/[?#]/)[0], fullPath: initialPath });
  const router = { push: vi.fn().mockResolvedValue(undefined), back: vi.fn() };
  const disposals: Array<() => void> = [];
  const modules: Record<string, unknown> = {
    vue: { ...Vue, onBeforeUnmount: (callback: () => void) => disposals.push(callback) },
    'lucide-vue-next': { Moon: 'Moon', Sun: 'Sun' },
    'vue-router': { useRoute: () => route, useRouter: () => router },
    '@tauri-apps/api/window': { getCurrentWindow: () => ({}) },
    '../../composables/usePlayerViewState': {
      usePlayerViewState: () => ({
        searchQuery: Vue.ref(''),
        setSearch: vi.fn(),
        isMiniMode: Vue.ref(false),
        currentViewMode: Vue.ref('songs'),
      }),
    },
    '../../composables/useThemeSettings': {
      useThemeSettings: () => ({ isDarkTheme: Vue.ref(false), toggleThemeMode: vi.fn() }),
    },
    '../../features/settings/useSettings': { useSettings: () => ({ settings: Vue.ref({}) }) },
    '../../features/settings/navigation': { useSettingsNavigationStore: () => navigation },
    '../../composables/renderingPower': { hideMainWindowToTray: vi.fn() },
    '../../composables/useLibrarySearchIndex': {
      useLibrarySearchIndex: () => ({ searchIndexBuilding: Vue.ref(false), searchIndexProgress: Vue.ref(0) }),
    },
    './AppBrand.vue': { default: 'AppBrand' },
  };
  const exports: { default?: { setup: (props: object, context: { expose: () => void }) => TitleBarSetup } } = {};
  new Function('require', 'exports', executableScript)((moduleId: string) => {
    if (!(moduleId in modules)) throw new Error(`Unexpected TitleBar.vue dependency: ${moduleId}`);
    return modules[moduleId];
  }, exports);
  const scope = Vue.effectScope();
  const setup = scope.run(() => exports.default!.setup({}, { expose: () => {} }))!;
  cleanup.push(() => {
    disposals.forEach(dispose => dispose());
    scope.stop();
    disposePinia(instance);
  });

  const navigate = async (fullPath: string) => {
    route.path = fullPath.split(/[?#]/)[0];
    route.fullPath = fullPath;
    await Vue.nextTick();
  };
  return { setup, navigation, router, navigate };
}

describe('TitleBar settings navigation', () => {
  it('keeps the settings-aware template valid', () => {
    expect(compiled.errors).toEqual([]);
    expect(source).toContain('useSettingsNavigationStore');
  });

  it.each([false, true])('hides song search and global history in settings (child: %s)', (canGoBack) => {
    const nodes = renderedNodes(createContext(true, canGoBack));

    expect(nodes.some(node => node.type === 'input')).toBe(false);
    expect(nodes.some(node => node.props?.title === '后退')).toBe(false);
  });

  it.each(rootPages)('renders the %s root title beside an available back button', (section, title) => {
    const context = createContext(true, false, section);
    const nodes = renderedNodes(context);
    const headings = nodes.filter(node => node.type === 'h1');
    const back = settingsBackButton(nodes);

    expect(headings).toHaveLength(1);
    expect(headings[0]?.props?.id).toBe('settings-page-heading');
    expect(headings[0]?.children).toBe(title);
    expect(classes(headings[0])).toEqual(expect.arrayContaining(['truncate', 'text-base', 'font-semibold']));
    expect(back?.props?.['aria-label']).toBe('返回音乐页面');
    expect(back?.props?.disabled).toBeUndefined();
    back!.props!.onClick();
    expect(context.handleSettingsBack).toHaveBeenCalledOnce();
    expect(context.goBack).not.toHaveBeenCalled();
  });

  it.each(childPages)('shows only the current %s title and its parent-return arrow', (_page, title) => {
    const context = createContext(true, true, 'personalization');
    context.settingsPageTitle = title;
    context.settingsNavigation.pageTitle = title;
    context.settingsNavigation.personalizationTitle = title;
    const nodes = renderedNodes(context);
    const headings = nodes.filter(node => node.type === 'h1');
    const back = settingsBackButton(nodes);

    expect(headings).toHaveLength(1);
    expect(headings[0]?.props?.id).toBe('settings-page-heading');
    expect(headings[0]?.children).toBe(title);
    expect(classes(headings[0])).toEqual(expect.arrayContaining(['text-base', 'font-semibold']));
    expect(nodes.some(node => node.type === 'ChevronRight')).toBe(false);
    expect(nodes.some(node => node.props?.['aria-label'] === '返回个性化总览')).toBe(false);
    expect(nodes.some(node => node.type === 'button' && node.children === '个性化')).toBe(false);
    expect(back?.props?.title).toBe('返回个性化');
    back!.props!.onClick();
    expect(context.handleSettingsBack).toHaveBeenCalledOnce();
    expect(context.goBack).not.toHaveBeenCalled();
  });

  it('separates the compact sidebar-aligned brand from the content-aligned page strip', () => {
    const context = createContext(true, true, 'personalization');
    const nodes = renderedNodes(context);
    const brandSlot = nodes.find(node => node.props && 'data-settings-brand' in node.props);
    const pageStrip = nodes.find(node => node.props && 'data-settings-page-header' in node.props);
    const brand = nodes.find(node => node.type === 'AppBrand');
    const heading = nodes.find(node => node.props?.id === 'settings-page-heading');
    const back = settingsBackButton(nodes);
    const root = render(context, []);

    expect(brandSlot).toBeDefined();
    expect(pageStrip).toBeDefined();
    expect(brand).toBeDefined();
    expect(brandSlot?.props?.style).toEqual({ width: 'var(--app-sidebar-width)' });
    expect(classes(brandSlot)).toEqual(expect.arrayContaining(['shrink-0', 'px-6']));
    expect(classes(brandSlot).some(name => /^(?:(?:sm|md|lg|xl|2xl):)?w-/.test(name))).toBe(false);
    expect(classes(pageStrip)).toEqual(expect.arrayContaining(['min-w-0', 'flex-1', 'gap-3', 'px-6']));
    const horizontalPadding = (node: VNode | undefined) => classes(node).filter(name => /^(?:(?:sm|md|lg|xl|2xl):)?px-/.test(name));
    expect(horizontalPadding(pageStrip)).toEqual(['px-6']);
    expect(horizontalPadding(pageStrip)).toEqual(horizontalPadding(render(createContext(false), [])));
    expect(brandSlot?.children).toContain(brand);
    expect(pageStrip?.children).toEqual(expect.arrayContaining([back, heading]));
    expect(pageStrip?.children).not.toContain(brand);
    expect(classes(heading)).toEqual(expect.arrayContaining(['min-w-0', 'truncate', 'text-base', 'font-semibold']));
    expect(classes(heading).some(name => /absolute|text-[23]xl|(?:sm:|md:|xl:)?left-/.test(name))).toBe(false);
    expect(classes(root)).toContain('h-16');
    expect(classes(root)).toContain('pr-6');
    expect(classes(root)).not.toContain('px-6');
    const rootChildren = root.children as VNode[];
    const controls = rootChildren[rootChildren.length - 1];
    expect(classes(controls)).toContain('shrink-0');
  });

  it.each([false, true])('keeps the original circular back-button appearance at every settings depth (%s)', canGoBack => {
    const settingsNodes = renderedNodes(createContext(true, canGoBack, 'personalization'));
    const musicNodes = renderedNodes(createContext(false));
    const settingsBack = settingsBackButton(settingsNodes);
    const musicBack = musicNodes.find(node => node.props?.title === '后退');

    expect(settingsBack).toBeDefined();
    expect(classes(settingsBack).filter(name => name !== 'shrink-0')).toEqual(classes(musicBack));
    expect(classes(settingsBack)).toEqual(expect.arrayContaining([
      'w-8', 'h-8', 'rounded-full', 'bg-white/5', 'border', 'border-black/10', 'dark:border-white/10',
    ]));
    expect(classes(settingsBack)).not.toContain('-ml-5');
  });

  it('does not leak settings titles or the extra brand into the music header', () => {
    const context = createContext(false, true, 'personalization');
    const nodes = renderedNodes(context);
    const root = render(context, []);

    expect(nodes.some(node => node.props?.id === 'settings-page-heading')).toBe(false);
    expect(nodes.some(node => node.type === 'AppBrand')).toBe(false);
    expect(classes(root)).toContain('px-6');
    expect(classes(root)).toContain('h-16');
  });

  it.each([
    { isSettingsRoute: true, isSettingsLayout: false },
    { isSettingsRoute: false, isSettingsLayout: true },
  ])('keeps the outgoing header layout until the route transition commits ($isSettingsRoute / $isSettingsLayout)', ({ isSettingsRoute, isSettingsLayout }) => {
    const context = createContext(isSettingsRoute);
    context.isSettingsLayout = isSettingsLayout;
    const nodes = renderedNodes(context);
    const root = render(context, []);

    expect(nodes.some(node => node.props && 'data-settings-brand' in node.props)).toBe(isSettingsLayout);
    expect(nodes.some(node => node.props?.id === 'settings-page-heading')).toBe(isSettingsLayout);
    expect(settingsBackButton(nodes) !== undefined).toBe(isSettingsLayout);
    expect(nodes.some(node => node.props?.title === '后退')).toBe(!isSettingsLayout);
    expect(classes(root)).toContain(isSettingsLayout ? 'pr-6' : 'px-6');
    expect(classes(root)).not.toContain(isSettingsLayout ? 'px-6' : 'pr-6');
  });

  it('preserves music-page history and song-search actions', () => {
    const context = createContext(false, true);
    context.searchDraft = 'Lycia';
    const nodes = renderedNodes(context);
    const back = nodes.find(node => node.props?.title === '后退');
    const search = nodes.find(node => node.props?.['aria-label'] === '提交搜索');
    const input = nodes.find(node => node.type === 'input');

    expect(input?.props?.placeholder).toBe('搜索歌曲...');
    expect(input?.props?.value).toBe('Lycia');
    expect(settingsBackButton(nodes)).toBeUndefined();
    back!.props!.onClick();
    search!.props!.onClick();
    expect(context.goBack).toHaveBeenCalledOnce();
    expect(context.commitSearch).toHaveBeenCalledWith('Lycia');
    expect(context.handleSettingsBack).not.toHaveBeenCalled();
  });

  it('keeps playlist-library search hidden and its history button available', () => {
    const context = createContext(false);
    context.isPlaylistLibraryRoute = true;
    const nodes = renderedNodes(context);

    expect(nodes.some(node => node.type === 'input')).toBe(false);
    expect(nodes.some(node => node.props?.title === '后退')).toBe(true);
  });

  it.each([false, true])('retains theme, mini-player, taskbar and window controls (settings: %s)', isSettingsRoute => {
    const context = createContext(isSettingsRoute);
    context.settings.showTaskbarPlayerIcon = true;
    const nodes = renderedNodes(context);
    const clickControl = (title: string) => {
      const node = nodes.find(candidate => (
        candidate.type === 'button'
        && candidate.props?.title === title
        && !('data-settings-back' in candidate.props)
      ));
      expect(node).toBeDefined();
      node!.props!.onClick({ stopPropagation: vi.fn() });
    };

    clickControl(isSettingsRoute ? '返回音乐页面' : '设置');
    clickControl('切换深色');
    clickControl('Mini 模式');
    clickControl('任务栏播控');
    clickControl('最小化');
    clickControl('最大化或还原');
    clickControl('关闭');

    expect(context.toggleSettingsPage).toHaveBeenCalledOnce();
    expect(context.toggleThemeMode).toHaveBeenCalledOnce();
    expect(context.isMiniMode).toBe(true);
    expect(context.toggleTaskbarPlayer).toHaveBeenCalledOnce();
    expect(context.minimize).toHaveBeenCalledOnce();
    expect(context.toggleMaximize).toHaveBeenCalledOnce();
    expect(context.closeWindow).toHaveBeenCalledOnce();
    expect(source).toContain('target.closest(TITLE_BAR_CONTROL_SELECTOR)');
  });
});

describe('TitleBar settings back behavior', () => {
  it.each(childPages)('returns from %s internally before the next back leaves settings', async (page) => {
    const bar = setupTitleBar('/favorites?sort=recent#selected');
    await bar.navigate('/settings');
    bar.navigation.openPersonalizationPage(page);

    expect(bar.setup.settingsBackTitle.value).toBe('返回个性化');
    await bar.setup.handleSettingsBack();

    expect(bar.navigation.activeSection).toBe('personalization');
    expect(bar.navigation.personalizationPage).toBeNull();
    expect(bar.navigation.pageTitle).toBe('个性化');
    expect(bar.setup.settingsBackTitle.value).toBe('返回音乐页面');
    expect(bar.router.push).not.toHaveBeenCalled();
    expect(bar.router.back).not.toHaveBeenCalled();

    await bar.setup.handleSettingsBack();

    expect(bar.router.push).toHaveBeenCalledOnce();
    expect(bar.router.push).toHaveBeenCalledWith('/favorites?sort=recent#selected');
    expect(bar.router.back).not.toHaveBeenCalled();
  });

  it.each(rootPages)('leaves the %s root for the remembered music route', async (section) => {
    const bar = setupTitleBar('/albums?sort=artist');
    await bar.navigate('/settings');
    bar.navigation.selectSection(section);

    expect(bar.setup.settingsBackTitle.value).toBe('返回音乐页面');
    await bar.setup.handleSettingsBack();

    expect(bar.router.push).toHaveBeenCalledOnce();
    expect(bar.router.push).toHaveBeenCalledWith('/albums?sort=artist');
    expect(bar.router.back).not.toHaveBeenCalled();
    expect(bar.navigation.activeSection).toBe(section);
  });

  it('falls back to home when settings was the initial route', async () => {
    const bar = setupTitleBar();

    await bar.setup.handleSettingsBack();

    expect(bar.router.push).toHaveBeenCalledWith('/');
    expect(bar.router.back).not.toHaveBeenCalled();
  });

  it('keeps the settings-toggle exit independent of an active personalization child', async () => {
    const bar = setupTitleBar('/artists');
    await bar.navigate('/settings');
    bar.navigation.openPersonalizationPage('theme');

    await bar.setup.toggleSettingsPage();

    expect(bar.router.push).toHaveBeenCalledWith('/artists');
    expect(bar.navigation.personalizationPage).toBe('theme');
  });

  it('keeps the outgoing child title when navigation resets during settings exit', async () => {
    const bar = setupTitleBar();
    bar.navigation.openPersonalizationPage('desktopLyrics');
    await Vue.nextTick();

    expect(bar.setup.settingsPageTitle.value).toBe('桌面歌词');
    await bar.navigate('/favorites');
    bar.navigation.resetNavigation();
    await Vue.nextTick();

    expect(bar.navigation.pageTitle).toBe('常规');
    expect(bar.setup.settingsPageTitle.value).toBe('桌面歌词');

    await bar.navigate('/settings');

    expect(bar.setup.settingsPageTitle.value).toBe('常规');
  });

  it('preserves browser-history back on music pages', () => {
    const bar = setupTitleBar('/recent');

    bar.setup.goBack();

    expect(bar.router.back).toHaveBeenCalledOnce();
    expect(bar.router.push).not.toHaveBeenCalled();
  });
});
