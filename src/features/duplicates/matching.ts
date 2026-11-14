import type { DuplicateSong } from './types';

export type DuplicateMatchMode = 'tags' | 'filename';

export interface DuplicateGroup {
  id: string;
  title: string;
  artist: string;
  songs: DuplicateSong[];
  recommendedPath: string;
}

export interface DuplicateMatchOptions {
  mode: DuplicateMatchMode;
  matchDuration: boolean;
}

const DURATION_TOLERANCE_SECONDS = 3;

/** 只归一化宽窄字符、大小写和空格，不移除 Live、伴奏等版本信息。 */
export function normalizeDuplicateText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function filenameStem(song: DuplicateSong): string {
  const filename = (song.name || song.path).split(/[\\/]/u).pop() || '';
  const extensionStart = filename.lastIndexOf('.');
  return extensionStart > 0 ? filename.slice(0, extensionStart) : filename;
}

function matchKey(song: DuplicateSong, mode: DuplicateMatchMode): string | null {
  if (mode === 'filename') {
    const filename = normalizeDuplicateText(filenameStem(song));
    return filename ? JSON.stringify(['filename', filename]) : null;
  }

  const title = normalizeDuplicateText(song.title);
  const artist = normalizeDuplicateText(song.artist);
  // 不将缺失标签的文件归为一个“未知歌名 / 未知歌手”组。
  return title && artist ? JSON.stringify(['tags', title, artist]) : null;
}

function positiveNumber(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function isLossless(song: DuplicateSong): boolean {
  const codec = normalizeDuplicateText(song.codec || '');
  if (/^(?:flac|alac|ape|wavpack|wav pack|pcm|dsd|truehd)(?:$|\b|_)/u.test(codec)) {
    return true;
  }
  // 未识别的编码（包括 ADPCM）不能因 WAV/AIFF 容器而被视为无损。
  if (codec) return false;
  const format = normalizeDuplicateText(song.format).replace(/^\./u, '');
  return ['flac', 'alac', 'ape', 'wv', 'dsf', 'dff'].includes(format);
}

/** 参数推荐并不代表听感或真实音源质量；路径仅用于相同参数时稳定排序。 */
export function compareDuplicateQuality(left: DuplicateSong, right: DuplicateSong): number {
  return (
    Number(isLossless(right)) - Number(isLossless(left)) ||
    positiveNumber(right.bit_depth) - positiveNumber(left.bit_depth) ||
    positiveNumber(right.sample_rate) - positiveNumber(left.sample_rate) ||
    positiveNumber(right.bitrate) - positiveNumber(left.bitrate) ||
    left.path.localeCompare(right.path)
  );
}

function createGroup(songs: DuplicateSong[], mode: DuplicateMatchMode): DuplicateGroup {
  const rankedSongs = [...songs].sort(compareDuplicateQuality);
  const recommended = rankedSongs[0];
  const artists = new Set(songs.map((song) => normalizeDuplicateText(song.artist)).filter(Boolean));

  return {
    // 完整路径列表避免哈希碰撞，排序确保扫描遍历顺序变化不会改变组 ID。
    id: JSON.stringify(songs.map((song) => song.path).sort()),
    title: mode === 'tags' ? recommended.title.trim() : filenameStem(recommended),
    artist: artists.size > 1 ? '不同歌手' : recommended.artist.trim() || '未知歌手',
    songs: rankedSongs,
    recommendedPath: recommended.path,
  };
}

export function findDuplicateGroups(
  songs: DuplicateSong[],
  options: DuplicateMatchOptions,
): DuplicateGroup[] {
  const buckets = new Map<string, DuplicateSong[]>();
  const seenPaths = new Set<string>();

  for (const song of songs) {
    if (seenPaths.has(song.path)) continue;
    seenPaths.add(song.path);

    const key = matchKey(song, options.mode);
    if (!key || (options.matchDuration && positiveNumber(song.duration) === 0)) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(song);
    else buckets.set(key, [song]);
  }

  const groups: DuplicateGroup[] = [];
  for (const songsWithSameKey of buckets.values()) {
    if (songsWithSameKey.length < 2) continue;
    if (!options.matchDuration) {
      groups.push(createGroup(songsWithSameKey, options.mode));
      continue;
    }

    const byDuration = [...songsWithSameKey].sort(
      (left, right) => left.duration - right.duration || left.path.localeCompare(right.path),
    );
    let cluster: DuplicateSong[] = [];
    for (const song of byDuration) {
      // 对照整组的最短时长，防止 180、183、186 秒经链式匹配合并。
      if (cluster.length > 0 && song.duration - cluster[0].duration > DURATION_TOLERANCE_SECONDS) {
        if (cluster.length > 1) groups.push(createGroup(cluster, options.mode));
        cluster = [];
      }
      cluster.push(song);
    }
    if (cluster.length > 1) groups.push(createGroup(cluster, options.mode));
  }

  return groups.sort(
    (left, right) => left.title.localeCompare(right.title, 'zh-CN') || left.id.localeCompare(right.id),
  );
}

export function duplicateSongBytes(song: DuplicateSong): number {
  return positiveNumber(song.file_size);
}
