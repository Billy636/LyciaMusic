import { open } from '@tauri-apps/plugin-dialog';
import { localStore } from '../services/storage/localStore';
import { fileApi } from '../services/tauri/fileApi';
import { useToast } from './toast';

export const MUSICTAG_PATH_KEY = 'toolbox_musictag_path';

export function getSavedMusicTagPath(): string | null {
  return localStore.getString(MUSICTAG_PATH_KEY);
}

export function setSavedMusicTagPath(path: string) {
  localStore.setString(MUSICTAG_PATH_KEY, path);
}

/**
 * 返回可用的 MusicTag 可执行文件路径：校验已保存路径，失效或缺失时弹原生选择框。
 * 用户取消或校验失败返回 null，由调用方决定后续提示。
 */
export async function ensureMusicTagPath(): Promise<string | null> {
  const toast = useToast();
  let path = getSavedMusicTagPath();

  if (path) {
    const exists = await fileApi.fileExists(path);
    if (!exists) {
      localStore.remove(MUSICTAG_PATH_KEY);
      toast.showToast('MusicTag 路径无效，请重新选择', 'error');
      path = null;
    }
  }

  if (!path) {
    const selected = await open({
      multiple: false,
      directory: false,
      title: '选择 MusicTag 可执行文件',
      filters: [
        {
          name: '可执行文件',
          extensions: ['exe'],
        },
      ],
    });

    if (!selected || typeof selected !== 'string') {
      toast.showToast('已取消选择 MusicTag', 'info');
      return null;
    }

    const exists = await fileApi.fileExists(selected);
    if (!exists) {
      toast.showToast('MusicTag 路径无效', 'error');
      return null;
    }

    setSavedMusicTagPath(selected);
    path = selected;
  }

  return path;
}
