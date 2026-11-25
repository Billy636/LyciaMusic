interface PlayerUiShellWindowApi {
  toggleAlwaysOnTop: (enable: boolean) => Promise<unknown>;
  togglePlayerDetail: () => void;
}

interface UseWindowActionsOptions {
  playerUiShell: PlayerUiShellWindowApi;
}

export function useWindowActions({ playerUiShell }: UseWindowActionsOptions) {
  const toggleAlwaysOnTop = (enable: boolean) => playerUiShell.toggleAlwaysOnTop(enable);
  const togglePlayerDetail = () => playerUiShell.togglePlayerDetail();

  return {
    toggleAlwaysOnTop,
    togglePlayerDetail,
  };
}
