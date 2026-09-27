import { compileScript, compileStyle, compileTemplate, parse } from '@vue/compiler-sfc';
import * as pinia from 'pinia';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import * as vue from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as settingsNavigation from '../features/settings/navigation';
import type { PersonalizationPage } from '../features/settings/navigation';
import settingsSource from './Settings.vue?raw';

const { descriptor, errors } = parse(settingsSource, { filename: 'Settings.vue' });
const compiledSettings = compileScript(descriptor, {
  id: 'settings-navigation-test',
  inlineTemplate: true,
  templateOptions: { compilerOptions: { hoistStatic: false } },
});
const executableSettings = transpileModule(compiledSettings.content, {
  compilerOptions: { target: ScriptTarget.ES2020, module: ModuleKind.CommonJS },
}).outputText;

// Execute the real setup and template while replacing unrelated settings panels.
// The memory renderer keeps these interaction tests independent of a browser DOM.
const panelNames = [
  'SettingsAbout',
  'SettingsDesktopLyrics',
  'SettingsGeneral',
  'SettingsLibrary',
  'SettingsRemoteLibrary',
  'SettingsShortcuts',
  'SettingsSidebar',
  'SettingsTheme',
  'SettingsToolbox',
  'SettingsAudioOutput',
];
const panelModules = Object.fromEntries(panelNames.map(name => [
  `../components/settings/${name}.vue`,
  { default: vue.defineComponent({ render: () => vue.h('div', { 'data-settings-panel': name }) }) },
]));
const icons = Object.fromEntries(['Captions', 'ChevronRight', 'PaintRoller', 'PanelLeft'].map(name => [
  name,
  vue.defineComponent({ render: () => vue.h('svg', { 'data-test-icon': name }) }),
]));

interface TransitionRun {
  name: string;
  phase: 'enter' | 'leave';
  node: MemoryNode;
  finish: () => void;
}

interface TransitionState {
  pending: TransitionRun[];
  observed: TransitionRun[];
}

const transitionStateKey: vue.InjectionKey<TransitionState> = Symbol('settings-transition-test');
// Keep Vue's real keyed out-in lifecycle, but complete animations explicitly so
// these DOM-free tests can distinguish an inserted page from a finished entry.
const MemoryTransition = vue.defineComponent({
  name: 'MemoryTransition',
  inheritAttrs: false,
  props: {
    name: { type: String, default: '' },
    mode: { type: String as vue.PropType<'out-in' | 'in-out' | 'default'>, default: 'default' },
  },
  setup(props, { attrs, slots }) {
    const state = vue.inject(transitionStateKey)!;
    const record = (phase: TransitionRun['phase'], node: MemoryNode, finish: () => void) => {
      const run = { name: props.name, phase, node, finish };
      state.pending.push(run);
      state.observed.push(run);
    };

    return () => vue.h(vue.BaseTransition, {
      ...attrs,
      mode: props.mode,
      onEnter: (node: MemoryNode, done: () => void) => record('enter', node, done),
      onLeave: (node: MemoryNode, done: () => void) => record('leave', node, done),
    }, slots);
  },
});

const modules: Record<string, unknown> = {
  vue: { ...vue, Transition: MemoryTransition },
  pinia,
  'lucide-vue-next': icons,
  '../features/settings/navigation': settingsNavigation,
  ...panelModules,
};
const settingsExports: { default?: vue.Component } = {};
new Function('require', 'exports', executableSettings)((moduleId: string) => {
  if (!(moduleId in modules)) throw new Error(`Unexpected Settings.vue dependency: ${moduleId}`);
  return modules[moduleId];
}, settingsExports);

class MemoryNode {
  parent: MemoryNode | null = null;
  children: MemoryNode[] = [];
  props: Record<string, unknown> = {};
  scrollTop = 0;
  focus = vi.fn();

  constructor(readonly tag: string, public text = '') {
    // Real DOM nodes are not reactive proxies; preserve the same ref identity.
    vue.markRaw(this);
  }

  querySelector(selector: string): MemoryNode | null {
    const match = /^\[([^=]+)="([^"]+)"\]$/.exec(selector);
    if (!match) throw new Error(`Unsupported test selector: ${selector}`);
    return findAll(this, node => node.props[match[1]] === match[2])[0] ?? null;
  }
}

