import { compileTemplate, parse } from '@vue/compiler-sfc';
import { describe, expect, it, vi } from 'vitest';
import type { Router } from 'vue-router';

import { buildAppLocation, useHomeNavigation } from '../../composables/useHomeNavigation';
import sidebarSource from './Sidebar.vue?raw';
import navigationSource from './SidebarNavigation.vue?raw';
import shortcutsSource from './SidebarPlaylists.vue?raw';
import titleBarSource from './TitleBar.vue?raw';
import settingsSidebarSource from '../settings/SettingsSidebar.vue?raw';

describe('sidebar playlist visibility', () => {
  it('guards only the shortcut section with the existing sidebar setting', () => {
    expect(sidebarSource).toContain('v-if="settings.sidebar.showPlaylists"');
    expect(settingsSidebarSource).toContain('settings.sidebar.showPlaylists = !settings.sidebar.showPlaylists');
  });

  it('keeps the playlist library navigation available when shortcuts are hidden', () => {
    expect(navigationSource).toContain('data-nav="playlists"');
    expect(navigationSource).toContain('@click="$emit(\'openPlaylists\')"');
    expect(navigationSource).toContain('@keydown.enter.prevent="$emit(\'openPlaylists\')"');
    expect(navigationSource).not.toContain('showPlaylists');
    expect(sidebarSource).toContain('@openPlaylists="handleOpenPlaylistsView"');
  });

  it('renders the bounded shortcut collection with the full count and a library link', () => {
    expect(sidebarSource).toContain(':playlists="shortcutPlaylists"');
    expect(sidebarSource).toContain(':totalCount="playlists.length"');
    expect(sidebarSource).toContain(':pinnedIds="pinnedIds"');
    expect(sidebarSource).toContain('@openAll="handleOpenPlaylistsView"');
    expect(shortcutsSource).toContain('{{ totalCount }}');
    expect(shortcutsSource).toContain("pinnedIds.includes(list.id)");
    expect(shortcutsSource).toContain("$emit('openAll')");
  });

  it('selects only visible shortcut ranges and loads covers only for expanded visible shortcuts', () => {
    expect(sidebarSource).toContain('useSidebarPlaylistSelection({\n  playlists: shortcutPlaylists,');
    expect(sidebarSource).toContain('settings.value.sidebar.showPlaylists && isPlaylistOpen.value ? shortcutPlaylists.value : []');
    expect(sidebarSource).toContain('useSidebarPlaylistCovers({\n  playlists: visibleShortcutPlaylists,');
  });

  it('maps shortcut drag sources back to the complete playlist collection by id', () => {
    expect(sidebarSource).toContain('playlists.value.findIndex(item => item.id === playlist.id)');
    expect(sidebarSource).toContain('handlePointerDown(event, sourceIndex, playlist)');
    expect(sidebarSource).toContain('@pointerDown="handleShortcutPointerDown"');
    expect(sidebarSource).not.toContain('@pointerDown="handlePointerDown"');
  });

  it('leaves the playlist library search to its page while retaining title bar controls', () => {
    expect(titleBarSource).toContain("const isPlaylistLibraryRoute = computed(() => route.path === '/playlists')");
    expect(titleBarSource).toContain('v-if="!isPlaylistLibraryRoute"');
    expect(titleBarSource).toContain('@click="goBack"');
    expect(titleBarSource).toContain('@click.stop="toggleThemeMode"');
    expect(titleBarSource).toContain('@click.stop="minimize"');
  });

  it.each([
    ['Sidebar.vue', sidebarSource],
    ['SidebarNavigation.vue', navigationSource],
    ['SidebarPlaylists.vue', shortcutsSource],
    ['TitleBar.vue', titleBarSource],
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

describe('playlist library navigation', () => {
  it('builds a dedicated management route without changing playlist detail URLs', () => {
    expect(buildAppLocation({ section: 'playlists' })).toEqual({ path: '/playlists' });
    expect(buildAppLocation({
      section: 'home',
      target: { view: 'playlist', filter: 'playlist-1' },
    })).toEqual({
      path: '/',
      query: { view: 'playlist', filter: 'playlist-1' },
    });
  });

  it('supports both push and replace navigation to the library', async () => {
    const router = {
      push: vi.fn().mockResolvedValue(undefined),
      replace: vi.fn().mockResolvedValue(undefined),
    };
    const { openPlaylists } = useHomeNavigation(router as unknown as Router);

    await openPlaylists();
    await openPlaylists({ replace: true });

    expect(router.push).toHaveBeenCalledWith({ path: '/playlists' });
    expect(router.replace).toHaveBeenCalledWith({ path: '/playlists' });
  });
});
