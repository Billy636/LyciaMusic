import type {
  DuplicateDeleteGroup,
  DuplicateDeleteResult,
  DuplicateScanResult,
} from '../../features/duplicates/types';
import { tauriInvoke } from './invoke';

export const duplicateApi = {
  scan: (rootPaths: string[], recursive: boolean): Promise<DuplicateScanResult> =>
    tauriInvoke('scan_duplicate_songs', { rootPaths, recursive }),
  deleteDuplicates: (groups: DuplicateDeleteGroup[]): Promise<DuplicateDeleteResult> =>
    tauriInvoke('delete_duplicate_songs', { groups }),
};
