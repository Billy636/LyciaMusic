import { tauriInvoke } from './invoke';
import { notifyCustomBackgroundCacheCleared } from '../../composables/customBackgroundMedia';

export const appApi = {
  getDataStorageInfo: () => tauriInvoke('get_data_storage_info'),
  setDataStorageDirectory: (path: string) => tauriInvoke('set_data_storage_directory', { path }),
  cancelDataStorageMigration: () => tauriInvoke('cancel_data_storage_migration'),
  restartApp: () => tauriInvoke('restart_app'),
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
