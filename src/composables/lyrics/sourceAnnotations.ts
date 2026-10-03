import { getLyricsReadingRoles, type LyricsReadingRole } from './readingOrder';
import type { LyricsReadingOrder } from './types';

export type LyricsSourceRole = LyricsReadingRole | 'metadata' | 'other' | 'empty';

export interface LyricsSourceLine {
  /** One-based physical source line, including the final empty line. */
  number: number;
  /** Absolute UTF-16 offsets; to excludes the newline. */
  from: number;
  to: number;
  text: string;
  role: LyricsSourceRole;
  /** Start of a contiguous source block, never a request to reorder its rows. */
  groupStart: boolean;
  /** Absolute UTF-16 ranges, including delimiters, with exclusive to offsets. */
  timings: Array<{ from: number; to: number; kind: 'line' | 'word' }>;
}

export interface LyricsSourceAnalysis {
  lines: LyricsSourceLine[];
  hasWordTiming: boolean;
  hasAuxiliary: boolean;
  supportsRoles: boolean;
}

interface RolePrefix {
  offset: number;
  role?: LyricsReadingRole;
  conflict: boolean;
}

interface SourceEntry {
  line: LyricsSourceLine;
  family: 'lrc' | 'qrc' | 'yrc';
  times: number[];
  role?: LyricsReadingRole;
  roleConflict: boolean;
  protectedVocal: boolean;
  isBG: boolean;
  hasText: boolean;
}

interface TimeToken {
  from: number;
  to: number;
  time: number;
  kind: 'line' | 'word';
}

// Keep these explicit labels aligned with lib/lyrics/formats/lrc.ts. They
// describe source roles, not guesses based on the language of the lyric text.
const ROLE_PREFIXES: Array<[LyricsReadingRole, RegExp]> = [
  ['main', /^(?:\[(?:main|orig|original)\]|【原文】|原文[:：])\s*/iu],
  ['translation', /^(?:\[(?:tr|trans|translation)\]|【(?:翻译|译文)】|(?:翻译|译文)[:：])\s*/iu],
  ['roman', /^(?:\[(?:roma|romaji|roman)\]|【(?:罗马音|罗马字|音译)】|(?:罗马音|罗马字|音译)[:：])\s*/iu],
];
const LRC_TIME = /(\[|<)(\d{1,3}):(\d{1,2})(?:[.:](\d{1,6}))?(\]|>)/g;
const METADATA_LINE = /^\[\s*[a-z]+\s*:.*\]$/i;

function readRolePrefix(text: string, offset: number): RolePrefix {
  let role: LyricsReadingRole | undefined;
  let conflict = false;
  while (true) {
    const remaining = text.slice(offset);
    const found = ROLE_PREFIXES.map(([value, pattern]) => ({ value, match: pattern.exec(remaining) }))
      .find(({ match }) => match);
    if (!found?.match) break;
    if (role && role !== found.value) conflict = true;
    role ??= found.value;
    offset += found.match[0].length;
  }
  return { offset, role, conflict };
}

function lrcTokens(text: string): TimeToken[] {
  const tokens: TimeToken[] = [];
  for (const match of text.matchAll(LRC_TIME)) {
    const from = match.index!;
    const to = from + match[0].length;
    // A partial, mismatched, or nested-looking tag must remain fully editable.
    if ((match[1] === '[') !== (match[5] === ']') || Number(match[3]) > 59
      || text[from - 1] === '<' || text[from - 1] === '[' || /[>\]]/.test(text[to] ?? '')) continue;
    tokens.push({
      from,
      to,
      // The LRC reader pads/truncates fractions to milliseconds.
      time: Number(match[2]) * 60000 + Number(match[3]) * 1000
        + Number(`${match[4] ?? ''}000`.slice(0, 3)),
      kind: match[1] === '<' ? 'word' : 'line',
    });
  }
  return tokens;
}

function textWithoutTokens(text: string, offset: number, tokens: TimeToken[]): string {
  let cursor = offset;
  let content = '';
  for (const token of tokens) {
    if (token.from < offset) continue;
    content += text.slice(cursor, token.from);
    cursor = token.to;
  }
  return content + text.slice(cursor);
}

