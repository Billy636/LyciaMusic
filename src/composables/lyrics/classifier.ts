import type {
  ClassifiedGroupResult,
  ClassificationConfidence,
  DominantScript,
  LineScriptProfile,
  ParsedLine,
  SemanticLine,
} from './types';

const MAX_GROUP_TOLERANCE_MS = 50;
const ROMAN_ALIGNMENT_TOLERANCE_MS = 80;

function resolveDominantScript(profile: Omit<LineScriptProfile, 'dominantScript'>): DominantScript {
  const counts = [
    ['latin', profile.latinCount],
    ['han', profile.hanCount],
    ['kana', profile.kanaCount],
    ['hangul', profile.hangulCount],
  ] as const;
  const total = counts.reduce((sum, [, count]) => sum + count, 0);

  if (total === 0) return 'other';

  const sorted = [...counts].sort((left, right) => right[1] - left[1]);
  const [dominantScript, dominantCount] = sorted[0];
  const secondaryCount = sorted[1]?.[1] ?? 0;

  if (secondaryCount > 0 && dominantCount / total < 0.7) {
    return 'mixed';
  }

  return dominantScript;
}

export function getLineScriptProfile(text: string): LineScriptProfile {
  const baseProfile = {
    latinCount: 0,
    hanCount: 0,
    kanaCount: 0,
    hangulCount: 0,
  };

  for (const char of text) {
    if (/\p{Script=Latin}/u.test(char)) {
      baseProfile.latinCount += 1;
      continue;
    }
    if (/[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]/u.test(char)) {
      baseProfile.kanaCount += 1;
      continue;
    }
    if (/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/u.test(char)) {
      baseProfile.hangulCount += 1;
      continue;
    }
    if (/\p{Script=Han}/u.test(char)) {
      baseProfile.hanCount += 1;
    }
  }

  return {
    ...baseProfile,
    dominantScript: resolveDominantScript(baseProfile),
  };
}

function hasExplicitSecondary(line: ParsedLine): boolean {
  return Boolean(line.explicitRole);
}

function hasParserNativeSecondary(line: ParsedLine): boolean {
  return Boolean(line.translatedText || line.romanText || line.words?.some((word) => word.romanText));
}

function isPureLatin(profile: LineScriptProfile): boolean {
  return profile.latinCount > 0
    && profile.hanCount === 0
    && profile.kanaCount === 0
    && profile.hangulCount === 0;
}

function isPureHan(profile: LineScriptProfile): boolean {
  return profile.hanCount > 0
    && profile.latinCount === 0
    && profile.kanaCount === 0
    && profile.hangulCount === 0;
}

function isChineseDominantLine(profile: LineScriptProfile): boolean {
  return profile.hanCount > 0
    && profile.hanCount > profile.latinCount
    && profile.kanaCount === 0
    && profile.hangulCount === 0;
}

function getContentText(line: ParsedLine): string {
  return line.text || line.translatedText || line.romanText || '';
}

function isForeignLanguageLine(line: ParsedLine): boolean {
  const profile = getContentProfile(line);
  return !isChineseDominantLine(profile)
    && !isPureHan(profile)
    && /\p{Letter}/u.test(getContentText(line));
}

function isJapaneseLike(profile: LineScriptProfile): boolean {
  return profile.kanaCount > 0
    && profile.hangulCount === 0;
}

function isKoreanLike(profile: LineScriptProfile): boolean {
  return profile.hangulCount > 0
    && profile.kanaCount === 0;
}

function getContentProfile(line: ParsedLine): LineScriptProfile {
  return getLineScriptProfile(getContentText(line));
}

function getEffectiveTolerance(
  currentStartMs: number,
  prevStartMs: number | null,
  nextStartMs: number | null,
): number {
  const prevGap = prevStartMs !== null
    ? Math.abs(currentStartMs - prevStartMs)
    : Number.POSITIVE_INFINITY;
  const nextGap = nextStartMs !== null
    ? Math.abs(nextStartMs - currentStartMs)
    : Number.POSITIVE_INFINITY;

  return Math.min(
    MAX_GROUP_TOLERANCE_MS,
    prevGap * 0.25,
    nextGap * 0.25,
  );
}

