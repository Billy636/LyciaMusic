import { computed, type Ref } from 'vue';

import type { AlbumCatalogItem, ArtistCatalogItem } from '../../types';
import { compareByAlphabetIndex } from '../../utils/alphabetIndex';
import type { AlbumSortMode, ArtistSortMode } from '../../services/storage/playerStorage';
import { matchesPinyinSearch } from '../../utils/pinyinSearch';
import {
  type AlbumListItem,
  type ArtistListItem,
} from './playerLibraryViewShared';

interface UseLibraryCatalogSelectorsOptions {
  artistCatalog: Ref<ArtistCatalogItem[]>;
  albumCatalog: Ref<AlbumCatalogItem[]>;
  searchQuery: Ref<string>;
  artistSortMode: Ref<ArtistSortMode>;
  albumSortMode: Ref<AlbumSortMode>;
  artistCustomOrder: Ref<string[]>;
  albumCustomOrder: Ref<string[]>;
}

export function useLibraryCatalogSelectors({
  artistCatalog,
  albumCatalog,
  searchQuery,
  artistSortMode,
  albumSortMode,
  artistCustomOrder,
  albumCustomOrder,
}: UseLibraryCatalogSelectorsOptions) {
  const artistList = computed<ArtistListItem[]>(() => {
    const list = [...artistCatalog.value];

    if (artistSortMode.value === 'name') {
      list.sort((a, b) => compareByAlphabetIndex(a.name, b.name));
    } else if (artistSortMode.value === 'custom') {
      const orderMap = new Map(artistCustomOrder.value.map((name, index) => [name, index]));
      list.sort((a, b) => {
        const left = orderMap.has(a.name) ? orderMap.get(a.name)! : Number.MAX_SAFE_INTEGER;
        const right = orderMap.has(b.name) ? orderMap.get(b.name)! : Number.MAX_SAFE_INTEGER;
        return left - right;
      });
    } else {
      list.sort((a, b) => b.count - a.count || compareByAlphabetIndex(a.name, b.name));
    }

    return list;
  });

  const albumList = computed<AlbumListItem[]>(() => {
    const list = [...albumCatalog.value];

    if (albumSortMode.value === 'name') {
      list.sort((a, b) => compareByAlphabetIndex(a.name, b.name));
    } else if (albumSortMode.value === 'custom') {
      const orderMap = new Map(albumCustomOrder.value.map((key, index) => [key, index]));
      list.sort((a, b) => {
        const left = orderMap.has(a.key) ? orderMap.get(a.key)! : Number.MAX_SAFE_INTEGER;
        const right = orderMap.has(b.key) ? orderMap.get(b.key)! : Number.MAX_SAFE_INTEGER;
        return left - right;
      });
    } else if (albumSortMode.value === 'count') {
      list.sort((a, b) => b.count - a.count || compareByAlphabetIndex(a.artist, b.artist));
    } else {
      list.sort((a, b) => {
        const artistDiff = compareByAlphabetIndex(a.artist, b.artist);
        return artistDiff !== 0 ? artistDiff : compareByAlphabetIndex(a.name, b.name);
      });
    }

    return list;
  });

  const filteredArtistList = computed(() => {
    const query = searchQuery.value.trim().toLowerCase();
    if (!query) {
      return artistList.value;
    }

    return artistList.value.filter(artist => matchesPinyinSearch([artist.name || ''], query));
  });

  const filteredAlbumList = computed(() => {
    const query = searchQuery.value.trim().toLowerCase();
    if (!query) {
      return albumList.value;
    }

    return albumList.value.filter(album => matchesPinyinSearch([
      album.name || '',
      album.artist || '',
    ], query));
  });

  return {
    artistList,
    albumList,
    filteredArtistList,
    filteredAlbumList,
  };
}
