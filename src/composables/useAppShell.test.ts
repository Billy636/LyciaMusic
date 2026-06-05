import { describe, expect, it } from 'vitest';

import type { Song } from '../types';
import { shouldShowPlayerFooter } from './appShellFooterState';

const makeSong = (path: string): Song => ({
  path,
  name: 'demo.flac',
  title: 'Demo',
  artist: 'Artist',
  artist_names: ['Artist'],
  effective_artist_names: ['Artist'],
  album: 'Album',
  album_artist: 'Artist',
  album_key: 'album::artist',
  is_various_artists_album: false,
  collapse_artist_credits: false,
  duration: 180,
});

describe('app shell player footer state', () => {
  it('shows the footer for a currently playing external song even before the queue is visible', () => {
    expect(shouldShowPlayerFooter([], makeSong('C:\\Downloads\\demo.flac'))).toBe(true);
  });
});
