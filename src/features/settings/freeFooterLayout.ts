import { effectiveFooterLayout, footerAction, footerGeometry, FOOTER_BUTTON_SIZE, FOOTER_PLAY_SIZE } from './footer';
import type { FooterMovableId, FooterPlacement, FooterScene, FooterSettings, FooterSpacing } from '../../types/footer';

export interface PlacedFooterButton { id: FooterMovableId; x: number; width: number }
export type FooterAlignment = 'playback-center' | 'utilities-right';
export interface FooterDropGuides {
  center?: number;
  symmetry?: number;
  gaps?: { spans: Array<{ from: number; to: number }> };
}
// Occupancy/hit targets are uniform, independently of the original SVG sizes.
export const footerButtonWidth = (id: FooterMovableId) => id === 'play' ? FOOTER_PLAY_SIZE : FOOTER_BUTTON_SIZE;
const playbackButtons = new Set<FooterMovableId>(['previous', 'play', 'next']);
export function footerButtonGap(settings: FooterSettings, scene: FooterScene, left: FooterMovableId, right: FooterMovableId) {
  const spacing = settings.spacing[settings.linked ? 'main' : scene];
  return playbackButtons.has(left) && playbackButtons.has(right) ? spacing.controls : spacing.utilities;
}
export const placementScene = (settings: FooterSettings, scene: FooterScene, id: FooterMovableId) => footerAction(id).detailOnly ? 'detail' : settings.linked ? 'main' : scene;
export const footerPlacement = (settings: FooterSettings, scene: FooterScene, id: FooterMovableId): FooterPlacement => settings.placement[placementScene(settings, scene, id)][id] ?? {};

// Old region data is only a migration/default-position source. Once a button is
// moved, its normalized horizontal coordinate has no region or center lock.
function initialButtons(settings: FooterSettings, scene: FooterScene, width: number) {
  const geometry = footerGeometry(settings, scene);
  const layout = effectiveFooterLayout(settings, scene);
  // Don't apply the legacy region-capacity overflow before the free-layout
  // solver; it would lose default coordinates for manually restored buttons.
  const groups = {
    left: layout.filter(item => item.position === 'left'), right: layout.filter(item => item.position === 'right'),
    before: layout.filter(item => item.position === 'before'), after: layout.filter(item => item.position === 'after'),
  };
  const x = new Map<FooterMovableId, number>();
  const center = width / 2, side = (width - geometry.center - 2 * geometry.padding - 2 * geometry.regionGap) / 2;
  let edge = geometry.padding + side;
  for (const item of [...groups.left].reverse()) { x.set(item.id, edge - FOOTER_BUTTON_SIZE / 2); edge -= FOOTER_BUTTON_SIZE + geometry.sideGap; }
  edge = width - geometry.padding - geometry.rightInset;
  for (const item of [...groups.right].reverse()) { x.set(item.id, edge - FOOTER_BUTTON_SIZE / 2); edge -= FOOTER_BUTTON_SIZE + geometry.sideGap; }
  edge = center - geometry.core / 2 - geometry.sideGap;
  for (const item of [...groups.before].reverse()) { const w = footerButtonWidth(item.id); x.set(item.id, edge - w / 2); edge -= w + geometry.sideGap; }
  edge = center + geometry.core / 2 + geometry.sideGap;
  for (const item of groups.after) { const w = footerButtonWidth(item.id); x.set(item.id, edge + w / 2); edge += w + geometry.sideGap; }
  const playbackOffset = (FOOTER_BUTTON_SIZE + FOOTER_PLAY_SIZE) / 2 + geometry.controlGap;
  x.set('previous', center - playbackOffset); x.set('play', center); x.set('next', center + playbackOffset);
  const items = [...effectiveFooterLayout(settings, scene), ...(['previous', 'play', 'next'] as const).map(id => ({ id, position: 'bar' }))];
  return items.map(item => {
    const override = footerPlacement(settings, scene, item.id);
    return { id: item.id, initialX: x.get(item.id) ?? width - 40, manual: override.x, basis: override.basis,
      visibility: override.visibility ?? (item.position === 'hidden' ? 'hidden' : item.position === 'more' ? 'more' : 'bar') };
  });
}
function bounds(width: number) {
  // Buttons own a fixed coordinate space. Song information only consumes the
  // free space before the first button; it must never change these boundaries.
  return { left: 16, right: width - 24 };
}
function placementBounds(basis: FooterPlacement['basis'], width: number) {
  const area = bounds(width);
  const info = basis === 'legacy-cover' ? Math.min(48, width / 3)
    : basis === 'legacy-text' ? Math.min(144, width / 3) : 0;
  return { ...area, left: area.left + info + (info ? 8 : 0) };
}
function fitOrderedButtons(settings: FooterSettings, scene: FooterScene, width: number, buttons: PlacedFooterButton[]) {
  const area = bounds(width);
  for (let index = 0; index < buttons.length; index++) {
    const item = buttons[index], previous = buttons[index - 1];
    const min = previous ? previous.x + (previous.width + item.width) / 2 + footerButtonGap(settings, scene, previous.id, item.id)
      : area.left + item.width / 2;
    item.x = Math.max(item.x, min);
  }
  for (let index = buttons.length - 1; index >= 0; index--) {
    const item = buttons[index], next = buttons[index + 1];
    const max = next ? next.x - (item.width + next.width) / 2 - footerButtonGap(settings, scene, item.id, next.id)
      : area.right - item.width / 2;
    item.x = Math.min(item.x, max);
  }
}

