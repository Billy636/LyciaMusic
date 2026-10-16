import type { LibraryScanSettings, LibraryScanSource } from '../../types';

export interface LibraryScanFormatOption {
  label: string;
  extensions: readonly string[];
  local: boolean;
  remote: boolean;
}

export const libraryScanFormatOptions: readonly LibraryScanFormatOption[] = [
  { label: 'MP3', extensions: ['mp3'], local: true, remote: true },
  { label: 'FLAC', extensions: ['flac'], local: true, remote: true },
  { label: 'WAV', extensions: ['wav'], local: true, remote: true },
  { label: 'AAC', extensions: ['aac'], local: true, remote: true },
  { label: 'M4A', extensions: ['m4a'], local: true, remote: true },
  { label: 'OGG', extensions: ['ogg', 'oga'], local: true, remote: true },
  { label: 'AIFF', extensions: ['aiff', 'aif'], local: true, remote: true },
  { label: 'M4B', extensions: ['m4b'], local: true, remote: false },
  { label: 'MP4', extensions: ['mp4'], local: true, remote: false },
  { label: 'OPUS', extensions: ['opus'], local: false, remote: true },
  { label: 'APE', extensions: ['ape'], local: false, remote: false },
  { label: 'WMA', extensions: ['wma'], local: false, remote: false },
  { label: 'DSF', extensions: ['dsf'], local: false, remote: false },
  { label: 'DFF', extensions: ['dff'], local: false, remote: false },
  { label: 'ISO', extensions: ['iso'], local: false, remote: false },
];

export function scanFormatExtensions(option: LibraryScanFormatOption, kind: LibraryScanSource['kind']) {
  return option.extensions.filter(extension => kind !== 'remote' || extension !== 'oga');
}

export function supportedScanExtensions(kind: LibraryScanSource['kind']) {
  return libraryScanFormatOptions.filter(option => option[kind])
    .flatMap(option => scanFormatExtensions(option, kind));
}

export function defaultLibraryScanSettings(kind: LibraryScanSource['kind']): LibraryScanSettings {
  return { includedExtensions: supportedScanExtensions(kind), readCue: kind === 'local', excludedDirectories: [] };
}

export function copyLibraryScanSettings(settings: LibraryScanSettings): LibraryScanSettings {
  return { includedExtensions: [...settings.includedExtensions], readCue: settings.readCue, excludedDirectories: [...settings.excludedDirectories] };
}

export function hasLibraryScanFormats(settings: LibraryScanSettings, kind: LibraryScanSource['kind']) {
  return supportedScanExtensions(kind).some(extension => settings.includedExtensions.includes(extension));
}

export function scanSettingsEqual(left: LibraryScanSettings, right: LibraryScanSettings) {
  return left.readCue === right.readCue
    && left.includedExtensions.length === right.includedExtensions.length
    && left.includedExtensions.every(extension => right.includedExtensions.includes(extension))
    && left.excludedDirectories.length === right.excludedDirectories.length
    && left.excludedDirectories.every(directory => right.excludedDirectories.includes(directory));
}

export function normalizeScanDirectory(path: string, kind: LibraryScanSource['kind']) {
  const slashPath = path.replace(/\\/g, '/').replace(/^\/\/\?\/UNC\//i, '//').replace(/^\/\/\?\//, '');
  const prefix = slashPath.startsWith('//') ? '//' : slashPath.startsWith('/') ? '/' : '';
  const parts: string[] = [];
  for (const part of slashPath.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  const normalized = prefix + parts.join('/');
  return kind === 'remote' ? normalized || '/' : normalized;
}

export function relativeScanDirectory(path: string, root: string, kind: LibraryScanSource['kind']) {
  const normalizedPath = normalizeScanDirectory(path, kind);
  const normalizedRoot = normalizeScanDirectory(root, kind);
  if (!normalizedRoot) return null;
  const prefix = normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`;
  const pathKey = kind === 'local' ? normalizedPath.toLowerCase() : normalizedPath;
  const prefixKey = kind === 'local' ? prefix.toLowerCase() : prefix;
  return pathKey.startsWith(prefixKey) ? normalizedPath.slice(prefix.length) || null : null;
}
