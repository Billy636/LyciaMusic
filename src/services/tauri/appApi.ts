import { tauriInvoke } from './invoke';
import { notifyCustomBackgroundCacheCleared } from '../../composables/customBackgroundMedia';

export const appApi = {
  clearAllAppData: () => tauriInvoke('clear_all_app_data'),
  getLaunchOnStartup: () => tauriInvoke('get_launch_on_startup'),
  setLaunchOnStartup: (enabled: boolean) => tauriInvoke('set_launch_on_startup', { enabled }),
  clearCoverCache: async () => {
    await tauriInvoke('clear_cover_cache');
    notifyCustomBackgroundCacheCleared();
  },
  openExternalProgram: (path: string, args: string[] = []) =>
    tauriInvoke('open_external_program', { path, args }),
  consumePendingOpenPaths: () => tauriInvoke('consume_pending_open_paths'),
};