/** Save the visible positions, not stale pre-collision targets. Mutates a settings draft. */
export function snapshotFooterPositions(settings: FooterSettings, scene: FooterScene, width: number,
  buttons = resolveFreeFooterLayout(settings, scene, width).bar) {
  const area = bounds(width);
  for (const item of buttons) {
    const key = placementScene(settings, scene, item.id);
    const x = Math.max(0, Math.min(1, (item.x - area.left - item.width / 2) / Math.max(1, area.right - area.left - item.width)));
    settings.placement[key][item.id] = { ...settings.placement[key][item.id], x, basis: 'canvas' };
  }
}

/** Re-space contiguous groups without undoing the user's button order. */
export function reflowFooterSpacing(settings: FooterSettings, scene: FooterScene, width: number,
  before: PlacedFooterButton[], patch: Partial<FooterSpacing>) {
  const buttons = before.map(item => ({ ...item }));
  const originalGap = (left: number, right: number) => before[right].x - before[left].x
    - (before[left].width + before[right].width) / 2;
  // A gap beyond either slider's range is intentional separation, e.g. the
  // queue beside playback versus the utility cluster at the right edge.
  const isClusterGap = (left: number, right: number) => originalGap(left, right) <= 40.01;
  for (const key of ['controls', 'utilities'] as const) {
    if (patch[key] === undefined && !(key === 'utilities' && patch.controls !== undefined)) continue;
    const gap = settings.spacing[settings.linked ? 'main' : scene][key];
    const matches = (item: PlacedFooterButton) => playbackButtons.has(item.id) === (key === 'controls');
    for (let start = 0; start < buttons.length;) {
      if (!matches(buttons[start])) { start++; continue; }
      let end = start + 1;
      while (end < buttons.length && matches(buttons[end]) && isClusterGap(end - 1, end)) end++;
      const playIndex = buttons.findIndex((item, index) => index >= start && index < end && item.id === 'play');
      let anchor = key === 'utilities' ? end - 1 : playIndex >= 0 ? playIndex : Math.floor((start + end - 1) / 2);
      if (key === 'utilities') {
        if (end < buttons.length && playbackButtons.has(buttons[end].id) && isClusterGap(end - 1, end)) {
          buttons[anchor].x = buttons[end].x - (buttons[anchor].width + buttons[end].width) / 2 - gap;
        } else if (start > 0 && playbackButtons.has(buttons[start - 1].id) && isClusterGap(start - 1, start)) {
          anchor = start;
          buttons[anchor].x = buttons[start - 1].x + (buttons[anchor].width + buttons[start - 1].width) / 2 + gap;
        } else if (patch.utilities === undefined) {
          start = end;
          continue;
        }
      }
      for (let index = anchor - 1; index >= start; index--) {
        buttons[index].x = buttons[index + 1].x - (buttons[index].width + buttons[index + 1].width) / 2 - gap;
      }
      for (let index = anchor + 1; index < end; index++) {
        buttons[index].x = buttons[index - 1].x + (buttons[index].width + buttons[index - 1].width) / 2 + gap;
      }
      start = end;
    }
  }
  const required = buttons.reduce((sum, item, index) => sum + item.width
    + (index ? footerButtonGap(settings, scene, buttons[index - 1].id, item.id) : 0), 0);
  const area = bounds(width);
  if (required <= area.right - area.left) {
    fitOrderedButtons(settings, scene, width, buttons);
    snapshotFooterPositions(settings, scene, width, buttons);
  } else {
    snapshotFooterPositions(settings, scene, width, before);
  }
}
function nearestFree(desired: number, buttonWidth: number, occupied: PlacedFooterButton[], left: number, right: number, gap: (item: PlacedFooterButton) => number, snap = false, tolerance = 8) {
  const min = left + buttonWidth / 2, max = right - buttonWidth / 2;
  if (max < min) return null;
  const candidates = [Math.max(min, Math.min(max, desired)), min, max];
  for (const item of occupied) candidates.push(item.x - (item.width + buttonWidth) / 2 - gap(item), item.x + (item.width + buttonWidth) / 2 + gap(item));
  const fits = (x: number) => x >= min - .01 && x <= max + .01
    && occupied.every(item => Math.abs(x - item.x) >= (buttonWidth + item.width) / 2 + gap(item) - .01);
  if (snap) {
    const neighbors = [...occupied].sort((a, b) => a.x - b.x);
    const centers: number[] = [];
    for (let index = 1; index < neighbors.length; index++) {
      // Center in the space between OUTER edges, not between glyphs or centers:
      // this keeps both gaps equal even beside the larger play button.
      const a = neighbors[index - 1], b = neighbors[index];
      const midpoint = (a.x + a.width / 2 + b.x - b.width / 2) / 2;
      if (Math.abs(midpoint - desired) <= tolerance && fits(midpoint)) centers.push(midpoint);
    }
    centers.sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired));
    if (centers.length) return centers[0];
    const edges = candidates.slice(3).filter(x => Math.abs(x - desired) <= tolerance * .75 && fits(x));
    edges.sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired));
    if (edges.length) return edges[0];
  }
  const valid = candidates.filter(fits);
  valid.sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired));
  return valid[0] ?? null;
}
export function resolveFreeFooterLayout(settings: FooterSettings, scene: FooterScene, width: number, omit?: FooterMovableId) {
  const items = initialButtons(settings, scene, width).filter(item => item.id !== omit);
  const area = bounds(width);
  const bar: PlacedFooterButton[] = [], more: { id: FooterMovableId }[] = [], hidden: { id: FooterMovableId }[] = [];
  const visible = items.filter(item => item.visibility === 'bar').map(item => {
    const w = footerButtonWidth(item.id);
    const reference = placementBounds(item.basis, width);
    return { ...item, width: w, desired: item.manual === undefined ? item.initialX
      : reference.left + w / 2 + item.manual * Math.max(0, reference.right - reference.left - w) };
  }).sort((a, b) => a.desired - b.desired);
  // Preserve spatial order when a wider gap or narrower viewport creates a
  // collision. Greedy nearest-free placement could swap previous/next buttons.
  const priority = (item: typeof visible[number]) => item.manual !== undefined ? 0 : ['previous', 'play', 'next', 'more'].includes(item.id) ? 1 : 2;
  const requiredWidth = () => visible.reduce((sum, item, index) => sum + item.width
    + (index ? footerButtonGap(settings, scene, visible[index - 1].id, item.id) : 0), 0);
  while (visible.length && requiredWidth() > area.right - area.left) {
    const candidate = [...visible].reverse().filter(item => item.id !== 'more')
      .sort((a, b) => priority(b) - priority(a))[0] ?? visible[visible.length - 1];
    visible.splice(visible.indexOf(candidate), 1);
    more.push({ id: candidate.id });
  }
  for (const item of visible) bar.push({ id: item.id, width: item.width, x: item.desired });
  fitOrderedButtons(settings, scene, width, bar);
  for (const item of items) {
    if (item.visibility === 'hidden') hidden.push({ id: item.id });
    if (item.visibility === 'more') more.push({ id: item.id });
  }
  bar.sort((a, b) => a.x - b.x);
  const first = bar[0];
  const availableInfoWidth = Math.max(0, (first ? first.x - first.width / 2 - 8 : width - 24) - 16);
  const infoWidth = settings.behavior[scene].info === 'none' ? 0 : settings.behavior[scene].info === 'cover'
    ? Math.min(48, availableInfoWidth) : availableInfoWidth;
  return { bar, more: more.filter(item => item.id !== 'more'), hidden, infoWidth };
}
export function footerDropPosition(settings: FooterSettings, scene: FooterScene, width: number, id: FooterMovableId, desired: number, snap = true, tolerance = 8) {
  const occupied = resolveFreeFooterLayout(settings, scene, width).bar.filter(item => item.id !== id);
  const area = bounds(width), w = footerButtonWidth(id);
  const gap = (item: PlacedFooterButton) => footerButtonGap(settings, scene, id, item.id);
  const center = width / 2;
  const fits = (x: number) => x - w / 2 >= area.left && x + w / 2 <= area.right
    && occupied.every(item => Math.abs(x - item.x) >= (w + item.width) / 2 + gap(item) - .01);
  const aligned: Array<{ x: number; guides: FooterDropGuides }> = [];
  const addAlignment = (x: number, left: PlacedFooterButton, middle: PlacedFooterButton, right: PlacedFooterButton) => {
    if (Math.abs(x - desired) > tolerance || !fits(x)) return;
    const spans = [
      { from: left.x + left.width / 2, to: middle.x - middle.width / 2 },
      { from: middle.x + middle.width / 2, to: right.x - right.width / 2 },
    ];
    if (spans.some(span => span.to < span.from - .01)
      || Math.abs((spans[0].to - spans[0].from) - (spans[1].to - spans[1].from)) > .1) return;
    aligned.push({ x, guides: {
      gaps: { spans },
      ...(Math.abs(left.width - right.width) < .01 ? { symmetry: middle.x } : {}),
    } });
  };
  if (snap) {
    for (let index = 1; index < occupied.length; index++) {
      const a = occupied[index - 1], b = occupied[index];
      // Dragging the middle: balance the gaps between the two stationary edges.
      const midpoint = (a.x + a.width / 2 + b.x - b.width / 2) / 2;
      addAlignment(midpoint, a, { id, x: midpoint, width: w }, b);
      const referenceGap = b.x - b.width / 2 - a.x - a.width / 2;
      if (referenceGap < 0) continue;
      // Dragging either end: mirror the opposite gap around the stationary
      // middle button. Keep the three buttons adjacent; never draw through others.
      const rightX = b.x + b.width / 2 + referenceGap + w / 2;
      if (!occupied[index + 1] || occupied[index + 1].x > rightX) {
        addAlignment(rightX, a, b, { id, x: rightX, width: w });
      }
      const leftX = a.x - a.width / 2 - referenceGap - w / 2;
      if (!occupied[index - 2] || occupied[index - 2].x < leftX) {
        addAlignment(leftX, { id, x: leftX, width: w }, a, b);
      }
    }
    aligned.sort((a, b) => Math.abs(a.x - desired) - Math.abs(b.x - desired));
  }
  const x = snap && Math.abs(desired - center) <= tolerance && fits(center) ? center
    : aligned[0]?.x ?? nearestFree(desired, w, occupied, area.left, area.right, gap, snap, tolerance);
  if (x === null) return null;
  const guides: FooterDropGuides = { ...aligned.find(item => Math.abs(item.x - x) < .01)?.guides };
  if (snap && Math.abs(x - desired) <= tolerance) {
    if (Math.abs(x - center) < .01) guides.center = center;
  }
  return { x, normalized: Math.max(0, Math.min(1, (x - area.left - w / 2) / Math.max(1, area.right - area.left - w))), guides };
}

