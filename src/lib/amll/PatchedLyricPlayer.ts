/*
 * Derived from AMLL (Apple Music-like Lyrics) integration work and adapted
 * for Lycia Player on 2026-04-04.
 * SPDX-License-Identifier: AGPL-3.0-only
 * Upstream project: https://github.com/amll-dev/applemusic-like-lyrics
 */
import { DomLyricPlayer, type LyricLine } from '@applemusic-like-lyrics/core';

import {
  TIMED_ROMAJI_BASE_OPACITY,
  TIMED_ROMAJI_HIGHLIGHT_OPACITY,
  TIMED_ROMAJI_SUBLINE_OPACITY,
  getInlineRomajiPatchPlan,
  getTimedRomajiFillProgress,
  shouldRebuildTimedRomajiDom,
} from './timedRomaji';

type TimedRomajiWord = {
  text: string;
  startTime: number;
  endTime: number;
};

type LyricLineWithTimedRomaji = LyricLine & {
  romajiWords?: TimedRomajiWord[];
};

export class PatchedLyricPlayer extends DomLyricPlayer {
  private lineGap = 1;
  private restoreScrollFrameId = 0;
  private playbackPaused = false;

  private hasFiniteTime(value: number | undefined): value is number {
    return Number.isFinite(value);
  }

  private clamp(min: number, value: number, max: number) {
    return Math.max(min, Math.min(value, max));
  }

  private easeOutExpo(value: number) {
    return value === 1 ? 1 : 1 - 2 ** (-10 * value);
  }

  private easeInOutBack(value: number) {
    const constant = 2.5949095;
    if (value < 0.5) {
      return (2 * value) ** 2 * ((constant + 1) * 2 * value - constant) / 2;
    }

    return ((2 * value - 2) ** 2 * ((constant + 1) * (value * 2 - 2) + constant) + 2) / 2;
  }

  private syncLineTransformsToDom() {
    for (const lineObj of this.currentLyricLineObjects) {
      const lineElement = this.getLineElement(lineObj);
      if (!lineElement) continue;

      const transformState = (lineObj as unknown as {
        lineTransforms?: {
          posY: { getCurrentPosition: () => number };
          scale: { getCurrentPosition: () => number };
        };
        blur?: number;
      }).lineTransforms;

      if (!transformState) continue;

      const posY = transformState.posY.getCurrentPosition();
      const scale = transformState.scale.getCurrentPosition() / 100;
      const blur = (lineObj as unknown as { blur?: number }).blur ?? 0;

      // Packaged WebView2 builds sometimes skip AMLL's internal transform writeback.
      lineElement.style.transform = `translateY(${posY.toFixed(3)}px) scale(${scale.toFixed(4)})`;
      lineElement.style.filter = `blur(${Math.min(32, blur).toFixed(3)}px)`;
      lineElement.style.transformOrigin = lineElement.className.includes('Duet') ? '100%' : '0';
      lineElement.style.willChange = 'transform, filter';
    }
  }

  private syncBottomLineTransformToDom() {
    const bottomLine = this.bottomLine as unknown as {
      getElement?: () => HTMLElement;
      lineTransforms?: {
        posX: { getCurrentPosition: () => number };
        posY: { getCurrentPosition: () => number };
      };
    };
    const element = typeof bottomLine.getElement === 'function'
      ? bottomLine.getElement.call(bottomLine)
      : null;
    const transforms = bottomLine.lineTransforms;

    if (!element || !transforms) return;

    const posX = transforms.posX.getCurrentPosition();
    const posY = transforms.posY.getCurrentPosition();
    element.style.transform = `translate(${posX.toFixed(3)}px, ${posY.toFixed(3)}px)`;
    element.style.willChange = 'transform';
  }

