import { getSvgPath } from 'figma-squircle';

export interface SquircleMaskParams {
  /** CSS 逻辑宽 */
  width: number;
  /** CSS 逻辑高 */
  height: number;
  /** CSS 逻辑圆角半径（会自动按半宽/半高缩让） */
  radius: number;
  /** 连续曲率强度 0~1，iOS 图标同款约 0.6 */
  smoothing?: number;
  /**
   * Tauri 报告的 scaleFactor（物理像素 / 逻辑像素）。优先于 window.devicePixelRatio：
   * 非整数缩放（如 180%）两者可能不同，必须以外层窗口的口径为准。
   */
  scaleFactor?: number;
  /** 原生窗口真实物理宽；给出时画布宽度直接 1:1 对齐物理像素 */
  physicalWidth?: number;
  /** 原生窗口真实物理高 */
  physicalHeight?: number;
}

/**
 * 以物理像素生成 iOS 式连续曲率（squircle）蒙版位图。
 *
 * 关键点：canvas 尺寸取 Tauri 原生窗口物理尺寸（或 CSS 尺寸 × scaleFactor），
 * 与窗口物理像素一一对应；路径在 CSS 空间生成后按 physical/css 比例缩放绘制，
 * 蒙版用 mask-size: 100% 100% 贴合，规避 WebView 在非整数缩放下 border-radius
 * 的亚像素抖动与边缘裁切。路径由 figma-squircle 生成，与直线相切且曲率连续。
 */
export function buildSquircleMask({
  width,
  height,
  radius,
  smoothing = 0.6,
  scaleFactor,
  physicalWidth,
  physicalHeight,
}: SquircleMaskParams): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const browserDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const dpr = Number.isFinite(scaleFactor) && (scaleFactor ?? 0) > 0 ? (scaleFactor as number) : browserDpr;
  const pw = Number.isFinite(physicalWidth) && (physicalWidth ?? 0) > 0
    ? Math.round(physicalWidth as number) : Math.round(width * dpr);
  const ph = Number.isFinite(physicalHeight) && (physicalHeight ?? 0) > 0
    ? Math.round(physicalHeight as number) : Math.round(height * dpr);
  if (pw <= 0 || ph <= 0) return null;
  // CSS 半径缩让：不超过半宽/半高（与 CSS 规范行为一致）
  const r = Math.min(radius, width / 2, height / 2);
  if (r <= 0) return null;
  try {
    const path = getSvgPath({
      width,
      height,
      cornerRadius: r,
      cornerSmoothing: smoothing,
      preserveSmoothing: true,
    });
    const canvas = document.createElement('canvas');
    canvas.width = pw;
    canvas.height = ph;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // 用真实物理/逻辑比例做变换，避免 dpr 取整造成的 1~2px 错位。
    ctx.setTransform(pw / width, 0, 0, ph / height, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fill(new Path2D(path));
    return canvas.toDataURL('image/png');
  } catch (error) {
    console.warn('Failed to build squircle mask:', error);
    return null;
  }
}
