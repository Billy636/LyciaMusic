import type { AlbumCatalogItem, ArtistCatalogItem, Song } from '../../types';

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

