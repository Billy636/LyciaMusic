import {
  EditorState, RangeSet, StateEffect, StateField, Transaction,
  type Extension, type Range, type SelectionRange,
} from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, WidgetType, gutter, gutterLineClass, type DecorationSet } from '@codemirror/view';
import type { LyricsReadingOrder } from '../../types';
import { analyzeLyricsSource, type LyricsSourceLine } from './sourceAnnotations';

export interface LyricsSourceOptions {
  readingOrder: LyricsReadingOrder;
  weakenTime: boolean;
  foldWordTime: boolean;
  focusOriginal: boolean;
}

export const configureLyricsSource = StateEffect.define<LyricsSourceOptions>();
const revealSource = StateEffect.define<{ from: number; kind: 'line' | 'word' }>();

const ROLE_LABELS: Record<LyricsSourceLine['role'], string> = {
  main: '原文', translation: '翻译', roman: '罗马音', metadata: '信息', other: '源码', empty: '空白',
};

class SourceLineMarker extends GutterMarker {
  constructor(readonly groupStart: boolean) {
    super();
    this.elementClass = `cm-lyric-gutter-line${groupStart ? ' cm-lyric-group-start' : ''}`;
  }
  eq(other: SourceLineMarker) { return this.groupStart === other.groupStart; }
}
const sourceLineMarker = new SourceLineMarker(false);
const sourceGroupMarker = new SourceLineMarker(true);

class RoleMarker extends GutterMarker {
  constructor(readonly role: LyricsSourceLine['role']) { super(); }
  eq(other: RoleMarker) { return this.role === other.role; }
  toDOM() {
    const marker = document.createElement('span');
    marker.className = `cm-lyric-role cm-lyric-role-${this.role}`;
    marker.textContent = ROLE_LABELS[this.role];
    marker.title = this.role === 'other' ? '未确定语言角色，完整保留源码' : ROLE_LABELS[this.role];
    return marker;
  }
}

class SourceFoldWidget extends WidgetType {
  constructor(readonly from: number, readonly text: string, readonly role?: LyricsSourceLine['role']) { super(); }
  eq(other: SourceFoldWidget) {
    return this.from === other.from && this.text === other.text && this.role === other.role;
  }
  toDOM(view: EditorView) {
    const button = document.createElement('button');
    button.type = 'button';
    button.tabIndex = -1;
    button.className = this.role ? 'cm-lyric-fold-line' : 'cm-lyric-fold-time';
    button.textContent = this.role ? `› 展开${ROLE_LABELS[this.role]}` : '·';
    button.title = this.role ? this.text : `展开逐字时间 ${this.text}`;
    button.setAttribute('aria-label', this.role
      ? `展开${ROLE_LABELS[this.role]}（第 ${view.state.doc.lineAt(this.from).number} 行）`
      : button.title);
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({
        effects: revealSource.of({ from: this.from, kind: this.role ? 'line' : 'word' }),
        selection: { anchor: this.from },
      });
      view.focus();
    });
    return button;
  }
}

interface FoldRange { from: number; to: number; kind: 'line' | 'word' }
interface SourcePresentation {
  options: LyricsSourceOptions;
  analysis: ReturnType<typeof analyzeLyricsSource>;
  expandedLines: Set<number>;
  expandedWords: Set<number>;
  decorations: DecorationSet;
  atoms: DecorationSet;
  roles: RangeSet<GutterMarker>;
  gutterLines: RangeSet<GutterMarker>;
  folds: FoldRange[];
}

function touchesSelection(selection: readonly SelectionRange[], from: number, to: number, includeEdges = false) {
  return selection.some((range) => range.empty
    ? includeEdges ? range.head >= from && range.head <= to : range.head > from && range.head < to
    : range.from < to && range.to > from);
}

function renderPresentation(state: EditorState, value: SourcePresentation): SourcePresentation {
  const decorations: Range<Decoration>[] = [];
  const atoms: Range<Decoration>[] = [];
  const roles: Range<GutterMarker>[] = [];
  const gutterLines: Range<GutterMarker>[] = [];
  const folds: FoldRange[] = [];
  const selection = state.selection.ranges;
  for (const line of value.analysis.lines) {
    roles.push(new RoleMarker(line.role).range(line.from));
    // Mirror first-line spacing in both gutters, including wrapped/folded rows.
    gutterLines.push((line.groupStart ? sourceGroupMarker : sourceLineMarker).range(line.from));
    const auxiliary = line.role === 'translation' || line.role === 'roman';
    const classes = [`cm-lyric-line-${line.role}`];
    if (line.groupStart) classes.push('cm-lyric-group-start');
    if (value.options.focusOriginal && line.role === 'main') classes.push('cm-lyric-focus-main');
    decorations.push(Decoration.line({ class: classes.join(' ') }).range(line.from));
    if (value.options.focusOriginal && auxiliary && line.to > line.from
      && !value.expandedLines.has(line.from) && !touchesSelection(selection, line.from, line.to, true)) {
      const fold = Decoration.replace({ widget: new SourceFoldWidget(line.from, line.text, line.role), inclusive: false })
        .range(line.from, line.to);
      decorations.push(fold);
      atoms.push(fold);
      folds.push({ from: line.from, to: line.to, kind: 'line' });
      continue;
    }
    for (const timing of line.timings) {
      if (timing.kind === 'word' && value.options.foldWordTime
        && !value.expandedWords.has(timing.from) && !touchesSelection(selection, timing.from, timing.to)) {
        const fold = Decoration.replace({
          widget: new SourceFoldWidget(timing.from, state.doc.sliceString(timing.from, timing.to)), inclusive: false,
        }).range(timing.from, timing.to);
        decorations.push(fold);
        atoms.push(fold);
        folds.push({ ...timing });
      } else {
        decorations.push(Decoration.mark({
          class: `cm-lyric-time${value.options.weakenTime ? ' cm-lyric-time-muted' : ''}`,
        }).range(timing.from, timing.to));
      }
    }
  }
  return {
    ...value, decorations: Decoration.set(decorations, true), atoms: Decoration.set(atoms, true),
    roles: RangeSet.of(roles, true), gutterLines: RangeSet.of(gutterLines, true), folds,
  };
}