  private syncInterludeDotsToDom() {
    const interludeDots = this.interludeDots as unknown as {
      getElement?: () => HTMLElement;
      left?: number;
      top?: number;
      playing?: boolean;
      currentTime?: number;
      currentInterlude?: [number, number] | undefined;
      targetBreatheDuration?: number;
      dot0?: HTMLElement;
      dot1?: HTMLElement;
      dot2?: HTMLElement;
    };
    const element = typeof interludeDots.getElement === 'function'
      ? interludeDots.getElement.call(interludeDots)
      : null;

    if (!element) return;

    const left = interludeDots.left ?? 0;
    const top = interludeDots.top ?? 0;
    let scale = 1;

    if (interludeDots.currentInterlude) {
      const [startTime, endTime] = interludeDots.currentInterlude;
      const currentTime = interludeDots.currentTime ?? startTime;
      const duration = endTime - startTime;
      const elapsed = currentTime - startTime;

      if (duration > 0 && elapsed <= duration) {
        const breatheDuration = duration / Math.ceil(duration / (interludeDots.targetBreatheDuration ?? 1500));
        scale *= Math.sin(1.5 * Math.PI - elapsed / breatheDuration * 2) / 20 + 1;

        if (elapsed < 2000) {
          scale *= this.easeOutExpo(elapsed / 2000);
        }

        if (duration - elapsed < 750) {
          const ratio = (750 - (duration - elapsed)) / 750 / 2;
          scale *= 1 - this.easeInOutBack(ratio);
        }

        scale = Math.max(0, scale) * 0.7;
      } else {
        scale = 0;
      }
    }

    element.style.transform = `translate(${left.toFixed(3)}px, ${top.toFixed(3)}px) scale(${this.clamp(0, scale, 1).toFixed(4)})`;
    element.style.willChange = 'transform';
  }

  private syncAuxiliaryTransformsToDom() {
    this.syncBottomLineTransformToDom();
    this.syncInterludeDotsToDom();
  }

  private getLineElement(
    lineObj: (typeof this.currentLyricLineObjects)[number],
  ): HTMLElement | null {
    const getElement = (lineObj as unknown as { getElement?: () => HTMLElement }).getElement;
    return typeof getElement === 'function' ? getElement.call(lineObj) : null;
  }

  private moveInlineRomajiAboveMainText(lineElement: HTMLElement) {
    for (const romanWord of lineElement.querySelectorAll<HTMLElement>(
      '[class*="_romanWord_"], [data-lycia-patched-inline-romaji="true"]',
    )) {
      const wordElement = romanWord.parentElement;
      if (!wordElement || wordElement.firstElementChild === romanWord) continue;

      wordElement.insertBefore(romanWord, wordElement.firstChild);
    }
  }

  private getElementTextWithoutRomaji(element: HTMLElement) {
    const clone = element.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll('[class*="_romanWord_"], [data-lycia-patched-inline-romaji="true"]')
      .forEach((node) => node.remove());
    return clone.textContent ?? '';
  }

  private getMainWordElements(mainLine: HTMLElement) {
    const elements: HTMLElement[] = [];

    for (const child of Array.from(mainLine.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.dataset.lyciaMainRomajiLine === 'true') continue;
      if (child.matches('[class*="_romanWord_"]')) continue;

      if (child.matches('[class*="_emphasizeWrapper_"]')) {
        for (const wordElement of Array.from(child.children)) {
          if (wordElement instanceof HTMLElement) {
            elements.push(wordElement);
          }
        }
      } else {
        elements.push(child);
      }
    }

    return elements;
  }

  private patchMissingInlineRomaji(lineElement: HTMLElement, line: LyricLineWithTimedRomaji) {
    const sourceWords = line.words.filter((word) => word.romanWord.trim().length > 0);
    if (sourceWords.length === 0) return;

    const mainLine = lineElement.children[0];
    if (!(mainLine instanceof HTMLElement)) return;

    const wordElements = this.getMainWordElements(mainLine);
    const renderedWords = wordElements.map((element) => this.getElementTextWithoutRomaji(element));
    const plan = getInlineRomajiPatchPlan(renderedWords, line.words);

    for (const patch of plan) {
      const wordElement = wordElements[patch.elementIndex];
      if (
        !wordElement
        || wordElement.querySelector('[class*="_romanWord_"], [data-lycia-patched-inline-romaji="true"]')
      ) continue;

      const romanWordElement = document.createElement('div');
      romanWordElement.dataset.lyciaPatchedInlineRomaji = 'true';
      romanWordElement.className = 'lycia-patched-inline-romaji';
      romanWordElement.style.fontSize = '.5em';
      romanWordElement.style.lineHeight = '1em';
      romanWordElement.textContent = patch.romanWord;
      wordElement.insertBefore(romanWordElement, wordElement.firstChild);
    }
  }

