import type { PlayerBackgroundMode } from '../../types';
import type { PlayerBackgroundColors } from './playerBackgroundPalette';

export interface PlayerColorRenderer {
  resize(width: number, height: number): void;
  render(colors: PlayerBackgroundColors, mode: Exclude<PlayerBackgroundMode, 'original'>, timeSeconds: number): void;
  dispose(): void;
}

const MAX_RENDER_SIDE = 960;

/** CSS ease-in-out, with alternating iterations sharing one continuous clock. */
function driftProgress(timeSeconds: number, duration: number): number {
  const iteration = (Math.max(0, timeSeconds) / duration) % 2;
  const progress = iteration <= 1 ? iteration : 2 - iteration;
  if (progress === 0 || progress === 1) return progress;
  let low = 0;
  let high = 1;
  for (let index = 0; index < 14; index += 1) {
    const t = (low + high) / 2;
    const inverse = 1 - t;
    const x = 3 * inverse * inverse * t * 0.42 + 3 * inverse * t * t * 0.58 + t * t * t;
    if (x < progress) low = t;
    else high = t;
  }
  const t = (low + high) / 2;
  return t * t * (3 - 2 * t);
}

/** One opaque surface keeps 4K palette changes out of large composited layers. */
export function createPlayerColorRenderer(canvas: HTMLCanvasElement): PlayerColorRenderer | null {
  let context: CanvasRenderingContext2D | null;
  try {
    context = canvas.getContext('2d', { alpha: false });
  } catch {
    return null;
  }
  if (!context) return null;
  const ctx = context;
  let disposed = false;

  function transparentColor(color: string): string {
    // Canvas normalizes CSS hsl/rgb to hex or rgb; retain the same RGB at alpha 0.
    ctx.fillStyle = color;
    const normalized = ctx.fillStyle;
    const hex = normalized.match(/^#([\da-f]{6})$/i);
    if (hex) {
      const value = Number.parseInt(hex[1], 16);
      return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, 0)`;
    }
    const functional = normalized.match(/^(rgb|hsl)a?\((.*)\)$/i);
    if (functional) {
      const channels = functional[2].split(/[\s,/]+/).filter(Boolean).slice(0, 3);
      return `${functional[1]}a(${channels.join(', ')}, 0)`;
    }
    return 'rgba(0, 0, 0, 0)';
  }

  function linearGradient(width: number, height: number, angle: number, firstStop = 0, lastStop = 1): CanvasGradient {
    const radians = angle * Math.PI / 180;
    const dx = Math.sin(radians);
    const dy = -Math.cos(radians);
    const length = Math.abs(width * dx) + Math.abs(height * dy);
    const start = firstStop - 0.5;
    const end = lastStop - 0.5;
    return ctx.createLinearGradient(
      width / 2 + dx * length * start, height / 2 + dy * length * start,
      width / 2 + dx * length * end, height / 2 + dy * length * end,
    );
  }

  function radialField(
    color: string, width: number, height: number,
    radiusX: number, radiusY: number, centerX: number, centerY: number, fadeStop: number,
    translateX = 0, translateY = 0, scale = 1,
  ): void {
    const fieldWidth = width * 1.2;
    const fieldHeight = height * 1.2;
    const cx = fieldWidth * centerX;
    const cy = fieldHeight * centerY;
    const rx = fieldWidth * radiusX;
    const ry = fieldHeight * radiusY;
    const transparent = transparentColor(color);
    ctx.save();
    // CSS transforms translate the expanded field, then scale about its center.
    ctx.translate(width / 2 + fieldWidth * translateX, height / 2 + fieldHeight * translateY);
    ctx.scale(scale, scale);
    ctx.translate(-fieldWidth / 2 + cx, -fieldHeight / 2 + cy);
    ctx.scale(rx, ry);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    gradient.addColorStop(0, color);
    gradient.addColorStop(fadeStop, transparent);
    ctx.fillStyle = gradient;
    ctx.fillRect(-cx / rx, -cy / ry, fieldWidth / rx, fieldHeight / ry);
    ctx.restore();
  }

  return {
    resize(width, height) {
      if (disposed || !Number.isFinite(width) || !Number.isFinite(height)) return;
      const ratio = Math.min(1, MAX_RENDER_SIDE / Math.max(1, width, height));
      const renderWidth = Math.max(1, Math.round(width * ratio));
      const renderHeight = Math.max(1, Math.round(height * ratio));
      if (canvas.width !== renderWidth) canvas.width = renderWidth;
      if (canvas.height !== renderHeight) canvas.height = renderHeight;
    },
    render(colors, mode, timeSeconds) {
      if (disposed) return;
      const width = canvas.width;
      const height = canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      // Fill every pixel before drawing fields, including the first resized frame.
      ctx.fillStyle = colors.base;
      ctx.fillRect(0, 0, width, height);
      const foundation = linearGradient(width, height, 116);
      foundation.addColorStop(0, colors.base);
      foundation.addColorStop(0.3, colors.base);
      foundation.addColorStop(1, colors.end);
      ctx.fillStyle = foundation;
      ctx.fillRect(0, 0, width, height);

      if (mode === 'gradient') {
        const fieldWidth = width * 1.2;
        const fieldHeight = height * 1.2;
        const transparent = transparentColor(colors.left);
        ctx.save();
        ctx.translate(-width * 0.1, -height * 0.1);
        const gradient = linearGradient(fieldWidth, fieldHeight, 128, -0.45, 0.55);
        gradient.addColorStop(0, colors.left);
        gradient.addColorStop(1, transparent);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, fieldWidth, fieldHeight);
        ctx.restore();
        return;
      }

      const cover = driftProgress(timeSeconds, 36);
      const halo = driftProgress(timeSeconds, 42);
      const accent = driftProgress(timeSeconds, 46);
      radialField(colors.left, width, height, 0.53, 0.75, 0.24, 0.44, 0.76,
        -0.02 + 0.04 * cover, -0.02 + 0.05 * cover, 1 + 0.06 * cover);
      radialField(colors.glow, width, height, 0.35, 0.45, 0.09, 0.11, 0.8,
        -0.02 + 0.06 * halo, 0.06 * halo);
      radialField(colors.accent, width, height, 0.6, 0.6, 0.44, 1.09, 0.78,
        -0.04 * accent, -0.03 + 0.05 * accent);
      radialField(colors.quiet, width, height, 0.42, 0.58, 0.94, 0.33, 0.85);
    },
    dispose() {
      disposed = true;
      canvas.width = 1;
      canvas.height = 1;
    },
  };
}
