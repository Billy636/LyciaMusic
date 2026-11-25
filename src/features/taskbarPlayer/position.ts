import {
  TASKBAR_PLAYER_WINDOW_HEIGHT,
  TASKBAR_PLAYER_MIN_LEFT_OFFSET,
  TASKBAR_PLAYER_MAX_LEFT_OFFSET,
  type RectPhysical,
  type TaskbarTrayGeometry,
} from './shared';

export interface TaskbarHorizontalPosition {
  /** 可拖动的左边界（底栏最左端）。 */
  minX: number;
  /** 可拖动的右边界（窗口贴右端时的左边缘）。 */
  maxX: number;
  /** 默认停靠位置：底栏最左端。 */
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

  // 默认贴底栏最左端；左右边界同时作为锁定状态下的横向拖动区间。
  return {
    minX,
    maxX: rightBound,
    baseX: minX,
    y: Math.round(top + (bottom - top - TASKBAR_PLAYER_WINDOW_HEIGHT) / 2),
  };
}

/** 偏移量表示窗口左边缘相对底栏最左端的距离。
 * 下限允许把窗口完全缩进桌面左边界（TASKBAR_PLAYER_MIN_LEFT_OFFSET）；
 * margin 仅放大右侧上限，允许往右藏边。 */
export function clampTaskbarLeftOffset(
  offset: number,
  position: TaskbarHorizontalPosition,
  margin = 0,
) {
  const safeOffset = Number.isFinite(offset) ? Math.round(offset) : 0;
  const screenLimit = Math.max(0, Math.floor(position.maxX - position.minX) + margin);
  // 设置范围优先：允许把整块窗口完整藏进左右边界外（-600 ~ 1430），
  // 不再被「屏幕宽 - 18px」的拖拽范围吞掉。
  const upper = Math.max(screenLimit, TASKBAR_PLAYER_MAX_LEFT_OFFSET);
  return clamp(safeOffset, TASKBAR_PLAYER_MIN_LEFT_OFFSET, upper);
}

/** 主屏工作区的逻辑纵向边界（不含任务栏）。 */
export interface TaskbarWorkAreaBounds {
  top: number;
  bottom: number;
}

/**
 * 边界感知的展开定位：以播控条锚点为顶边先展开面板，若窗口底部越过工作区
 * 下界则整体上移使底边贴合；再保证顶边不越过工作区上界。
 *
 * 效果即「先展开、后平移」，整窗始终完整呈现，不会因为固定在锚点上方一个
 * 面板高度而在屏幕上界时隐出桌面之外。收起态调用方可直接传原始锚点。
 */
export function resolveExpandedWindowTop(
  anchorY: number,
  windowHeight: number,
  workArea: TaskbarWorkAreaBounds | null,
): number {
  if (!Number.isFinite(anchorY) || !Number.isFinite(windowHeight) || windowHeight <= 0) return anchorY;
  if (!workArea || !Number.isFinite(workArea.top) || !Number.isFinite(workArea.bottom)) return anchorY;
  // 1) 以锚点为顶边向下展开；底边超出工作区时整体上移，使底边贴合下界。
  const maxTop = workArea.bottom - windowHeight;
  let top = Math.min(anchorY, maxTop);
  // 2) 若上移后顶边越过工作区上界，则贴回上界（不让播控条隐出屏幕顶部）。
  if (top < workArea.top) top = workArea.top;
  return Math.round(top);
}
