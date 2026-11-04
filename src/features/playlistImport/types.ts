export interface SourceTrack {
  id?: string | null;
  title: string;
  artists: string[];
  album: string;
  duration?: number | null;
  path?: string | null;
}

export interface SourceDocument {
  name: string;
  kind: 'm3u' | 'list' | 'netease' | 'qq';
  source: string;
  tracks: SourceTrack[];
  total: number;
  warnings: string[];
}

export interface PathMapping { from: string; to: string }
export interface SourceInput { kind: 'url' | 'file' | 'text'; value: string; mapping?: PathMapping }
export interface PlaylistCandidate {
  path: string;
  title: string;
  artists: string[];
  album: string;
  duration: number;
  score: number;
  reason: string;
}
export interface TrackMatch { candidates: PlaylistCandidate[]; selectedPath: string | null }

export interface PlaylistImportData {
  document: SourceDocument;
  choices: (string | null)[];
  ignored: number[];
  linked: boolean;
  mapping: PathMapping;
  revision: string;
  updatedAt: string;
  error: string | null;
}

export interface FileBinding { id: string; path: string; revision: string; mapping: PathMapping }
export interface PlaylistFileUpdate {
  id: string;
  revision: string;
  document: SourceDocument | null;
  playablePaths: string[];
  error: string | null;
}

export const unresolvedCount = (data?: PlaylistImportData) => data
  ? data.document.tracks.filter((_, index) => !data.choices[index] && !data.ignored.includes(index)).length : 0;

export const matchKey = (doc: SourceDocument, track: SourceTrack) => track.path ? ''
  : track.id && (doc.kind === 'netease' || doc.kind === 'qq') ? `${doc.kind}:${track.id}`
    : JSON.stringify([track.title.normalize('NFKC').toLowerCase().trim(), [...track.artists].sort(), track.album]);

export function isPlaylistImportData(value: unknown): value is PlaylistImportData {
  if (!value || typeof value !== 'object') return false;
  const data = value as PlaylistImportData;
  const doc = data.document;
  return !!doc && ['m3u', 'list', 'netease', 'qq'].includes(doc.kind)
    && typeof doc.name === 'string' && typeof doc.source === 'string'
    && typeof doc.total === 'number' && Array.isArray(doc.warnings) && doc.warnings.every(s => typeof s === 'string')
    && Array.isArray(doc.tracks) && doc.tracks.length <= 10000 && doc.tracks.every(t => t && typeof t.title === 'string'
      && typeof t.album === 'string' && Array.isArray(t.artists) && t.artists.every(s => typeof s === 'string')
      && (t.path == null || typeof t.path === 'string'))
    && Array.isArray(data.choices) && data.choices.length === doc.tracks.length && data.choices.every(p => p === null || typeof p === 'string')
    && Array.isArray(data.ignored) && data.ignored.every(i => Number.isInteger(i) && i >= 0 && i < doc.tracks.length)
    && typeof data.linked === 'boolean' && (!data.linked || doc.kind === 'm3u')
    && !!data.mapping && typeof data.mapping.from === 'string' && typeof data.mapping.to === 'string'
    && typeof data.revision === 'string' && typeof data.updatedAt === 'string';
}
