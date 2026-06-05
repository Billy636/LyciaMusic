import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

describe('imported lyrics font registration', () => {
  beforeEach(() => {
    vi.resetModules();
    invokeMock.mockReset();

    vi.stubGlobal('FontFace', vi.fn(function FontFaceMock(this: { load: () => Promise<unknown> }) {
      this.load = vi.fn(async () => this);
    }));

    const head = {
      appended: [] as Array<{ textContent: string; setAttribute: (name: string, value: string) => void }>,
      appendChild(element: { textContent: string; setAttribute: (name: string, value: string) => void }) {
        this.appended.push(element);
      },
    };

    vi.stubGlobal('document', {
      head,
      fonts: {
        add: vi.fn(),
        delete: vi.fn(),
      },
      createElement: () => ({
        textContent: '',
        setAttribute: vi.fn(),
      }),
    });
  });

  it('loads imported fonts via FontFace API using data URLs', async () => {
    invokeMock.mockResolvedValue('data:font/ttf;base64,AAECAw==');
    const { importedLyricsFontsRevision, registerImportedLyricsFonts } = await import('./fontUtils');

    await registerImportedLyricsFonts([{
      id: 'font-id',
      name: 'Long Custom Font',
      family: 'Lycia Imported Lyrics Font font-id',
      filePath: 'C:\\Users\\lover\\AppData\\Roaming\\com.lover.lyciaplayer\\custom-lyrics-fonts\\font-id.ttf',
      importedAt: 1,
      format: 'truetype',
    }]);

    expect(invokeMock).toHaveBeenCalledWith('read_lyrics_font_data_url', {
      fontPath: 'C:\\Users\\lover\\AppData\\Roaming\\com.lover.lyciaplayer\\custom-lyrics-fonts\\font-id.ttf',
    });
    expect(FontFace).toHaveBeenCalledWith(
      'Lycia Imported Lyrics Font font-id',
      'url("data:font/ttf;base64,AAECAw==")',
      { display: 'swap' },
    );
    expect(document.fonts.add).toHaveBeenCalled();
    expect(importedLyricsFontsRevision.value).toBe(1);
  });
});