function readLrcEntry(line: LyricsSourceLine, previousMainTime?: number): SourceEntry | undefined {
  const text = line.text;
  const outer = readRolePrefix(text, text.length - text.trimStart().length);
  const tokens = lrcTokens(text);
  let cursor = outer.offset;
  const leading: TimeToken[] = [];
  for (const token of tokens) {
    if (token.from !== cursor) break;
    leading.push(token);
    cursor = token.to;
  }
  cursor += text.slice(cursor).length - text.slice(cursor).trimStart().length;
  const inner = readRolePrefix(text, cursor);
  const role = outer.role ?? inner.role;
  const roleConflict = outer.conflict || inner.conflict
    || Boolean(outer.role && inner.role && outer.role !== inner.role);
  const voice = /^\s*v([12])\s*:\s*(?=<\d)/i.exec(text.slice(inner.offset));
  const bodyOffset = inner.offset + (voice?.[0].length ?? 0);
  if (!leading.length && !role) return undefined;

  // Without a leading timestamp, only a labelled auxiliary/main can inherit the
  // previous main's time, matching the existing LRC parser's explicit policy.
  const sourceTokens = leading.length || previousMainTime !== undefined ? tokens : [];
  const content = textWithoutTokens(text, bodyOffset, sourceTokens).trim();
  const wordSynchronized = leading.some((token) => token.kind === 'word')
    || sourceTokens.some((token) => token.from >= bodyOffset);
  const times = leading.length
    ? wordSynchronized ? [leading[0].time] : [...new Set(leading.map((token) => token.time))]
    : previousMainTime === undefined ? [] : [previousMainTime];
  line.timings = sourceTokens.map(({ from, to, kind }) => ({ from: line.from + from, to: line.from + to, kind }));
  return {
    line,
    family: 'lrc',
    times,
    role,
    roleConflict,
    protectedVocal: Boolean(voice),
    isBG: /^[(（].*[)）]$/s.test(content),
    hasText: Boolean(content),
  };
}

function readMillisecondEntry(line: LyricsSourceLine): SourceEntry | undefined {
  const offset = line.text.length - line.text.trimStart().length;
  const header = /^\[(\d+),(\d+)\]/.exec(line.text.slice(offset));
  if (!header || !Number.isSafeInteger(Number(header[1])) || !Number.isSafeInteger(Number(header[2]))) return undefined;
  const bodyOffset = offset + header[0].length;
  const body = line.text.slice(bodyOffset);
  const isYrc = /^\s*\(\d+,\d+,0\)/.test(body);
  const pattern = isYrc ? /\((\d+),(\d+),0\)/g : /\((\d+),(\d+)\)/g;
  const tokens: TimeToken[] = [];
  for (const match of body.matchAll(pattern)) {
    if (!Number.isSafeInteger(Number(match[1])) || !Number.isSafeInteger(Number(match[2]))) continue;
    tokens.push({
      from: bodyOffset + match.index!,
      to: bodyOffset + match.index! + match[0].length,
      time: Number(match[1]),
      kind: 'word',
    });
  }
  if (!tokens.length) return undefined;
  const content = textWithoutTokens(line.text, bodyOffset, tokens).trim();
  line.timings = [
    { from: line.from + offset, to: line.from + bodyOffset, kind: 'line' },
    ...tokens.map(({ from, to, kind }) => ({ from: line.from + from, to: line.from + to, kind })),
  ];
  return {
    line,
    family: isYrc ? 'yrc' : 'qrc',
    times: [Number(header[1])],
    roleConflict: false,
    protectedVocal: false,
    isBG: /^[(（].*[)）]$/s.test(content),
    hasText: Boolean(content),
  };
}

function assignGroupRoles(
  group: SourceEntry[],
  readingOrder: LyricsReadingOrder,
): Map<LyricsReadingRole, SourceEntry> | undefined {
  if (!group.length || group.length > 3 || group.some((entry) => entry.roleConflict)) return undefined;
  const assigned = new Map<LyricsReadingRole, SourceEntry>();
  for (const entry of group) {
    if (!entry.role) continue;
    if (assigned.has(entry.role)) return undefined;
    assigned.set(entry.role, entry);
  }
  const unmarked = group.filter((entry) => !entry.role);
  if (!group.some((entry) => entry.protectedVocal)) {
    const roles = new Set(assigned.keys());
    if (roles.size < group.length) roles.add('main');
    for (const role of getLyricsReadingRoles(readingOrder, group.length as 1 | 2 | 3)) {
      if (roles.size < group.length) roles.add(role);
    }
    const remaining = getLyricsReadingRoles(readingOrder, 3)
      .filter((role) => roles.has(role) && !assigned.has(role));
    unmarked.forEach((entry, index) => {
      if (remaining[index]) assigned.set(remaining[index], entry);
    });
  } else if (!assigned.has('main') && unmarked.length === 1) {
    assigned.set('main', unmarked[0]);
  }
  return assigned;
}