  private getRomanSubLineElement(lineElement: HTMLElement, line: LyricLineWithTimedRomaji) {
    if (!line.romanLyric.trim()) return null;

    const mainLine = lineElement.children[0];
    const roman = lineElement.children[2];
    if (!(roman instanceof HTMLElement) || !(mainLine instanceof HTMLElement)) return null;

    roman.style.display = 'none';

    let mountedRoman = mainLine.querySelector<HTMLElement>('[data-lycia-main-romaji-line="true"]');
    if (!mountedRoman) {
      mountedRoman = document.createElement('div');
      mountedRoman.dataset.lyciaMainRomajiLine = 'true';
      mainLine.insertBefore(mountedRoman, mainLine.firstChild);
    }

    mountedRoman.className = roman.className;
    mountedRoman.style.cssText = roman.style.cssText;
    mountedRoman.style.display = '';
    if (!mountedRoman.querySelector('.lycia-timed-romaji-word')) {
      mountedRoman.textContent = roman.textContent;
    }
    return mountedRoman;
  }

  private syncRomajiPlacementToDom() {
    for (const lineObj of this.currentLyricLineObjects) {
      const lineElement = this.getLineElement(lineObj);
      if (!lineElement) continue;

      const line = lineObj.getLine() as LyricLineWithTimedRomaji;
      this.patchMissingInlineRomaji(lineElement, line);
      this.getRomanSubLineElement(lineElement, line);
      this.moveInlineRomajiAboveMainText(lineElement);
    }
  }

  private syncTimedRomajiWordsToDom() {
    for (const lineObj of this.currentLyricLineObjects) {
      const line = lineObj.getLine() as LyricLineWithTimedRomaji;
      const romajiWords = line.romajiWords?.filter((word) => (
        word.text.length > 0
        && Number.isFinite(word.startTime)
        && Number.isFinite(word.endTime)
      ));
      if (!romajiWords || romajiWords.length === 0) continue;

      const lineElement = this.getLineElement(lineObj);
      if (!lineElement) continue;

      const romanSubLine = this.getRomanSubLineElement(lineElement, line);
      if (!romanSubLine) continue;
      romanSubLine.style.opacity = TIMED_ROMAJI_SUBLINE_OPACITY;

      const signature = romajiWords
        .map((word) => `${word.startTime}:${word.endTime}:${word.text}`)
        .join('|');

      const currentWordElements = romanSubLine.querySelectorAll<HTMLElement>('.lycia-timed-romaji-word');
      if (shouldRebuildTimedRomajiDom(
        romanSubLine.dataset.lyciaTimedRomajiSignature,
        signature,
        currentWordElements.length,
        romajiWords.length,
      )) {
        romanSubLine.textContent = '';
        romanSubLine.style.whiteSpace = 'pre-wrap';

        for (const word of romajiWords) {
          const wordElement = document.createElement('span');
          wordElement.className = 'lycia-timed-romaji-word';
          wordElement.dataset.startTime = String(word.startTime);
          wordElement.dataset.endTime = String(word.endTime);
          wordElement.style.display = 'inline-block';
          wordElement.style.position = 'relative';
          wordElement.style.whiteSpace = 'pre';

          const baseElement = document.createElement('span');
          baseElement.textContent = word.text;
          baseElement.style.opacity = TIMED_ROMAJI_BASE_OPACITY;

          const fillElement = document.createElement('span');
          fillElement.className = 'lycia-timed-romaji-fill';
          fillElement.textContent = word.text;
          fillElement.style.position = 'absolute';
          fillElement.style.inset = '0 auto 0 0';
          fillElement.style.overflow = 'hidden';
          fillElement.style.whiteSpace = 'pre';
          fillElement.style.pointerEvents = 'none';
          fillElement.style.opacity = TIMED_ROMAJI_HIGHLIGHT_OPACITY;
          fillElement.style.width = '0%';

          wordElement.appendChild(baseElement);
          wordElement.appendChild(fillElement);
          romanSubLine.appendChild(wordElement);
        }

        romanSubLine.dataset.lyciaTimedRomajiSignature = signature;
      }

      for (const wordElement of romanSubLine.querySelectorAll<HTMLElement>('.lycia-timed-romaji-word')) {
        const startTime = Number(wordElement.dataset.startTime);
        const endTime = Number(wordElement.dataset.endTime);
        const progress = getTimedRomajiFillProgress(this.currentTime, line.endTime, startTime, endTime);
        const fillElement = wordElement.querySelector<HTMLElement>('.lycia-timed-romaji-fill');
        if (fillElement) {
          fillElement.style.width = `${(progress * 100).toFixed(2)}%`;
        }
      }
    }

    this.syncRomajiPlacementToDom();
  }

