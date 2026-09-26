import { open } from '@tauri-apps/plugin-dialog';
import { localStore } from '../services/storage/localStore';
import { fileApi } from '../services/tauri/fileApi';
import { useToast } from './toast';

export const LDDC_PATH_KEY = 'toolbox_lddc_path';

export function getSavedLddcPath(): string | null {
  return localStore.getString(LDDC_PATH_KEY);
}

/** 选择并记住 LDDC 路径；取消或校验失败时保留原有配置。 */
export async function selectLddcPath(): Promise<string | null> {
  const toast = useToast();
  const selected = await open({
    multiple: false,
    directory: false,
    title: '选择 LDDC 可执行文件',
    filters: [
      {
        name: '可执行文件',
        extensions: ['exe'],
      },
    ],
  });

  if (!selected || typeof selected !== 'string') {
    toast.showToast('已取消选择 LDDC', 'info');
    return null;
  }

  if (!(await fileApi.fileExists(selected))) {
    toast.showToast('LDDC 路径无效', 'error');
    return null;
  }

  localStore.setString(LDDC_PATH_KEY, selected);
  return selected;
}

/** 返回可用的 LDDC 路径，已保存路径失效或缺失时重新选择。 */
export async function ensureLddcPath(): Promise<string | null> {
  const path = getSavedLddcPath();
  if (path) {
    if (await fileApi.fileExists(path)) return path;

    localStore.remove(LDDC_PATH_KEY);
    useToast().showToast('LDDC 路径无效，请重新选择', 'error');
  }

  return selectLddcPath();
}
