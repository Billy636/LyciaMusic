import { reactive } from 'vue';

import type { Song } from '../types';

export type DragSessionType = 'song' | 'playlist' | 'folder';

export interface DragSessionState {
  active: boolean;
  showGhost: boolean;
  type: DragSessionType;
  songs: Song[];
  // Full drag payload, including selected rows outside the loaded metadata window.
  songPaths?: string[];
  songSourceIndices?: number[];
  completedPlaylistId?: string;
  data: any;
  mouseX: number;
  mouseY: number;
  targetFolder: { name: string; path: string } | null;
  targetPlaylist: { id: string; name: string } | null;
  insertIndex: number;
  sortLineTop: number;
}

export const dragSession = reactive<DragSessionState>({
  active: false,
  showGhost: false,
  type: 'song',
  songs: [],
  data: null,
  mouseX: 0,
  mouseY: 0,
  targetFolder: null,
  targetPlaylist: null,
  insertIndex: -1,
  sortLineTop: -1,
});