  private patchLineElementLayout() {
    for (const lineObj of this.currentLyricLineObjects) {
      const lineElement = this.getLineElement(lineObj);
      if (!lineElement) continue;

      // WebView2 packaged builds can report 0 height for AMLL's absolute + fit-content lines.
      lineElement.style.height = 'auto';
      lineElement.style.minHeight = `${Math.max(32, this.baseFontSize * 1.8)}px`;
      lineElement.style.top = '0';
      lineElement.style.left = '0';
      lineElement.style.contain = 'layout style paint';
      lineElement.style.contentVisibility = 'visible';
    }
  }

  private syncMeasuredSize() {
    const playerEl = this.getElement();
    const wrapperEl = playerEl.parentElement;
    const playerRect = playerEl.getBoundingClientRect();
    const wrapperRect = wrapperEl?.getBoundingClientRect();

    const safeWidth = Math.max(
      this.size[0],
      playerEl.clientWidth,
      playerRect.width,
      wrapperEl?.clientWidth ?? 0,
      wrapperRect?.width ?? 0,
    );
    const safeHeight = Math.max(
      this.size[1],
      playerEl.clientHeight,
      playerRect.height,
      wrapperEl?.clientHeight ?? 0,
      wrapperRect?.height ?? 0,
    );

    if (safeWidth > 0) this.size[0] = safeWidth;
    if (safeHeight > 0) this.size[1] = safeHeight;
  }

  private getSafePlayerHeight() {
    this.syncMeasuredSize();

    const playerEl = this.getElement();
    const wrapperEl = playerEl.parentElement;
    const playerRect = playerEl.getBoundingClientRect();
    const wrapperRect = wrapperEl?.getBoundingClientRect();
    const viewportFallback = Math.max(180, window.innerHeight * 0.42);

    const safeHeight = Math.max(
      this.size[1],
      playerEl.clientHeight,
      playerRect.height,
      wrapperEl?.clientHeight ?? 0,
      wrapperRect?.height ?? 0,
      viewportFallback,
    );

    if (safeHeight > this.size[1]) {
      this.size[1] = safeHeight;
    }

    return safeHeight;
  }

  private estimateLineHeight(
    lineObj: (typeof this.currentLyricLineObjects)[number],
    playerHeight: number,
  ) {
    const line = lineObj.getLine();
    const baseFontSize = Number.isFinite(this.baseFontSize) && this.baseFontSize > 0
      ? this.baseFontSize
      : Math.max(20, playerHeight * 0.075);
    const subLineCount = Number(line.translatedLyric.trim().length > 0) +
      Number(line.romanLyric.trim().length > 0);
    const verticalPadding = baseFontSize;
    const mainLineHeight = baseFontSize * 1.25;
    const subLinesHeight = subLineCount * Math.max(baseFontSize * 0.85, 14) * 1.35;
    const bgScale = line.isBG ? 0.78 : 1;

    return Math.max(
      baseFontSize * 1.9,
      (verticalPadding + mainLineHeight + subLinesHeight) * bgScale,
    );
  }

