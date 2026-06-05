import { onMounted, onUnmounted, ref, type Ref } from 'vue';

import type { Playlist } from '../types';

interface DragSessionState {
  active: boolean;
  type: 'song' | 'playlist' | 'folder' | 'artist' | 'album';
  data: any;
}

interface UseSidebarPlaylistDragDropOptions {
  playlists: Ref<Playlist[]>;
  dragSession: DragSessionState;
  reorderPlaylists: (from: number, to: number) => void;
}

export function useSidebarPlaylistDragDrop({
  playlists,
  dragSession,
  reorderPlaylists,
}: UseSidebarPlaylistDragDropOptions) {
  const dragOverId = ref<string | null>(null);
  const dragPosition = ref<'top' | 'bottom' | null>(null);
  let pointerDownInfo: { x: number; y: number; index: number; playlist: Playlist } | null = null;

  const handlePointerDown = (event: PointerEvent, index: number, playlist: Playlist) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointerDownInfo = { x: event.clientX, y: event.clientY, index, playlist };
  };

  const handleGlobalPointerMove = (event: PointerEvent) => {
    if (!pointerDownInfo || dragSession.active) {
      return;
    }

    if (event.pointerType !== 'mouse') {
      event.preventDefault();
    }

    const dist = Math.sqrt(
      Math.pow(event.clientX - pointerDownInfo.x, 2) +
      Math.pow(event.clientY - pointerDownInfo.y, 2),
    );
    if (dist <= 5) {
      return;
    }

    dragSession.active = true;
    dragSession.type = 'playlist';
    dragSession.data = {
      index: pointerDownInfo.index,
      id: pointerDownInfo.playlist.id,
      name: pointerDownInfo.playlist.name,
    };
  };

  const resetPlaylistDrag = () => {
    pointerDownInfo = null;
    if (dragSession.type === 'playlist') {
      dragSession.active = false;
      dragSession.type = 'song';
      dragSession.data = null;
      dragOverId.value = null;
      dragPosition.value = null;
    }
  };

  const handleGlobalPointerEnd = (cancelled = false) => {
    if (!cancelled && dragSession.active && dragSession.type === 'playlist' && dragOverId.value && pointerDownInfo) {
      const fromIndex = pointerDownInfo.index;
      const targetIndex = playlists.value.findIndex(playlist => playlist.id === dragOverId.value);

      if (targetIndex !== -1) {
        let toIndex = targetIndex;
        if (dragPosition.value === 'bottom') {
          toIndex += 1;
        }
        if (fromIndex < toIndex) {
          toIndex -= 1;
        }
        if (fromIndex !== toIndex) {
          reorderPlaylists(fromIndex, toIndex);
        }
      }
    }

    resetPlaylistDrag();
  };

  const handleGlobalPointerUp = () => handleGlobalPointerEnd(false);
  const handleGlobalPointerCancel = () => handleGlobalPointerEnd(true);

  const handleItemPointerMove = (event: PointerEvent, playlistId: string) => {
    if (!(dragSession.active && dragSession.type === 'playlist')) {
      return;
    }

    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;

    dragOverId.value = playlistId;
    dragPosition.value = event.clientY < midpoint ? 'top' : 'bottom';
  };

  onMounted(() => {
    window.addEventListener('pointermove', handleGlobalPointerMove);
    window.addEventListener('pointerup', handleGlobalPointerUp);
    window.addEventListener('pointercancel', handleGlobalPointerCancel);
  });

  onUnmounted(() => {
    window.removeEventListener('pointermove', handleGlobalPointerMove);
    window.removeEventListener('pointerup', handleGlobalPointerUp);
    window.removeEventListener('pointercancel', handleGlobalPointerCancel);
  });

  return {
    dragOverId,
    dragPosition,
    handlePointerDown,
    handleItemPointerMove,
  };
}
