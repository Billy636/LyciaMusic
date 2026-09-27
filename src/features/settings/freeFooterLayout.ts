import { effectiveFooterLayout, footerAction, footerGeometry, FOOTER_BUTTON_SIZE, FOOTER_PLAY_SIZE, resolveFooterLayout } from './footer';
import type { FooterMovableId, FooterPlacement, FooterScene, FooterSettings } from '../../types/footer';

export interface PlacedFooterButton { id: FooterMovableId; x: number; width: number }
// Occupancy/hit targets are uniform, independently of the original SVG sizes.
export const footerButtonWidth = (id: FooterMovableId) => id === 'play' ? FOOTER_PLAY_SIZE : FOOTER_BUTTON_SIZE;
export const placementScene = (settings: FooterSettings, scene: FooterScene, id: FooterMovableId) => footerAction(id).detailOnly ? 'detail' : settings.linked ? 'main' : scene;
export const footerPlacement = (settings: FooterSettings, scene: FooterScene, id: FooterMovableId): FooterPlacement => settings.placement[placementScene(settings, scene, id)][id] ?? {};

// Old region data is only a migration/default-position source. Once a button is
// moved, its normalized horizontal coordinate has no region or center lock.
function initialButtons(settings: FooterSettings, scene: FooterScene, width: number) {
  const geometry = footerGeometry(settings, scene), groups = resolveFooterLayout(settings, scene, width);
  const x = new Map<FooterMovableId, number>();
  const center = width / 2, side = (width - geometry.center - 2 * geometry.padding - 2 * geometry.regionGap) / 2;
  let edge = geometry.padding + side;
  for (const item of [...groups.left].reverse()) { x.set(item.id, edge - FOOTER_BUTTON_SIZE / 2); edge -= FOOTER_BUTTON_SIZE + geometry.sideGap; }
  edge = width - geometry.padding - geometry.rightInset;
  for (const item of [...groups.right].reverse()) { x.set(item.id, edge - FOOTER_BUTTON_SIZE / 2); edge -= FOOTER_BUTTON_SIZE + geometry.sideGap; }
  edge = center - geometry.core / 2 - geometry.controlGap;
  for (const item of [...groups.before].reverse()) { const w = footerButtonWidth(item.id); x.set(item.id, edge - w / 2); edge -= w + geometry.controlGap; }
  edge = center + geometry.core / 2 + geometry.controlGap;
  for (const item of groups.after) { const w = footerButtonWidth(item.id); x.set(item.id, edge + w / 2); edge += w + geometry.controlGap; }
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
function nearestFree(desired: number, buttonWidth: number, occupied: PlacedFooterButton[], left: number, right: number, gap: number, snap = false) {
  const min = left + buttonWidth / 2, max = right - buttonWidth / 2;
  if (max < min) return null;
  const candidates = [Math.max(min, Math.min(max, desired)), min, max];
  for (const item of occupied) candidates.push(item.x - (item.width + buttonWidth) / 2 - gap, item.x + (item.width + buttonWidth) / 2 + gap);
  const fits = (x: number) => x >= min - .01 && x <= max + .01
    && occupied.every(item => Math.abs(x - item.x) >= (buttonWidth + item.width) / 2 + gap - .01);
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
  const area = bounds(settings, scene, width), geometry = footerGeometry(settings, scene);
  const bar: PlacedFooterButton[] = [], more: { id: FooterMovableId }[] = [], hidden: { id: FooterMovableId }[] = [];
  const visible = items.filter(item => item.visibility === 'bar');
  // Explicit user positions win, followed by essential playback controls and
  // the menu trigger. Resizing only resolves collisions; it never rewrites saves.
  const priority = (item: typeof visible[number]) => item.manual !== undefined ? 0 : ['previous', 'play', 'next', 'more'].includes(item.id) ? 1 : 2;
  visible.sort((a, b) => priority(a) - priority(b));
  for (const item of visible) {
    const w = footerButtonWidth(item.id);
    const desired = item.manual === undefined ? item.initialX : area.left + w / 2 + item.manual * Math.max(0, area.right - area.left - w);
    const position = nearestFree(desired, w, bar, area.left, area.right, geometry.sideGap);
    if (position === null) more.push({ id: item.id });
    else bar.push({ id: item.id, x: position, width: w });
  }
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
  const x = nearestFree(desired, w, occupied, area.left, area.right, footerGeometry(settings, scene).sideGap, snap);
  if (x === null) return null;
  return { x, normalized: Math.max(0, Math.min(1, (x - area.left - w / 2) / Math.max(1, area.right - area.left - w))) };
}