  private getSafeLineHeight(
    lineObj: (typeof this.currentLyricLineObjects)[number],
    playerHeight: number,
  ) {
    const measuredHeight = this.lyricLinesSize.get(lineObj)?.[1] ?? 0;
    const minReliableHeight = Math.max(12, this.baseFontSize * 0.35);

    if (measuredHeight >= minReliableHeight) {
      return measuredHeight;
    }

    return this.estimateLineHeight(lineObj, playerHeight);
  }

  private getLayoutLineHeight(
    lineObj: (typeof this.currentLyricLineObjects)[number],
    playerHeight: number,
  ) {
    return Math.max(36, this.getSafeLineHeight(lineObj, playerHeight));
  }

  private getPositionedLineHeight(
    lineObj: (typeof this.currentLyricLineObjects)[number],
    playerHeight: number,
  ) {
    return Math.max(36, this.getLayoutLineHeight(lineObj, playerHeight) * this.lineGap);
  }

  setLineGap(value: number) {
    if (!Number.isFinite(value)) {
      this.lineGap = 1;
      return;
    }

    this.lineGap = this.clamp(0.6, value, 2);
  }

  setPlaybackPaused(paused: boolean) {
    const nextPaused = Boolean(paused);

    // Keep AMLL's "playing" layout class even while audio is paused. Calling the
    // built-in pause() switches to AMLL's global paused layout and reveals other lines.
    this.getElement().classList.add('playing');

    if (this.playbackPaused === nextPaused) {
      return;
    }

    this.playbackPaused = nextPaused;

    if (nextPaused) {
      this.interludeDots.pause();
      for (const lineObj of this.currentLyricLineObjects) {
        void lineObj.pause();
      }
      return;
    }

    this.interludeDots.resume();
    for (const lineObj of this.currentLyricLineObjects) {
      void lineObj.resume();
    }
  }

  suspendScrollForSeek() {
    this.allowScroll = false;

    if (this.restoreScrollFrameId !== 0) {
      cancelAnimationFrame(this.restoreScrollFrameId);
      this.restoreScrollFrameId = 0;
    }

    this.restoreScrollFrameId = requestAnimationFrame(() => {
      this.restoreScrollFrameId = requestAnimationFrame(() => {
        this.allowScroll = true;
        this.restoreScrollFrameId = 0;
      });
    });
  }

  alignScrollToSeekTarget(lineIndex?: number) {
    let explicitIndex: number | undefined;
    if (
      Number.isInteger(lineIndex) &&
      lineIndex !== undefined &&
      lineIndex >= 0 &&
      lineIndex < this.currentLyricLineObjects.length &&
      !this.currentLyricLineObjects[lineIndex].getLine().isBG
    ) {
      explicitIndex = lineIndex;
    }

    const targetIndex = explicitIndex ?? (this.bufferedLines.size > 0
      ? Math.min(...this.bufferedLines)
      : undefined);

    if (targetIndex !== undefined) {
      this.hotLines.clear();
      this.bufferedLines.clear();

      this.hotLines.add(targetIndex);
      this.bufferedLines.add(targetIndex);
      this.currentLyricLineObjects[targetIndex]?.enable(this.currentTime);

      const backgroundIndex = targetIndex + 1;
      if (this.currentLyricLineObjects[backgroundIndex]?.getLine().isBG) {
        this.hotLines.add(backgroundIndex);
        this.bufferedLines.add(backgroundIndex);
        this.currentLyricLineObjects[backgroundIndex]?.enable(this.currentTime);
      }

      this.currentLyricLineObjects.forEach((lineObj, index) => {
        if (!this.hotLines.has(index)) {
          lineObj.disable();
        }
      });

      this.scrollToIndex = targetIndex;
    } else {
      const nextIndex = this.currentLyricLineObjects.findIndex((lineObj) => {
        const line = lineObj.getLine();
        return !line.isBG && line.startTime >= this.currentTime;
      });
      this.scrollToIndex = nextIndex === -1
        ? Math.max(0, this.currentLyricLineObjects.length - 1)
        : nextIndex;
    }
  }

