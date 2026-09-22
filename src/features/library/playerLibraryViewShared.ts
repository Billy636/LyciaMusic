import type { AlbumCatalogItem, ArtistCatalogItem, Song } from '../../types';
import { getAlphabetIndexKey, getAlphabetSortKey, INDEX_ORDER } from '../../utils/alphabetIndex';

export type ArtistListItem = ArtistCatalogItem;
export type AlbumListItem = AlbumCatalogItem;

export const isDirectParent = (parentPath: string, childPath: string) => {
  if (!parentPath || !childPath) return false;

  const normalizedParent = parentPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const normalizedChild = childPath.replace(/\\/g, '/').toLowerCase();
  const lastSlash = normalizedChild.lastIndexOf('/');

  return lastSlash !== -1 && normalizedChild.substring(0, lastSlash) === normalizedParent;
};

export const getSongArtistNames = (song: Song) => {
  if (Array.isArray(song.effective_artist_names) && song.effective_artist_names.length > 0) {
    return song.effective_artist_names;
  }

  if (Array.isArray(song.artist_names) && song.artist_names.length > 0) {
    return song.artist_names;
  }

  return [song.artist || 'Unknown'];
};

export const songHasArtist = (song: Song, artistName: string) =>
  getSongArtistNames(song).some(name => name === artistName);

export const getSongAlbumKey = (song: Song) =>
  song.album_key || `${song.album || 'Unknown'}::${song.album_artist || song.artist || 'Unknown'}`;

export const matchesAlbumKey = (song: Song, albumKey: string) => getSongAlbumKey(song) === albumKey;

export const getSongArtistSearchText = (song?: Song | null) => {
  if (!song) return '';
  return [song.artist, song.album_artist, ...getSongArtistNames(song)].join(' ').toLowerCase();
};

export const getSongTitleLabel = (song?: Song | null, fallbackPath?: string) => {
  if (song?.title) return song.title;
  if (song?.name) return song.name;
  if (fallbackPath) {
    const fileName = fallbackPath.replace(/\\/g, '/').split('/').pop();
    if (fileName) return fileName;
  }
  return '';
};

export const getSongFileNameLabel = (song?: Song | null, fallbackPath?: string) => {
  if (song?.name) return song.name;
  if (fallbackPath) {
    const fileName = fallbackPath.replace(/\\/g, '/').split('/').pop();
    if (fileName) return fileName;
  }
  return '';
};

export const parseSortIndexValue = (value?: string) => {
  if (!value) {
    return null;
  }

  const match = value.trim().match(/\d+/);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const artistSortCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const compareStableText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const compareOptionalIndex = (left: number | null, right: number | null) => {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return left - right;
};
const parseArtistSortIndex = (value?: string) => {
  const parsed = parseSortIndexValue(value);
  return parsed !== null && parsed <= 2_147_483_647 ? parsed : null;
};

/** The local fallback for the backend's artist -> album -> disc/track order. */
export const sortSongPathsByArtist = (
  paths: readonly string[],
  lookupSong: (path: string) => Song | null | undefined,
): string[] => {
  const songs: Array<{ path: string; song: Song }> = [];
  for (const path of paths) {
    const song = lookupSong(path);
    // Windowed metadata must not reorder unknown songs as empty artist names.
    if (!song) return [...paths];
    songs.push({ path, song });
  }

  type AlphabetKey = { group: number; value: string };
  const alphabetKeys = new Map<string, AlphabetKey>();
  const alphabetKey = (label: string): AlphabetKey => {
    const cached = alphabetKeys.get(label);
    if (cached) return cached;
    const key = {
      group: INDEX_ORDER.get(getAlphabetIndexKey(label)) ?? 999,
      value: getAlphabetSortKey(label),
    };
    alphabetKeys.set(label, key);
    return key;
  };
  const compareAlphabetKeys = (left: AlphabetKey, right: AlphabetKey) =>
    left.group - right.group || artistSortCollator.compare(left.value, right.value);

  const keyedSongs = songs.map(({ path, song }) => {
    const artist = song.artist?.trim() || 'Unknown';
    const album = song.album?.trim() || 'Unknown';
    const albumArtist = song.album_artist?.trim() || artist;
    const albumIdentity = (song.album_key?.trim() || `${album}::${albumArtist}`).toLowerCase();
    const title = song.title?.trim() || path;
    return {
      path,
      artistKey: alphabetKey(artist),
      artistIdentity: artist.toLowerCase(),
      albumKey: alphabetKey(album),
      albumIdentity,
      disc: parseArtistSortIndex(song.disc_number),
      track: parseArtistSortIndex(song.track_number),
      titleKey: alphabetKey(title),
    };
  });

  keyedSongs.sort((left, right) =>
    compareAlphabetKeys(left.artistKey, right.artistKey)
    || compareStableText(left.artistIdentity, right.artistIdentity)
    || compareAlphabetKeys(left.albumKey, right.albumKey)
    || compareStableText(left.albumIdentity, right.albumIdentity)
    || compareOptionalIndex(left.disc, right.disc)
    || compareOptionalIndex(left.track, right.track)
    || compareAlphabetKeys(left.titleKey, right.titleKey)
    || compareStableText(left.path, right.path),
  );
  return keyedSongs.map(song => song.path);
};

export const compareSongPathsByTrackNumber = (
  left: string,
  right: string,
  songLookup: Map<string, Song>,
): number => {
  const findSong = (path: string) => {
    const direct = songLookup.get(path);
    if (direct) return direct;
    const normalized = path.replace(/\\/g, '/').toLowerCase();
    for (const [key, song] of songLookup.entries()) {
      if (key.replace(/\\/g, '/').toLowerCase() === normalized) {
        return song;
      }
    }
    return undefined;
  };

  const leftSong = findSong(left);
  const rightSong = findSong(right);

  const leftDisc = parseSortIndexValue(leftSong?.disc_number);
  const rightDisc = parseSortIndexValue(rightSong?.disc_number);
  let result = 0;

  if (leftDisc === null && rightDisc !== null) {
    result = 1;
  } else if (leftDisc !== null && rightDisc === null) {
    result = -1;
  } else if (leftDisc !== null && rightDisc !== null && leftDisc !== rightDisc) {
    result = leftDisc - rightDisc;
  }

  if (result === 0) {
    const leftTrack = parseSortIndexValue(leftSong?.track_number);
    const rightTrack = parseSortIndexValue(rightSong?.track_number);

    if (leftTrack === null && rightTrack !== null) {
      result = 1;
    } else if (leftTrack !== null && rightTrack === null) {
      result = -1;
    } else if (leftTrack !== null && rightTrack !== null && leftTrack !== rightTrack) {
      result = leftTrack - rightTrack;
    }
  }

  if (result === 0) {
    const leftTitle = leftSong ? (leftSong.title || leftSong.name) : '';
    const rightTitle = rightSong ? (rightSong.title || rightSong.name) : '';
    result = leftTitle.localeCompare(rightTitle, 'zh-CN') || left.localeCompare(right, 'zh-CN');
  }

  return result;
};
