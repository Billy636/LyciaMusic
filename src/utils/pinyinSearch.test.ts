import { describe, expect, it } from 'vitest';

import {
  createPinyinSearchTerms,
  createSearchIndexEntry,
  matchesPinyinSearch,
  normalizeSearchInput,
} from './pinyinSearch';

describe('pinyin search terms', () => {
  it('creates continuous suffixes only at syllable boundaries', () => {
    expect(createPinyinSearchTerms(['周杰伦'])).toEqual({
      full: 'zhoujielun jielun lun',
      initials: 'zjl jl l',
    });
    expect(matchesPinyinSearch(['周杰伦'], 'jielun')).toBe(true);
    expect(matchesPinyinSearch(['周杰伦'], 'jl')).toBe(true);
    expect(matchesPinyinSearch(['周杰伦'], 'oujie')).toBe(false);
    expect(matchesPinyinSearch(['周杰伦'], 'zl')).toBe(false);
  });

  it('supports segmented AND queries across fields', () => {
    expect(matchesPinyinSearch(['青花瓷', '周杰伦'], 'qhc zjl')).toBe(true);
    expect(matchesPinyinSearch(['青花瓷', '林俊杰'], 'qhc zjl')).toBe(false);
  });

  it('normalizes full width text and v without conflating plain u', () => {
    expect(normalizeSearchInput(' ＬＶ－ＳＥ ')).toBe('lv se');
    expect(matchesPinyinSearch(['绿色'], 'lvse')).toBe(true);
    expect(matchesPinyinSearch(['绿色'], 'luse')).toBe(false);
  });

  it('does not merge Chinese initials with trailing English words', () => {
    expect(matchesPinyinSearch(['一路向北 Remix'], 'ylxb remix')).toBe(true);
    expect(matchesPinyinSearch(['一路向北 Remix'], 'ylxbr')).toBe(false);
  });

  it('builds persisted terms without converting file paths to pinyin', () => {
    const entry = createSearchIndexEntry({
      songId: 1,
      path: 'C:/音乐/青花瓷.flac',
      title: '青花瓷',
      artistNames: ['周杰伦'],
      album: '我很忙',
      albumArtist: '周杰伦',
      sourceSignature: 'signature-1',
    });

    expect(entry.titleFull).toBe('qinghuaci huaci ci');
    expect(entry.artistInitials).toBe('zjl jl l');
    expect(entry.literalText).toContain('c:/音乐/青花瓷.flac');
    expect(entry.literalText).not.toContain('qinghuaci.flac');
    expect(entry.sourceSignature).toBe('signature-1');
  });
});
