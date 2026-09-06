import { pinyin } from 'pinyin-pro';

import type { SearchIndexEntry, SearchIndexSource } from '../types';
import { getAlphabetSortKey } from './alphabetIndex';

const HAN_RUN_PATTERN = /\p{Script=Han}+/gu;
const FULL_WIDTH_PATTERN = /[\uFF01-\uFF5E]/g;
const UMLAUT_PATTERN = /[üÜǖǕǘǗǚǙǜǛ]/g;

export const normalizeSearchInput = (value: string): string => value
  .replace(FULL_WIDTH_PATTERN, character => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
  .replace(/\u3000/g, ' ')
  .replace(UMLAUT_PATTERN, 'v')
  .toLowerCase()
  .replace(/[-'’]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const splitSearchTokens = (value: string) => (
  normalizeSearchInput(value).split(' ').filter(Boolean)
);

const normalizeSyllable = (value: string) => value.toLowerCase().replace(UMLAUT_PATTERN, 'v');

const getHanRuns = (value: string): string[] => value.match(HAN_RUN_PATTERN) ?? [];

export interface PinyinSearchTerms {
  full: string;
  initials: string;
}

export const createPinyinSearchTerms = (values: string[]): PinyinSearchTerms => {
  const fullTerms = new Set<string>();
  const initialTerms = new Set<string>();

  values.forEach((value) => {
    getHanRuns(value).forEach((run) => {
      const syllables = pinyin(run, {
        toneType: 'none',
        type: 'array',
        nonZh: 'consecutive',
      }).map(normalizeSyllable).filter(Boolean);

      for (let index = 0; index < syllables.length; index += 1) {
        const suffix = syllables.slice(index);
        fullTerms.add(suffix.join(''));
        initialTerms.add(suffix.map(syllable => syllable[0]).join(''));
      }
    });
  });

  return {
    full: Array.from(fullTerms).join(' '),
    initials: Array.from(initialTerms).join(' '),
  };
};

export const createSearchIndexEntry = (source: SearchIndexSource): SearchIndexEntry => {
  const title = createPinyinSearchTerms([source.title]);
  const artist = createPinyinSearchTerms(source.artistNames);
  const album = createPinyinSearchTerms([source.album]);
  const albumArtist = createPinyinSearchTerms([source.albumArtist]);

  return {
    songId: source.songId,
    titleFull: title.full,
    titleInitials: title.initials,
    artistFull: artist.full,
    artistInitials: artist.initials,
    albumFull: album.full,
    albumInitials: album.initials,
    albumArtistFull: albumArtist.full,
    albumArtistInitials: albumArtist.initials,
    literalText: normalizeSearchInput([
      source.title,
      ...source.artistNames,
      source.album,
      source.albumArtist,
      source.path,
    ].join(' ')),
    titleSortKey: getAlphabetSortKey(source.title),
    sourceSignature: source.sourceSignature,
  };
};

export const matchesPinyinSearch = (values: string[], query: string): boolean => {
  const tokens = splitSearchTokens(query);
  if (tokens.length === 0) {
    return true;
  }

  const literalValues = values.map(normalizeSearchInput);
  const terms = createPinyinSearchTerms(values);
  const pinyinTerms = `${terms.full} ${terms.initials}`.split(' ').filter(Boolean);

  return tokens.every(token => (
    literalValues.some(value => value.includes(token))
    || pinyinTerms.some(term => term.startsWith(token))
  ));
};
