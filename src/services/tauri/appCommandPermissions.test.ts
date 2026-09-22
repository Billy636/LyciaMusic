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
      'get_library_song_path_page_for_all_view',
      'get_library_songs_by_paths',
      'get_library_song_labels_for_all_view',
      'get_search_index_status',
      'get_search_index_batch',
      'upsert_search_index_batch',
      'get_library_album_catalog_by_artist',
      'get_song_runtime_metadata',
    ];

    requiredCommands.forEach((command) => {
      expect(permissionFile).toContain(`"${command}"`);
    });
  });

  it('allows the native immersive fullscreen transition', () => {
    expect(permissionFile).toContain('"set_immersive_fullscreen"');
  });

  it('allows on-demand audio visualizer sampling control', () => {
    expect(permissionFile).toContain('"set_audio_visualizer_enabled"');
  });

  it('registers and authorizes every native desktop lyrics command for the main window', () => {
    const nativeBridge = readFileSync(new URL('../../features/desktopLyrics/native.ts', import.meta.url), 'utf8') as string;
    const backend = readFileSync(new URL('../../../src-tauri/src/lib.rs', import.meta.url), 'utf8') as string;
    const capability = JSON.parse(readFileSync(
      new URL('../../../src-tauri/capabilities/default.json', import.meta.url), 'utf8',
    )) as { windows: string[]; permissions: string[] };
    const commands = [...nativeBridge.matchAll(/invoke<void>\('(native_desktop_lyrics_\w+)'/g)]
      .map((match) => match[1]);
    const allowedCommands = new Set(
      [...(permissionFile.match(/commands\.allow\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? '').matchAll(/"([^"]+)"/g)]
        .map((match) => match[1]),
    );
    const handlers = backend.match(/tauri::generate_handler!\[([\s\S]*?)\]/)?.[1] ?? '';

    expect(commands).toHaveLength(5);
    expect(capability.windows).toContain('main');
    expect(capability.permissions).toContain('allow-app-commands');
    for (const command of commands) {
      expect(handlers).toContain(`desktop_lyrics::${command},`);
      expect(allowedCommands.has(command), `${command} must be allowed by the application ACL`).toBe(true);
    }
  });
});