  protected override getCurrentInterlude(): [number, number, number, boolean] | undefined {
    if (this.bufferedLines.size > 0) return undefined;

    const currentTime = this.currentTime + 20;
    const index = this.scrollToIndex;
    const currentLine = this.processedLines[index];
    const nextLine = this.processedLines[index + 1];
    const lineAfterNext = this.processedLines[index + 2];

    if (index === 0) {
      const firstLine = this.processedLines[0];
      const secondLine = this.processedLines[1];

      if (
        firstLine &&
        this.hasFiniteTime(firstLine.startTime) &&
        firstLine.startTime > currentTime
      ) {
        return [
          currentTime,
          Math.max(currentTime, firstLine.startTime - 250),
          -2,
          firstLine.isDuet,
        ];
      }

      if (
        firstLine &&
        secondLine &&
        this.hasFiniteTime(firstLine.endTime) &&
        this.hasFiniteTime(secondLine.startTime) &&
        secondLine.startTime > currentTime &&
        firstLine.endTime < currentTime
      ) {
        return [
          Math.max(firstLine.endTime, currentTime),
          secondLine.startTime,
          0,
          secondLine.isDuet,
        ];
      }

      return undefined;
    }

    if (
      !currentLine ||
      !nextLine ||
      !this.hasFiniteTime(currentLine.endTime) ||
      !this.hasFiniteTime(nextLine.startTime)
    ) {
      return undefined;
    }

    if (nextLine.startTime > currentTime && currentLine.endTime < currentTime) {
      return [
        Math.max(currentLine.endTime, currentTime),
        nextLine.startTime,
        index,
        nextLine.isDuet,
      ];
    }

    if (
      lineAfterNext &&
      this.hasFiniteTime(nextLine.endTime) &&
      this.hasFiniteTime(lineAfterNext.startTime) &&
      lineAfterNext.startTime > currentTime &&
      nextLine.endTime < currentTime
    ) {
      return [
        Math.max(nextLine.endTime, currentTime),
        lineAfterNext.startTime,
        index + 1,
        lineAfterNext.isDuet,
      ];
    }

    return undefined;
  }

  override onResize(): void {
    this.syncMeasuredSize();
    super.onResize();
    this.patchLineElementLayout();
    this.syncRomajiPlacementToDom();
    this.syncLineTransformsToDom();
    this.syncAuxiliaryTransformsToDom();
  }

  override setLyricLines(...args: Parameters<DomLyricPlayer['setLyricLines']>): void {
    super.setLyricLines(...args);
    this.patchLineElementLayout();
    this.syncRomajiPlacementToDom();
    this.syncTimedRomajiWordsToDom();
    this.syncLineTransformsToDom();
    this.syncAuxiliaryTransformsToDom();
    if (this.playbackPaused) {
      this.playbackPaused = false;
      this.setPlaybackPaused(true);
    }
  }

  override setCurrentTime(...args: Parameters<DomLyricPlayer['setCurrentTime']>): void {
    super.setCurrentTime(...args);
    this.syncTimedRomajiWordsToDom();
    if (this.playbackPaused) {
      this.playbackPaused = false;
      this.setPlaybackPaused(true);
    }
  }

  override update(delta = 0): void {
    super.update(delta);
    this.syncTimedRomajiWordsToDom();
    this.syncLineTransformsToDom();
    this.syncAuxiliaryTransformsToDom();
  }

