import { effectiveFooterLayout, footerAction, footerGeometry, FOOTER_BUTTON_SIZE, FOOTER_PLAY_SIZE } from './footer';
import type { FooterMovableId, FooterPlacement, FooterScene, FooterSettings, FooterSpacing } from '../../types/footer';

export interface PlacedFooterButton { id: FooterMovableId; x: number; width: number }
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
    return { id: item.id, initialX: x.get(item.id) ?? width - 40, manual: override.x,
      visibility: override.visibility ?? (item.position === 'hidden' ? 'hidden' : item.position === 'more' ? 'more' : 'bar') };
  });
}
function bounds(settings: FooterSettings, scene: FooterScene, width: number) {
  const mode = settings.behavior[scene].info;
  const info = mode === 'none' ? 0 : Math.min(mode === 'cover' ? 48 : 144, width / 3);
  return { left: 16 + info + (info ? 8 : 0), right: width - 24 };
}
function fitOrderedButtons(settings: FooterSettings, scene: FooterScene, width: number, buttons: PlacedFooterButton[]) {
  const area = bounds(settings, scene, width);
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
  const area = bounds(settings, scene, width);
  for (const item of buttons) {
    const key = placementScene(settings, scene, item.id);
    const x = Math.max(0, Math.min(1, (item.x - area.left - item.width / 2) / Math.max(1, area.right - area.left - item.width)));
    settings.placement[key][item.id] = { ...settings.placement[key][item.id], x };
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
  const area = bounds(settings, scene, width);
  if (required <= area.right - area.left) {
    fitOrderedButtons(settings, scene, width, buttons);
    snapshotFooterPositions(settings, scene, width, buttons);
  } else {
    snapshotFooterPositions(settings, scene, width, before);
  }
}
function nearestFree(desired: number, buttonWidth: number, occupied: PlacedFooterButton[], left: number, right: number, gap: (item: PlacedFooterButton) => number, snap = false) {
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
      if (Math.abs(midpoint - desired) <= 8 && fits(midpoint)) centers.push(midpoint);
    }
    centers.sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired));
    if (centers.length) return centers[0];
    const edges = candidates.slice(3).filter(x => Math.abs(x - desired) <= 6 && fits(x));
    edges.sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired));
    if (edges.length) return edges[0];
  }
  const valid = candidates.filter(fits);
  valid.sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired));
  return valid[0] ?? null;
}
export function resolveFreeFooterLayout(settings: FooterSettings, scene: FooterScene, width: number, omit?: FooterMovableId) {
  const items = initialButtons(settings, scene, width).filter(item => item.id !== omit);
  const area = bounds(settings, scene, width);
  const bar: PlacedFooterButton[] = [], more: { id: FooterMovableId }[] = [], hidden: { id: FooterMovableId }[] = [];
  const visible = items.filter(item => item.visibility === 'bar').map(item => {
    const w = footerButtonWidth(item.id);
    return { ...item, width: w, desired: item.manual === undefined ? item.initialX
      : area.left + w / 2 + item.manual * Math.max(0, area.right - area.left - w) };
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
  const infoWidth = settings.behavior[scene].info === 'none' ? 0 : settings.behavior[scene].info === 'cover' ? 48
    : Math.max(0, (first ? first.x - first.width / 2 - 8 : width - 24) - 16);
  return { bar, more: more.filter(item => item.id !== 'more'), hidden, infoWidth };
}
export function footerDropPosition(settings: FooterSettings, scene: FooterScene, width: number, id: FooterMovableId, desired: number, snap = true) {
  const occupied = resolveFreeFooterLayout(settings, scene, width).bar.filter(item => item.id !== id);
  const area = bounds(settings, scene, width), w = footerButtonWidth(id);
  const x = nearestFree(desired, w, occupied, area.left, area.right,
    item => footerButtonGap(settings, scene, id, item.id), snap);
  if (x === null) return null;
  return { x, normalized: Math.max(0, Math.min(1, (x - area.left - w / 2) / Math.max(1, area.right - area.left - w))) };
}
