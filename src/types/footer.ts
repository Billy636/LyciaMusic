export type FooterScene = 'main' | 'detail';
/** rounded=连续曲率圆角矩形（旧值 square 迁移而来），square=直角方形，circle=圆形。 */
export type FooterCoverShape = 'rounded' | 'square' | 'circle';
export type FooterActionId = 'favorite' | 'mode' | 'queue' | 'volume' | 'desktopLyrics'
  | 'equalizer' | 'wasapiExclusive' | 'volumeBalance' | 'pin' | 'progress' | 'lyricsStyle' | 'visualizer' | 'more';
export type FooterMovableId = FooterActionId | 'previous' | 'play' | 'next';
export type FooterPlacementBasis = 'canvas' | 'legacy-none' | 'legacy-cover' | 'legacy-text';
export interface FooterPlacement {
  x?: number;
  /** Freeze the coordinate basis so info-mode changes never reinterpret x. */
  basis?: FooterPlacementBasis;
  visibility?: 'bar' | 'more' | 'hidden';
}
export type FooterPosition = 'left' | 'before' | 'after' | 'right' | 'more' | 'hidden';
export interface FooterLayoutItem { id: FooterActionId; position: FooterPosition }
export interface FooterSpacing { controls: number; utilities: number }
export interface FooterBehavior {
  info: 'cover' | 'song' | 'time' | 'both' | 'none';
  progress: 'always' | 'hover' | 'hidden';
  lastVisibleProgress: 'always' | 'hover';
  /** Empty/absent keeps the original progress-bar color. */
  progressColor?: string;
  autoHide: boolean;
  visualizer: boolean;
  /** 圆形封面时是否随播放旋转。 */
  coverRotate: boolean;
}
export interface FooterSettings {
  version: number;
  linked: boolean;
  coverShape: Record<FooterScene, FooterCoverShape>;
  main: FooterLayoutItem[];
  detail: FooterLayoutItem[];
  detailExtras: FooterLayoutItem[];
  detailOrder: FooterActionId[];
  spacing: Record<FooterScene, FooterSpacing>;
  placement: Record<FooterScene, Partial<Record<FooterMovableId, FooterPlacement>>>;
  behavior: Record<FooterScene, FooterBehavior>;
}
