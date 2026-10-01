export type FooterScene = 'main' | 'detail';
export type FooterActionId = 'favorite' | 'mode' | 'queue' | 'volume' | 'desktopLyrics'
  | 'equalizer' | 'pin' | 'progress' | 'lyricsStyle' | 'visualizer' | 'more';
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
}
export interface FooterSettings {
  version: 1;
  linked: boolean;
  main: FooterLayoutItem[];
  detail: FooterLayoutItem[];
  detailExtras: FooterLayoutItem[];
  detailOrder: FooterActionId[];
  spacing: Record<FooterScene, FooterSpacing>;
  placement: Record<FooterScene, Partial<Record<FooterMovableId, FooterPlacement>>>;
  behavior: Record<FooterScene, FooterBehavior>;
}
