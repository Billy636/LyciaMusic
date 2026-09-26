import { getLyricsReadingRoles, type LyricsReadingRole } from './readingOrder';
import { withAlignedRomanization } from './romanization';
import type { LyricsReadingOrder } from './types';
import type { NativeAmlLyricLine, NativeAmlLyricWord } from './ttml';

export interface ReadingOrderLyricEntry {
  line: NativeAmlLyricLine;
  role?: LyricsReadingRole;
  roleConflict?: boolean;
  /** A supplied singer identity must not be mistaken for a language slot. */
  protectedVocal?: boolean;
  /** Timestamp before offset clamping; distinct source times must stay distinct. */
  sourceTime?: number;
}

interface IndexedEntry {
  entry: ReadingOrderLyricEntry;
  index: number;
}

function cloneWords(words: NativeAmlLyricWord[]): NativeAmlLyricWord[] {
  return words.map((word) => ({ ...word, ruby: word.ruby?.map((ruby) => ({ ...ruby })) }));
}

function cloneLine(line: NativeAmlLyricLine): NativeAmlLyricLine {
  return {
    ...line,
    words: cloneWords(line.words),
    romanWords: line.romanWords && cloneWords(line.romanWords),
    translationWords: line.translationWords && cloneWords(line.translationWords),
  };
}

function textOf(line: NativeAmlLyricLine): string {
  return line.words.map((word) => word.word).join('');
}

/**
 * Interpret exact-time lyric groups using an explicit user convention, never a
 * language heuristic. Input order and every supplied timestamp are immutable.
 */
export function groupLyricsByReadingOrder(
  entries: readonly ReadingOrderLyricEntry[],
  readingOrder?: LyricsReadingOrder,
): { lines: NativeAmlLyricLine[]; issues: string[] } {
  const output: Array<NativeAmlLyricLine | undefined> = entries.map(({ line }) => cloneLine(line));
  const issues: string[] = [];
  const groups = new Map<number, IndexedEntry[]>();
  entries.forEach((entry, index) => {
    // Background vocals and clear records retain their original identities and
    // positions; neither occupies a main/translation/romanization slot.
    if (entry.line.isBG || !textOf(entry.line).trim()) return;
    const time = entry.sourceTime ?? entry.line.startTime;
    const group = groups.get(time) ?? [];
    group.push({ entry, index });
    groups.set(time, group);
  });

  for (const group of groups.values()) {
    if (group.length > 3) {
      issues.push('同时间歌词超过三行，已保留原内容。');
      continue;
    }
    const assigned = new Map<LyricsReadingRole, IndexedEntry>();
    let conflict = group.some(({ entry }) => entry.roleConflict);
    for (const item of group) {
      if (!item.entry.role) continue;
      if (assigned.has(item.entry.role)) conflict = true;
      assigned.set(item.entry.role, item);
    }
    if (conflict) {
      issues.push('歌词角色标记冲突，已保留原内容。');
      continue;
    }

    const unmarked = group.filter(({ entry }) => !entry.role);
    const hasVocalIdentity = group.some(({ entry }) => entry.protectedVocal || entry.line.isDuet);
    if (readingOrder !== undefined && !hasVocalIdentity) {
      const count = group.length as 1 | 2 | 3;
      const roles = new Set(assigned.keys());
      if (roles.size < count) roles.add('main');
      for (const role of getLyricsReadingRoles(readingOrder, count)) {
        if (roles.size < count) roles.add(role);
      }
      // Explicit labels take precedence, including a labelled romanization in
      // a two-line group. Only *unlabelled* pairs unconditionally omit roman.
      const remaining = getLyricsReadingRoles(readingOrder, 3)
        .filter((role) => roles.has(role) && !assigned.has(role));
      unmarked.forEach((item, index) => {
        if (remaining[index]) assigned.set(remaining[index], item);
      });
    } else if (!assigned.has('main') && unmarked.length === 1) {
      // With no user convention (or with explicit vocal identities), retain
      // unmarked rows. A unique remaining main still hosts explicitly labelled
      // auxiliaries, as it did before manual reading order was introduced.
      assigned.set('main', unmarked[0]);
    }

    const main = assigned.get('main');
    const translation = assigned.get('translation');
    const roman = assigned.get('roman');
    if (!main) {
      if (translation || roman) issues.push('辅助行没有唯一对应正文，已保留为独立行。');
      else if (unmarked.length > 1) issues.push('同时间的未标注歌词保留为独立行。');
      continue;
    }
    if (!translation && !roman) {
      if (unmarked.length > 1) issues.push('同时间的未标注歌词保留为独立行。');
      continue;
    }
    const original = main.entry.line;
    if ((translation && (original.translatedLyric || original.translationWords?.length))
      || (roman && (original.romanLyric || original.romanWords?.length
        || original.words.some((word) => word.romanWord)))) {
      issues.push('歌词角色与已有辅助内容冲突，已保留原内容。');
      continue;
    }

    let merged = cloneLine(original);
    if (translation) {
      merged.translatedLyric = textOf(translation.entry.line);
      merged.translationWords = cloneWords(translation.entry.line.words);
    }
    if (roman) {
      merged.romanWords = cloneWords(roman.entry.line.words);
      merged = withAlignedRomanization(merged, issues);
    }
    const consumed = [main, translation, roman].filter((item): item is IndexedEntry => Boolean(item));
    const firstIndex = Math.min(...consumed.map((item) => item.index));
    consumed.forEach(({ index }) => { output[index] = undefined; });
    output[firstIndex] = merged;
  }

  return {
    lines: output.filter((line): line is NativeAmlLyricLine => line !== undefined),
    issues: [...new Set(issues)],
  };
}