function findAll(root: MemoryNode, predicate: (node: MemoryNode) => boolean): MemoryNode[] {
  return root.children.flatMap(child => [
    ...(predicate(child) ? [child] : []),
    ...findAll(child, predicate),
  ]);
}

function textContent(node: MemoryNode): string {
  if (node.tag === '#comment') return '';
  return node.text + node.children.map(textContent).join('');
}

function classNames(node: MemoryNode): string[] {
  return String(node.props.class ?? '').split(/\s+/).filter(Boolean);
}

function removeNode(node: MemoryNode) {
  if (!node.parent) return;
  const index = node.parent.children.indexOf(node);
  if (index !== -1) node.parent.children.splice(index, 1);
  node.parent = null;
}

const renderer = vue.createRenderer<MemoryNode, MemoryNode>({
  createElement: tag => new MemoryNode(tag),
  createText: text => new MemoryNode('#text', text),
  createComment: text => new MemoryNode('#comment', text),
  setText: (node, text) => { node.text = text; },
  setElementText: (node, text) => {
    node.children.forEach(child => { child.parent = null; });
    node.children = [];
    node.text = text;
  },
  parentNode: node => node.parent,
  nextSibling: node => {
    if (!node.parent) return null;
    return node.parent.children[node.parent.children.indexOf(node) + 1] ?? null;
  },
  insert: (node, parent, anchor = null) => {
    removeNode(node);
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index === -1) parent.children.push(node);
    else parent.children.splice(index, 0, node);
    node.parent = parent;
  },
  remove: removeNode,
  patchProp: (node, key, _previous, value) => {
    if (value == null) delete node.props[key];
    else node.props[key] = value;
  },
});

const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach(dispose => dispose());
});

function mountSettings(previousPage?: PersonalizationPage) {
  const instance = pinia.createPinia();
  const navigation = settingsNavigation.useSettingsNavigationStore(instance);
  if (previousPage) navigation.openPersonalizationPage(previousPage);
  const root = new MemoryNode('root');
  const transitions: TransitionState = { pending: [], observed: [] };
  const app = renderer.createApp(settingsExports.default!);
  app.use(instance);
  app.provide(transitionStateKey, transitions);
  app.mount(root);
  let isMounted = true;
  const unmount = () => {
    if (!isMounted) return;
    app.unmount();
    isMounted = false;
  };
  cleanup.push(() => {
    unmount();
    pinia.disposePinia(instance);
  });

  const nodes = (attribute: string) => findAll(root, node => attribute in node.props);
  const find = (attribute: string, value: string) => {
    const node = findAll(root, node => node.props[attribute] === value)[0];
    if (!node) throw new Error(`Missing rendered element: ${attribute}=${value}`);
    return node;
  };
  const finishNextTransition = async (phase: TransitionRun['phase']) => {
    const run = transitions.pending.shift();
    expect(run?.phase).toBe(phase);
    run!.finish();
    await vue.nextTick();
    return run!;
  };
  const finishTransitions = async () => {
    let completed = 0;
    while (transitions.pending.length > 0) {
      if (++completed > 12) throw new Error('Settings transition did not settle');
      await finishNextTransition(transitions.pending[0].phase);
    }
  };
  const click = async (attribute: string, value: string, finishAnimation = true) => {
    const handler = find(attribute, value).props.onClick;
    expect(handler).toBeTypeOf('function');
    (handler as () => void)();
    await vue.nextTick();
    if (finishAnimation) await finishTransitions();
  };

  return {
    root,
    navigation,
    unmount,
    nodes,
    find,
    click,
    transitions,
    finishNextTransition,
    finishTransitions,
    panels: () => nodes('data-settings-panel').map(node => node.props['data-settings-panel']),
  };
}

const personalizationCases = [
  { page: 'theme', title: '外观', panel: 'SettingsTheme' },
  { page: 'sidebar', title: '侧边栏管理', panel: 'SettingsSidebar' },
  { page: 'desktopLyrics', title: '桌面歌词', panel: 'SettingsDesktopLyrics' },
] satisfies Array<{ page: PersonalizationPage; title: string; panel: string }>;

