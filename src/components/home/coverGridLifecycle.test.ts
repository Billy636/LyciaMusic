import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { shallowRef, type ShallowRef } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import favoritesSource from '../common/FavoritesGrid.vue?raw';
import artistAlbumsSource from './ArtistAlbumGrid.vue?raw';
import homeContentSource from './HomeContentPanel.vue?raw';
import homeViewSource from './HomeViewPane.vue?raw';
import homeSource from '../../views/Home.vue?raw';
import homeModelSource from '../../composables/useHomePageModel.ts?raw';
import artistAlbumsModelSource from '../../composables/useHomeArtistAlbums.ts?raw';

describe('artist and album grid cover lifecycle', () => {
  it('retains favorite covers only for rendered cards without a custom avatar', () => {
    expect(favoritesSource).toContain('useVisibleCoverUrls(() =>');
    expect(favoritesSource).toContain('virtualGridState.value.items');
    expect(favoritesSource).toContain(".filter(item => item.type !== 'artist' || !item.artist.avatarPath)");
    expect(favoritesSource).toContain('getDisplayedCoverUrl(item.firstSongPath)');
    expect(favoritesSource).not.toContain('coverCache.get(');
    expect(favoritesSource).not.toContain('new IntersectionObserver');
  });

  it('loads and retains artist album covers only within the observed viewport', () => {
    expect(artistAlbumsSource).toContain('useVisibleCoverUrls(visibleCoverPaths)');
    expect(artistAlbumsSource).toContain("rootMargin: '200px 0px'");
    expect(artistAlbumsSource).toContain(':data-cover-path="album.firstSongPath"');
    expect(artistAlbumsSource).toContain('getDisplayedCoverUrl(album.firstSongPath)');
    expect(artistAlbumsSource).toContain('isCoverLoading(album.firstSongPath)');
    expect(artistAlbumsSource).not.toContain('coverCache.get(');
    expect(artistAlbumsSource).not.toContain('loadingSet.has(');
  });

  it('does not preload album covers or pass the shared LRU through inactive home panels', () => {
    expect(artistAlbumsModelSource).not.toContain('preloadCovers');
    for (const source of [homeSource, homeModelSource, homeViewSource, homeContentSource]) {
      expect(source).not.toContain('coverCache');
      expect(source).not.toContain('loadingSet');
    }
  });

  it.each([
    ['FavoritesGrid.vue', favoritesSource],
    ['ArtistAlbumGrid.vue', artistAlbumsSource],
    ['HomeContentPanel.vue', homeContentSource],
    ['HomeViewPane.vue', homeViewSource],
    ['Home.vue', homeSource],
  ])('keeps the %s template valid', (filename, source) => {
    const { descriptor, errors } = parse(source, { filename });
    expect(errors).toEqual([]);
    expect(compileTemplate({
      source: descriptor.template!.content,
      filename,
      id: filename,
    }).errors).toEqual([]);
  });
});

// Run the component's actual setup logic with small lifecycle/DOM doubles.
// This tests viewport ownership without adding a browser test dependency.
const gridScript = compileScript(parse(artistAlbumsSource).descriptor, { id: 'artist-album-grid-test' }).content;
const executableGridScript = transpileModule(gridScript.replace(/^import .*;?$/gm, ''), {
  compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext },
}).outputText.replace('export default', 'return');

