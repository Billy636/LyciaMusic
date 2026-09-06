export type PlayerDetailEscapeAction = 'exit-immersive' | 'close-player-detail';

export const resolvePlayerDetailEscapeAction = (
  isFullscreen: boolean,
  isFullscreenTransitioning: boolean,
): PlayerDetailEscapeAction => (
  isFullscreen || isFullscreenTransitioning
    ? 'exit-immersive'
    : 'close-player-detail'
);
