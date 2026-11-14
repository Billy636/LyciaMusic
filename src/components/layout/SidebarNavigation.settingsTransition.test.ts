import { compileScript, parse } from '@vue/compiler-sfc';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Vue from 'vue';
import type { VNode } from 'vue';

import { useSidebarNavigationPath } from '../../composables/useSidebarNavigationPath';
import source from './SidebarNavigation.vue?raw';

const { descriptor, errors } = parse(source, { filename: 'SidebarNavigation.vue' });
const compiled = compileScript(descriptor, {
  id: 'sidebar-settings-transition-test',
  inlineTemplate: true,
  templateOptions: { compilerOptions: { hoistStatic: false } },
});
const executable = transpileModule(compiled.content, {
  compilerOptions: { target: ScriptTarget.ES2020, module: ModuleKind.CommonJS },
}).outputText;
type Render = (context: { $emit: ReturnType<typeof vi.fn> }, cache: unknown[]) => VNode;
const exports: { default?: { setup: (props: object, context: { expose: () => void }) => Render } } = {};
new Function('require', 'exports', executable)((moduleId: string) => {
  if (moduleId !== 'vue') throw new Error(`Unexpected SidebarNavigation.vue dependency: ${moduleId}`);
  return Vue;
}, exports);

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach(dispose => dispose()));

function textContent(node: VNode): string {
  if (typeof node.children === 'string') return node.children;
  return Array.isArray(node.children)
    ? node.children.filter(Vue.isVNode).map(textContent).join('')
    : '';
}

function items(root: VNode): VNode[] {
  const nodes: VNode[] = [];
  const visit = (node: unknown) => {
    if (!Vue.isVNode(node)) return;
    if (node.type === 'li') nodes.push(node);
    if (Array.isArray(node.children)) node.children.forEach(visit);
  };
  visit(root);
  return nodes;
}

const classes = (node: VNode) => String(node.props?.class ?? '').split(/\s+/);

function createNavigation(initialPath: string) {
  const routePath = Vue.ref(initialPath);
  const scope = Vue.effectScope();
  const currentPath = scope.run(() => useSidebarNavigationPath(() => routePath.value))!;
  cleanup.push(() => scope.stop());
  const props = Vue.reactive({
    sidebar: {
      showLocalMusic: true,
      showArtists: true,
      showAlbums: true,
      showFavorites: true,
      showRecent: true,
      showFolders: true,
      showStatistics: true,
    },
    currentViewMode: 'all',
    currentPath: currentPath.value,
    isDragActive: false,
  });
  const render = exports.default!.setup(props, { expose: () => {} });
  const context = { $emit: vi.fn() };
  const tree = () => {
    props.currentPath = currentPath.value;
    return render(context, []);
  };
  const item = (label: string) => {
    const node = items(tree()).find(candidate => textContent(candidate).trim() === label);
    if (!node) throw new Error(`Missing sidebar item: ${label}`);
    return node;
  };
  const navigate = async (path: string) => {
    routePath.value = path;
    await Vue.nextTick();
  };
  return { tree, item, navigate };
}

describe('sidebar selection during settings transitions', () => {
  it('compiles the real navigation script and template', () => {
    expect(errors).toEqual([]);
  });

  it.each([
    ['/', '本地音乐'],
    ['/artists', '歌手'],
    ['/favorites', '我的收藏'],
    ['/playlists', '歌单'],
  ])('preserves the %s selection, font weight and position throughout settings entry', async (path, label) => {
    const navigation = createNavigation(path);
    const before = navigation.item(label);
    expect(classes(before)).toEqual(expect.arrayContaining(['font-semibold', 'translate-x-1', 'shadow-sm']));

    for (const settingsPath of ['/settings', '/settings/theme']) {
      await navigation.navigate(settingsPath);

      expect(navigation.item(label).props?.class).toBe(before.props?.class);
      expect(items(navigation.tree()).filter(node => classes(node).includes('font-semibold')).map(textContent)).toEqual([label]);
    }

    await navigation.navigate('/albums');

    expect(classes(navigation.item(label))).not.toContain('font-semibold');
    expect(classes(navigation.item(label))).not.toContain('translate-x-1');
    expect(classes(navigation.item('专辑'))).toEqual(expect.arrayContaining(['font-semibold', 'translate-x-1']));
  });

  it('limits navigation transitions to visual properties without animating text metrics', () => {
    const navigation = createNavigation('/');
    const root = navigation.tree();

    expect(classes(root)).toContain('transition-[opacity,filter]');
    expect(classes(root)).not.toContain('transition-all');
    for (const node of items(root)) {
      expect(classes(node)).toContain('transition-[color,background-color,box-shadow,translate,scale]');
      expect(classes(node)).toContain('duration-100');
      expect(classes(node)).not.toContain('transition-all');
      expect(classes(node).some(name => /^transition-\[[^\]]*(?:font-weight|width|all)/.test(name))).toBe(false);
    }
  });

  it('retains press-only scale feedback without shrinking idle or selected items', () => {
    const navigation = createNavigation('/artists');

    for (const node of items(navigation.tree())) {
      expect(classes(node)).toContain('active:scale-[0.97]');
      expect(classes(node).some(name => /^scale-/.test(name))).toBe(false);
    }
    navigation.item('本地音乐').props!.onMouseenter();

    expect(classes(navigation.item('本地音乐'))).toContain('translate-x-1');
    expect(classes(navigation.item('本地音乐')).some(name => /^scale-/.test(name))).toBe(false);
  });
});