const createGridHarness = (paths: string[], withObserver = true) => {
  const props = { albums: paths.map((firstSongPath, index) => ({ key: `album-${index}`, firstSongPath })) };
  let elements = paths.map(coverPath => ({ dataset: { coverPath } }) as unknown as HTMLElement);
  const container = { querySelectorAll: () => elements } as unknown as HTMLElement;
  let mount = () => {};
  let refresh = () => {};
  let unmount = () => {};
  const observers: ObserverDouble[] = [];

  class ObserverDouble {
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(
      private callback: IntersectionObserverCallback,
      readonly options: IntersectionObserverInit,
    ) {
      observers.push(this);
    }
    emit(entries: Array<{ target: HTMLElement; isIntersecting: boolean }>) {
      this.callback(entries as unknown as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
    }
  }

  const bindings = {
    _defineComponent: (component: unknown) => component,
    shallowRef,
    onMounted: (callback: () => void) => { mount = callback; },
    onBeforeUnmount: (callback: () => void) => { unmount = callback; },
    watch: (_source: unknown, callback: () => void) => { refresh = callback; },
    useVisibleCoverUrls: () => ({ getDisplayedCoverUrl: () => '', isCoverLoading: () => false }),
    HomeEmptyState: {},
    IntersectionObserver: withObserver ? ObserverDouble : undefined,
  };
  const component = new Function(...Object.keys(bindings), executableGridScript)(...Object.values(bindings)) as {
    setup: (props: unknown, context: { expose: () => void }) => Record<string, unknown>;
  };
  const instance = component.setup(props, { expose: () => {} });
  (instance.containerRef as ShallowRef<HTMLElement | null>).value = container;
  const visiblePaths = instance.visibleCoverPaths as ShallowRef<string[]>;
  mount();

  return {
    observers,
    container,
    elements,
    visiblePaths,
    refresh: () => refresh(),
    unmount: () => unmount(),
    replaceElements: (nextElements: HTMLElement[]) => {
      elements = nextElements;
      props.albums = nextElements.map((element, index) => ({
        key: `album-${index}`,
        firstSongPath: element.dataset.coverPath ?? '',
      }));
      refresh();
    },
  };
};

describe('artist album cover viewport ownership', () => {
  it('loads intersecting cards, releases exits and reloads re-entry', () => {
    const grid = createGridHarness(['/first.flac', '/second.flac']);
    const observer = grid.observers[0];
    expect(observer.options).toEqual({ root: grid.container, rootMargin: '200px 0px' });
    expect(observer.observe).toHaveBeenCalledTimes(2);
    expect(grid.visiblePaths.value).toEqual([]);

    observer.emit([{ target: grid.elements[0], isIntersecting: true }]);
    expect(grid.visiblePaths.value).toEqual(['/first.flac']);
    observer.emit([{ target: grid.elements[0], isIntersecting: false }]);
    expect(grid.visiblePaths.value).toEqual([]);
    observer.emit([{ target: grid.elements[0], isIntersecting: true }]);
    expect(grid.visiblePaths.value).toEqual(['/first.flac']);
  });

  it('keeps a shared path until every matching card has left', () => {
    const grid = createGridHarness(['/shared.flac', '/shared.flac']);
    const observer = grid.observers[0];
    observer.emit(grid.elements.map(target => ({ target, isIntersecting: true })));
    expect(grid.visiblePaths.value).toEqual(['/shared.flac']);
    observer.emit([{ target: grid.elements[0], isIntersecting: false }]);
    expect(grid.visiblePaths.value).toEqual(['/shared.flac']);
    observer.emit([{ target: grid.elements[1], isIntersecting: false }]);
    expect(grid.visiblePaths.value).toEqual([]);
  });

  it('drops removed and replaced paths and ignores callbacks after refresh or unmount', () => {
    const grid = createGridHarness(['/first.flac', '/second.flac']);
    const observer = grid.observers[0];
    observer.emit(grid.elements.map(target => ({ target, isIntersecting: true })));
    grid.replaceElements([grid.elements[1]]);
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(grid.visiblePaths.value).toEqual(['/second.flac']);
    observer.emit([{ target: grid.elements[0], isIntersecting: true }]);
    expect(grid.visiblePaths.value).toEqual(['/second.flac']);

    grid.elements[1].dataset.coverPath = '/replacement.flac';
    grid.refresh();
    expect(grid.visiblePaths.value).toEqual([]);
    const latestObserver = grid.observers[grid.observers.length - 1];
    latestObserver.emit([{ target: grid.elements[1], isIntersecting: true }]);
    expect(grid.visiblePaths.value).toEqual(['/replacement.flac']);
    grid.unmount();
    expect(latestObserver.disconnect).toHaveBeenCalledOnce();
    latestObserver.emit([{ target: grid.elements[1], isIntersecting: true }]);
    expect(grid.visiblePaths.value).toEqual([]);
  });

  it('falls back to current album paths when IntersectionObserver is unavailable', () => {
    const grid = createGridHarness(['/first.flac', '/second.flac'], false);
    expect(grid.visiblePaths.value).toEqual(['/first.flac', '/second.flac']);
    grid.replaceElements([grid.elements[1]]);
    expect(grid.visiblePaths.value).toEqual(['/second.flac']);
    grid.unmount();
    expect(grid.visiblePaths.value).toEqual([]);
  });
});