describe('settings personalization navigation', () => {
  it('keeps the settings script, template and transition styles valid', () => {
    expect(errors).toEqual([]);
    expect(compileTemplate({
      source: descriptor.template!.content,
      filename: 'Settings.vue',
      id: 'settings-template-test',
    }).errors).toEqual([]);
    for (const style of descriptor.styles) {
      expect(compileStyle({
        source: style.content,
        filename: 'Settings.vue',
        id: 'settings-style-test',
        scoped: style.scoped,
      }).errors).toEqual([]);
    }
  });

  it('consolidates the sidebar into eight entries with one personalization section', () => {
    const settings = mountSettings();
    const sidebar = settings.nodes('data-settings-section');

    expect(sidebar.map(node => node.props['data-settings-section'])).toEqual([
      'general', 'personalization', 'audioOutput', 'toolbox', 'library', 'remoteLibrary', 'shortcuts', 'about',
    ]);
    expect(sidebar.map(node => textContent(node).trim())).toEqual([
      '常规', '个性化', '音频输出', '工具箱', '本地音乐库', '远程音乐库', '快捷键', '关于',
    ]);
    expect(settings.find('data-settings-section', 'general').props['aria-current']).toBe('page');
    expect(settings.panels()).toEqual(['SettingsGeneral']);
  });

  it('shows exactly three clickable rows in the personalization overview', async () => {
    const settings = mountSettings();

    await settings.click('data-settings-section', 'personalization');

    const entries = settings.nodes('data-personalization-page');
    expect(entries.map(node => node.props['data-personalization-page'])).toEqual(['theme', 'sidebar', 'desktopLyrics']);
    expect(entries.map(node => textContent(node).trim())).toEqual(['外观', '侧边栏管理', '桌面歌词']);
    expect(entries.every(node => node.tag === 'button' && node.props.type === 'button')).toBe(true);
    expect(settings.find('aria-label', '个性化').props.tabindex).toBe('-1');
    expect(settings.find('aria-labelledby', 'settings-page-heading').tag).toBe('section');
    expect(findAll(settings.root, node => node.tag === 'h1')).toEqual([]);
    expect(settings.nodes('id').some(node => node.props.id === 'settings-page-heading')).toBe(false);
    expect(settings.panels()).toEqual([]);
    expect(settings.navigation.canGoBack).toBe(false);
  });

  it('uses the shared music-sidebar width and a constant content inset at every breakpoint', () => {
    const settings = mountSettings();
    const aside = findAll(settings.root, node => node.tag === 'aside')[0];
    const main = findAll(settings.root, node => node.tag === 'main')[0];

    expect(aside.props.style).toEqual({ width: 'var(--app-sidebar-width)' });
    expect(classNames(aside)).toContain('shrink-0');
    expect(classNames(aside).some(name => /^(?:(?:sm|md|lg|xl|2xl):)?w-/.test(name))).toBe(false);
    expect(classNames(main).filter(name => /^(?:(?:sm|md|lg|xl|2xl):)?px-/.test(name))).toEqual(['px-6']);
  });

  it('uses unframed plain rows with interaction feedback and less top spacing', async () => {
    const settings = mountSettings();
    await settings.click('data-settings-section', 'personalization');
    const list = findAll(settings.root, node => classNames(node).includes('personalization-list'))[0];
    const rows = settings.nodes('data-personalization-page');
    const restingSurfaceClass = /^(?:dark:)?(?:border(?:-|$)|bg-|shadow(?:-|$))/;

    expect(list).toBeDefined();
    expect(classNames(list).some(name => restingSurfaceClass.test(name) || name.startsWith('rounded'))).toBe(false);
    for (const row of rows) {
      expect(classNames(row).some(name => restingSurfaceClass.test(name))).toBe(false);
      expect(classNames(row).some(name => name.startsWith('hover:bg-'))).toBe(true);
      expect(classNames(row)).toContain('focus-visible:ring-2');
    }
    const main = findAll(settings.root, node => node.tag === 'main')[0];
    expect(classNames(main)).toContain('sm:py-4');
    expect(classNames(main)).not.toContain('sm:py-10');

    await settings.click('data-settings-section', 'audioOutput');
    expect(classNames(main)).toContain('sm:py-10');
  });

  it.each(personalizationCases)('opens only $title in the right pane and returns to its entry', async ({ page, title, panel }) => {
    const settings = mountSettings();
    await settings.click('data-settings-section', 'personalization');
    const sidebar = settings.nodes('data-settings-section');
    const main = findAll(settings.root, node => node.tag === 'main')[0];
    main.scrollTop = 480;

    const overview = settings.find('aria-label', '个性化');
    await settings.click('data-personalization-page', page, false);

    expect(settings.transitions.pending.map(run => [run.phase, run.name])).toEqual([
      ['leave', 'personalization-forward'],
    ]);
    expect(settings.nodes('data-personalization-page')).toHaveLength(3);
    expect(settings.panels()).toEqual([]);
    expect(main.scrollTop).toBe(480);

    await settings.finishNextTransition('leave');

    expect(settings.panels()).toEqual([panel]);
    expect(settings.nodes('data-personalization-page')).toEqual([]);
    expect(settings.nodes('data-settings-section')).toEqual(sidebar);
    expect(settings.find('data-settings-section', 'personalization').props['aria-current']).toBe('page');
    const content = settings.find('aria-label', title);
    expect(content).not.toBe(overview);
    expect(content.props.tabindex).toBe('-1');
    expect(content.focus).not.toHaveBeenCalled();
    expect(main.scrollTop).toBe(0);
    expect(settings.navigation.canGoBack).toBe(true);

    await settings.finishNextTransition('enter');
    expect(content.focus).toHaveBeenCalledWith({ preventScroll: true });

    main.scrollTop = 360;
    settings.navigation.backToPersonalization();
    await vue.nextTick();

    expect(settings.transitions.pending.map(run => [run.phase, run.name])).toEqual([
      ['leave', 'personalization-back'],
    ]);
    expect(settings.panels()).toEqual([panel]);
    expect(main.scrollTop).toBe(360);
    await settings.finishNextTransition('leave');

    expect(settings.panels()).toEqual([]);
    expect(settings.nodes('data-personalization-page')).toHaveLength(3);
    expect(settings.find('aria-label', '个性化')).not.toBe(overview);
    expect(settings.find('data-personalization-page', page).focus).not.toHaveBeenCalled();
    await settings.finishNextTransition('enter');
    expect(settings.find('data-personalization-page', page).focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(main.scrollTop).toBe(0);
    expect(settings.navigation.canGoBack).toBe(false);
  });

  it('provides opposite fade-slide directions and disables motion when requested', () => {
    const styles = descriptor.styles.map(style => style.content).join('\n');
    expect(styles).toMatch(/\.personalization-forward-enter-from,\s*\.personalization-back-leave-to\s*\{[^}]*opacity:\s*0;[^}]*transform:\s*translateX\(14px\)/);
    expect(styles).toMatch(/\.personalization-forward-leave-to,\s*\.personalization-back-enter-from\s*\{[^}]*opacity:\s*0;[^}]*transform:\s*translateX\(-14px\)/);
    expect(styles).toMatch(/\.personalization-forward-leave-active,\s*\.personalization-back-leave-active\s*\{[^}]*pointer-events:\s*none;/);
    const reducedMotion = styles.slice(styles.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reducedMotion).toContain('@media (prefers-reduced-motion: reduce)');
    expect(reducedMotion).toMatch(/\.personalization-forward-enter-active,[^}]*\.personalization-back-leave-active\s*\{\s*transition:\s*none;/);
    expect(reducedMotion).toMatch(/\.personalization-forward-enter-from,[^}]*\.personalization-back-leave-to\s*\{\s*transform:\s*none;/);
  });

  it.each(['leave', 'enter'] as const)('handles an immediate return during the forward %s animation', async phase => {
    const settings = mountSettings();
    await settings.click('data-settings-section', 'personalization');
    await settings.click('data-personalization-page', 'theme', false);
    if (phase === 'enter') await settings.finishNextTransition('leave');
    const leavingContent = settings.transitions.pending[0].node;

    settings.navigation.backToPersonalization();
    await vue.nextTick();
    await settings.finishTransitions();

    expect(settings.panels()).toEqual([]);
    expect(settings.nodes('data-personalization-page')).toHaveLength(3);
    expect(settings.navigation.canGoBack).toBe(false);
    expect(leavingContent.focus).not.toHaveBeenCalled();
    expect(settings.find('data-personalization-page', 'theme').focus).toHaveBeenCalledWith({ preventScroll: true });

    await settings.click('data-personalization-page', 'sidebar');
    expect(settings.panels()).toEqual(['SettingsSidebar']);
    expect(settings.find('aria-label', '侧边栏管理').focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it.each(['leave', 'enter'] as const)('does not focus a stale page when switching sections during %s', async phase => {
    const settings = mountSettings();
    await settings.click('data-settings-section', 'personalization');
    await settings.click('data-personalization-page', 'theme', false);
    if (phase === 'enter') await settings.finishNextTransition('leave');
    const outgoingContent = settings.transitions.pending[0].node;

    await settings.click('data-settings-section', 'audioOutput');

    expect(settings.panels()).toEqual(['SettingsAudioOutput']);
    expect(settings.navigation.canGoBack).toBe(false);
    expect(outgoingContent.focus).not.toHaveBeenCalled();

    await settings.click('data-settings-section', 'personalization');
    expect(settings.nodes('data-personalization-page')).toHaveLength(3);
    expect(settings.find('aria-label', '个性化').focus).not.toHaveBeenCalled();
    expect(settings.nodes('data-personalization-page').every(node => node.focus.mock.calls.length === 0)).toBe(true);
  });

  it.each(['leave', 'enter'] as const)('keeps focus in sidebar navigation when returning during %s', async phase => {
    const settings = mountSettings();
    await settings.click('data-settings-section', 'personalization');
    await settings.click('data-personalization-page', 'theme', false);
    if (phase === 'enter') await settings.finishNextTransition('leave');
    const outgoingContent = settings.transitions.pending[0].node;

    await settings.click('data-settings-section', 'personalization');

    expect(settings.panels()).toEqual([]);
    expect(settings.nodes('data-personalization-page')).toHaveLength(3);
    expect(settings.navigation.canGoBack).toBe(false);
    expect(outgoingContent.focus).not.toHaveBeenCalled();
    expect(settings.find('aria-label', '个性化').focus).not.toHaveBeenCalled();
    expect(settings.nodes('data-personalization-page').every(node => node.focus.mock.calls.length === 0)).toBe(true);
  });

  it('returns to the overview when the selected personalization sidebar entry is clicked again', async () => {
    const settings = mountSettings();
    await settings.click('data-settings-section', 'personalization');
    await settings.click('data-personalization-page', 'sidebar');

    await settings.click('data-settings-section', 'personalization');

    expect(settings.panels()).toEqual([]);
    expect(settings.nodes('data-personalization-page')).toHaveLength(3);
    expect(settings.navigation.personalizationPage).toBeNull();
    expect(settings.navigation.canGoBack).toBe(false);
    expect(settings.nodes('data-personalization-page').every(node => node.focus.mock.calls.length === 0)).toBe(true);
  });

  it('clears a subpage when switching sections and does not reopen it on return', async () => {
    const settings = mountSettings();
    await settings.click('data-settings-section', 'personalization');
    await settings.click('data-personalization-page', 'desktopLyrics');

    await settings.click('data-settings-section', 'audioOutput');

    expect(settings.panels()).toEqual(['SettingsAudioOutput']);
    expect(settings.navigation.personalizationPage).toBeNull();
    expect(settings.navigation.canGoBack).toBe(false);
    expect(settings.find('data-settings-section', 'audioOutput').props['aria-current']).toBe('page');

    await settings.click('data-settings-section', 'personalization');

    expect(settings.panels()).toEqual([]);
    expect(settings.nodes('data-personalization-page')).toHaveLength(3);
  });

  it('starts each visit at general settings and clears navigation on unmount', async () => {
    const settings = mountSettings('theme');

    expect(settings.navigation.activeSection).toBe('general');
    expect(settings.navigation.personalizationPage).toBeNull();
    expect(settings.panels()).toEqual(['SettingsGeneral']);

    await settings.click('data-settings-section', 'personalization');
    await settings.click('data-personalization-page', 'theme');
    settings.unmount();

    expect(settings.navigation.activeSection).toBe('general');
    expect(settings.navigation.personalizationPage).toBeNull();
    expect(settings.navigation.canGoBack).toBe(false);
  });
});
