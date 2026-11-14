import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Vue from 'vue';
import type { VNode } from 'vue';

import * as progress from './playerFooterProgress';
import source from './PlayerFooter.vue?raw';

const { descriptor } = parse(source);
const template = compileTemplate({
  source: descriptor.template!.content,
  filename: 'PlayerFooter.vue',
  id: 'footer-song-info-click',
  compilerOptions: { mode: 'function' },
});
const render = new Function('Vue', template.code)({
  ...Vue,
  resolveComponent: (name: string) => name,
}) as (context: Record<string, unknown>, cache: unknown[]) => VNode;
const script = transpileModule(compileScript(descriptor, { id: 'footer-song-info-click' }).content, {
  compilerOptions: { target: ScriptTarget.ES2020, module: ModuleKind.CommonJS },
}).outputText;
const classes = (node: VNode) => String(node.props?.class ?? '').split(/\s+/);
const hasAttribute = (name: string) => (node: VNode) => name in (node.props ?? {});

// A node-only Element stand-in: closest follows the actual rendered VNode ancestry,
// including SVG descendants, rather than returning a preselected test answer.
class TestElement {
  constructor(readonly node: VNode, readonly parent?: TestElement) {}

  closest(selector: string): TestElement | null {
    if (selector.split(',').some(part => {
      const token = part.trim();
      return token.startsWith('[')
        ? token.slice(1, -1) in (this.node.props ?? {})
        : this.node.type === token;
    })) return this;
    return this.parent?.closest(selector) ?? null;
  }

  contains(target: TestElement): boolean {
    for (let element: TestElement | undefined = target; element; element = element.parent) {
      if (element === this) return true;
    }
    return false;
  }

  getBoundingClientRect() {
    return { left: 0, width: 300, bottom: 100, height: 100 };
  }
}

