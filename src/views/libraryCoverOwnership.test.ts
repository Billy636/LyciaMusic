import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { describe, expect, it } from 'vitest';

import albumsSource from './Albums.vue?raw';
import artistsSource from './Artists.vue?raw';

describe('library list cover ownership', () => {
  it.each([
    ['Artists.vue', artistsSource, 'visibleArtistCoverPaths'],
    ['Albums.vue', albumsSource, 'visibleAlbumCoverPaths'],
  ])('%s retains its visible covers through the shared cover owner', (filename, source, visiblePaths) => {
    expect(source).toContain(`useVisibleCoverUrls(${visiblePaths}${filename === 'Albums.vue' ? ", 'card'" : ''})`);
    expect(source).not.toContain('coverCache.get(');
    expect(source).not.toContain('syncVisibleCoverUrls');
    expect(source).not.toContain('displayedCoverUrls.clear()');
    expect(source.indexOf('restoreViewportCoverSnapshot();'))
      .toBeGreaterThan(source.indexOf(`useVisibleCoverUrls(${visiblePaths}${filename === 'Albums.vue' ? ", 'card'" : ''})`));

    const { descriptor, errors } = parse(source, { filename });
    expect(errors).toEqual([]);
    expect(() => compileScript(descriptor, { id: filename })).not.toThrow();
    expect(compileTemplate({
      source: descriptor.template!.content,
      filename,
      id: filename,
    }).errors).toEqual([]);
  });

  it('restores artist snapshot URLs only into the current visible set', () => {
    expect(artistsSource).toContain('const visiblePaths = new Set(visibleArtistCoverPaths.value);');
    expect(artistsSource).toContain('visiblePaths.has(entry.path)');
    expect(artistsSource).toContain('displayedCoverUrls.set(entry.path, entry.url);');
    expect(artistsSource).toContain('snapshot.push({ path, url });');
  });

  it('preserves album path-only viewport snapshots', () => {
    expect(albumsSource).toContain('const snapshot: string[] = [];');
    expect(albumsSource).toContain('snapshot.push(path);');
    expect(albumsSource).toContain("preloadPriorityCovers(snapshot, 'card');");
  });

  it('continues preferring custom artist avatars over embedded covers', () => {
    expect(artistsSource).toContain('return convertFileSrc(artist.avatarPath);');
    expect(artistsSource).toContain('.filter(item => !item.artist.avatarPath)');
  });
});
