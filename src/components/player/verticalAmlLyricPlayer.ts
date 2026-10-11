import type { DomLyricPlayer } from '@applemusic-like-lyrics/core';

import { AdjustableBlurAmlLyricPlayer } from './adjustableBlurAmlLyricPlayer';

const GLYPH_CLASS = 'amll-vertical-glyph';
const SIDEWAYS_CLASS = 'amll-vertical-sideways';
const UPRIGHT_TEXT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}\u3000-\u303f\uff01-\uff60]/u;
type GraphemeSegmenter = { segment: (text: string) => Iterable<{ segment: string }> };
const Segmenter = (Intl as typeof Intl & {
  Segmenter?: new (locales: undefined, options: { granularity: 'grapheme' }) => GraphemeSegmenter;
}).Segmenter;
const graphemes = Segmenter ? new Segmenter(undefined, { granularity: 'grapheme' }) : null;

function splitGraphemes(text: string) {
  return graphemes ? Array.from(graphemes.segment(text), ({ segment }) => segment) : Array.from(text);
}

/** Decorate text only; keep AMLL's word, ruby and animated character nodes alive. */
function decorateVerticalText(element: HTMLElement) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent?.trim()
        || node.parentElement?.closest(`.${GLYPH_CLASS}, .${SIDEWAYS_CLASS}`)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);

  for (const node of nodes) {
    const fragment = document.createDocumentFragment();
    let sidewaysText = '';
    const flushSidewaysText = () => {
      if (sidewaysText.trim()) {
        // An inner wrapper corrects letter orientation when the stage swaps
        // axes with a reflection. The original animated word nodes stay alive.
        const sideways = document.createElement('span');
        sideways.className = SIDEWAYS_CLASS;
        sideways.textContent = sidewaysText;
        fragment.appendChild(sideways);
      } else if (sidewaysText) fragment.appendChild(document.createTextNode(sidewaysText));
      sidewaysText = '';
    };
    for (const segment of splitGraphemes(node.data)) {
      if (!UPRIGHT_TEXT.test(segment)) {
        // Keep alphabetic scripts in native word boxes. This also preserves
        // joining scripts, emphasis nodes and the original mask dimensions.
        sidewaysText += segment;
        continue;
      }
      flushSidewaysText();
      const glyph = document.createElement('span');
      glyph.className = GLYPH_CLASS;
      glyph.textContent = segment;
      fragment.appendChild(glyph);
    }
    flushSidewaysText();
    node.replaceWith(fragment);
  }
}

/** Keep AMLL's animation clocks; adapt only word-motion keyframe coordinates. */
function adaptVerticalWordMotion(element: HTMLElement) {
  for (const animation of element.getAnimations({ subtree: true })) {
    const isFloat = animation.id === 'float-word' || animation.id === 'emphasize-word-float';
    const isGlow = !isFloat && animation.id.startsWith('emphasize-word-');
    const effect = animation.effect;
    if ((!isFloat && !isGlow) || !(effect instanceof KeyframeEffect)) continue;

    let changed = false;
    const frames = effect.getKeyframes().map((frame) => {
      if (typeof frame.transform !== 'string') return frame;
      // Both vertical stages map local X to screen Y. Negative X floats up.
      // Glow also spreads characters along local X; merge its small Y lift
      // into that axis so it does not become a sideways wobble.
      const transform = isFloat
        ? frame.transform.replace(/translateY\(([^)]+)\)/g, 'translateX($1)')
        : frame.transform.replace(
          /translate\(([-\d.e+]+em),\s*([-\d.e+]+em)\)/g,
          'translateX(calc($1 + $2))',
        );
      changed ||= transform !== frame.transform;
      return { ...frame, transform };
    });
    // Rewritten frames contain translateX, so repeat decoration is harmless.
    if (changed) effect.setKeyframes(frames);
  }
}

type AmlDomLine = DomLyricPlayer['currentLyricGroups'][number]['mainLine'];

/**
 * AMLL owns timing, masks, springs, virtualization and duet grouping. These
 * hooks only adapt display and word-motion coordinates, using the public
 * DOM-line methods from the pinned core 0.6.0 implementation.
 */
export class VerticalAmlLyricPlayer extends AdjustableBlurAmlLyricPlayer {
  constructor(private readonly coordinateStage: HTMLElement) {
    super();
  }

  protected override buildLyricGroups() {
    super.buildLyricGroups();
    for (const group of this.currentLyricGroups) {
      this.adaptLine(group.mainLine);
      if (group.bgLine) this.adaptLine(group.bgLine);
    }
  }

  private adaptLine(line: AmlDomLine) {
    const rebuild = line.rebuildElement.bind(line);
    const measure = line.updateMaskImageSync.bind(line);
    const decorate = () => decorateVerticalText(line.getElement());

    line.rebuildElement = () => {
      rebuild();
      decorate();
      adaptVerticalWordMotion(line.getElement());
    };
    line.updateMaskImageSync = () => {
      // The line balancer reads screen-space rectangles. Restore its native
      // axes for synchronous measurement, then restore rotation before paint.
      const transform = this.coordinateStage.style.transform;
      this.coordinateStage.style.transform = 'none';
      try {
        measure();
        // The non-word-timed path can rebuild the text while balancing it.
        decorate();
      } finally {
        this.coordinateStage.style.transform = transform;
      }
    };
  }
}
