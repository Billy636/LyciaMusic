// @ts-expect-error Vitest runs in Node, but this repo does not ship @types/node.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const permissionFile = readFileSync(
  new URL('../../../src-tauri/permissions/app-commands.toml', import.meta.url),
  'utf8',
);

describe('Tauri app command permissions', () => {
  it('allows every command used by the path-backed library runtime', () => {
    const requiredCommands = [
      'get_library_song_paths_cached',
      'get_library_song_page',
      'get_library_songs_by_paths',
      'get_library_song_labels_for_all_view',
      'get_library_album_catalog_by_artist',
      'get_song_runtime_metadata',
    ];

    requiredCommands.forEach((command) => {
      expect(permissionFile).toContain(`"${command}"`);
    });
  });
});
