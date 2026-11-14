import { invertedEffects } from '@codemirror/commands';
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Text,
  type Transaction,
} from '@codemirror/state';

type LineEnding = '\n' | '\r\n' | '\r';

interface SourceDocumentValue {
  raw: string;
  /** UTF-16 offsets in raw, not in CodeMirror's LF-normalized document. */
  lineStarts: readonly number[];
  lineEndings: readonly LineEnding[];
}

function readSource(raw: string): SourceDocumentValue {
  const lineStarts = [0];
  const lineEndings: LineEnding[] = [];
  for (const match of raw.matchAll(/\r\n|\r|\n/g)) {
    const ending = match[0] as LineEnding;
    lineEndings.push(ending);
    lineStarts.push(match.index! + ending.length);
  }
  return { raw, lineStarts, lineEndings };
}

function rawPosition(source: SourceDocumentValue, doc: Text, position: number): number {
  const line = doc.lineAt(position);
  return source.lineStarts[line.number - 1] + position - line.from;
}

function sameLineEndings(left: readonly LineEnding[], right: readonly LineEnding[]): boolean {
  return left.length === right.length && left.every((ending, index) => ending === right[index]);
}

function spliceSource(
  source: SourceDocumentValue,
  transaction: Transaction,
  insertedLineEnding: LineEnding,
): SourceDocumentValue {
  const pieces: string[] = [];
  const endings: LineEnding[] = [];
  const insertedEndings = new Set<number>();
  let rawCursor = 0;
  let endingCursor = 0;
  const appendExistingEndings = (to: number) => {
    while (endingCursor < to) endings.push(source.lineEndings[endingCursor++]);
  };

  transaction.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    const oldDoc = transaction.startState.doc;
    const rawFrom = rawPosition(source, oldDoc, from);
    const rawTo = rawPosition(source, oldDoc, to);
    pieces.push(source.raw.slice(rawCursor, rawFrom),
      inserted.sliceString(0, inserted.length, insertedLineEnding));
    rawCursor = rawTo;

    appendExistingEndings(oldDoc.lineAt(from).number - 1);
    endingCursor = oldDoc.lineAt(to).number - 1;
    for (let line = 1; line < inserted.lines; line += 1) {
      insertedEndings.add(endings.length);
      endings.push(insertedLineEnding);
    }
  });
  pieces.push(source.raw.slice(rawCursor));
  appendExistingEndings(source.lineEndings.length);

  // Two separate CR and LF endings must not accidentally become one CRLF when
  // an edit makes their intervening line empty. Prefer changing the newly
  // inserted ending to CRLF. If deleting text joins two existing endings, the
  // minimal guard adds a CR before the old LF, retaining both existing bytes.
  // The newline-only history snapshot restores the exact original on undo.
  let repairedBoundary = false;
  for (let index = 0; index + 1 < endings.length; index += 1) {
    if (endings[index] !== '\r' || endings[index + 1] !== '\n'
      || transaction.newDoc.line(index + 2).length !== 0) continue;
    const target = insertedEndings.has(index) && !insertedEndings.has(index + 1)
      ? index : index + 1;
    endings[target] = '\r\n';
    repairedBoundary = true;
  }

  let nextRaw = pieces.join('');
  if (repairedBoundary) {
    let index = 0;
    nextRaw = transaction.newDoc.toString().replace(/\n/g, () => endings[index++]);
  }
  return nextRaw === source.raw ? source : readSource(nextRaw);
}

function restoreLineEndings(
  source: SourceDocumentValue,
  endings: readonly LineEnding[],
): SourceDocumentValue {
  // History effects describe the complete pre-edit newline sequence. External
  // document loads must create a new state/history instead of mapping these
  // snapshots through unrelated, non-history document replacements.
  if (endings.length !== source.lineEndings.length
    || sameLineEndings(endings, source.lineEndings)) return source;
  let index = 0;
  return readSource(source.raw.replace(/\r\n|\r|\n/g, () => endings[index++]));
}

/**
 * Keep a lossless source alongside CodeMirror's LF-normalized editing buffer.
 * Add `extension` to the state created with `doc`; install history separately.
 * Display-only transactions never touch the source. Create a new factory/state
 * for each external load so another document cannot inherit this undo history.
 */
export function createLyricsSourceDocument(raw: string): {
  doc: string;
  extension: Extension;
  getRaw: (state: EditorState) => string;
} {
  const initial = readSource(raw);
  const insertedLineEnding = initial.lineEndings[0] ?? '\n';
  // These snapshots have no positions to map. In a merged history event,
  // CodeMirror places newer effects first and older effects last.
  const restoreEndings = StateEffect.define<readonly LineEnding[]>();
  const sourceField = StateField.define<SourceDocumentValue>({
    create: () => initial,
    update(value, transaction) {
      let endings: readonly LineEnding[] | undefined;
      for (const effect of transaction.effects) {
        if (effect.is(restoreEndings)) endings = effect.value;
      }
      if (!transaction.docChanged && !endings) return value;

      const next = transaction.docChanged
        ? spliceSource(value, transaction, insertedLineEnding) : value;
      // Apply only the final snapshot: earlier effects in a combined undo may
      // describe intermediate documents with a different number of lines.
      return endings ? restoreLineEndings(next, endings) : next;
    },
  });

  return {
    // Normalizing separators must not trim text or remove a leading BOM.
    doc: raw.replace(/\r\n|\r/g, '\n'),
    extension: [
      sourceField,
      invertedEffects.of((transaction) => {
        const before = transaction.startState.field(sourceField);
        const after = transaction.state.field(sourceField);
        if (sameLineEndings(before.lineEndings, after.lineEndings)) return [];
        // Preserve newline styles for undo and redo without retaining a copy
        // of the complete lyric text in every history event.
        return [restoreEndings.of(before.lineEndings)];
      }),
    ],
    getRaw: (state) => state.field(sourceField).raw,
  };
}
