import { afterEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ isTauri: vi.fn(() => true), invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/api/core', () => mock);
import { nativeDesktopLyrics, usesNativeDesktopLyrics } from './native';

afterEach(() => { vi.unstubAllGlobals(); mock.isTauri.mockReturnValue(true); });
describe('native desktop lyrics platform routing', () => {
  it('only selects native rendering inside Windows Tauri', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
    expect(usesNativeDesktopLyrics()).toBe(true);
    mock.isTauri.mockReturnValue(false);
    expect(usesNativeDesktopLyrics()).toBe(false);
    mock.isTauri.mockReturnValue(true);
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh)' });
    expect(usesNativeDesktopLyrics()).toBe(false);
  });
  it('closes the native worker through the registered command', async () => {
    await nativeDesktopLyrics.close();
    expect(mock.invoke).toHaveBeenCalledWith('native_desktop_lyrics_close');
  });
});
