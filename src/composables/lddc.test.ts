import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { localStore } from '../services/storage/localStore';
import { fileApi } from '../services/tauri/fileApi';
import { useToast } from './toast';
import {
  ensureLddcPath,
  getSavedLddcPath,
  LDDC_PATH_KEY,
  selectLddcPath,
} from './lddc';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

vi.mock('../services/storage/localStore', () => ({
  localStore: {
    getString: vi.fn(),
    setString: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock('../services/tauri/fileApi', () => ({
  fileApi: { fileExists: vi.fn() },
}));

vi.mock('./toast', () => ({ useToast: vi.fn() }));

const mockedOpen = vi.mocked(open);
const mockedGetString = vi.mocked(localStore.getString);
const mockedSetString = vi.mocked(localStore.setString);
const mockedRemove = vi.mocked(localStore.remove);
const mockedFileExists = vi.mocked(fileApi.fileExists);
const mockedUseToast = vi.mocked(useToast);
const showToast = vi.fn();
const savedPath = 'C:\\Tools\\LDDC\\LDDC.exe';
const selectedPath = 'D:\\歌词工具\\LDDC\\LDDC.exe';

describe('LDDC executable path configuration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedGetString.mockReturnValue(null);
    mockedOpen.mockResolvedValue(null);
    mockedFileExists.mockResolvedValue(true);
    mockedUseToast.mockReturnValue({
      showToast,
      toasts: ref([]),
    });
  });

  it('reads the LDDC-specific saved path without using the MusicTag key', () => {
    mockedGetString.mockReturnValue(savedPath);

    expect(getSavedLddcPath()).toBe(savedPath);
    expect(mockedGetString).toHaveBeenCalledWith('toolbox_lddc_path');
  });

  it('reuses an existing saved path without opening a dialog or rewriting storage', async () => {
    mockedGetString.mockReturnValue(savedPath);

    await expect(ensureLddcPath()).resolves.toBe(savedPath);

    expect(mockedFileExists).toHaveBeenCalledExactlyOnceWith(savedPath);
    expect(mockedOpen).not.toHaveBeenCalled();
    expect(mockedSetString).not.toHaveBeenCalled();
    expect(mockedRemove).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('selects and persists an existing executable when no path has been saved', async () => {
    mockedOpen.mockResolvedValue(selectedPath);

    await expect(ensureLddcPath()).resolves.toBe(selectedPath);

    expect(mockedOpen).toHaveBeenCalledExactlyOnceWith({
      multiple: false,
      directory: false,
      title: '选择 LDDC 可执行文件',
      filters: [{ name: '可执行文件', extensions: ['exe'] }],
    });
    expect(mockedFileExists).toHaveBeenCalledExactlyOnceWith(selectedPath);
    expect(mockedSetString).toHaveBeenCalledExactlyOnceWith(LDDC_PATH_KEY, selectedPath);
  });

  it('clears a missing saved path and prompts for a replacement', async () => {
    mockedGetString.mockReturnValue(savedPath);
    mockedFileExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockedOpen.mockResolvedValue(selectedPath);

    await expect(ensureLddcPath()).resolves.toBe(selectedPath);

    expect(mockedFileExists).toHaveBeenNthCalledWith(1, savedPath);
    expect(mockedFileExists).toHaveBeenNthCalledWith(2, selectedPath);
    expect(mockedRemove).toHaveBeenCalledExactlyOnceWith(LDDC_PATH_KEY);
    expect(showToast).toHaveBeenCalledWith('LDDC 路径无效，请重新选择', 'error');
    expect(mockedSetString).toHaveBeenCalledExactlyOnceWith(LDDC_PATH_KEY, selectedPath);
  });

  it('leaves a missing saved path cleared when replacement is cancelled', async () => {
    mockedGetString.mockReturnValue(savedPath);
    mockedFileExists.mockResolvedValue(false);

    await expect(ensureLddcPath()).resolves.toBeNull();

    expect(mockedRemove).toHaveBeenCalledExactlyOnceWith(LDDC_PATH_KEY);
    expect(mockedSetString).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenLastCalledWith('已取消选择 LDDC', 'info');
  });

  it.each([null, '', [selectedPath]])('does not persist a cancelled or non-single selection: %j', async selected => {
    mockedOpen.mockResolvedValue(selected);

    await expect(ensureLddcPath()).resolves.toBeNull();

    expect(mockedFileExists).not.toHaveBeenCalled();
    expect(mockedSetString).not.toHaveBeenCalled();
    expect(mockedRemove).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledExactlyOnceWith('已取消选择 LDDC', 'info');
  });

  it('rejects a chosen path that does not exist', async () => {
    mockedOpen.mockResolvedValue(selectedPath);
    mockedFileExists.mockResolvedValue(false);

    await expect(ensureLddcPath()).resolves.toBeNull();

    expect(mockedSetString).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledExactlyOnceWith('LDDC 路径无效', 'error');
  });

  it('allows an explicit replacement even when the original executable still exists', async () => {
    mockedGetString.mockReturnValue(savedPath);
    mockedOpen.mockResolvedValue(selectedPath);

    await expect(selectLddcPath()).resolves.toBe(selectedPath);

    expect(mockedFileExists).toHaveBeenCalledExactlyOnceWith(selectedPath);
    expect(mockedSetString).toHaveBeenCalledExactlyOnceWith(LDDC_PATH_KEY, selectedPath);
    expect(mockedRemove).not.toHaveBeenCalled();
  });

  it('preserves the original saved path when explicit replacement is cancelled', async () => {
    mockedGetString.mockReturnValue(savedPath);

    await expect(selectLddcPath()).resolves.toBeNull();

    expect(mockedSetString).not.toHaveBeenCalled();
    expect(mockedRemove).not.toHaveBeenCalled();
    expect(getSavedLddcPath()).toBe(savedPath);
  });

  it('preserves the original saved path when explicit replacement does not exist', async () => {
    mockedGetString.mockReturnValue(savedPath);
    mockedOpen.mockResolvedValue(selectedPath);
    mockedFileExists.mockResolvedValue(false);

    await expect(selectLddcPath()).resolves.toBeNull();

    expect(mockedSetString).not.toHaveBeenCalled();
    expect(mockedRemove).not.toHaveBeenCalled();
    expect(getSavedLddcPath()).toBe(savedPath);
  });

  it('propagates errors checking the saved executable without clearing its path', async () => {
    const error = new Error('检查路径失败');
    mockedGetString.mockReturnValue(savedPath);
    mockedFileExists.mockRejectedValue(error);

    await expect(ensureLddcPath()).rejects.toBe(error);

    expect(mockedRemove).not.toHaveBeenCalled();
    expect(mockedOpen).not.toHaveBeenCalled();
  });

  it('propagates dialog errors without changing the saved path', async () => {
    const error = new Error('无法打开文件选择框');
    mockedOpen.mockRejectedValue(error);

    await expect(selectLddcPath()).rejects.toBe(error);

    expect(mockedSetString).not.toHaveBeenCalled();
    expect(mockedRemove).not.toHaveBeenCalled();
  });

  it('propagates selected-path validation errors without persisting the selection', async () => {
    const error = new Error('无法检查所选路径');
    mockedOpen.mockResolvedValue(selectedPath);
    mockedFileExists.mockRejectedValue(error);

    await expect(selectLddcPath()).rejects.toBe(error);

    expect(mockedSetString).not.toHaveBeenCalled();
    expect(mockedRemove).not.toHaveBeenCalled();
  });

  it('propagates storage failures instead of reporting a saved selection', async () => {
    const error = new Error('无法保存程序路径');
    mockedOpen.mockResolvedValue(selectedPath);
    mockedSetString.mockImplementation(() => { throw error; });

    await expect(selectLddcPath()).rejects.toBe(error);
  });
});
