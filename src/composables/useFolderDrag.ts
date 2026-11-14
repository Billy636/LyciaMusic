import { onDeactivated, onScopeDispose, watch, type Ref } from 'vue';
import { dragSession } from './dragState';
import { folderMoveTargetError } from '../utils/folderMove';

type Folder = { path: string; name: string };

export function useFolderDrag(options: {
  enabled: Ref<boolean>;
  container: Ref<HTMLElement | null>;
  canMove: (folder: Folder) => boolean;
  expand: (path: string) => Promise<unknown>;
  move: (source: Folder, target: Folder) => Promise<void>;
}) {
  let pending: { folder: Folder; x: number; y: number; pointerId: number } | null = null;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  let hoveredPath = '';
  let frame = 0;
  let suppressClickUntil = 0;

  const clearHover = () => {
    clearTimeout(hoverTimer);
    hoverTimer = undefined;
    hoveredPath = '';
  };

  const updateTarget = () => {
    if (!pending || !dragSession.active || dragSession.type !== 'folder') return;
    const element = document.elementFromPoint(dragSession.mouseX, dragSession.mouseY)
      ?.closest<HTMLElement>('.folder-drop-target');
    const path = element?.dataset.folderPath ?? '';
    const valid = path && !folderMoveTargetError(pending.folder.path, path);
    dragSession.targetFolder = valid ? { path, name: element!.dataset.folderName || path } : null;
    if (hoveredPath !== (valid ? path : '')) {
      clearHover();
      if (valid) {
        hoveredPath = path;
        hoverTimer = setTimeout(() => {
          void options.expand(path).catch(() => { /* A failed expansion must not move a folder. */ });
        }, 650);
      }
    }
  };

  const scroll = () => {
    if (!pending || !dragSession.active || dragSession.type !== 'folder') return;
    const container = options.container.value;
    if (container) {
      const rect = container.getBoundingClientRect();
      const { mouseX: x, mouseY: y } = dragSession;
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        const delta = y < rect.top + 36 ? -8 : y > rect.bottom - 36 ? 8 : 0;
        if (delta) { container.scrollTop += delta; updateTarget(); }
      }
    }
    frame = requestAnimationFrame(scroll);
  };

  const reset = () => {
    pending = null;
    clearHover();
    cancelAnimationFrame(frame);
    window.removeEventListener('pointermove', pointerMove);
    window.removeEventListener('pointerup', pointerUp, true);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', cancel);
    window.removeEventListener('keydown', keydown, true);
    if (dragSession.type === 'folder') {
      dragSession.active = false;
      dragSession.showGhost = false;
      dragSession.targetFolder = null;
      dragSession.data = null;
      dragSession.type = 'song';
    }
  };

  const cancel = () => {
    if (pending && dragSession.active && dragSession.type === 'folder') suppressClickUntil = Date.now() + 400;
    reset();
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
  };
  const pointerMove = (event: PointerEvent) => {
    if (!pending || pending.pointerId !== event.pointerId) return;
    if (!options.enabled.value) { cancel(); return; }
    if (!dragSession.active) {
      if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < 6) return;
      Object.assign(dragSession, {
        type: 'folder', active: true, showGhost: true, data: pending.folder,
        songs: [], targetPlaylist: null, targetFolder: null, insertIndex: -1,
      });
      frame = requestAnimationFrame(scroll);
    }
    event.preventDefault();
    dragSession.mouseX = event.clientX;
    dragSession.mouseY = event.clientY;
    updateTarget();
  };
  const pointerUp = (event: PointerEvent) => {
    if (!pending || pending.pointerId !== event.pointerId) return;
    const source = pending.folder;
    const wasDragging = dragSession.active && dragSession.type === 'folder';
    if (wasDragging) {
      dragSession.mouseX = event.clientX;
      dragSession.mouseY = event.clientY;
      updateTarget();
      suppressClickUntil = Date.now() + 400;
    }
    const target = wasDragging ? dragSession.targetFolder : null;
    reset();
    if (target && options.enabled.value) void options.move(source, target);
  };
  const suppressClick = (event: MouseEvent) => {
    if (Date.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClickUntil = 0;
    }
  };

  window.addEventListener('click', suppressClick, true);
  watch(options.enabled, enabled => { if (!enabled) cancel(); });
  onDeactivated(cancel);
  onScopeDispose(() => { reset(); window.removeEventListener('click', suppressClick, true); });

  return {
    startFolderDrag: ({ event, node }: { event: PointerEvent; node: Folder }) => {
      if (!options.enabled.value || dragSession.active || event.button !== 0 || event.isPrimary === false
        || (event.target as HTMLElement).closest('button') || !options.canMove(node)) return;
      reset();
      pending = { folder: { path: node.path, name: node.name }, x: event.clientX, y: event.clientY, pointerId: event.pointerId };
      window.addEventListener('pointermove', pointerMove, { passive: false });
      window.addEventListener('pointerup', pointerUp, true);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('blur', cancel);
      window.addEventListener('keydown', keydown, true);
    },
  };
}
