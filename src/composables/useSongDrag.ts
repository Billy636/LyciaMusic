import { ref, onMounted, onUnmounted, Ref } from 'vue';
import { storeToRefs } from 'pinia';

import { dragSession } from './dragState';
import { usePlayer } from './player';
import type { Song } from '../types';
import { useToast } from './toast';
import { useCollectionsStore } from '../features/collections/store';

export function useSongDrag(
    displaySongList: Ref<Song[]>,
    isBatchMode: Ref<boolean>,
    selectedPaths: Ref<Set<string>>,
    songTableRef: Ref<{ containerRef: HTMLElement | null } | null>
) {
    const {
        songList, currentViewMode, addSongsToPlaylist,
        currentFolderFilter, updateFolderOrder // 🟢 导入文件夹排序函数
    } = usePlayer();
    const { playlists } = storeToRefs(useCollectionsStore());
    const { filterCondition, setPlaylistSortMode } = usePlayer();
    const { updateLocalOrder } = usePlayer();

    const reorderPathOrder = (
        pathOrder: string[],
        movingPaths: string[],
        targetPath?: string
    ) => {
        const movingSet = new Set(movingPaths);
        const movingInOrder = pathOrder.filter(p => movingSet.has(p));
        if (movingInOrder.length === 0) {
            return { reordered: pathOrder, changed: false };
        }

        if (targetPath && movingSet.has(targetPath)) {
            return { reordered: pathOrder, changed: false };
        }

        const remaining = pathOrder.filter(p => !movingSet.has(p));
        let insertIndex = remaining.length;

        if (targetPath) {
            const targetIndexInRemaining = remaining.indexOf(targetPath);
            if (targetIndexInRemaining !== -1) {
                const firstMovingIndex = pathOrder.findIndex(p => movingSet.has(p));
                const targetIndexInOriginal = pathOrder.indexOf(targetPath);
                const movingFromAbove = firstMovingIndex !== -1 && firstMovingIndex < targetIndexInOriginal;
                insertIndex = movingFromAbove ? targetIndexInRemaining + 1 : targetIndexInRemaining;
            }
        }

        const reordered = [...remaining];
        reordered.splice(insertIndex, 0, ...movingInOrder);
        const changed = reordered.some((p, i) => p !== pathOrder[i]);
        return { reordered, changed };
    };

    const reorderSongArrayByPaths = (
        songs: Song[],
        movingPaths: string[],
        targetPath?: string
    ) => {
        const originalPaths = songs.map(s => s.path);
        const { reordered, changed } = reorderPathOrder(originalPaths, movingPaths, targetPath);
        if (!changed) {
            return { reordered: songs, changed: false };
        }
        const songMap = new Map(songs.map(s => [s.path, s]));
        return {
            reordered: reordered.map(path => songMap.get(path)).filter((s): s is Song => !!s),
            changed: true
        };
    };


    let isPointerDown = false;
    let startX = 0;
    let startY = 0;
    const ROW_HEIGHT = 72;

    // 自动滚动
    let autoScrollTimer: number | null = null;
    const startAutoScroll = (direction: 'up' | 'down') => {
        if (autoScrollTimer) return;
        const container = songTableRef.value?.containerRef;
        if (!container) return;

        const scroll = () => {
            if (!isPointerDown) { stopAutoScroll(); return; }
            const speed = 15;
            if (direction === 'up') container.scrollTop -= speed;
            else container.scrollTop += speed;
            autoScrollTimer = requestAnimationFrame(scroll);
        };
        autoScrollTimer = requestAnimationFrame(scroll);
    };

    const stopAutoScroll = () => {
        if (autoScrollTimer) { cancelAnimationFrame(autoScrollTimer); autoScrollTimer = null; }
    };

    const lastSelectedIndex = ref<number>(-1);
    const isSelectionDragging = ref(false);
    const dragSelectAction = ref<'select' | 'deselect' | null>(null);

    const isPrimaryDragPointer = (event: PointerEvent) =>
        event.isPrimary !== false && (event.pointerType !== 'mouse' || event.button === 0);

    // 1. PointerDown 处理项
    const handleTableDragStart = ({ event, song, index }: { event: PointerEvent; song: Song; index: number }) => {
        if (!isPrimaryDragPointer(event)) {
            return;
        }

        isPointerDown = true;
        startX = event.clientX;
        startY = event.clientY;

        // --- 分支 A: 批量多选模式 ---
        if (isBatchMode.value) {
            const tr = event.currentTarget as HTMLElement;
            const rect = tr.getBoundingClientRect();

            // 判断点击位置：如果点击在左侧 60% 区域，视为“选择操作”
            if ((event.clientX - rect.left) / rect.width < 0.6) {
                isSelectionDragging.value = true;

                // Shift 连选逻辑
                if (event.shiftKey && lastSelectedIndex.value !== -1) {
                    const start = Math.min(lastSelectedIndex.value, index);
                    const end = Math.max(lastSelectedIndex.value, index);
                    for (let i = start; i <= end; i++) {
                        if (displaySongList.value[i]) selectedPaths.value.add(displaySongList.value[i].path);
                    }
                } else {
                    // 普通点击：单选/反选
                    if (selectedPaths.value.has(song.path)) {
                        selectedPaths.value.delete(song.path);
                    } else {
                        selectedPaths.value.add(song.path);
                    }
                    lastSelectedIndex.value = index;
                }

                dragSelectAction.value = selectedPaths.value.has(song.path) ? 'select' : 'deselect';
            } else {
                // 点击右侧区域，视为“拖拽已选歌曲”
                isSelectionDragging.value = false;
                if (!selectedPaths.value.has(song.path)) selectedPaths.value.add(song.path);
                dragSession.songs = displaySongList.value.filter(s => selectedPaths.value.has(s.path));
                dragSession.insertIndex = index;
            }
        }
        // --- 分支 B: 普通模式 ---
        else {
            if (['folder', 'playlist', 'all', 'artist', 'album', 'genre', 'year'].includes(currentViewMode.value)) {
                dragSession.type = 'song';
                dragSession.songs = [song];
                dragSession.insertIndex = index;
            }
        }
    };

    // 2. PointerMove
    const onGlobalPointerMove = (e: PointerEvent) => {
        if (!isPointerDown) return;
        if (e.pointerType !== 'mouse') {
            e.preventDefault();
        }

        // 滑动框选逻辑
        if (isBatchMode.value && isSelectionDragging.value) {
            const container = songTableRef.value?.containerRef;
            if (!container) return;

            const rect = container.getBoundingClientRect();
            if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
                // 🔥 使用 elementFromPoint 精确命中鼠标下方的行元素
                // 不再依赖 ROW_HEIGHT 常量，彻底避免行高不一致导致的选择偏移
                const target = document.elementFromPoint(e.clientX, e.clientY);
                const rowEl = target?.closest('[data-index]') as HTMLElement | null;

                let currentIndex = -1;
                if (rowEl) {
                    currentIndex = parseInt(rowEl.dataset.index!, 10);
                } else {
                    // 兜底：鼠标在虚拟滚动 padding 区域
                    const rowElements = container.querySelectorAll('[data-index]');
                    if (rowElements.length > 0) {
                        const firstRow = rowElements[0] as HTMLElement;
                        const lastRow = rowElements[rowElements.length - 1] as HTMLElement;
                        if (e.clientY < firstRow.getBoundingClientRect().top) {
                            currentIndex = parseInt(firstRow.dataset.index!, 10);
                        } else {
                            currentIndex = parseInt(lastRow.dataset.index!, 10);
                        }
                    }
                }

                if (currentIndex === -1) return;
                currentIndex = Math.max(0, Math.min(displaySongList.value.length - 1, currentIndex));

                if (currentIndex !== lastSelectedIndex.value) {
                    const start = Math.min(lastSelectedIndex.value, currentIndex);
                    const end = Math.max(lastSelectedIndex.value, currentIndex);

                    for (let i = start; i <= end; i++) {
                        const s = displaySongList.value[i];
                        if (s) {
                            if (dragSelectAction.value === 'select') {
                                selectedPaths.value.add(s.path);
                            } else if (dragSelectAction.value === 'deselect') {
                                selectedPaths.value.delete(s.path);
                            }
                        }
                    }
                    lastSelectedIndex.value = currentIndex;
                }

                const threshold = 60;
                if (e.clientY < rect.top + threshold) startAutoScroll('up');
                else if (e.clientY > rect.bottom - threshold) startAutoScroll('down');
                else stopAutoScroll();
            }
            return;
        }

        // 拖拽激活判断
        if (!dragSession.active) {
            const dist = Math.sqrt(Math.pow(e.clientX - startX, 2) + Math.pow(e.clientY - startY, 2));
            if (dist > 5) {
                dragSession.active = true;
                dragSession.showGhost = true;
            }
        }

        if (dragSession.active) {
            dragSession.mouseX = e.clientX;
            dragSession.mouseY = e.clientY;

            const container = songTableRef.value?.containerRef;
            if (container) {
                const rect = container.getBoundingClientRect();
                const threshold = 60;
                if (e.clientY < rect.top + threshold) startAutoScroll('up');
                else if (e.clientY > rect.bottom - threshold) startAutoScroll('down');
                else stopAutoScroll();
            }

            const target = document.elementFromPoint(e.clientX, e.clientY);
            const folderEl = target?.closest('.folder-drop-target');
            if (folderEl) {
                dragSession.targetFolder = {
                    path: folderEl.getAttribute('data-folder-path')!,
                    name: folderEl.getAttribute('data-folder-name')!
                };
                dragSession.targetPlaylist = null;
                dragSession.insertIndex = -1;
                return;
            } else {
                dragSession.targetFolder = null;
            }

            const playlistEl = target?.closest('.playlist-drop-target');
            if (playlistEl) {
                dragSession.targetPlaylist = {
                    id: playlistEl.getAttribute('data-playlist-id')!,
                    name: playlistEl.getAttribute('data-playlist-name')!
                };
                dragSession.targetFolder = null;
                dragSession.insertIndex = -1;
                return;
            } else {
                dragSession.targetPlaylist = null;
            }

            if (!isBatchMode.value && !dragSession.targetFolder && !dragSession.targetPlaylist && container) {
                const containerRect = container.getBoundingClientRect();
                if (
                    e.clientX >= containerRect.left && e.clientX <= containerRect.right &&
                    e.clientY >= containerRect.top && e.clientY <= containerRect.bottom
                ) {
                    const offsetY = e.clientY - containerRect.top + container.scrollTop;
                    let currentGapIndex = dragSession.insertIndex;
                    if (currentGapIndex === -1) currentGapIndex = 0;

                    const upTriggerLimit = (currentGapIndex - 0.5) * ROW_HEIGHT;
                    const downTriggerLimit = (currentGapIndex + 1.5) * ROW_HEIGHT;
                    const maxIndex = displaySongList.value.length - 1;

                    if (offsetY < upTriggerLimit) {
                        const newIndex = Math.floor(offsetY / ROW_HEIGHT);
                        dragSession.insertIndex = Math.max(0, newIndex);
                    } else if (offsetY > downTriggerLimit) {
                        const newIndex = Math.floor(offsetY / ROW_HEIGHT);
                        dragSession.insertIndex = Math.min(maxIndex, newIndex);
                    }
                } else {
                    dragSession.insertIndex = -1;
                }
            }
        }
    };

    // 3. PointerUp / PointerCancel
    const resetDragState = () => {
        dragSession.showGhost = false;
        dragSession.active = false;
        dragSession.insertIndex = -1;
        dragSession.targetFolder = null;
        dragSession.targetPlaylist = null;
    };

    const onGlobalPointerEnd = (cancelled = false) => {
        isPointerDown = false;
        stopAutoScroll();
        isSelectionDragging.value = false;
        dragSelectAction.value = null;

        if (cancelled) {
            resetDragState();
            return;
        }

        if (dragSession.active) {
            if (dragSession.targetFolder) {
                dragSession.showGhost = false;
                return;
            }

            if (dragSession.targetPlaylist) {
                const paths = dragSession.songs.map(s => s.path);
                const count = addSongsToPlaylist(dragSession.targetPlaylist.id, paths);
                const msg = count > 0 ? `已添加 ${count} 首歌曲到 ${dragSession.targetPlaylist.name}` : '歌曲已存在于歌单';
                useToast().showToast(msg, count > 0 ? 'success' : 'info');
                dragSession.showGhost = false;
                dragSession.active = false;
            } else if (dragSession.insertIndex > -1) {
                const movingSongs = dragSession.songs;
                if (movingSongs.length > 0) {
                    const movingPaths = movingSongs.map(s => s.path);
                    const targetVisualSong = displaySongList.value[dragSession.insertIndex];
                    const targetPath = targetVisualSong?.path;

                    // 处理歌单内排序
                    if (currentViewMode.value === 'playlist') {
                        const plId = filterCondition.value;
                        const pl = playlists.value.find(p => p.id === plId);

                        if (pl) {
                            // Keep drag behavior consistent with current visual order.
                            const visualPaths = displaySongList.value.map(s => s.path);
                            const { reordered, changed } = reorderPathOrder(visualPaths, movingPaths, targetPath);
                            if (changed) {
                                pl.songPaths = reordered;
                                setPlaylistSortMode('custom');
                            }
                        }
                    }
                    // 处理全局排序
                    else {
                        const fullList = [...songList.value];
                        const { reordered, changed } = reorderSongArrayByPaths(fullList, movingPaths, targetPath);
                        if (changed) {
                            songList.value = reordered;
                        }

                        // 🟢 文件夹视图:保存自定义排序顺序
                        if (currentViewMode.value === 'folder' && currentFolderFilter.value) {
                            const visualPaths = displaySongList.value.map(s => s.path);
                            const { reordered: newOrder, changed: folderOrderChanged } = reorderPathOrder(
                                visualPaths,
                                movingPaths,
                                targetPath
                            );
                            if (folderOrderChanged) {
                                updateFolderOrder(currentFolderFilter.value, newOrder);
                            }
                        }

                        // 本地音乐视图: 保存自定义排序并自动切换到 custom 模式
                        if (currentViewMode.value === 'all') {
                            const visualPaths = displaySongList.value.map(s => s.path);
                            const { reordered: newOrder, changed: localOrderChanged } = reorderPathOrder(
                                visualPaths,
                                movingPaths,
                                targetPath
                            );
                            if (localOrderChanged) {
                                updateLocalOrder(newOrder);
                            }
                        }
                    }
                }
                dragSession.showGhost = false;
                dragSession.active = false;
            } else {
                dragSession.showGhost = false;
                dragSession.active = false;
            }
            dragSession.insertIndex = -1;
            setTimeout(() => { dragSession.targetPlaylist = null; }, 100);
        }
    };

    const onGlobalPointerUp = () => onGlobalPointerEnd(false);
    const onGlobalPointerCancel = () => onGlobalPointerEnd(true);

    onMounted(() => {
        window.addEventListener('pointermove', onGlobalPointerMove);
        window.addEventListener('pointerup', onGlobalPointerUp);
        window.addEventListener('pointercancel', onGlobalPointerCancel);
    });

    onUnmounted(() => {
        stopAutoScroll();
        window.removeEventListener('pointermove', onGlobalPointerMove);
        window.removeEventListener('pointerup', onGlobalPointerUp);
        window.removeEventListener('pointercancel', onGlobalPointerCancel);
    });

    return {
        handleTableDragStart
    };
}
