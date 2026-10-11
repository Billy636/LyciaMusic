import {
  TASKBAR_PLAYER_WINDOW_HEIGHT,
  type RectPhysical,
  type TaskbarTrayGeometry,
} from './shared';

export interface TaskbarHorizontalPosition {
  minX: number;
  maxX: number;
  baseX: number;
  y: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function isValidRect(rect: RectPhysical) {
  return [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)
    && rect.right > rect.left && rect.bottom > rect.top;
}

// Rust reports the player window's scale, which may still belong to a different
// monitor during a DPI transition. The native taskbar geometry belongs to primary.
export function resolveTaskbarPositionScaleFactor(
  geometry: TaskbarTrayGeometry,
  primaryScaleFactor?: number,
) {
  if (typeof primaryScaleFactor === 'number' && Number.isFinite(primaryScaleFactor) && primaryScaleFactor > 0) {
    return primaryScaleFactor;
  }
  return Number.isFinite(geometry.scale_factor) && geometry.scale_factor > 0
    ? geometry.scale_factor : 1;
}

// All values returned here use logical pixels. Sharing this calculation keeps
// manual dragging, automatic positioning and the settings alignment action alike.
export function resolveTaskbarHorizontalPosition(
  geometry: TaskbarTrayGeometry,
  width: number,
  scaleFactor: number,
): TaskbarHorizontalPosition | null {
  const physical = geometry.taskbar_rect_physical;
  if (!isValidRect(physical) || !Number.isFinite(width) || width <= 0
    || !Number.isFinite(scaleFactor) || scaleFactor <= 0) return null;

  const left = physical.left / scaleFactor;
  const top = physical.top / scaleFactor;
  const right = physical.right / scaleFactor;
  const bottom = physical.bottom / scaleFactor;
  if (right - left <= bottom - top) return null;

  const minX = Math.ceil(left);
  const rightBound = Math.max(minX, Math.floor(right - width));
  const tray = geometry.tray_rect_physical;
  const hasTray = geometry.source === 'tray' && tray !== null && isValidRect(tray);
  const defaultX = hasTray ? tray.left / scaleFactor - width - 12 : right - width - 16;
  const baseX = clamp(Math.round(defaultX), minX, rightBound);

  return {
    minX,
    maxX: baseX,
    baseX,
    y: Math.round(top + (bottom - top - TASKBAR_PLAYER_WINDOW_HEIGHT) / 2),
  };
}

export function clampTaskbarLeftOffset(offset: number, position: TaskbarHorizontalPosition) {
  const safeOffset = Number.isFinite(offset) ? Math.round(offset) : 0;
  return clamp(safeOffset, 0, Math.max(0, Math.floor(position.baseX - position.minX)));
}
