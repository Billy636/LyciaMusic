import type {
  RenameApplyResult,
  RenameOperation,
  ToolboxPreviewConfig,
  ToolboxPreviewItem,
} from './contracts';
import { tauriInvoke } from './invoke';

export const toolboxApi = {
  preview: (rootPath: string, config: ToolboxPreviewConfig): Promise<ToolboxPreviewItem[]> =>
    tauriInvoke('preview_toolbox', { rootPath, config }),
  applyRename: (operations: RenameOperation[]): Promise<RenameApplyResult> =>
    tauriInvoke('apply_rename', { operations }),
  launchProgram: (path: string, args: string[] = []): Promise<void> =>
    tauriInvoke('open_external_program', { path, args }),
};
