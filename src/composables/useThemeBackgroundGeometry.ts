/**
 * 自定义皮肤与全局背景共享的几何尺寸计算模块
 */

export interface BackgroundGeometry {
  width: number;
  height: number;
}

/**
 * 精准计算在 object-fit: cover 填充模式下，图片载入容器后的实际物理布局尺寸
 * 
 * @param containerW 容器像素宽度
 * @param containerH 容器像素高度
 * @param imageW 图片原始物理宽度
 * @param imageH 图片原始物理高度
 * @returns 缩放前 cover 填充的真实图片宽高，若输入不合法则返回 null
 */
export function calculateCoverGeometry(
  containerW: number,
  containerH: number,
  imageW: number,
  imageH: number
): BackgroundGeometry | null {
  if (containerW <= 0 || containerH <= 0 || imageW <= 0 || imageH <= 0) {
    return null;
  }

  const containerRatio = containerW / containerH;
  const imageRatio = imageW / imageH;

  let width = containerW;
  let height = containerH;

  if (imageRatio > containerRatio) {
    // 图片更宽，高度与容器对齐
    height = containerH;
    width = containerH * imageRatio;
  } else {
    // 图片更窄或比例一致，宽度与容器对齐
    width = containerW;
    height = containerW / imageRatio;
  }

  return { width, height };
}
