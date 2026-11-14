import { onDeactivated, onScopeDispose, watch, type Ref } from 'vue';
import { storeToRefs } from 'pinia';

import { dragSession } from './dragState';
import { usePlayer } from './player';
import type { Song } from '../types';
import { useToast } from './toast';
import { useCollectionsStore } from '../features/collections/store';
import { useLibraryStore } from '../features/library/store';

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
        currentViewMode, addSongsToPlaylist, currentFolderFilter,
        updateFolderOrder, filterCondition, setPlaylistSortMode, updateLocalOrder,
    } = usePlayer();
    const collections = useCollectionsStore();
    const { playlists } = storeToRefs(collections);
    const library = useLibraryStore();
    const { sourceSongPaths, localCustomOrder, folderCustomOrder, localSortMode, folderSortMode } = storeToRefs(library);
    const { showToast } = useToast();
    const owner = Symbol('song-drag');
    const ROW_HEIGHT = 72;
    const reorderViews = ['folder', 'playlist', 'all', 'artist', 'album', 'genre', 'year'];
    let pending: {
        pointerId: number; song: Song; index: number;
        selection: boolean; selectionAction: 'select' | 'deselect'; selectionIndex: number;
        x: number; y: number; lastX: number; lastY: number; moved: boolean;
        visualPaths?: string[];
        capture?: HTMLElement;
    } | null = null;
    let lastSelectedIndex = -1;
    let scrollFrame = 0;
    let hoverTimer: ReturnType<typeof setTimeout> | undefined;
    let hoveredPath = '';
    let suppressClickUntil = 0;
    let suppressClickX = 0;
    let suppressClickY = 0;
    let previousFrameTime = 0;
    let scrollVelocity = 0;
    let scrollContainer: HTMLElement | null = null;
    let edgeDirection = 0;
    let edgeDuration = 0;
    let scrollRemainder = 0;
    let bodyStyle: { cursor: string; userSelect: string } | null = null;

    const ownsDrag = () => !!pending && activeSongDragOwner === owner && dragSession.type === 'song';
    const canDropToFolder = () => !!options.onDropToFolder && (options.canDropToFolder?.() ?? true);

    const getListPointer = () => {
        const container = songTableRef.value?.containerRef;
        if (!container || !pending) return null;
        const rect = container.getBoundingClientRect();
        const top = Math.max(0, rect.top + container.clientTop);
        const bottom = Math.min(window.innerHeight, rect.top + container.clientTop + container.clientHeight);
        const { lastX: x, lastY: y } = pending;
        // Keep a drag alive over the footer/header immediately beyond the list edge.
        const overshoot = pending.selection ? 0 : 96;
        if (bottom <= top || x < rect.left || x > rect.right
            || y < Math.max(0, top - overshoot) || y > Math.min(window.innerHeight, bottom + overshoot)) return null;
        return { container, rect, top, bottom, y: Math.max(top, Math.min(y, bottom - 1)) };
    };

    const reorderPathOrder = (pathOrder: string[], movingPaths: string[], boundary: number) => {
        const movingSet = new Set(movingPaths);
        const movingInOrder = pathOrder.filter(path => movingSet.has(path));
        const remaining = pathOrder.filter(path => !movingSet.has(path));
        const insertIndex = pathOrder.slice(0, boundary).filter(path => !movingSet.has(path)).length;
        const reordered = [...remaining];
        reordered.splice(insertIndex, 0, ...movingInOrder);
        return { reordered, changed: reordered.some((path, index) => path !== pathOrder[index]) };
    };

    const applyReorder = (movingPaths: string[], insertIndex: number) => {
        const visualPaths = getVisualPaths();
        const { reordered, changed } = reorderPathOrder(visualPaths, movingPaths, insertIndex);
        if (!changed) return;
        const visiblePaths = new Set(visualPaths);
        // Replace only visible slots, preserving songs hidden by search or pagination.
        const mergeOrder = (paths: string[], nextOrder: string[]) => {
            let index = 0;
            return paths.map(path => visiblePaths.has(path) ? nextOrder[index++] ?? path : path);
        };
        if (currentViewMode.value === 'playlist') {
            const playlist = playlists.value.find(item => item.id === filterCondition.value);
            if (!playlist) return;
            if (playlist.importData?.linked) { showToast('文件关联歌单的顺序由源文件决定', 'info'); return; }
            const previousOrder = [...playlist.songPaths];
            const previousSort = collections.getPlaylistSortOverride(playlist.id);
            const nextOrder = mergeOrder(playlist.songPaths, reordered);
            playlist.songPaths = nextOrder;
            setPlaylistSortMode('custom');
            showToast('已调整歌曲顺序', 'success', { label: '撤销', onClick: () => {
                const current = playlists.value.find(item => item.id === playlist.id);
                    if (current && !current.importData?.linked && current.songPaths.join('\0') === nextOrder.join('\0')) {
                    current.songPaths = previousOrder;
                    collections.setPlaylistSortOverride(playlist.id, previousSort ?? null);
                }
                else showToast('歌单已发生变化，无法撤销这次排序', 'info');
            } });
            return;
        }
        // Reorder paths directly: the metadata window may omit unloaded songs.
        const previousSourceOrder = [...sourceSongPaths.value];
        const sourceSet = new Set(previousSourceOrder);
        const nextSourceOrder = mergeOrder(previousSourceOrder, reordered.filter(path => sourceSet.has(path)));
        library.setSourceSongOrder(nextSourceOrder);
        const view = currentViewMode.value, folder = currentFolderFilter.value;
        const previousLocalOrder = localCustomOrder.value;
        const previousFolderOrder = folderCustomOrder.value[folder];
        const previousLocalMode = localSortMode.value, previousFolderMode = folderSortMode.value;
        const baseOrder = view === 'folder' ? previousFolderOrder ?? visualPaths : previousLocalOrder;
        const baseSet = new Set(baseOrder);
        const fallback = view === 'folder' ? visualPaths : previousSourceOrder;
        const nextCustomOrder = mergeOrder([...baseOrder, ...fallback.filter(path => !baseSet.has(path))], reordered);
        if (view === 'folder' && folder) updateFolderOrder(folder, nextCustomOrder);
        else if (view === 'all') updateLocalOrder(nextCustomOrder);
        showToast('已调整歌曲顺序', 'success', { label: '撤销', onClick: () => {
            if (sourceSongPaths.value.join('\0') !== nextSourceOrder.join('\0')
                || (view === 'all' && localCustomOrder.value.join('\0') !== nextCustomOrder.join('\0'))
                || (view === 'folder' && folder && folderCustomOrder.value[folder]?.join('\0') !== nextCustomOrder.join('\0'))) {
                showToast('列表已发生变化，无法撤销这次排序', 'info');
                return;
            }
            library.setSourceSongOrder(previousSourceOrder);
            if (view === 'folder' && folder) {
                const next = { ...folderCustomOrder.value };
                if (previousFolderOrder) next[folder] = previousFolderOrder;
                else delete next[folder];
                folderCustomOrder.value = next;
                folderSortMode.value = previousFolderMode;
            } else if (view === 'all') {
                localCustomOrder.value = previousLocalOrder;
                localSortMode.value = previousLocalMode;
            }
        } });
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
        const expandPlaylists = element?.closest<HTMLElement>('[data-playlist-expand]');
        const nextHoveredPath = dragSession.targetFolder?.path ?? (expandPlaylists ? 'sidebar-playlists' : '');
        if (hoveredPath !== nextHoveredPath) {
            clearHover();
            if (nextHoveredPath && (expandPlaylists || options.expandFolder)) {
                hoveredPath = nextHoveredPath;
                hoverTimer = setTimeout(() => {
                    if (!ownsDrag() || hoveredPath !== nextHoveredPath) return;
                    if (expandPlaylists) {
                        expandPlaylists.click();
                        clearHover();
                        return;
                    }
                    if (!canDropToFolder()) return;
                    void Promise.resolve().then(() => options.expandFolder!(nextHoveredPath)).then(() => {
                        if (ownsDrag() && hoveredPath === nextHoveredPath) updateTarget();
                    }).catch(() => { /* A failed expansion must not complete a move. */ });
                }, 650);
            }
        }
        const playlist = !folder ? element?.closest<HTMLElement>('.playlist-drop-target') : null;
        const playlistId = playlist?.dataset.playlistId;
        dragSession.targetPlaylist = playlistId && playlists.value.some(item => item.id === playlistId)
            ? { id: playlistId, name: playlist?.dataset.playlistName || playlistId } : null;
        if (folder || playlist || !reorderViews.includes(currentViewMode.value)) {
            dragSession.insertIndex = -1;
            return;
        }
        const point = getListPointer();
        if (!point) {
            dragSession.insertIndex = -1;
            return;
        }
        const { container, rect } = point;
        const offsetY = point.y - rect.top + container.scrollTop - container.clientTop;
        const boundary = Math.max(0, Math.min(getVisualPaths().length, Math.floor((offsetY + ROW_HEIGHT / 2) / ROW_HEIGHT)));
        // A small dead zone at slot boundaries prevents jitter without delaying the drag.
        if (dragSession.insertIndex === -1 || Math.abs(offsetY - dragSession.insertIndex * ROW_HEIGHT) > ROW_HEIGHT / 2 + 4) {
            dragSession.insertIndex = boundary;
        }
    };

    const autoScroll = (time: number) => {
        if (!ownsDrag() || !pending) return;
        const { lastX: x, lastY: y } = pending;
        const hit = document.elementFromPoint(x, y);
        const external = !pending.selection
            ? hit?.closest<HTMLElement>('[data-song-drop-scroll], [data-folder-tree-scroll]') : null;
        const point = getListPointer();
        const container = external || point?.container;
        const elapsed = previousFrameTime ? Math.min((time - previousFrameTime) / 1000, 0.032) : 1 / 60;
        previousFrameTime = time;
        if (scrollContainer !== (container ?? null)) {
            scrollVelocity = 0;
            edgeDirection = 0;
            edgeDuration = 0;
            scrollRemainder = 0;
        }
        scrollContainer = container ?? null;
        let depth = 0;
        if (container) {
            const rect = container.getBoundingClientRect();
            const top = external ? Math.max(0, rect.top) : point!.top;
            const bottom = external ? Math.min(window.innerHeight, rect.bottom) : point!.bottom;
            const pointerY = external ? y : point!.y;
            if (bottom > top && x >= rect.left && x <= rect.right && pointerY >= top && pointerY <= bottom) {
                const threshold = Math.min(64, (bottom - top) / 2);
                depth = pointerY < top + threshold ? -(top + threshold - pointerY) / threshold
                    : pointerY > bottom - threshold ? (pointerY - bottom + threshold) / threshold : 0;
            }
        }
        const direction = Math.sign(depth);
        if (direction !== edgeDirection || direction === 0) {
            edgeDuration = 0;
            scrollVelocity = 0;
            scrollRemainder = 0;
        }
        edgeDirection = direction;
        if (container && direction) {
            // Holding still at an edge expresses continued movement: start slowly,
            // then accelerate over 1.5s. Large song lists get a higher ceiling;
            // the sidebar keeps its slower speed for choosing a drop target.
            edgeDuration += elapsed;
            const progress = Math.min(1, edgeDuration / 1.5);
            const ceiling = external ? 240 + 660 * Math.abs(depth) : 600 + 9400 * depth * depth;
            const targetVelocity = direction * (110 + (ceiling - 110) * progress * progress);
            scrollVelocity += (targetVelocity - scrollVelocity) * Math.min(1, elapsed * 8);
            // Preserve fractional pixels so low initial speeds cannot round to zero forever.
            scrollRemainder += scrollVelocity * elapsed;
            const step = Math.trunc(scrollRemainder);
            scrollRemainder -= step;
            if (step) container.scrollTop += step;
        }
        if (pending.selection) updateSelection();
        else updateTarget();
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
        const capture = pending?.capture;
        const pointerId = pending?.pointerId;
        pending = null;
        if (capture) {
            capture.removeEventListener('lostpointercapture', cancel);
            if (pointerId !== undefined && capture.hasPointerCapture(pointerId)) capture.releasePointerCapture(pointerId);
        }
        clearHover();
        cancelAnimationFrame(scrollFrame);
        scrollFrame = 0;
        previousFrameTime = 0;
        scrollVelocity = 0;
        scrollContainer = null;
        edgeDirection = 0;
        edgeDuration = 0;
        scrollRemainder = 0;
        window.removeEventListener('pointermove', pointerMove);
        window.removeEventListener('pointerup', pointerUp, true);
        window.removeEventListener('pointercancel', pointerCancel, true);
        window.removeEventListener('blur', cancel);
        window.removeEventListener('resize', cancel);
        window.removeEventListener('keydown', keydown, true);
        if (!owned) return;
        activeSongDragOwner = null;
        if (bodyStyle) {
            document.body.style.cursor = bodyStyle.cursor;
            document.body.style.userSelect = bodyStyle.userSelect;
            bodyStyle = null;
        }
        if (dragSession.type === 'song') {
            Object.assign(dragSession, {
                active: false, showGhost: false, songs: [], songPaths: undefined, songSourceIndices: undefined, data: null,
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
        if (!pending || !ownsDrag() || pending.selection) return;
        const { song, index } = pending;
        const paths = getVisualPaths();
        pending.visualPaths = [...paths];
        const moving = isBatchMode.value && selectedPaths.value.has(song.path) ? selectedPaths.value : new Set([song.path]);
        dragSession.songPaths = paths.filter(path => moving.has(path));
        const loaded = new Map(displaySongList.value.map(item => [item.path, item]));
        loaded.set(song.path, song);
        dragSession.songs = [song, ...dragSession.songPaths.filter(path => path !== song.path).map(path => loaded.get(path)).filter((item): item is Song => !!item)];
        dragSession.songSourceIndices = paths.flatMap((path, sourceIndex) => moving.has(path) ? [sourceIndex] : []);
        dragSession.active = true;
        dragSession.showGhost = true;
        dragSession.insertIndex = reorderViews.includes(currentViewMode.value) ? index : -1;
        bodyStyle = { cursor: document.body.style.cursor, userSelect: document.body.style.userSelect };
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
        const container = songTableRef.value?.containerRef;
        if (container) {
            try {
                container.setPointerCapture(pending.pointerId);
                pending.capture = container;
                container.addEventListener('lostpointercapture', cancel);
            } catch { /* Window listeners still track pointers without capture. */ }
        }
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
        const wasDragging = !pending.selection && dragSession.active;
        if (wasDragging) updateTarget();
        else if (pending.selection) updateSelection();
        if (wasDragging || pending.selection || pending.moved) {
            event.preventDefault();
            markClickSuppressed();
        }
        const paths = [...(dragSession.songPaths ?? [])];
        const folder = wasDragging && canDropToFolder() && dragSession.targetFolder
            ? { ...dragSession.targetFolder } : null;
        const playlist = wasDragging && dragSession.targetPlaylist ? { ...dragSession.targetPlaylist } : null;
        const insertIndex = wasDragging ? dragSession.insertIndex : -1;
        const sourcePaths = pending.visualPaths;
        // Confirmation owns an immutable snapshot, never the live global drag session.
        reset();
        if (!paths.length) return;
        if (folder) {
            options.onDropToFolder?.(paths, folder);
        } else if (playlist) {
            const target = playlists.value.find(item => item.id === playlist.id);
            if (!target) return;
            if (target.importData?.linked) { showToast('请先复制为普通歌单，再添加歌曲', 'info'); return; }
            const existing = new Set(target.songPaths);
            const added = new Set(paths.filter(path => !existing.has(path)));
            const count = addSongsToPlaylist(playlist.id, paths);
            const duplicates = paths.length - count;
            if (count > 0) {
                dragSession.completedPlaylistId = playlist.id;
                setTimeout(() => {
                    if (dragSession.completedPlaylistId === playlist.id) dragSession.completedPlaylistId = undefined;
                }, 650);
            }
            showToast(count > 0 ? `已添加 ${count} 首到「${playlist.name}」${duplicates ? `，${duplicates} 首已存在` : ''}`
                : `歌曲已在「${playlist.name}」中`, count > 0 ? 'success' : 'info', count > 0 ? {
                label: '撤销', onClick: () => {
                    const current = playlists.value.find(item => item.id === playlist.id);
                    if (current && !current.importData?.linked) current.songPaths = current.songPaths.filter(path => !added.has(path));
                },
            } : undefined);
        } else if (insertIndex > -1) {
            if (sourcePaths?.join('\0') === getVisualPaths().join('\0')) applyReorder(paths, insertIndex);
        }
    };
    const pointerCancel = (event: PointerEvent) => {
        if (pending?.pointerId === event.pointerId) cancel();
    };

    const handleTableDragStart = ({ event, song, index }: { event: PointerEvent; song: Song; index: number }) => {
        if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)
            || activeSongDragOwner || dragSession.active) return;
        const target = event.target instanceof Element ? event.target : null;
        // Every row area selects in batch mode, including blank space around the checkbox.
        const handle = !!target?.closest('[data-song-drag-handle]');
        const selection = isBatchMode.value && !handle;
        const selectionControl = selection && !!target?.closest('[data-selection-control], input[type="checkbox"], [role="checkbox"]');
        if (!handle && !selectionControl && target?.closest('button, a, input, select, textarea, [contenteditable="true"]')) return;
        activeSongDragOwner = owner;
        Object.assign(dragSession, {
            type: 'song', active: false, showGhost: false, songs: [], songPaths: undefined, songSourceIndices: undefined, completedPlaylistId: undefined, data: null,
            targetFolder: null, targetPlaylist: null, insertIndex: -1, sortLineTop: -1,
            mouseX: event.clientX, mouseY: event.clientY,
        });
        pending = {
            pointerId: event.pointerId, song, index,
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
        window.addEventListener('resize', cancel);
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