  override async calcLayout(sync = false) {
    const playerHeight = this.getSafePlayerHeight();
    const interlude = this.getCurrentInterlude();
    let curPos = -this.scrollOffset;
    let targetAlignIndex = this.scrollToIndex;
    let interludeDuration = 0;

    if (interlude) {
      interludeDuration = interlude[1] - interlude[0];
      if (interludeDuration >= 4000) {
        const nextLine = this.currentLyricLineObjects[interlude[2] + 1];
        if (nextLine) {
          targetAlignIndex = interlude[2] + 1;
        }
      }
    } else {
      this.interludeDots.setInterlude(undefined);
    }

    const scrollOffset = this.currentLyricLineObjects
      .slice(0, targetAlignIndex)
      .reduce((acc, lineObj) => {
        const lineHeight = this.getPositionedLineHeight(lineObj, playerHeight);
        return acc + (lineObj.getLine().isBG && this.isPlaying ? 0 : lineHeight);
      }, 0);

    this.scrollBoundary[0] = -scrollOffset;
    curPos -= scrollOffset;
    curPos += playerHeight * this.alignPosition;

    const currentLine = this.currentLyricLineObjects[targetAlignIndex];
    this.targetAlignIndex = targetAlignIndex;
    if (currentLine) {
      const lineHeight = this.getLayoutLineHeight(currentLine, playerHeight);
      switch (this.alignAnchor) {
        case 'bottom':
          curPos -= lineHeight;
          break;
        case 'center':
          curPos -= lineHeight / 2;
          break;
        case 'top':
          break;
      }
    }

    const latestIndex = Math.max(...this.bufferedLines);
    let delay = 0;
    let baseDelay = sync ? 0 : 0.05;
    let setDots = false;

    this.currentLyricLineObjects.forEach((lineObj, index) => {
      const hasBuffered = this.bufferedLines.has(index);
      const isActive = hasBuffered || (index >= this.scrollToIndex && index < latestIndex);
      const line = lineObj.getLine();

      if (
        !setDots &&
        interludeDuration >= 4000 &&
        ((index === this.scrollToIndex && interlude?.[2] === -2) ||
          index === this.scrollToIndex + 1)
      ) {
        setDots = true;
        this.interludeDots.setTransform(0, curPos);
        if (interlude) {
          this.interludeDots.setInterlude([interlude[0], interlude[1]]);
        }
        curPos += this.interludeDotsSize[1];
      }

      let targetOpacity: number;
      if (this.hidePassedLines) {
        if (
          index < (interlude ? interlude[2] + 1 : this.scrollToIndex) &&
          this.isPlaying
        ) {
          targetOpacity = 0.00001;
        } else if (hasBuffered) {
          targetOpacity = 0.85;
        } else {
          targetOpacity = this.isNonDynamic ? 0.2 : 1;
        }
      } else if (hasBuffered) {
        targetOpacity = 0.85;
      } else {
        targetOpacity = this.isNonDynamic ? 0.2 : 1;
      }

      let blurLevel = 0;
      if (this.enableBlur) {
        if (isActive) {
          blurLevel = 0;
        } else {
          blurLevel = 1;
          if (index < this.scrollToIndex) {
            blurLevel += Math.abs(this.scrollToIndex - index) + 1;
          } else {
            blurLevel += Math.abs(index - Math.max(this.scrollToIndex, latestIndex));
          }
        }
      }

      const scaleAspect = this.enableScale ? 97 : 100;
      let targetScale = 100;
      if (!isActive && this.isPlaying) {
        targetScale = line.isBG ? 75 : scaleAspect;
      }

      lineObj.setTransform(
        curPos,
        targetScale,
        targetOpacity,
        window.innerWidth <= 1024 ? blurLevel * 0.8 : blurLevel,
        false,
        delay,
      );

      const lineHeight = this.getPositionedLineHeight(lineObj, playerHeight);
      if (line.isBG && (isActive || !this.isPlaying)) {
        curPos += lineHeight;
      } else if (!line.isBG) {
        curPos += lineHeight;
      }

      if (curPos >= 0 && !this.isSeeking) {
        if (!line.isBG) delay += baseDelay;
        if (index >= this.scrollToIndex) baseDelay /= 1.05;
      }
    });

    this.scrollBoundary[1] = curPos + this.scrollOffset - playerHeight / 2;
    this.bottomLine.setTransform(0, curPos, false, delay);
  }

  recoverLayout(reason: string) {
    void reason;
    this.patchLineElementLayout();
    this.onResize();
    void this.calcLayout(true);
    this.update(0);
    this.syncRomajiPlacementToDom();
    this.syncTimedRomajiWordsToDom();
    this.syncLineTransformsToDom();
    this.syncAuxiliaryTransformsToDom();
  }

  override dispose(): void {
    if (this.restoreScrollFrameId !== 0) {
      cancelAnimationFrame(this.restoreScrollFrameId);
      this.restoreScrollFrameId = 0;
    }

    super.dispose();
  }
}
