import type { PlaylistSortMode } from '../../services/storage/playerStorage';

export const playlistSortOptions = [
  { value: 'title', label: '歌曲名' },
  { value: 'name', label: '文件名' },
  { value: 'artist', label: '歌手' },
  { value: 'added_at', label: '添加时间 · 最新在前' },
  { value: 'added_at_asc', label: '添加时间 · 最早在前' },
  { value: 'custom', label: '自定义' },
] as const;

export function isPlaylistSortMode(value: unknown): value is PlaylistSortMode {
  return playlistSortOptions.some(option => option.value === value);
}

export function playlistSortLabel(mode: PlaylistSortMode): string {
  return playlistSortOptions.find(option => option.value === mode)?.label ?? '自定义';
}
