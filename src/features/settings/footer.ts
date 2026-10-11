import type { FooterActionId, FooterBehavior, FooterCoverShape, FooterLayoutItem, FooterMovableId, FooterPlacement, FooterPosition, FooterScene, FooterSettings } from '../../types/footer';

export const FOOTER_ACTIONS: { id: FooterActionId; label: string; position: FooterPosition; detailOnly?: boolean }[] = [
  { id: 'favorite', label: '收藏', position: 'hidden' },
  { id: 'mode', label: '播放模式', position: 'before' },
  { id: 'queue', label: '播放队列', position: 'after' },
  { id: 'volume', label: '音量', position: 'right' },
  { id: 'desktopLyrics', label: '桌面歌词', position: 'right' },
  { id: 'equalizer', label: '均衡器', position: 'right' },
  { id: 'wasapiExclusive', label: 'WASAPI 独占', position: 'hidden' },
  { id: 'volumeBalance', label: '音量平衡', position: 'hidden' },
  { id: 'pin', label: '固定底栏', position: 'more' },
  { id: 'progress', label: '进度条显示开关', position: 'more' },
  { id: 'more', label: '更多底栏操作', position: 'right' },
  { id: 'lyricsStyle', label: '歌词样式', position: 'right', detailOnly: true },
  { id: 'visualizer', label: '音频频谱开关', position: 'more', detailOnly: true },
];
export const FOOTER_POSITIONS: Record<FooterPosition, string> = {
  left: '底栏左侧', before: '播放键左侧', after: '播放键右侧', right: '底栏右侧', more: '更多菜单', hidden: '隐藏',
};
export const FOOTER_BUTTON_SIZE = 32;
export const FOOTER_PLAY_SIZE = 44;
export const footerAction = (id: FooterMovableId) => {
  if (id === 'previous' || id === 'play' || id === 'next') return { id, label: { previous: '上一首', play: '播放 / 暂停', next: '下一首' }[id], position: 'left' as FooterPosition, detailOnly: false };
  return FOOTER_ACTIONS.find(action => action.id === id)!;
};
export const allowedFooterPositions = (id: FooterActionId) => (Object.keys(FOOTER_POSITIONS) as FooterPosition[])
  .filter(position => (!['before', 'after'].includes(position) || id === 'mode' || id === 'queue')
    && !(id === 'more' && position === 'more'));

