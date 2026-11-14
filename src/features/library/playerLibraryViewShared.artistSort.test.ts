import { describe, expect, it } from 'vitest';

import type { Song } from '../../types';
import { sortSongPathsByArtist } from './playerLibraryViewShared';

const makeSong = (path: string, overrides: Partial<Song> = {}): Song => ({
  path,
  name: `${path}.flac`,
  title: path,
  artist: 'Artist',
  artist_names: ['Artist'],
  effective_artist_names: ['Artist'],
  album: 'Album',
  album_artist: 'Artist',
  album_key: 'album::artist',
  is_various_artists_album: false,
  collapse_artist_credits: false,
  duration: 180,
  ...overrides,
});

const sortSongs = (songs: Song[]) => {
  const lookup = new Map(songs.map(song => [song.path, song]));
  return sortSongPathsByArtist(songs.map(song => song.path), path => lookup.get(path));
};

describe('artist song ordering', () => {
  it('interleaves Chinese pinyin and English artists in the same alphabetical groups', () => {
    const artists = ['Zoe', '周杰伦', '陈奕迅', 'Beyoncé', '2Cellos', '阿杜', 'Adele', '赵雷'];
    const songs = artists.map(artist => makeSong(artist, { artist }));

    expect(sortSongs(songs)).toEqual(['2Cellos', '阿杜', 'Adele', 'Beyoncé', '陈奕迅', '赵雷', '周杰伦', 'Zoe']);
    expect(songs.map(song => song.artist)).toEqual(artists);
  });

  it('groups each artist by natural album order before disc and numeric track order', () => {
    const songs = [
      makeSong('album-10', { album: 'Album 10', album_key: 'album-10', disc_number: '1', track_number: '1' }),
      makeSong('disc-2', { album: 'Album 2', album_key: 'album-2', disc_number: 'Disc 2', track_number: '0' }),
      makeSong('track-10', { album: 'Album 2', album_key: 'album-2', disc_number: '1', track_number: '10/12', title: 'Alpha' }),
      makeSong('track-2', { album: 'Album 2', album_key: 'album-2', disc_number: '1', track_number: '02/12', title: 'Zulu' }),
      makeSong('unknown-disc', { album: 'Album 2', album_key: 'album-2', track_number: '1' }),
      makeSong('next-artist', { artist: '陈奕迅', album: 'Album 1', disc_number: '1', track_number: '1' }),
    ];

    expect(sortSongs(songs)).toEqual(['track-2', 'track-10', 'disc-2', 'unknown-disc', 'album-10', 'next-artist']);
  });

  it('sorts Chinese album names by pinyin rather than interleaving their track numbers', () => {
    expect(sortSongs([
      makeSong('fantasy-1', { artist: '周杰伦', album: '范特西', album_key: 'fantasy', track_number: '1' }),
      makeSong('octave-2', { artist: '周杰伦', album: '八度空间', album_key: 'octave', track_number: '2' }),
      makeSong('octave-1', { artist: '周杰伦', album: '八度空间', album_key: 'octave', track_number: '1' }),
    ])).toEqual(['octave-1', 'octave-2', 'fantasy-1']);
  });

  it('keeps homophone artists separate and same-name album identities contiguous', () => {
    expect(sortSongs([
      makeSong('other-artist', { artist: '李纳', album: 'Album A', track_number: '0' }),
      makeSong('album-b-1', { artist: ' 李娜 ', album: 'Album', album_key: 'album-b', track_number: '1' }),
      makeSong('album-a-2', { artist: '李娜', album: 'Album', album_key: ' ALBUM-A ', track_number: '2' }),
      makeSong('album-a-1', { artist: '李娜', album: 'Album', album_key: 'album-a', track_number: '1' }),
    ])).toEqual(['album-a-1', 'album-a-2', 'album-b-1', 'other-artist']);
  });

  it('uses album-artist identity when the album key is blank', () => {
    expect(sortSongs([
      makeSong('collection-b', { album_key: ' ', album_artist: 'Collection B', track_number: '1' }),
      makeSong('collection-a-2', { album_key: '', album_artist: ' Collection A ', track_number: '2' }),
      makeSong('collection-a-1', { album_key: '', album_artist: 'collection a', track_number: '1' }),
    ])).toEqual(['collection-a-1', 'collection-a-2', 'collection-b']);
  });

  it('accepts track zero and embedded numeric labels while putting missing indices last', () => {
    expect(sortSongs([
      makeSong('missing-track', { disc_number: '1', track_number: 'Side A' }),
      makeSong('missing-disc', { disc_number: '?', track_number: '0' }),
      makeSong('track-12', { disc_number: 'Disc 1', track_number: 'Track 12/20' }),
      makeSong('track-0', { disc_number: '1', track_number: '0' }),
    ])).toEqual(['track-0', 'track-12', 'missing-track', 'missing-disc']);
  });

  it('normalizes blank group labels and uses title pinyin then path for ties', () => {
    expect(sortSongs([
      makeSong('/z', { artist: ' ', album: ' ', album_artist: ' ', album_key: ' ', title: '陈年' }),
      makeSong('/b', { artist: 'Unknown', album: 'Unknown', album_artist: 'Unknown', album_key: '', title: '阿' }),
      makeSong('/a', { artist: '', album: '', album_artist: '', album_key: '', title: '阿' }),
    ])).toEqual(['/a', '/b', '/z']);
  });

  it('uses the complete path for blank or missing titles across folders', () => {
    expect(sortSongs([
      makeSong('D:/Z-folder/Alpha.flac', { title: ' ', name: 'Alpha.flac' }),
      makeSong('D:/A-folder/Zulu.flac', { title: undefined, name: 'Zulu.flac' }),
    ])).toEqual(['D:/A-folder/Zulu.flac', 'D:/Z-folder/Alpha.flac']);
  });

  it('treats disc and track numbers outside the backend i32 range as missing', () => {
    expect(sortSongs([
      makeSong('overflow-disc', { disc_number: '2147483648', track_number: '0' }),
      makeSong('overflow-track', { disc_number: '1', track_number: '2147483648', title: 'Alpha' }),
      makeSong('max-disc', { disc_number: '2147483647', track_number: '1' }),
      makeSong('max-track', { disc_number: '1', track_number: '2147483647', title: 'Zulu' }),
    ])).toEqual(['max-track', 'overflow-track', 'max-disc', 'overflow-disc']);
  });

  it('preserves the input sequence while any song metadata is unavailable', () => {
    const paths = ['/loaded', '/missing'];
    const loadedSong = makeSong('/loaded', { artist: '周杰伦' });

    expect(sortSongPathsByArtist(paths, path => path === loadedSong.path ? loadedSong : undefined)).toEqual(paths);
  });
});
