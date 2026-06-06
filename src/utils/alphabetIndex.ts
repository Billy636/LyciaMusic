import { pinyin } from 'pinyin-pro';

export const ALPHABET_INDEX_KEYS = [
  '0',
  'A', 'B', 'C', 'D', 'E', 'F', 'G',
  'H', 'I', 'J', 'K', 'L', 'M', 'N',
  'O', 'P', 'Q', 'R', 'S', 'T',
  'U', 'V', 'W', 'X', 'Y', 'Z',
  '#',
] as const;

export type AlphabetIndexKey = typeof ALPHABET_INDEX_KEYS[number];

export const INDEX_KEYS = [...ALPHABET_INDEX_KEYS];

export const INDEX_ORDER = new Map<AlphabetIndexKey, number>(
  ALPHABET_INDEX_KEYS.map((key, index) => [key, index]),
);

const toHalfWidth = (text: string): string => {
  return text
    .replace(/[\uFF01-\uFF5E]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xFEE0)
    )
    .replace(/\u3000/g, ' ');
};

export const normalizeTitleForIndex = (title: string | null | undefined): string => {
  let clean = toHalfWidth((title || '').trim());
  const WRAP_SYMBOLS = /^[《》【】[\]()（）「」『』]/;
  while (WRAP_SYMBOLS.test(clean)) {
    clean = clean.substring(1).trim();
  }
  return clean;
};

export const normalizeTitleForSort = (title: string | null | undefined): string => {
  let clean = normalizeTitleForIndex(title);
  const PAIR_SYMBOLS = [
    { start: '《', end: '》' },
    { start: '【', end: '】' },
    { start: '[', end: ']' },
    { start: '(', end: ')' },
    { start: '（', end: '）' },
    { start: '「', end: '」' },
    { start: '『', end: '』' },
  ];
  let changed = true;
  while (changed) {
    changed = false;
    const len = clean.length;
    if (len >= 2) {
      for (const pair of PAIR_SYMBOLS) {
        if (clean.startsWith(pair.start) && clean.endsWith(pair.end)) {
          clean = clean.substring(1, len - 1).trim();
          changed = true;
          break;
        }
      }
    }
  }
  // 替换所有中间残留的包裹符号，转为干净的空格分隔，避免排序干扰
  clean = clean.replace(/[《》【】[\]()（）「」『』]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.toLowerCase();
};

export const getAlphabetIndexKey = (
  title: string | null | undefined,
): AlphabetIndexKey => {
  const clean = normalizeTitleForIndex(title);
  if (!clean) return '#';

  // 使用 Array.from 保证对 4 字节的 Emoji、生僻汉字等进行 Unicode 安全截取，防止代理对截断
  const firstChar = Array.from(clean)[0];
  if (!firstChar) return '#';

  if (/^\d$/.test(firstChar)) return '0';

  if (/^[A-Za-z]$/.test(firstChar)) {
    return firstChar.toUpperCase() as AlphabetIndexKey;
  }

  try {
    const py = pinyin(firstChar, {
      pattern: 'first',
      toneType: 'none',
      type: 'string',
    }).trim();

    const firstLetter = py[0]?.toUpperCase();

    if (firstLetter && /^[A-Z]$/.test(firstLetter)) {
      return firstLetter as AlphabetIndexKey;
    }
  } catch {
    // fallback to #
  }

  return '#';
};

export const getAlphabetSortKey = (title: string | null | undefined): string => {
  const normalized = normalizeTitleForSort(title);
  try {
    const result = pinyin(normalized, {
      toneType: 'none',
      nonZh: 'consecutive',
      type: 'string',
    });
    return result.toLowerCase().trim();
  } catch {
    return normalized.toLowerCase().trim();
  }
};

export const compareByAlphabetIndex = (left: string, right: string) => {
  const leftKey = getAlphabetIndexKey(left);
  const rightKey = getAlphabetIndexKey(right);
  const orderDiff = (INDEX_ORDER.get(leftKey) || 0) - (INDEX_ORDER.get(rightKey) || 0);

  if (orderDiff !== 0) {
    return orderDiff;
  }

  // 配置 numeric: true 精确兼顾含有数字标题的自然排序排列
  return getAlphabetSortKey(left).localeCompare(getAlphabetSortKey(right), 'en', {
    numeric: true,
    sensitivity: 'base',
  });
};

export const sortItemsByAlphabetIndex = <T>(
  items: T[],
  getTitle: (item: T) => string,
): T[] => {
  if (!items || items.length === 0) return [];
  
  // 1. 预计算每个 item 的 key，每首歌仅在排序触发时处理一次
  const keyedItems = items.map((item, index) => {
    const title = getTitle(item);
    return {
      item,
      index,
      indexKey: getAlphabetIndexKey(title),
      sortKey: getAlphabetSortKey(title),
    };
  });

  // 2. 稳定排序逻辑比较
  keyedItems.sort((a, b) => {
    // 组顺序 (0 -> A-Z -> #)
    if (a.indexKey !== b.indexKey) {
      const orderA = INDEX_ORDER.get(a.indexKey) ?? 999;
      const orderB = INDEX_ORDER.get(b.indexKey) ?? 999;
      return orderA - orderB;
    }
    // 配置 numeric: true 精确兼顾含有数字标题的自然排序排列
    const cmp = a.sortKey.localeCompare(b.sortKey, 'en', {
      numeric: true,
      sensitivity: 'base',
    });
    if (cmp !== 0) return cmp;
    return a.index - b.index;
  });

  return keyedItems.map(k => k.item);
};