export function createDefaultFooterSettings(): FooterSettings {
  const main = FOOTER_ACTIONS.filter(action => !action.detailOnly).map(({ id, position }) => ({ id, position }));
  const detailExtras = FOOTER_ACTIONS.filter(action => action.detailOnly).map(({ id, position }) => ({ id, position }));
  return {
    version: 1, linked: true, coverShape: { main: 'square', detail: 'square' }, main, detail: main.map(item => ({ ...item })),
    detailExtras,
    detailOrder: legacyDetailOrder(main, detailExtras),
    spacing: { main: { controls: 24, utilities: 8 }, detail: { controls: 24, utilities: 8 } },
    placement: { main: {}, detail: {} },
    behavior: {
      main: { info: 'song', progress: 'always', lastVisibleProgress: 'always', autoHide: false, visualizer: false },
      detail: { info: 'time', progress: 'always', lastVisibleProgress: 'always', autoHide: true, visualizer: true },
    },
  };
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
function normalizeLayout(value: unknown, fallback: FooterLayoutItem[]) {
  const output: FooterLayoutItem[] = [];
  if (Array.isArray(value)) {
    for (const raw of value) {
      const item = object(raw);
      const definition = fallback.find(entry => entry.id === item.id);
      if (!definition || output.some(entry => entry.id === definition.id)) continue;
      const position = allowedFooterPositions(definition.id).includes(item.position as FooterPosition)
        ? item.position as FooterPosition : definition.position;
      output.push({ id: definition.id, position });
    }
  }
  for (const item of fallback) if (!output.some(entry => entry.id === item.id)) output.push({ ...item });
  return output;
}
function normalizeBehavior(value: unknown, fallback: FooterBehavior): FooterBehavior {
  const raw = object(value);
  return {
    info: typeof raw.info === 'string' && ['cover', 'song', 'time', 'both', 'none'].includes(raw.info) ? raw.info as FooterBehavior['info'] : fallback.info,
    progress: typeof raw.progress === 'string' && ['always', 'hover', 'hidden'].includes(raw.progress) ? raw.progress as FooterBehavior['progress'] : fallback.progress,
    lastVisibleProgress: raw.lastVisibleProgress === 'hover' ? 'hover' : 'always',
    progressColor: typeof raw.progressColor === 'string' && /^#[\da-f]{6}$/i.test(raw.progressColor)
      ? raw.progressColor.toLowerCase() : '',
    autoHide: typeof raw.autoHide === 'boolean' ? raw.autoHide : fallback.autoHide,
    visualizer: typeof raw.visualizer === 'boolean' ? raw.visualizer : fallback.visualizer,
  };
}

/** Song info and playback-page-only visualization are always scene-specific. */
export function syncFooterBehavior(settings: FooterSettings, source: FooterScene) {
  const { info: _info, visualizer: _visualizer, ...shared } = settings.behavior[source];
  Object.assign(settings.behavior.main, shared);
  Object.assign(settings.behavior.detail, shared);
}

export function normalizeFooterSettings(value: unknown): FooterSettings {
  const defaults = createDefaultFooterSettings(), raw = object(value), behavior = object(raw.behavior);
  const main = normalizeLayout(raw.main, defaults.main), detail = normalizeLayout(raw.detail, defaults.detail);
  const detailExtras = normalizeLayout(raw.detailExtras, defaults.detailExtras);
  const linked = typeof raw.linked === 'boolean' ? raw.linked : defaults.linked;
  // Older versions stored one shape for both scenes, including unlinked layouts.
  const legacyShape = raw.coverShape === 'circle' ? 'circle' : 'square';
  const shapes = object(raw.coverShape);
  const normalizeShape = (value: unknown): FooterCoverShape => value === 'square' || value === 'circle' ? value : legacyShape;
  const mainShape = normalizeShape(shapes.main);
  const fallbackOrder = legacyDetailOrder(linked ? main : detail, detailExtras);
  const detailOrder = Array.isArray(raw.detailOrder)
    ? [...new Set(raw.detailOrder.filter((id): id is FooterActionId => fallbackOrder.includes(id as FooterActionId)))] : [];
  detailOrder.push(...fallbackOrder.filter(id => !detailOrder.includes(id)));
  const spacing = object(raw.spacing);
  const placement = object(raw.placement);
  const normalizedBehavior = {
    main: normalizeBehavior(behavior.main, defaults.behavior.main),
    detail: normalizeBehavior(behavior.detail, defaults.behavior.detail),
  };
  const normalizePlacement = (value: unknown, info: FooterBehavior['info']) => {
    const entries = object(value), result: Partial<Record<FooterMovableId, FooterPlacement>> = {};
    for (const id of [...FOOTER_ACTIONS.map(item => item.id), 'previous', 'play', 'next'] as FooterMovableId[]) {
      const entry = object(entries[id]);
      const next: FooterPlacement = {};
      if (typeof entry.x === 'number' && Number.isFinite(entry.x)) {
        next.x = Math.max(0, Math.min(1, entry.x));
        next.basis = entry.basis === 'canvas' || entry.basis === 'legacy-none' || entry.basis === 'legacy-cover' || entry.basis === 'legacy-text'
          ? entry.basis : info === 'none' ? 'legacy-none' : info === 'cover' ? 'legacy-cover' : 'legacy-text';
      }
      if (entry.visibility === 'bar' || entry.visibility === 'hidden' || (entry.visibility === 'more' && id !== 'more')) next.visibility = entry.visibility;
      if (Object.keys(next).length) result[id] = next;
    }
    return result;
  };
  const normalizeSpacing = (value: unknown) => {
    const entry = object(value);
    const clamp = (input: unknown, fallback: number, min: number, max: number) => typeof input === 'number' && Number.isFinite(input)
      ? Math.max(min, Math.min(max, Math.round(input))) : fallback;
    return { controls: clamp(entry.controls, 24, 8, 40), utilities: clamp(entry.utilities, 8, 0, 24) };
  };
  const normalized: FooterSettings = {
    version: 1, linked, coverShape: { main: mainShape, detail: linked ? mainShape : normalizeShape(shapes.detail) }, main, detail, detailExtras, detailOrder,
    spacing: { main: normalizeSpacing(spacing.main), detail: normalizeSpacing(spacing.detail) },
    placement: { main: normalizePlacement(placement.main, normalizedBehavior.main.info), detail: normalizePlacement(placement.detail, normalizedBehavior.detail.info) },
    behavior: normalizedBehavior,
  };
  // Old linked settings may have copied a cover-bearing main-page mode into
  // the playback footer. Keep the main preference and repair only the detail.
  if (normalized.behavior.detail.info !== 'time' && normalized.behavior.detail.info !== 'none') {
    normalized.behavior.detail.info = 'time';
  }
  if (linked) syncFooterBehavior(normalized, 'main');
  return normalized;
}

export function migrateFooterSettings(read: (key: string) => string | null, showEqualizer: boolean): FooterSettings {
  const settings = createDefaultFooterSettings();
  const hidden = read('footer_progress_hidden') === 'true';
  settings.behavior.main.progress = settings.behavior.detail.progress = hidden ? 'hidden' : 'always';
  const pinnedMain = read('footer_pinned_main') ?? read('footer_pinned');
  settings.behavior.main.autoHide = pinnedMain === 'false';
  settings.behavior.detail.autoHide = read('footer_pinned_detail') !== 'true';
  settings.behavior.detail.visualizer = read('footer_visualizer_enabled') !== 'false';
  if (!showEqualizer) for (const layout of [settings.main, settings.detail]) {
    layout.find(item => item.id === 'equalizer')!.position = 'hidden';
  }
  return settings;
}

function legacyDetailOrder(shared: FooterLayoutItem[], extras: FooterLayoutItem[]): FooterActionId[] {
  const moreIndex = shared.findIndex(item => item.id === 'more');
  const more = shared[moreIndex];
  // Preserve the previous trailing menu position in the playback page, while
  // honoring a user who places the trigger before other buttons in its region.
  const trailingMore = more && !shared.slice(moreIndex + 1).some(item => item.position === more.position);
  return (trailingMore
    ? [...shared.slice(0, moreIndex), ...extras, ...shared.slice(moreIndex)]
    : [...shared, ...extras]).map(item => item.id);
}

export function effectiveFooterLayout(settings: FooterSettings, scene: FooterScene): FooterLayoutItem[] {
  const shared = [...settings[settings.linked ? 'main' : scene]];
  if (scene !== 'detail') return shared;
  // Shared order follows the main scene; dedicated buttons keep their slots
  // among shared buttons, including when a shared button is later reordered.
  return settings.detailOrder.map(id => footerAction(id).detailOnly
    ? settings.detailExtras.find(item => item.id === id)! : shared.shift()!).filter(Boolean);
}

// Preserve the original gap-6 playback spacing and gap-2 utility spacing.
// Both the live footer and its preview use these dimensions; overflow must not
// squeeze the controls to make room for another shortcut.
export function footerGeometry(settings: FooterSettings, scene: FooterScene) {
  const spacing = settings.spacing[settings.linked ? 'main' : scene];
  const core = 2 * FOOTER_BUTTON_SIZE + FOOTER_PLAY_SIZE + 2 * spacing.controls;
  const wing = 2 * FOOTER_BUTTON_SIZE + spacing.utilities;
  return { core, wing, controlGap: spacing.controls, sideGap: spacing.utilities,
    center: core + 2 * (wing + spacing.utilities), button: FOOTER_BUTTON_SIZE, padding: 16, regionGap: 16, rightInset: 8 };
}
export function footerLayoutStyle(settings: FooterSettings, scene: FooterScene) {
  const geometry = footerGeometry(settings, scene);
  return {
  '--footer-center-width': `${geometry.center}px`,
  '--footer-core-width': `${geometry.core}px`,
  '--footer-wing-width': `${geometry.wing}px`,
  '--footer-control-gap': `${geometry.controlGap}px`,
  '--footer-side-gap': `${geometry.sideGap}px`,
  '--footer-region-gap': `${geometry.regionGap}px`,
  '--footer-padding': `${geometry.padding}px`,
  '--footer-right-inset': `${geometry.rightInset}px`,
  };
}

// Symmetric wings keep the play button centered even with asymmetric shortcuts.
export function footerLayoutCapacity(settings: FooterSettings, scene: FooterScene, width: number) {
  const geometry = footerGeometry(settings, scene);
  const sideWidth = Math.max(0, (width - 2 * geometry.padding - 2 * geometry.regionGap - geometry.center) / 2);
  const infoWidth = settings.behavior[scene].info === 'none' ? 0 : settings.behavior[scene].info === 'cover' ? 48 : 144;
  const sideStep = geometry.button + geometry.sideGap;
  return {
    left: Math.max(0, Math.floor((sideWidth - infoWidth + (infoWidth ? 0 : geometry.sideGap)) / sideStep)),
    right: Math.max(0, Math.floor((sideWidth - geometry.rightInset + geometry.sideGap) / sideStep)), before: 2, after: 2,
  };
}
export function resolveFooterLayout(settings: FooterSettings, scene: FooterScene, width: number) {
  const layout = effectiveFooterLayout(settings, scene);
  const capacities = footerLayoutCapacity(settings, scene, width);
  const morePosition = layout.find(item => item.id === 'more')?.position;
  const groups: Record<Exclude<FooterPosition, 'hidden'>, FooterLayoutItem[]> = { left: [], right: [], before: [], after: [], more: [] };
  for (const item of layout) {
    if (item.position === 'hidden') continue;
    // Reserve a visible menu trigger's slot, even when it is ordered last.
    // It must never overflow into its own menu.
    if (item.id === 'more') {
      if (item.position === 'left' || item.position === 'right') groups[item.position].push(item);
      continue;
    }
    if (item.position === 'more') groups.more.push(item);
    else {
      const reserved = morePosition === item.position && !groups[item.position].some(entry => entry.id === 'more') ? 1 : 0;
      if (groups[item.position].length < capacities[item.position] - reserved) groups[item.position].push(item);
      else groups.more.push(item);
    }
  }
  return groups;
}
