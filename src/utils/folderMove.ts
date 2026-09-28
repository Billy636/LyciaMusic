export const folderPathKey = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export const isWithinFolder = (path: string, folder: string) => {
  if (!path || !folder) return false;
  const key = folderPathKey(path);
  const parent = folderPathKey(folder);
  return key === parent || key.startsWith(`${parent}/`);
};

export const folderMoveTargetError = (source: string, target: string) => {
  if (!source || !target) return '请选择目标文件夹';
  if (isWithinFolder(target, source)) return '不能将文件夹移入自身或其子文件夹';
  if (folderPathKey(source.replace(/[/\\][^/\\]+$/, '')) === folderPathKey(target)) return '文件夹已在该目录中';
  return '';
};

export const remapFolderPath = (path: string, source: string, destination: string) => {
  if (!isWithinFolder(path, source)) return path;
  const suffix = path.replace(/\\/g, '/').slice(source.replace(/\\/g, '/').replace(/\/+$/, '').length);
  const separator = destination.includes('\\') ? '\\' : '/';
  return destination.replace(/[/\\]+$/, '') + suffix.replace(/\//g, separator);
};
