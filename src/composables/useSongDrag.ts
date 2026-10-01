import { onDeactivated, onScopeDispose, watch, type Ref } from 'vue';
import { storeToRefs } from 'pinia';

import { dragSession } from './dragState';
import { usePlayer } from './player';
import type { Song } from '../types';
import { useToast } from './toast';
import { useCollectionsStore } from '../features/collections/store';

type FolderDropTarget = { path: string; name: string };
interface SongDragOptions {
    canDropToFolder?: () => boolean;
    onDropToFolder?: (paths: string[], target: FolderDropTarget) => void;
    expandFolder?: (path: string) => Promise<unknown>;
}

// Home can remain alive while Recent/Favorites mount another song list.
let activeSongDragOwner: symbol | null = null;

export function useSongDrag(
    displaySongList: Ref<Song[]>,
    isBatchMode: Ref<boolean>,
    selectedPaths: Ref<Set<string>>,
    songTableRef: Ref<{ containerRef: HTMLElement | null } | null>,
    displaySongPaths?: Ref<string[]>,
    options: SongDragOptions = {},
) {
    const getVisualPaths = () => displaySongPaths?.value ?? displaySongList.value.map(song => song.path);
    const {
        songList, currentViewMode, addSongsToPlaylist, currentFolderFilter,
        updateFolderOrder, filterCondition, setPlaylistSortMode, updateLocalOrder,
    } = usePlayer();
    const { playlists } = storeToRefs(useCollectionsStore());
    const owner = Symbol('song-drag');
    const ROW_HEIGHT = 72;
    const reorderViews = ['folder', 'playlist', 'all', 'artist', 'album', 'genre', 'year'];
    let pending: {
        pointerId: number; song: Song; index: number; batch: boolean; shift: boolean;
        selection: boolean; selectionAction: 'select' | 'deselect'; selectionIndex: number;
        x: number; y: number; lastX: number; lastY: number; moved: boolean;
    } | null = null;
    let lastSelectedIndex = -1;
    let scrollFrame = 0;
    let hoverTimer: ReturnType<typeof setTimeout> | undefined;
    let hoveredPath = '';
    let suppressClickUntil = 0;
    let suppressClickX = 0;
    let suppressClickY = 0;

    const ownsDrag = () => !!pending && activeSongDragOwner === owner && dragSession.type === 'song';
    const canDropToFolder = () => !!options.onDropToFolder && (options.canDropToFolder?.() ?? true);

    const reorderPathOrder = (pathOrder: string[], movingPaths: string[], targetPath?: string) => {
        const movingSet = new Set(movingPaths);
        const movingInOrder = pathOrder.filter(path => movingSet.has(path));
        if (movingInOrder.length === 0 || (targetPath && movingSet.has(targetPath))) {
            return { reordered: pathOrder, changed: false };
        }
        const remaining = pathOrder.filter(path => !movingSet.has(path));
        let insertIndex = remaining.length;
        if (targetPath) {
            const targetIndex = remaining.indexOf(targetPath);
            if (targetIndex !== -1) {
                const firstMovingIndex = pathOrder.findIndex(path => movingSet.has(path));
                const movingFromAbove = firstMovingIndex < pathOrder.indexOf(targetPath);
                insertIndex = movingFromAbove ? targetIndex + 1 : targetIndex;
            }
        }
        const reordered = [...remaining];
        reordered.splice(insertIndex, 0, ...movingInOrder);
        return { reordered, changed: reordered.some((path, index) => path !== pathOrder[index]) };
    };

    const applyReorder = (movingPaths: string[], insertIndex: number) => {
        const visualPaths = getVisualPaths();
        const targetPath = visualPaths[insertIndex];
        if (!targetPath) return;
        if (currentViewMode.value === 'playlist') {
            const playlist = playlists.value.find(item => item.id === filterCondition.value);
            if (!playlist) return;
            const { reordered, changed } = reorderPathOrder(visualPaths, movingPaths, targetPath);
            if (changed) {
                // Preserve songs hidden by search, pagination or unavailable files.
                const visiblePaths = new Set(visualPaths);
                let visibleIndex = 0;
                playlist.songPaths = playlist.songPaths.map(path => visiblePaths.has(path)
                    ? reordered[visibleIndex++] ?? path : path);
                setPlaylistSortMode('custom');
            }
            return;
        }
        const fullList = [...songList.value];
        const { reordered, changed } = reorderPathOrder(fullList.map(song => song.path), movingPaths, targetPath);
        if (changed) {
            const songMap = new Map(fullList.map(song => [song.path, song]));
            songList.value = reordered.map(path => songMap.get(path)).filter((song): song is Song => !!song);
        }
        const viewOrder = reorderPathOrder(visualPaths, movingPaths, targetPath);
        if (viewOrder.changed && currentViewMode.value === 'folder' && currentFolderFilter.value) {
            updateFolderOrder(currentFolderFilter.value, viewOrder.reordered);
        } else if (viewOrder.changed && currentViewMode.value === 'all') {
            updateLocalOrder(viewOrder.reordered);
        }
    };

    const clearHover = () => {
        clearTimeout(hoverTimer);
        hoverTimer = undefined;
        hoveredPath = '';
    };

    const toggleSelection = (path: string, index: number, shift: boolean) => {
        if (shift && lastSelectedIndex !== -1) {
            const visualPaths = getVisualPaths();
            const start = Math.min(lastSelectedIndex, index);
            const end = Math.min(Math.max(lastSelectedIndex, index), visualPaths.length - 1);
            for (let i = start; i <= end; i++) selectedPaths.value.add(visualPaths[i]);
        } else {
            if (selectedPaths.value.has(path)) selectedPaths.value.delete(path);
            else selectedPaths.value.add(path);
            lastSelectedIndex = index;
        }
    };

    const updateSelection = () => {
        if (!ownsDrag() || !pending?.selection || !pending.moved) return;
        const container = songTableRef.value?.containerRef;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const { lastX: x, lastY: y } = pending;
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return;
        const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-index]');
        let index = element && container.contains(element) ? Number(element.dataset.index) : -1;
        if (index === -1) {
            const rows = container.querySelectorAll<HTMLElement>('[data-index]');
            if (!rows.length) return;
            const row = y < rows[0].getBoundingClientRect().top ? rows[0] : rows[rows.length - 1];
            index = Number(row.dataset.index);
        }
        const visualPaths = getVisualPaths();
        if (!Number.isInteger(index) || !visualPaths.length) return;
        index = Math.max(0, Math.min(index, visualPaths.length - 1));
        const start = Math.min(pending.selectionIndex, index);
        const end = Math.max(pending.selectionIndex, index);
        for (let i = start; i <= end; i++) {
            const path = visualPaths[i];
            if (!path) continue;
            if (pending.selectionAction === 'select') selectedPaths.value.add(path);
            else selectedPaths.value.delete(path);
        }
        pending.selectionIndex = index;
    };

    const updateTarget = () => {
        if (!ownsDrag() || !dragSession.active || !pending) return;
        const { lastX: x, lastY: y } = pending;
        const element = document.elementFromPoint(x, y);
        const folder = element?.closest<HTMLElement>('.folder-drop-target');
        const folderPath = folder?.dataset.folderPath;
        dragSession.targetFolder = folderPath && canDropToFolder()
            ? { path: folderPath, name: folder?.dataset.folderName || folderPath } : null;
        const nextHoveredPath = dragSession.targetFolder?.path ?? '';
        if (hoveredPath !== nextHoveredPath) {
            clearHover();
            if (nextHoveredPath && options.expandFolder) {
                hoveredPath = nextHoveredPath;
                hoverTimer = setTimeout(() => {
                    if (!ownsDrag() || hoveredPath !== nextHoveredPath || !canDropToFolder()) return;
                    void Promise.resolve().then(() => options.expandFolder!(nextHoveredPath)).then(() => {
                        if (ownsDrag() && hoveredPath === nextHoveredPath) updateTarget();
                    }).catch(() => { /* A failed expansion must not complete a move. */ });
                }, 650);
            }
        }
        const playlist = !folder ? element?.closest<HTMLElement>('.playlist-drop-target') : null;
        const playlistId = playlist?.dataset.playlistId;
        dragSession.targetPlaylist = playlistId
            ? { id: playlistId, name: playlist?.dataset.playlistName || playlistId } : null;
        if (folder || playlist || pending.batch || !reorderViews.includes(currentViewMode.value)) {
            dragSession.insertIndex = -1;
            return;
        }
        const container = songTableRef.value?.containerRef;
        const rect = container?.getBoundingClientRect();
        if (!container || !rect || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
            dragSession.insertIndex = -1;
            return;
        }
        const offsetY = y - rect.top + container.scrollTop;
        const currentIndex = Math.max(0, dragSession.insertIndex);
        if (offsetY < (currentIndex - 0.5) * ROW_HEIGHT || offsetY > (currentIndex + 1.5) * ROW_HEIGHT) {
            dragSession.insertIndex = Math.max(0, Math.min(getVisualPaths().length - 1, Math.floor(offsetY / ROW_HEIGHT)));
        } else if (dragSession.insertIndex === -1) {
            dragSession.insertIndex = currentIndex;
        }
    };

    const autoScroll = () => {
        if (!ownsDrag() || !pending) return;
        const { lastX: x, lastY: y } = pending;
        const tree = !pending.selection && canDropToFolder()
            ? document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-folder-tree-scroll]') : null;
        const container = tree || songTableRef.value?.containerRef;
        if (container) {
            const rect = container.getBoundingClientRect();
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                const threshold = tree ? 36 : 60;
                const speed = tree ? 8 : 15;
                const delta = y < rect.top + threshold ? -speed : y > rect.bottom - threshold ? speed : 0;
                if (delta) {
                    container.scrollTop += delta;
                    if (pending.selection) updateSelection();
                    else updateTarget();
                }
            }
        }
        scrollFrame = requestAnimationFrame(autoScroll);
    };

    const markClickSuppressed = () => {
        if (!pending) return;
        suppressClickUntil = Date.now() + 400;
        suppressClickX = pending.lastX;
        suppressClickY = pending.lastY;
    };
    const suppressClick = (event: MouseEvent) => {
        if (event.detail > 0 && Date.now() < suppressClickUntil
            && Math.hypot(event.clientX - suppressClickX, event.clientY - suppressClickY) < 8) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    };

    const reset = () => {
        const owned = activeSongDragOwner === owner;
        pending = null;
        clearHover();
        cancelAnimationFrame(scrollFrame);
        scrollFrame = 0;
        window.removeEventListener('pointermove', pointerMove);
        window.removeEventListener('pointerup', pointerUp, true);
        window.removeEventListener('pointercancel', pointerCancel, true);
        window.removeEventListener('blur', cancel);
        window.removeEventListener('keydown', keydown, true);
        if (!owned) return;
        activeSongDragOwner = null;
        if (dragSession.type === 'song') {
            Object.assign(dragSession, {
                active: false, showGhost: false, songs: [], songPaths: undefined, data: null,
                targetFolder: null, targetPlaylist: null, insertIndex: -1, sortLineTop: -1,
            });
        }
    };
    const cancel = () => {
        if (ownsDrag() && (pending?.moved || pending?.selection)) markClickSuppressed();
        reset();
    };
    const keydown = (event: KeyboardEvent) => {
        if (ownsDrag() && event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            cancel();
        }
    };

    const activateDrag = () => {
        if (!pending || !ownsDrag()) return;
        const { song, batch, shift, index } = pending;
        if (batch) {
            if (shift) toggleSelection(song.path, index, true);
            selectedPaths.value.add(song.path);
        }
        // Paths are authoritative; metadata is only loaded for the visible virtual window.
        const paths = batch
            ? [...new Set([...getVisualPaths().filter(path => selectedPaths.value.has(path)), ...selectedPaths.value])]
            : [song.path];
        const movingSet = new Set(paths);
        dragSession.songs = [song, ...displaySongList.value.filter(item => item.path !== song.path && movingSet.has(item.path))];
        dragSession.songPaths = paths;
        dragSession.active = true;
        dragSession.showGhost = true;
        dragSession.insertIndex = !batch && reorderViews.includes(currentViewMode.value) ? index : -1;
    };

    const pointerMove = (event: PointerEvent) => {
        if (!pending || pending.pointerId !== event.pointerId) return;
        if (!ownsDrag()) { reset(); return; }
        pending.lastX = event.clientX;
        pending.lastY = event.clientY;
        if (!pending.moved) {
            if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < 6) return;
            pending.moved = true;
            if (!pending.selection) activateDrag();
            scrollFrame = requestAnimationFrame(autoScroll);
        }
        event.preventDefault();
        dragSession.mouseX = event.clientX;
        dragSession.mouseY = event.clientY;
        if (pending.selection) updateSelection();
        else updateTarget();
    };

    const pointerUp = (event: PointerEvent) => {
        if (!pending || pending.pointerId !== event.pointerId) return;
        if (!ownsDrag()) { reset(); return; }
        pending.lastX = event.clientX;
        pending.lastY = event.clientY;
        const wasDragging = dragSession.active;
        const batch = pending.batch;
        if (wasDragging) updateTarget();
        else if (batch && !pending.selection && !pending.moved) {
            toggleSelection(pending.song.path, pending.index, pending.shift);
        }
        if (wasDragging || batch || pending.moved) {
            event.preventDefault();
            markClickSuppressed();
        }
        const paths = [...(dragSession.songPaths ?? [])];
        const folder = wasDragging && canDropToFolder() && dragSession.targetFolder
            ? { ...dragSession.targetFolder } : null;
        const playlist = wasDragging && dragSession.targetPlaylist ? { ...dragSession.targetPlaylist } : null;
        const insertIndex = wasDragging && !batch ? dragSession.insertIndex : -1;
        // Confirmation owns an immutable snapshot, never the live global drag session.
        reset();
        if (!paths.length) return;
        if (folder) {
            options.onDropToFolder?.(paths, folder);
        } else if (playlist) {
            const count = addSongsToPlaylist(playlist.id, paths);
            useToast().showToast(count > 0 ? `已添加 ${count} 首歌曲到 ${playlist.name}` : '歌曲已存在于歌单', count > 0 ? 'success' : 'info');
        } else if (insertIndex > -1) {
            applyReorder(paths, insertIndex);
        }
    };
    const pointerCancel = (event: PointerEvent) => {
        if (pending?.pointerId === event.pointerId) cancel();
    };

    const handleTableDragStart = ({ event, song, index }: { event: PointerEvent; song: Song; index: number }) => {
        if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)
            || activeSongDragOwner || dragSession.active) return;
        const target = event.target instanceof Element ? event.target : null;
        const selection = isBatchMode.value && !!target?.closest('[data-selection-control], input[type="checkbox"], [role="checkbox"]');
        if (!selection && target?.closest('button, a, input, select, textarea, [contenteditable="true"]')) return;
        activeSongDragOwner = owner;
        Object.assign(dragSession, {
            type: 'song', active: false, showGhost: false, songs: [], songPaths: undefined, data: null,
            targetFolder: null, targetPlaylist: null, insertIndex: -1, sortLineTop: -1,
            mouseX: event.clientX, mouseY: event.clientY,
        });
        pending = {
            pointerId: event.pointerId, song, index, batch: isBatchMode.value, shift: event.shiftKey,
            selection, selectionAction: 'select', selectionIndex: index, moved: false,
            x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY,
        };
        if (selection) {
            event.preventDefault();
            toggleSelection(song.path, index, event.shiftKey);
            pending.selectionAction = selectedPaths.value.has(song.path) ? 'select' : 'deselect';
        }
        window.addEventListener('pointermove', pointerMove, { passive: false });
        window.addEventListener('pointerup', pointerUp, true);
        window.addEventListener('pointercancel', pointerCancel, true);
        window.addEventListener('blur', cancel);
        window.addEventListener('keydown', keydown, true);
    };

    window.addEventListener('click', suppressClick, true);
    window.addEventListener('dblclick', suppressClick, true);
    watch([isBatchMode, currentViewMode, currentFolderFilter, filterCondition], () => {
        cancel();
        lastSelectedIndex = -1;
    }, { flush: 'sync' });
    onDeactivated(cancel);
    onScopeDispose(() => {
        cancel();
        window.removeEventListener('click', suppressClick, true);
        window.removeEventListener('dblclick', suppressClick, true);
    });

    return { handleTableDragStart };
}
