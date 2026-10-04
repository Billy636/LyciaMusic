import { computed } from 'vue';
import { playerStorage } from '../../services/storage/playerStorage';
import { useSettings } from './useSettings';
import { allowedFooterPositions, createDefaultFooterSettings, effectiveFooterLayout, footerAction, migrateFooterSettings, normalizeFooterSettings, syncFooterBehavior } from './footer';
import type { FooterActionId, FooterBehavior, FooterCoverShape, FooterMovableId, FooterPlacement, FooterPosition, FooterScene, FooterSettings, FooterSpacing } from '../../types/footer';
import { footerAlignedPositions, placementScene, reflowFooterSpacing, resolveFreeFooterLayout, snapshotFooterPositions, type FooterAlignment } from './freeFooterLayout';

export function useFooterSettings() {
  const { settings } = useSettings();
  if (!settings.value.footer) {
    settings.value.footer = migrateFooterSettings(playerStorage.getString, settings.value.audio.showEqualizerInFooter !== false);
    playerStorage.writeSettings(settings.value);
  }
  const footer = computed(() => normalizeFooterSettings(settings.value.footer));
  const update = (edit: (draft: FooterSettings) => void) => {
    const draft = normalizeFooterSettings(footer.value);
    edit(draft);
    // Visual edits must not recreate audio.equalizer/volumeBalance objects:
    // their identity watchers would otherwise reapply the DSP settings.
    settings.value.footer = normalizeFooterSettings(draft);
    playerStorage.writeSettings(settings.value);
  };
  const setBehavior = (scene: FooterScene, patch: Partial<FooterBehavior>) => update(draft => {
    Object.assign(draft.behavior[scene], patch);
    if (patch.progress && patch.progress !== 'hidden') draft.behavior[scene].lastVisibleProgress = patch.progress;
    if (draft.linked) syncFooterBehavior(draft, scene);
  });
  const setCoverShape = (shape: FooterCoverShape) => update(draft => {
    draft.coverShape = shape;
  });
  const setPosition = (scene: FooterScene, id: FooterActionId, position: FooterPosition) => update(draft => {
    const list = footerAction(id).detailOnly ? draft.detailExtras : draft[draft.linked ? 'main' : scene];
    const item = list.find(entry => entry.id === id);
    if (item) item.position = position;
  });
  const place = (scene: FooterScene, id: FooterActionId, position: FooterPosition, relativeId?: FooterActionId, after = false) => update(draft => {
    if (!allowedFooterPositions(id).includes(position) || (scene === 'main' && footerAction(id).detailOnly) || relativeId === id) return;
    const items = effectiveFooterLayout(draft, scene).map(item => ({ ...item }));
    const from = items.findIndex(item => item.id === id);
    if (from < 0) return;
    const [item] = items.splice(from, 1); item.position = position;
    const target = items.findIndex(entry => entry.id === relativeId && entry.position === position);
    let index = target >= 0 ? target + Number(after) : items.length;
    if (target < 0) {
      const last = items.map(entry => entry.position).lastIndexOf(position);
      if (last >= 0) index = last + 1;
    }
    items.splice(index, 0, item);
    draft[draft.linked ? 'main' : scene] = items.filter(entry => !footerAction(entry.id).detailOnly);
    if (scene === 'detail') {
      draft.detailExtras = items.filter(entry => footerAction(entry.id).detailOnly);
      draft.detailOrder = items.map(entry => entry.id);
    }
  });
  const move = (scene: FooterScene, id: FooterActionId, targetId: FooterActionId) => {
    const items = effectiveFooterLayout(footer.value, scene);
    const from = items.findIndex(item => item.id === id), to = items.findIndex(item => item.id === targetId);
    if (from < 0 || to < 0 || items[from].position !== items[to].position) return;
    place(scene, id, items[from].position, targetId, from < to);
  };
  const setSpacing = (scene: FooterScene, patch: Partial<FooterSpacing>, referenceWidth?: number) => update(draft => {
    const before = referenceWidth ? resolveFreeFooterLayout(draft, scene, referenceWidth).bar : undefined;
    Object.assign(draft.spacing[draft.linked ? 'main' : scene], patch);
    if (referenceWidth && before) reflowFooterSpacing(draft, scene, referenceWidth, before, patch);
  });
  const setPlacement = (scene: FooterScene, id: FooterMovableId, patch: FooterPlacement, referenceWidth?: number) => update(draft => {
    if (id === 'more' && patch.visibility === 'more') return;
    if (referenceWidth) snapshotFooterPositions(draft, scene, referenceWidth);
    const key = placementScene(draft, scene, id);
    draft.placement[key][id] = { ...draft.placement[key][id], ...patch };
    if (patch.x !== undefined) draft.placement[key][id]!.basis = 'canvas';
  });
  const alignButtons = (scene: FooterScene, alignment: FooterAlignment, referenceWidth: number) => {
    const positions = footerAlignedPositions(footer.value, scene, referenceWidth, alignment);
    if (!positions) return false;
    update(draft => snapshotFooterPositions(draft, scene, referenceWidth, positions));
    return true;
  };
  const setLinked = (linked: boolean, scene: FooterScene) => update(draft => {
    if (linked) {
      draft.main = draft[scene].map(item => ({ ...item }));
      draft.spacing.main = { ...draft.spacing[scene] };
      draft.placement.main = Object.fromEntries(Object.entries(draft.placement[scene]).filter(([id]) => !footerAction(id as FooterMovableId).detailOnly));
      syncFooterBehavior(draft, scene);
    } else {
      draft.detail = draft.main.map(item => ({ ...item }));
      draft.spacing.detail = { ...draft.spacing.main };
      draft.placement.detail = {
        ...Object.fromEntries(Object.entries(draft.placement.detail).filter(([id]) => footerAction(id as FooterMovableId).detailOnly)),
        ...draft.placement.main,
      };
    }
    draft.linked = linked;
  });
  const resetScene = (scene: FooterScene) => update(draft => {
    const defaults = createDefaultFooterSettings();
    draft[draft.linked ? 'main' : scene] = defaults[scene];
    draft.behavior[scene] = defaults.behavior[scene];
    if (draft.linked) syncFooterBehavior(draft, scene);
    draft.spacing[draft.linked ? 'main' : scene] = defaults.spacing[scene];
    draft.placement[draft.linked ? 'main' : scene] = {};
    if (scene === 'detail') draft.placement.detail = {};
    if (scene === 'detail') { draft.detailExtras = defaults.detailExtras; draft.detailOrder = defaults.detailOrder; }
  });
  const toggleProgress = (scene: FooterScene) => {
    const behavior = footer.value.behavior[scene];
    setBehavior(scene, { progress: behavior.progress === 'hidden' ? behavior.lastVisibleProgress : 'hidden' });
  };
  return { footer, update, setBehavior, setCoverShape, setPosition, place, move, setSpacing, setPlacement, alignButtons, setLinked, resetScene, toggleProgress,
    layout: (scene: FooterScene) => effectiveFooterLayout(footer.value, scene) };
}
