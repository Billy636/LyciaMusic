import type { SidebarNavigationId, SidebarSettings } from '../../types';

export type { SidebarNavigationId } from '../../types';

interface SidebarNavigationItem {
  id: SidebarNavigationId;
  label: string;
  visibilityKey: Exclude<keyof SidebarSettings, 'navigationOrder' | 'homepageId' | 'showPlaylists'>;
}

export const sidebarNavigationItems: readonly SidebarNavigationItem[] = [
  { id: 'artists', label: '歌手', visibilityKey: 'showArtists' },
  { id: 'albums', label: '专辑', visibilityKey: 'showAlbums' },
  { id: 'genres', label: '流派', visibilityKey: 'showGenres' },
  { id: 'playlists', label: '歌单', visibilityKey: 'showPlaylistLibrary' },
  { id: 'favorites', label: '我的收藏', visibilityKey: 'showFavorites' },
  { id: 'recent', label: '最近播放', visibilityKey: 'showRecent' },
  { id: 'localMusic', label: '本地音乐', visibilityKey: 'showLocalMusic' },
  { id: 'folders', label: '文件夹', visibilityKey: 'showFolders' },
  { id: 'statistics', label: '统计', visibilityKey: 'showStatistics' },
];

// 旧版本默认顺序（本地音乐排第一），升级时迁移到新默认顺序。
const legacyDefaultOrder: readonly SidebarNavigationId[] = [
  'localMusic', 'artists', 'albums', 'genres', 'playlists', 'favorites', 'recent', 'folders', 'statistics',
];

export const normalizeSidebarNavigationOrder = (value: unknown): SidebarNavigationId[] => {
  const defaultOrder = sidebarNavigationItems.map(item => item.id);
  const knownIds = new Set<string>(defaultOrder);
  const savedOrder = Array.isArray(value)
    ? value.filter((id): id is SidebarNavigationId => typeof id === 'string' && knownIds.has(id))
    : [];

  // 用户未自定义过顺序时，跟随最新的默认排序。
  if (savedOrder.length === legacyDefaultOrder.length
    && savedOrder.every((id, index) => id === legacyDefaultOrder[index])) {
    return [...defaultOrder];
  }

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

export const getSidebarHomepageId = (sidebar: SidebarSettings): SidebarNavigationId => {
  const visibleItems = getVisibleSidebarNavigation(sidebar);
  return visibleItems.find(item => item.id === sidebar.homepageId)?.id
    ?? visibleItems.find(item => item.id === 'localMusic')?.id
    ?? visibleItems[0]?.id
    ?? 'localMusic';
};