/** Decorations never rewrite the document. Only known auxiliary rows can fold. */
export function createLyricsSourcePresentation(initialOptions: LyricsSourceOptions): {
  extension: Extension;
  getAnalysis: (state: EditorState) => ReturnType<typeof analyzeLyricsSource>;
} {
  const presentation = StateField.define<SourcePresentation>({
    create(state) {
      return renderPresentation(state, {
        options: initialOptions,
        analysis: analyzeLyricsSource(state.doc.toString(), initialOptions.readingOrder),
        expandedLines: new Set(), expandedWords: new Set(),
        decorations: Decoration.none, atoms: Decoration.none, roles: RangeSet.empty, gutterLines: RangeSet.empty, folds: [],
      });
    },
    update(value, transaction) {
      let options = value.options;
      let expandedLines = value.expandedLines;
      let expandedWords = value.expandedWords;
      if (transaction.docChanged) {
        expandedLines = new Set([...expandedLines].map((pos) => transaction.changes.mapPos(pos, 1)));
        expandedWords = new Set([...expandedWords].map((pos) => transaction.changes.mapPos(pos, 1)));
      }
      let changed = transaction.docChanged || Boolean(transaction.selection);
      for (const effect of transaction.effects) {
        if (effect.is(configureLyricsSource)) {
          if (effect.value.focusOriginal !== options.focusOriginal || effect.value.readingOrder !== options.readingOrder) {
            expandedLines = new Set();
          }
          if (effect.value.foldWordTime !== options.foldWordTime) expandedWords = new Set();
          options = effect.value;
          changed = true;
        } else if (effect.is(revealSource)) {
          if (effect.value.kind === 'line') expandedLines = new Set(expandedLines).add(effect.value.from);
          else expandedWords = new Set(expandedWords).add(effect.value.from);
          changed = true;
        }
      }
      if (!changed) return value;
      const analysis = transaction.docChanged || options.readingOrder !== value.options.readingOrder
        ? analyzeLyricsSource(transaction.newDoc.toString(), options.readingOrder) : value.analysis;
      return renderPresentation(transaction.state, { ...value, options, expandedLines, expandedWords, analysis });
    },
    provide: (field) => [
      EditorView.decorations.from(field, (value) => value.decorations),
      EditorView.atomicRanges.of((view) => view.state.field(field).atoms),
      gutterLineClass.from(field, (value) => value.gutterLines),
      gutter({
        class: 'cm-lyric-role-gutter',
        markers: (view) => view.state.field(field).roles,
        initialSpacer: () => new RoleMarker('roman'),
      }),
    ],
  });

  // Backspace/Delete or a word-delete at a folded boundary reveals first.
  // A deliberate selection is expanded before replacement, while undo/redo
  // and explicit edits to visible source remain normal editor transactions.
  const protectHiddenText = EditorState.transactionFilter.of((transaction) => {
    if (!transaction.docChanged || !transaction.isUserEvent('delete')
      || transaction.startState.selection.ranges.some((range) => !range.empty)) return transaction;
    const value = transaction.startState.field(presentation);
    const touched = new Map<number, FoldRange>();
    transaction.changes.iterChangedRanges((from, to) => {
      for (const fold of value.folds) {
        const touches = fold.kind === 'line'
          ? from <= fold.to && to >= fold.from : from < fold.to && to > fold.from;
        if (touches) touched.set(fold.from, fold);
      }
    });
    if (!touched.size) return transaction;
    return {
      effects: [
        ...[...touched.values()].map((fold) => revealSource.of(fold)),
        EditorView.announce.of('已展开折叠内容，再次删除可编辑时间或辅助行。'),
      ],
      annotations: Transaction.addToHistory.of(false),
    };
  });
  return { extension: [presentation, protectHiddenText], getAnalysis: (state) => state.field(presentation).analysis };
}
