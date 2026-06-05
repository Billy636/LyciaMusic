export type ArtistTabId = 'songs' | 'albums' | 'details';

export interface ArtistTabItem {
  id: ArtistTabId;
  name: string;
}

export const ARTIST_TABS_STORAGE_KEY = 'lycia_artist_tabs_order';

export const DEFAULT_ARTIST_TABS: ArtistTabId[] = ['songs', 'albums', 'details'];

const TABS_NAME_MAP: Record<ArtistTabId, string> = {
  songs: '歌曲',
  albums: '专辑',
  details: '歌手详情',
};

/**
 * 类型守卫函数，用来校验未知变量是否为合法的 ArtistTabId
 */
export function isArtistTabId(value: unknown): value is ArtistTabId {
  return value === 'songs' || value === 'albums' || value === 'details';
}

/**
 * 严格清洗和去重、补全 Tab 顺序列表，防止本地缓存垃圾数据损坏 UI
 */
export function sanitizeTabsOrder(rawOrder: unknown): ArtistTabId[] {
  if (!Array.isArray(rawOrder)) {
    return [...DEFAULT_ARTIST_TABS];
  }
  const validSavedIds = rawOrder.filter(isArtistTabId);
  const dedupedSavedIds = Array.from(new Set(validSavedIds));
  const missingIds = DEFAULT_ARTIST_TABS.filter(id => !dedupedSavedIds.includes(id));
  return [...dedupedSavedIds, ...missingIds];
}

/**
 * 从 localStorage 安全读取经过清洗和补全的 Tab 顺序
 */
export function getSavedTabsOrder(): ArtistTabId[] {
  try {
    const raw = localStorage.getItem(ARTIST_TABS_STORAGE_KEY);
    if (!raw) return [...DEFAULT_ARTIST_TABS];
    return sanitizeTabsOrder(JSON.parse(raw));
  } catch {
    return [...DEFAULT_ARTIST_TABS];
  }
}

/**
 * 获取默认的首位 Tab ID，用于初次进入歌手详情时做首屏展示
 */
export function getDefaultArtistTab(): ArtistTabId {
  const order = getSavedTabsOrder();
  return order[0] || 'songs';
}

/**
 * 根据最新的排布顺序，装配并获取带有翻译和完整信息的 Tab 列表数据
 */
export function getOrderedArtistTabs(): ArtistTabItem[] {
  const order = getSavedTabsOrder();
  return order.map(id => ({
    id,
    name: TABS_NAME_MAP[id] || '',
  }));
}

/**
 * 将 Tab 顺序经过清洗后，防崩溃写入 localStorage
 */
export function saveTabsOrder(order: ArtistTabId[]): void {
  try {
    localStorage.setItem(
      ARTIST_TABS_STORAGE_KEY,
      JSON.stringify(sanitizeTabsOrder(order)),
    );
  } catch {
    // 静默失败，避免本地写入故障中断主进程或阻塞 UI 响应
  }
}