/**
 * Annotates the editor's LF document without parsing it into a replacement text.
 * Unknown, incomplete, or ambiguous content stays in place and remains editable.
 */
export function analyzeLyricsSource(source: string, readingOrder: LyricsReadingOrder): LyricsSourceAnalysis {
  let from = 0;
  const lines: LyricsSourceLine[] = source.split('\n').map((text, index) => {
    const line: LyricsSourceLine = {
      number: index + 1, from, to: from + text.length, text,
      role: text.trim() ? 'other' : 'empty', groupStart: false, timings: [],
    };
    from += text.length + 1;
    return line;
  });
  // XML (including partially entered roots) is a different syntax. In
  // particular, numeric-looking text inside XML must not become fold widgets.
  if (/<\?xml\b|<!DOCTYPE\b|<QrcInfos\b|^\s*<\/?[a-z_][\w:.-]*(?=[\s/>])/im.test(source)) {
    return { lines, hasWordTiming: false, hasAuxiliary: false, supportsRoles: false };
  }

  const entries: SourceEntry[] = [];
  let previousMainTime: number | undefined;
  let previousVisibleGroup: string | undefined;
  for (const line of lines) {
    const trimmed = line.text.trim();
    if (METADATA_LINE.test(trimmed)) {
      line.role = 'metadata';
      previousVisibleGroup = undefined;
      continue;
    }
    if (!trimmed || /^(?:#|\/\/)/.test(trimmed)) {
      previousVisibleGroup = undefined;
      continue;
    }
    const entry = readMillisecondEntry(line) ?? readLrcEntry(line, previousMainTime);
    if (!entry) {
      previousVisibleGroup = undefined;
      continue;
    }
    entries.push(entry);
    if (!entry.hasText) {
      line.role = 'empty';
      previousVisibleGroup = undefined;
      continue;
    }
    if (entry.role && !entry.roleConflict) line.role = entry.role;
    const signature = entry.times.length ? `${entry.family}:${entry.times.join(',')}` : `untimed:${line.number}`;
    line.groupStart = signature !== previousVisibleGroup;
    previousVisibleGroup = signature;
    if (entry.family === 'lrc' && (!entry.role || entry.role === 'main') && entry.times.length) {
      previousMainTime = entry.times[entry.times.length - 1];
    }
  }

  const groups = new Map<string, SourceEntry[]>();
  for (const entry of entries) {
    if (!entry.hasText) continue;
    for (const time of entry.times) {
      const key = `${entry.family}:${time}`;
      const group = groups.get(key) ?? [];
      group.push(entry);
      groups.set(key, group);
    }
  }
  const proposals = new Map<SourceEntry, Set<LyricsReadingRole>>();
  const ambiguous = new Set<SourceEntry>();
  for (const candidates of groups.values()) {
    const backgroundRoles = assignGroupRoles(candidates, readingOrder);
    const group = backgroundRoles?.get('main')?.isBG ? candidates : candidates.filter((entry) => !entry.isBG);
    const assigned = assignGroupRoles(group, readingOrder);
    if (!assigned) {
      group.forEach((entry) => ambiguous.add(entry));
      continue;
    }
    const inferredEntries = new Set(assigned.values());
    group.forEach((entry) => {
      if (!inferredEntries.has(entry)) ambiguous.add(entry);
    });
    for (const [role, entry] of assigned) {
      const roles = proposals.get(entry) ?? new Set<LyricsReadingRole>();
      roles.add(role);
      proposals.set(entry, roles);
    }
  }
  for (const entry of entries) {
    if (entry.role || entry.roleConflict || ambiguous.has(entry)) continue;
    const roles = proposals.get(entry);
    if (roles?.size === 1) entry.line.role = [...roles][0];
  }

  return {
    lines,
    hasWordTiming: lines.some((line) => line.timings.some((timing) => timing.kind === 'word')),
    hasAuxiliary: lines.some((line) => line.role === 'translation' || line.role === 'roman'),
    supportsRoles: entries.some((entry) => entry.hasText),
  };
}
