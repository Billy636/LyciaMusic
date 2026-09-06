const clampVolumePercent = (volume: number) => Math.max(0, Math.min(100, Math.round(volume)));

export const getNextWheelVolume = (currentVolume: number, deltaY: number) => {
  if (deltaY === 0) {
    return clampVolumePercent(currentVolume);
  }

  return clampVolumePercent(currentVolume + (deltaY < 0 ? 1 : -1));
};
