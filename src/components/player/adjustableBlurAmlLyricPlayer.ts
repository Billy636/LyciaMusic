import { DomLyricPlayer } from '@applemusic-like-lyrics/core';

import { clampLyricsBlurStrength, DEFAULT_LYRICS_BLUR_STRENGTH } from '../../composables/lyrics/constants';

const BLUR_CLASS = 'amll-adjustable-blur';
const BLUR_FILTER_PROPERTY = '--amll-adjusted-blur-filter';
// Core 0.6.0 caps each group/footer's rendered radius at 5 px. Scale that
// rendered value so strength 1 retains the original distance-based effect.
const CORE_MAX_BLUR_PX = 5;

/** Adapt public transform hooks; AMLL continues to own focus and scrolling. */
export class AdjustableBlurAmlLyricPlayer extends DomLyricPlayer {
  private blurStrength = DEFAULT_LYRICS_BLUR_STRENGTH;
  private bottomLineBlur = 0;

  constructor() {
    super();
    const setTransform = this.bottomLine.setTransform.bind(this.bottomLine);
    this.bottomLine.setTransform = (...args) => {
      setTransform(...args);
      this.bottomLineBlur = args[1] ?? 0;
      this.applyBlur(this.bottomLine.getElement(), this.bottomLineBlur);
    };
    this.applyBlur(this.bottomLine.getElement(), this.bottomLineBlur);
  }

  setBlurStrength(value: number) {
    const strength = clampLyricsBlurStrength(value);
    if (this.blurStrength === strength) return;
    this.blurStrength = strength;
    for (const group of this.currentLyricGroups) {
      this.applyBlur(group.getElement(), group.blur);
    }
    this.applyBlur(this.bottomLine.getElement(), this.bottomLineBlur);
  }

  protected override buildLyricGroups() {
    super.buildLyricGroups();
    for (const group of this.currentLyricGroups) {
      const setTransform = group.setTransform.bind(group);
      group.setTransform = (...args) => {
        setTransform(...args);
        this.applyBlur(group.getElement(), group.blur);
      };
      this.applyBlur(group.getElement(), group.blur);
    }
  }

  private applyBlur(element: HTMLElement, originalBlur: number) {
    const radius = Math.max(0, Math.min(CORE_MAX_BLUR_PX, originalBlur)) * this.blurStrength;
    const filter = radius > 0.01 ? `blur(${radius.toFixed(2)}px)` : 'none';
    element.classList.add(BLUR_CLASS);
    if (element.style.getPropertyValue(BLUR_FILTER_PROPERTY) !== filter) {
      element.style.setProperty(BLUR_FILTER_PROPERTY, filter);
    }
  }
}
