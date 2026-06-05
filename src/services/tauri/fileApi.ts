import type { Song } from '../../types';
import { tauriInvoke } from './invoke';

export const fileApi = {
  deleteFolder: (path: string): Promise<void> => tauriInvoke('delete_folder', { path }),
  moveFileToFolder: (sourcePath: string, targetFolder: string) =>
    tauriInvoke('move_file_to_folder', { sourcePath, targetFolder }),
  batchMoveMusicFiles: (paths: string[], targetFolder: string) =>
    tauriInvoke('batch_move_music_files', { paths, targetFolder }),
  getFolderFirstSong: (folderPath: string) =>
    tauriInvoke('get_folder_first_song', { folderPath }),
  scanMusicFolder: (folderPath: string, minimumDurationSeconds = 0) =>
    tauriInvoke('scan_music_folder', { folderPath, minimumDurationSeconds }),
  moveMusicFile: (oldPath: string, newPath: string) =>
    tauriInvoke('move_music_file', { oldPath, newPath }),
  showInFolder: (path: string): Promise<void> => tauriInvoke('show_in_folder', { path }),
  deleteMusicFile: (path: string): Promise<void> => tauriInvoke('delete_music_file', { path }),
  isDirectory: (path: string): Promise<boolean> => tauriInvoke('is_directory', { path }),
  parseAudioFiles: (paths: string[], minimumDurationSeconds = 0): Promise<Song[]> =>
    tauriInvoke('parse_audio_files', { paths, minimumDurationSeconds }),
};
