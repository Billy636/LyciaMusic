import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';

import {
  escapeFontFamilyName,
  extractPrimaryFontFamily,
  LYRICS_FONT_OPTIONS,
  normalizeCustomFontName,
  normalizeLyricsFontPreset,
  type LyricsFontOption,
} from './constants';
import type { ImportedLyricsFont } from '../../types';

const builtinPrimaryFontFamilies = new Set(
  LYRICS_FONT_OPTIONS
    .map((option) => extractPrimaryFontFamily(option.fontFamily).toLocaleLowerCase())
    .filter(Boolean),
);

export function getLyricsFontFamily(preset: string): string {
  return LYRICS_FONT_OPTIONS.find((option) => option.value === preset)?.fontFamily
    ?? `${escapeFontFamilyName(normalizeLyricsFontPreset(preset))}, system-ui, sans-serif`;
}

export function buildImportedLyricsFontOptions(fonts: ImportedLyricsFont[]): LyricsFontOption[] {
  return fonts.map((font) => ({
    value: font.family,
    label: font.name,
    fontFamily: `${escapeFontFamilyName(font.family)}, system-ui, sans-serif`,
    isImported: true,
  }));
}

let importedLyricsFontStyleEl: HTMLStyleElement | null = null;
let importedLyricsFontRegistrationVersion = 0;
const importedLyricsFontFaces = new Map<string, FontFace>();
export const importedLyricsFontsRevision = ref(0);

async function loadImportedLyricsFontSource(font: ImportedLyricsFont): Promise<string | null> {
  try {
    return await invoke<string>('read_lyrics_font_data_url', { fontPath: font.filePath });
  } catch (error) {
    console.warn('Failed to load imported lyrics font:', font.name, error);
    return null;
  }
}

async function createImportedLyricsFontFace(
  font: ImportedLyricsFont,
  sourceUrl: string,
): Promise<FontFace | null> {
  if (typeof FontFace === 'undefined') {
    return null;
  }

  try {
    const fontFace = new FontFace(font.family, `url(${JSON.stringify(sourceUrl)})`, { display: 'swap' });
    await fontFace.load();
    return fontFace;
  } catch (error) {
    console.warn('Failed to create imported lyrics FontFace:', font.name, error);
    return null;
  }
}

function clearRegisteredImportedLyricsFontFaces() {
  if (typeof document !== 'undefined' && 'fonts' in document) {
    for (const fontFace of importedLyricsFontFaces.values()) {
      document.fonts.delete(fontFace);
    }
  }
  importedLyricsFontFaces.clear();
}

export async function registerImportedLyricsFonts(fonts: ImportedLyricsFont[]) {
  if (typeof document === 'undefined') return;

  if (!importedLyricsFontStyleEl) {
    importedLyricsFontStyleEl = document.createElement('style');
    importedLyricsFontStyleEl.setAttribute('data-lycia-imported-lyrics-fonts', 'true');
    document.head.appendChild(importedLyricsFontStyleEl);
  }

  const registrationVersion = ++importedLyricsFontRegistrationVersion;
  if (fonts.length === 0) {
    importedLyricsFontStyleEl.textContent = '';
    clearRegisteredImportedLyricsFontFaces();
    importedLyricsFontsRevision.value += 1;
    return;
  }

  const fontFaceEntries = await Promise.all(fonts.map(async (font) => {
    const sourceUrl = await loadImportedLyricsFontSource(font);
    if (!sourceUrl) return null;
    const fontFace = await createImportedLyricsFontFace(font, sourceUrl);
    if (!fontFace) return null;

    return { font, fontFace };
  }));

  if (registrationVersion !== importedLyricsFontRegistrationVersion) return;

  importedLyricsFontStyleEl.textContent = '';
  clearRegisteredImportedLyricsFontFaces();
  for (const entry of fontFaceEntries) {
    if (!entry) continue;
    importedLyricsFontFaces.set(entry.font.family, entry.fontFace);
    document.fonts.add(entry.fontFace);
  }
  importedLyricsFontsRevision.value += 1;
}

export async function importLyricsFontFile(sourcePath: string): Promise<ImportedLyricsFont> {
  return invoke<ImportedLyricsFont>('import_lyrics_font', { sourcePath });
}

export const systemLyricsFontOptions = ref<LyricsFontOption[]>([]);
let loadSystemLyricsFontsTask: Promise<void> | null = null;
let systemLyricsFontsLoaded = false;

function buildSystemLyricsFontOptions(fontFamilies: string[]): LyricsFontOption[] {
  const uniqueFamilies = new Set<string>();

  for (const family of fontFamilies) {
    const normalized = normalizeCustomFontName(family);
    if (!normalized) continue;
    if (builtinPrimaryFontFamilies.has(normalized.toLocaleLowerCase())) continue;
    uniqueFamilies.add(normalized);
  }

  return Array.from(uniqueFamilies)
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .map((family) => ({
      value: family,
      label: family,
      fontFamily: `${escapeFontFamilyName(family)}, system-ui, sans-serif`,
      isSystem: true,
    }));
}

export async function loadSystemLyricsFonts(force = false) {
  if (systemLyricsFontsLoaded && !force) return;
  if (loadSystemLyricsFontsTask) return loadSystemLyricsFontsTask;

  loadSystemLyricsFontsTask = (async () => {
    try {
      const fonts = await invoke<string[]>('get_system_fonts');
      systemLyricsFontOptions.value = buildSystemLyricsFontOptions(fonts);
    } catch (error) {
      console.warn('Failed to load system fonts:', error);
      systemLyricsFontOptions.value = [];
    } finally {
      systemLyricsFontsLoaded = true;
      loadSystemLyricsFontsTask = null;
    }
  })();

  return loadSystemLyricsFontsTask;
}
