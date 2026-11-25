/**
 * 全应用统一的 iOS 连续曲率参数。
 *
 * 铃动窗、切歌提示、桌面歌词只是尺寸不同：圆角半径按同一比例随高度缩放，
 * 绘制统一交给 taskbarSquircle.buildSquircleMask（figma-squircle,
 * cornerSmoothing 0.6, preserveSmoothing），不再各写一套 16px 固定值。
 */
export const IOS_CORNER_SMOOTHING = 0.6;

/** 铃动窗小条：44px 高、圆角矩形 16px、胶囊取半高。 */
export const REFERENCE_FRAME_HEIGHT = 44;
export const REFERENCE_CORNER_RADIUS = 16;

export type FrameShape = 'rounded' | 'pill' | 'square';

/** 按铃动窗 16/44 的比例换算任意尺寸下的外框半径。 */
export function resolveFrameRadius(shape: FrameShape, height: number): number {
  if (shape === 'square' || !Number.isFinite(height) || height <= 0) return 0;
  if (shape === 'pill') return height / 2;
  return Math.round((height * REFERENCE_CORNER_RADIUS) / REFERENCE_FRAME_HEIGHT);
}

/** 封面与外框同一比例、同一曲率：半径 = 封面尺寸 × 外框半径 / 外框高度。 */
export function resolveCoverRadius(shape: FrameShape, coverSize: number, frameHeight: number): number {
  if (shape === 'square') return 0;
  const frameRadius = resolveFrameRadius(shape, frameHeight);
  if (frameRadius <= 0 || !Number.isFinite(coverSize) || coverSize <= 0) return 0;
  const radius = (coverSize * frameRadius) / Math.max(1, frameHeight);
  return Math.min(coverSize / 2, Math.max(4, Math.round(radius)));
}