const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach(dispose => dispose());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function setupFooter(withSong = true, expanded = false) {
  vi.useFakeTimers();
  vi.stubGlobal('Element', TestElement);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  vi.stubGlobal('window', {
    addEventListener: (name: string, listener: (event: unknown) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
    },
    removeEventListener: (name: string, listener: (event: unknown) => void) => listeners.get(name)?.delete(listener),
  });
  const song = { path: 'demo.flac', name: 'demo.flac', title: 'Demo title', artist: 'Demo artist', duration: 180 };
  const currentSong = Vue.ref(withSong ? song : null);
  const showPlayerDetail = Vue.ref(expanded);
  const togglePlayerDetail = vi.fn(() => { showPlayerDetail.value = !showPlayerDetail.value; });
  const controller = {
    currentSong, showPlayerDetail, togglePlayerDetail,
    isPlaying: Vue.ref(false), volume: Vue.ref(50), currentTime: Vue.ref(30),
    playMode: Vue.ref(0), showPlaylist: Vue.ref(false),
    togglePlay: vi.fn(), nextSong: vi.fn(), prevSong: vi.fn(),
    handleVolume: vi.fn(), handleVolumeWheel: vi.fn(), toggleMute: vi.fn(),
    toggleMode: vi.fn(), togglePlaylist: vi.fn(), seekTo: vi.fn().mockResolvedValue(undefined),
    formatDuration: (value: number) => String(value),
  };
  const toggleFavorite = vi.fn();
  const mounted: Array<() => unknown> = [];
  const unmounted: Array<() => void> = [];
  const modules: Record<string, unknown> = {
    vue: { ...Vue, onMounted: (callback: () => unknown) => mounted.push(callback), onUnmounted: (callback: () => void) => unmounted.push(callback) },
    'lucide-vue-next': { AudioLines: 'AudioLines', Eye: 'Eye', EyeOff: 'EyeOff', SlidersHorizontal: 'SlidersHorizontal' },
    '@tauri-apps/api/event': { listen: vi.fn().mockResolvedValue(vi.fn()) },
    '../../features/playback/usePlaybackController': { usePlaybackController: () => controller },
    '../../features/collections/useLibraryCollections': { useLibraryCollections: () => ({ isFavorite: () => false, toggleFavorite }) },
    '../../composables/lyrics': { useLyrics: () => ({ showDesktopLyrics: Vue.ref(false), showLyricsPlayerSettingsPanel: Vue.ref(false) }) },
    '../../features/settings/useSettings': { useSettings: () => ({ settings: Vue.ref({ audio: { showEqualizerInFooter: true } }) }) },
    '../../features/highlights/useSongHighlights': { useSongHighlights: () => ({ addMarker: vi.fn(), formatMarkerTime: String, errorMessage: String }) },
    '../../composables/toast': { useToast: () => ({ showToast: vi.fn() }) },
    './playerFooterProgress': progress,
    '../player/AudioVisualizer.vue': { default: 'AudioVisualizer' },
    '../player/SongHighlightMarkers.vue': { default: 'SongHighlightMarkers' },
    '../player/EqualizerPanel.vue': { default: 'EqualizerPanel' },
    '../overlays/FooterContextMenu.vue': { default: 'FooterContextMenu' },
  };
  const exports: { default?: { setup: (props: object, context: { expose: () => void }) => Record<string, any> } } = {};
  new Function('require', 'exports', script)((name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected PlayerFooter dependency: ${name}`);
    return modules[name];
  }, exports);
  const scope = Vue.effectScope();
  const setup = scope.run(() => exports.default!.setup({}, { expose: () => {} }))!;
  cleanup.push(() => { unmounted.forEach(dispose => dispose()); scope.stop(); });
  for (const callback of mounted) await callback();
  const windowClick = vi.fn();
  window.addEventListener('click', windowClick);

  const tree = () => {
    const root = render(Vue.proxyRefs(setup), []);
    const nodes: VNode[] = [];
    const elements = new Map<VNode, TestElement>();
    const visit = (node: unknown, parent?: TestElement) => {
      if (!Vue.isVNode(node)) return;
      const element = new TestElement(node, parent);
      nodes.push(node);
      elements.set(node, element);
      if (Array.isArray(node.children)) node.children.forEach(child => visit(child, element));
    };
    visit(root);
    const find = (predicate: (node: VNode) => boolean) => {
      const node = nodes.find(predicate);
      expect(node).toBeDefined();
      return node!;
    };
    const dispatch = (node: VNode, name = 'click') => {
      let stopped = false;
      const event = {
        target: elements.get(node)!, currentTarget: elements.get(node)!,
        button: 0, pointerType: 'mouse', pointerId: 1, clientX: 150, clientY: 25,
        preventDefault: vi.fn(), stopPropagation: vi.fn(() => { stopped = true; }),
      };
      const handlerName = `on${name[0]!.toUpperCase()}${name.slice(1)}`;
      for (let element: TestElement | undefined = event.target; element; element = element.parent) {
        event.currentTarget = element;
        element.node.props?.[handlerName]?.(event);
        if (stopped) break;
      }
      if (!stopped) listeners.get(name)?.forEach(listener => listener(event));
      return event;
    };
    return { root, nodes, elements, find, dispatch };
  };
  return { setup, controller, toggleFavorite, windowClick, tree };
}

describe('PlayerFooter left song-info entry', () => {
  it.each(['container', 'nested blank', 'title', 'artist'])('opens detail once from the %s and preserves window click handling', async target => {
    const footer = await setupFooter();
    const tree = footer.tree();
    const node = tree.find(target === 'container' ? hasAttribute('data-player-song-info')
      : target === 'nested blank' ? node => classes(node).includes('ml-3')
        : node => typeof node.children === 'string' && node.children.trim() === (target === 'title' ? 'Demo title' : 'Demo artist'));
    footer.setup.showProgressContextMenu.value = true;
    footer.setup.showEqPanel.value = true;
    footer.setup.eqPanelRef.value = { contains: () => false };
    footer.setup.eqButtonRef.value = { contains: () => false };

    const event = tree.dispatch(node);

    expect(footer.controller.showPlayerDetail.value).toBe(true);
    expect(footer.controller.togglePlayerDetail).toHaveBeenCalledOnce();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(footer.windowClick).toHaveBeenCalledOnce();
    expect(footer.setup.showProgressContextMenu.value).toBe(false);
    expect(footer.setup.showEqPanel.value).toBe(false);
  });

  it.each([[false, false], [true, true]])('does nothing with song=%s and expanded=%s', async (withSong, expanded) => {
    const footer = await setupFooter(withSong, expanded);
    const tree = footer.tree();
    tree.dispatch(tree.find(hasAttribute('data-player-song-info')));

    expect(footer.controller.togglePlayerDetail).not.toHaveBeenCalled();
    expect(footer.controller.showPlayerDetail.value).toBe(expanded);
    expect(footer.windowClick).toHaveBeenCalledOnce();
  });

  it.each([false, true])('preserves exactly one cover toggle from expanded=%s', async expanded => {
    const footer = await setupFooter(true, expanded);
    const tree = footer.tree();
    const event = tree.dispatch(tree.find(hasAttribute('data-footer-cover')));

    expect(footer.controller.togglePlayerDetail).toHaveBeenCalledOnce();
    expect(footer.controller.showPlayerDetail.value).toBe(!expanded);
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(footer.windowClick).toHaveBeenCalledOnce();
  });

  it('keeps a favorite SVG click out of detail navigation without blocking global dismissal', async () => {
    const footer = await setupFooter();
    const tree = footer.tree();
    const iconPath = tree.find(node => node.type === 'path'
      && tree.elements.get(node)!.closest('button')?.node.props?.title === '添加到收藏');
    footer.setup.showProgressContextMenu.value = true;

    const event = tree.dispatch(iconPath);

    expect(footer.toggleFavorite).toHaveBeenCalledExactlyOnceWith(footer.controller.currentSong.value);
    expect(footer.controller.togglePlayerDetail).not.toHaveBeenCalled();
    expect(footer.controller.showPlayerDetail.value).toBe(false);
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(footer.windowClick).toHaveBeenCalledOnce();
    expect(footer.setup.showProgressContextMenu.value).toBe(false);
  });

  it.each([[true, false, 'cursor-pointer'], [false, false, 'cursor-default'], [true, true, 'cursor-default']] as const)(
    'limits the full-height left cursor to song=%s, expanded=%s', async (withSong, expanded, cursor) => {
      const footer = await setupFooter(withSong, expanded);
      const tree = footer.tree();
      const left = tree.find(hasAttribute('data-player-song-info'));

      expect(template.errors).toEqual([]);
      expect(classes(left)).toEqual(expect.arrayContaining(['h-full', 'flex-1', 'min-w-[200px]', cursor]));
      expect(left.props?.onClick).toBeTypeOf('function');
      if (withSong && !expanded) {
        for (const text of ['Demo title', 'Demo artist']) {
          const label = tree.find(node => typeof node.children === 'string' && node.children.trim() === text);
          expect(classes(label)).not.toContain('cursor-default');
        }
      }
    },
  );

  it('does not make footer, middle or right blanks into detail entry points', async () => {
    const footer = await setupFooter();
    const tree = footer.tree();
    const middle = tree.find(node => classes(node).includes('gap-6'));
    const right = tree.find(node => classes(node).includes('min-w-[150px]'));

    for (const node of [tree.root, middle, right]) {
      expect(node.props?.onClick).toBeUndefined();
      expect(node.props?.onClickCapture).toBeUndefined();
      tree.dispatch(node);
    }
    expect(footer.controller.togglePlayerDetail).not.toHaveBeenCalled();
    const buttons = tree.nodes.filter(node => node.type === 'button' && tree.elements.get(node)!.parent?.node === middle);
    const actions = ['toggleMode', 'prevSong', 'togglePlay', 'nextSong', 'togglePlaylist'] as const;
    expect(buttons).toHaveLength(actions.length);
    for (const [index, action] of actions.entries()) {
      tree.dispatch(buttons[index]!);
      expect(footer.controller[action]).toHaveBeenCalledOnce();
    }
    tree.dispatch(tree.find(node => node.props?.title === '音量'));
    expect(footer.controller.toggleMute).toHaveBeenCalledOnce();
    expect(footer.controller.togglePlayerDetail).not.toHaveBeenCalled();
  });

  it.each([false, true])('extends the left hit area to centered controls without giving the middle spare width (expanded=%s)', async expanded => {
    const footer = await setupFooter(true, expanded);
    const tree = footer.tree();
    const left = tree.find(hasAttribute('data-player-song-info'));
    const middle = tree.find(node => classes(node).includes('gap-6'));
    const right = tree.find(node => classes(node).includes('min-w-[150px]'));

    for (const side of [left, right]) {
      expect(classes(side)).toContain('flex-1');
      expect(classes(side)).toContain('pr-2');
      expect(classes(side)).not.toContain('w-1/3');
      expect(tree.elements.get(side)!.parent?.node).toBe(tree.root);
    }
    expect(classes(middle)).toEqual(expect.arrayContaining(['shrink-0', 'gap-6']));
    expect(classes(middle)).not.toContain('flex-1');
    expect(tree.elements.get(middle)!.parent?.node).toBe(tree.root);
  });

  it('retains progress and volume pointer operations outside the left entry', async () => {
    const footer = await setupFooter();
    footer.setup.showVolumeSlider.value = true;
    const tree = footer.tree();
    const progressBar = tree.find(hasAttribute('data-player-progress'));
    const volumeBar = tree.find(node => node.props?.ref === 'volumeBarRef');
    footer.setup.progressBarRef.value = tree.elements.get(progressBar);
    footer.setup.volumeBarRef.value = tree.elements.get(volumeBar);

    for (const node of [progressBar, volumeBar]) {
      expect(tree.elements.get(node)!.closest('[data-player-song-info]')).toBeNull();
      tree.dispatch(node, 'pointerdown');
      tree.dispatch(node, 'pointerup');
      tree.dispatch(node);
    }

    expect(footer.controller.seekTo).toHaveBeenCalledExactlyOnceWith(90);
    expect(footer.controller.handleVolume).toHaveBeenCalledExactlyOnceWith({ target: { value: '75' } });
    expect(footer.controller.togglePlayerDetail).not.toHaveBeenCalled();
    expect(footer.setup.isDraggingProgress.value).toBe(false);
    expect(footer.setup.isDraggingVolume.value).toBe(false);
  });
});