/** Align visible buttons only. Refuse blocked layouts rather than changing
 * another group's positions or hiding buttons to manufacture a fit. */
export function footerAlignedPositions(settings: FooterSettings, scene: FooterScene, width: number, alignment: FooterAlignment) {
  const layout = resolveFreeFooterLayout(settings, scene, width);
  const buttons = layout.bar.map(item => ({ ...item }));
  const group = buttons.filter(item => playbackButtons.has(item.id) === (alignment === 'playback-center'));
  if (!group.length) return null;
  const spacing = settings.spacing[settings.linked ? 'main' : scene];
  const area = bounds(width);
  if (alignment === 'playback-center') {
    const play = group.findIndex(item => item.id === 'play');
    if (play >= 0) {
      group[play].x = width / 2;
      for (let index = play - 1; index >= 0; index--) group[index].x = group[index + 1].x
        - (group[index].width + group[index + 1].width) / 2 - spacing.controls;
      for (let index = play + 1; index < group.length; index++) group[index].x = group[index - 1].x
        + (group[index].width + group[index - 1].width) / 2 + spacing.controls;
    } else {
      const total = group.reduce((sum, item) => sum + item.width, 0) + (group.length - 1) * spacing.controls;
      let edge = (width - total) / 2;
      for (const item of group) { item.x = edge + item.width / 2; edge += item.width + spacing.controls; }
    }
  } else {
    let edge = area.right;
    for (const item of [...group].reverse()) { item.x = edge - item.width / 2; edge -= item.width + spacing.utilities; }
  }
  buttons.sort((a, b) => a.x - b.x);
  if (buttons.some((item, index) => item.x - item.width / 2 < area.left - .01 || item.x + item.width / 2 > area.right + .01
    || index > 0 && item.x - buttons[index - 1].x < (item.width + buttons[index - 1].width) / 2
      + footerButtonGap(settings, scene, buttons[index - 1].id, item.id) - .01)) return null;
  const candidate = { ...settings, placement: { main: { ...settings.placement.main }, detail: { ...settings.placement.detail } } };
  snapshotFooterPositions(candidate, scene, width, buttons);
  const resolved = resolveFreeFooterLayout(candidate, scene, width).bar;
  if (resolved.length !== buttons.length || resolved.some((item, index) => item.id !== buttons[index].id || Math.abs(item.x - buttons[index].x) > .01)) return null;
  return buttons;
}
