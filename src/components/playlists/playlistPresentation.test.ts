import { compileStyle, compileTemplate, parse } from '@vue/compiler-sfc';
import { describe, expect, it } from 'vitest';
import pageSource from '../../views/Playlists.vue?raw';
import coverSource from './PlaylistCover.vue?raw';
import menuSource from './PlaylistActionsMenu.vue?raw';

describe('playlist presentation', () => {
  it.each([
    ['Playlists.vue', pageSource],
    ['PlaylistCover.vue', coverSource],
    ['PlaylistActionsMenu.vue', menuSource],
  ])('compiles the %s template', (filename, source) => {
    const { descriptor, errors } = parse(source, { filename });
    expect(errors).toEqual([]);
    expect(compileTemplate({ source: descriptor.template!.content, filename, id: 'playlist-test' }).errors).toEqual([]);
  });

  it.each([
    ['Playlists.vue', pageSource, '.dark .playlist-page'],
    ['PlaylistActionsMenu.vue', menuSource, '.dark .playlist-actions-menu'],
  ])('keeps %s dark styles on the component, not the document root', (filename, source, selector) => {
    const { descriptor } = parse(source, { filename });
    const result = compileStyle({ source: descriptor.styles[0].content, filename, id: 'playlist-test', scoped: true });
    expect(result.errors).toEqual([]);
    expect(result.code).toContain(`${selector} {`);
    expect(result.code).not.toMatch(/\.dark\s*\{/);
  });
});