function findContextStart(
  lines: ParsedLine[],
  originIndex: number,
  direction: -1 | 1,
): number | null {
  const originStartMs = lines[originIndex].startMs;

  for (let index = originIndex + direction; index >= 0 && index < lines.length; index += direction) {
    const candidateStartMs = lines[index].startMs;
    if (Math.abs(candidateStartMs - originStartMs) > MAX_GROUP_TOLERANCE_MS) {
      return candidateStartMs;
    }
  }

  return null;
}

function getGroupTolerance(lines: ParsedLine[], groupStartIndex: number): number {
  return getEffectiveTolerance(
    lines[groupStartIndex].startMs,
    findContextStart(lines, groupStartIndex, -1),
    findContextStart(lines, groupStartIndex, 1),
  );
}

function groupParsedLines(lines: ParsedLine[]): ParsedLine[][] {
  if (lines.length === 0) return [];

  const groups: ParsedLine[][] = [];
  let groupStartIndex = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const currentGroup = groups[groups.length - 1];

    if (!currentGroup) {
      groups.push([line]);
      groupStartIndex = index;
      continue;
    }

    const tolerance = getGroupTolerance(lines, groupStartIndex);
    const withinTolerance = Math.abs(line.startMs - currentGroup[0].startMs) <= tolerance;

    if (withinTolerance) {
      currentGroup.push(line);
      continue;
    }

    groups.push([line]);
    groupStartIndex = index;
  }

  return groups;
}

function selectHeuristicMainLine(lines: ParsedLine[]): ParsedLine {
  const japaneseLine = lines.find((line) => isJapaneseLike(getContentProfile(line)));
  if (japaneseLine) return japaneseLine;

  const koreanLine = lines.find((line) => isKoreanLike(getContentProfile(line)));
  if (koreanLine) return koreanLine;

  if (lines.length === 2) {
    const chineseLine = lines.find((line) => isChineseDominantLine(getContentProfile(line)));
    const foreignLine = lines.find((line) => isForeignLanguageLine(line));
    if (foreignLine && chineseLine) return foreignLine;
  }

  return lines[0];
}

function classifyHeuristicRole(
  main: ParsedLine,
  candidate: ParsedLine,
): 'translation' | 'romaji' | 'secondary' {
  const mainProfile = getContentProfile(main);
  const candidateProfile = getContentProfile(candidate);

  if (isJapaneseLike(mainProfile) || isKoreanLike(mainProfile)) {
    if (isPureLatin(candidateProfile)) return 'romaji';
    if (isChineseDominantLine(candidateProfile)) return 'translation';
    return 'secondary';
  }

  switch (mainProfile.dominantScript) {
    case 'han':
      return isPureLatin(candidateProfile) ? 'romaji' : 'secondary';
    case 'latin':
      return isChineseDominantLine(candidateProfile) ? 'translation' : 'secondary';
    default:
      return isChineseDominantLine(candidateProfile) ? 'translation' : 'secondary';
  }
}

export function classifyGroupLines(group: ParsedLine[]): ClassifiedGroupResult {
  const explicitTranslationLines = group.filter((line) => line.explicitRole === 'translation');
  const explicitRomajiLines = group.filter((line) => line.explicitRole === 'roman');
  const regularLines = group.filter((line) => !line.explicitRole);

  const parserNativeMain = regularLines.find((line) => hasParserNativeSecondary(line));
  const main = parserNativeMain
    ?? selectHeuristicMainLine(regularLines.length > 0 ? regularLines : group);

  const remainingRegularLines = regularLines.filter((line) => line !== main);

  let translationLine = explicitTranslationLines[0] ?? null;
  let romajiLine = explicitRomajiLines[0] ?? null;
  const secondaryLines: ParsedLine[] = [
    ...explicitTranslationLines.slice(1),
    ...explicitRomajiLines.slice(1),
  ];

  for (const line of remainingRegularLines) {
    const role = classifyHeuristicRole(main, line);

    if (role === 'translation' && !translationLine && !main.translatedText) {
      translationLine = line;
      continue;
    }

    if (role === 'romaji' && !romajiLine && !main.romanText && !main.words?.some((word) => word.romanText)) {
      romajiLine = line;
      continue;
    }

    secondaryLines.push(line);
  }

  let confidence: ClassificationConfidence = 'heuristic';
  if (hasExplicitSecondary(main) || explicitTranslationLines.length > 0 || explicitRomajiLines.length > 0) {
    confidence = 'explicit';
  } else if (hasParserNativeSecondary(main)) {
    confidence = 'parser-native';
  }

  return {
    main,
    translationLine,
    romajiLine,
    secondaryLines,
    confidence,
  };
}

function normalizeRomanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function mergeAlignedRomanWords(main: ParsedLine, romajiLine: ParsedLine | null): SemanticLine['romanWords'] {
  const mainWords = main.words ?? [];

  if (mainWords.some((word) => word.romanText)) {
    const nativeRomanWords = mainWords.map((word) => ({
      text: normalizeRomanText(word.romanText || ''),
      startMs: word.startMs,
      endMs: word.endMs,
    }));
    return nativeRomanWords.every((word) => word.text.length > 0)
      ? nativeRomanWords
      : undefined;
  }

  const romajiWords = romajiLine?.words ?? [];
  if (mainWords.length === 0 || romajiWords.length === 0) return romajiWords.length > 0 ? romajiWords : undefined;
  if (mainWords.length === romajiWords.length) {
    const allAligned = mainWords.every((word, index) => {
      const romajiWord = romajiWords[index];
      return Math.abs(word.startMs - romajiWord.startMs) <= ROMAN_ALIGNMENT_TOLERANCE_MS
        && Math.abs(word.endMs - romajiWord.endMs) <= ROMAN_ALIGNMENT_TOLERANCE_MS;
    });

    if (allAligned) {
      const alignedRomanWords = romajiWords.map((word) => ({
        text: normalizeRomanText(word.text),
        startMs: word.startMs,
        endMs: word.endMs,
      }));
      return alignedRomanWords.every((word) => word.text.length > 0)
        ? alignedRomanWords
        : undefined;
    }
  }

  const mergedTexts = mainWords.map(() => '');

  for (const romajiWord of romajiWords) {
    const romajiCenter = (romajiWord.startMs + romajiWord.endMs) / 2;
    let bestIndex = -1;
    let bestOverlap = Number.NEGATIVE_INFINITY;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < mainWords.length; index += 1) {
      const mainWord = mainWords[index];
      const expandedStart = mainWord.startMs - ROMAN_ALIGNMENT_TOLERANCE_MS;
      const expandedEnd = mainWord.endMs + ROMAN_ALIGNMENT_TOLERANCE_MS;
      const overlap = Math.min(expandedEnd, romajiWord.endMs) - Math.max(expandedStart, romajiWord.startMs);
      const mainCenter = (mainWord.startMs + mainWord.endMs) / 2;
      const distance = Math.abs(mainCenter - romajiCenter);

      if (
        overlap > bestOverlap
        || (overlap === bestOverlap && distance < bestDistance)
      ) {
        bestIndex = index;
        bestOverlap = overlap;
        bestDistance = distance;
      }
    }

    if (bestIndex >= 0) {
      mergedTexts[bestIndex] += romajiWord.text;
    }
  }

  const mergedRomanWords = mainWords.map((word, index) => ({
    text: normalizeRomanText(mergedTexts[index]),
    startMs: word.startMs,
    endMs: word.endMs,
  }));

  return mergedRomanWords.every((word) => word.text.length > 0)
    ? mergedRomanWords
    : undefined;
}

export function buildSemanticLines(lines: ParsedLine[]): SemanticLine[] {
  return groupParsedLines(lines)
    .map((group) => {
      const {
        main,
        translationLine,
        romajiLine,
        secondaryLines,
        confidence,
      } = classifyGroupLines(group);
      const endMs = Math.max(
        main.endMs ?? main.startMs,
        ...group.map((line) => line.endMs ?? line.startMs),
      );
      const romanWords = mergeAlignedRomanWords(main, romajiLine);
      const secondaryTexts = secondaryLines
        .map((line) => line.text)
        .filter((text) => text.length > 0);

      return {
        startMs: main.startMs,
        endMs,
        mainText: main.text,
        mainWords: main.words,
        translationText: main.translatedText || translationLine?.text || undefined,
        romanText: main.romanText || romajiLine?.text || undefined,
        romanWords,
        secondaryTexts: secondaryTexts.length > 0 ? secondaryTexts : undefined,
        confidence,
      } satisfies SemanticLine;
    })
    .filter((line) => line.mainText.length > 0 || line.translationText || line.romanText);
}
