import type { SidebarNavigationId, SidebarSettings } from '../../types';

export type { SidebarNavigationId } from '../../types';

interface SidebarNavigationItem {
  id: SidebarNavigationId;
  label: string;
  visibilityKey: Exclude<keyof SidebarSettings, 'navigationOrder' | 'showPlaylists'>;
}

export const sidebarNavigationItems: readonly SidebarNavigationItem[] = [
  { id: 'localMusic', label: '本地音乐', visibilityKey: 'showLocalMusic' },
  { id: 'artists', label: '歌手', visibilityKey: 'showArtists' },
  { id: 'albums', label: '专辑', visibilityKey: 'showAlbums' },
  { id: 'playlists', label: '歌单', visibilityKey: 'showPlaylistLibrary' },
  { id: 'favorites', label: '我的收藏', visibilityKey: 'showFavorites' },
  { id: 'recent', label: '最近播放', visibilityKey: 'showRecent' },
  { id: 'folders', label: '文件夹', visibilityKey: 'showFolders' },
  { id: 'statistics', label: '统计', visibilityKey: 'showStatistics' },
];

export const normalizeSidebarNavigationOrder = (value: unknown): SidebarNavigationId[] => {
  const defaultOrder = sidebarNavigationItems.map(item => item.id);
  const knownIds = new Set<string>(defaultOrder);
  const savedOrder = Array.isArray(value)
    ? value.filter((id): id is SidebarNavigationId => typeof id === 'string' && knownIds.has(id))
    : [];

  // Drop unknown/duplicate entries and append missing ones for old or partial settings.
  return [...new Set([...savedOrder, ...defaultOrder])];
};

export const getOrderedSidebarNavigation = (sidebar: SidebarSettings) =>
  normalizeSidebarNavigationOrder(sidebar.navigationOrder)
    .map(id => sidebarNavigationItems.find(item => item.id === id)!);

export const getVisibleSidebarNavigation = (sidebar: SidebarSettings) =>
  getOrderedSidebarNavigation(sidebar).filter(item =>
    item.visibilityKey === 'showPlaylistLibrary'
      ? sidebar.showPlaylistLibrary !== false
      : sidebar[item.visibilityKey],
  );
