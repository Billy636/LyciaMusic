import { computed, watch, onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window'; 
import { open } from '@tauri-apps/plugin-dialog';
import * as State from './playerState';
import { useLyrics } from './lyrics';

export * from './playerState'; 

// 动画帧 ID
let progressFrameId: number | null = null; 
// 校准定时器 ID
let syncIntervalId: any = null;
let seekTimeout: any = null;

// 插值锚点
let playbackAnchorTime = 0;   
let playbackStartOffset = 0;  

// 定义后端返回的结构
interface GeneratedFolder {
  name: string;
  path: string; 
  songs: State.Song[];
}

export function usePlayer() {
  
  const { loadLyrics } = useLyrics();

  // ... (格式化函数保持不变) ...
  function formatDuration(seconds: number) { if (!seconds) return "00:00"; const mins = Math.floor(seconds / 60); const secs = Math.floor(seconds % 60); return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`; }
  function formatTimeAgo(timestamp: number) { const now = Date.now(); const diff = now - timestamp; const oneHour = 60 * 60 * 1000; if (diff < oneHour) return `${Math.max(1, Math.floor(diff / 60000))}分钟前`; if (diff < 24 * oneHour) return `${Math.floor(diff / oneHour)}小时前`; return `${Math.floor(diff / (24 * oneHour))}天前`; }
  
  // ... (计算属性保持不变) ...
  const isLocalMusic = computed(() => State.currentViewMode.value === 'all' || State.currentViewMode.value === 'artist' || State.currentViewMode.value === 'album');
  const isFolderMode = computed(() => State.currentViewMode.value === 'folder');
  
  const artistList = computed(() => { const map = new Map<string, { count: number, firstSongPath: string }>(); State.songList.value.forEach(s => { const k = s.artist || 'Unknown'; const existing = map.get(k); if (existing) { existing.count++; } else { map.set(k, { count: 1, firstSongPath: s.path }); } }); return Array.from(map).map(([n, v]) => ({ name: n, count: v.count, firstSongPath: v.firstSongPath })).sort((a,b)=>b.count-a.count); });
  const albumList = computed(() => { const map = new Map<string, { count: number, artist: string, firstSongPath: string }>(); State.songList.value.forEach(s => { const k = s.album || 'Unknown'; const existing = map.get(k); if (existing) { existing.count++; } else { map.set(k, { count: 1, artist: s.artist, firstSongPath: s.path }); } }); return Array.from(map).map(([n, v]) => ({ name: n, count: v.count, artist: v.artist, firstSongPath: v.firstSongPath })).sort((a, b) => b.count - a.count); });
  const folderList = computed(() => { return State.watchedFolders.value.map(folderPath => { const songsInFolder = State.songList.value.filter(s => s.path.startsWith(folderPath)); return { path: folderPath, name: folderPath.split(/[/\\]/).pop() || folderPath, count: songsInFolder.length, firstSongPath: songsInFolder.length > 0 ? songsInFolder[0].path : '' }; }); });
  const favoriteSongList = computed(() => { return State.songList.value.filter(s => State.favoritePaths.value.includes(s.path)); });
  const favArtistList = computed(() => { const map = new Map<string, { count: number, firstSongPath: string }>(); favoriteSongList.value.forEach(s => { const k = s.artist || 'Unknown'; const existing = map.get(k); if (existing) { existing.count++; } else { map.set(k, { count: 1, firstSongPath: s.path }); } }); return Array.from(map).map(([name, val]) => ({ name, count: val.count, firstSongPath: val.firstSongPath })).sort((a, b) => b.count - a.count); });
  const favAlbumList = computed(() => { const map = new Map<string, { count: number, artist: string, firstSongPath: string }>(); favoriteSongList.value.forEach(s => { const k = s.album || 'Unknown'; const existing = map.get(k); if (existing) { existing.count++; } else { map.set(k, { count: 1, artist: s.artist, firstSongPath: s.path }); } }); return Array.from(map).map(([name, val]) => ({ name, count: val.count, artist: val.artist, firstSongPath: val.firstSongPath })).sort((a, b) => b.count - a.count); });
  const recentAlbumList = computed(() => { const map = new Map<string, { artist: string, playedAt: number, firstSongPath: string }>(); State.recentSongs.value.forEach(item => { const k = item.song.album || 'Unknown'; if (!map.has(k) || item.playedAt > map.get(k)!.playedAt) { map.set(k, { artist: item.song.artist, playedAt: item.playedAt, firstSongPath: item.song.path }); } }); return Array.from(map).map(([name, val]) => ({ name, artist: val.artist, playedAt: val.playedAt, firstSongPath: val.firstSongPath })).sort((a, b) => b.playedAt - a.playedAt); });
  const recentPlaylistList = computed(() => { const result: { id: string, name: string, count: number, playedAt: number, firstSongPath: string }[] = []; State.playlists.value.forEach(pl => { let lastPlayedTime = 0; let hasPlayed = false; const plSongPaths = new Set(pl.songPaths); for (const historyItem of State.recentSongs.value) { if (plSongPaths.has(historyItem.song.path)) { if (historyItem.playedAt > lastPlayedTime) { lastPlayedTime = historyItem.playedAt; hasPlayed = true; } } } if (hasPlayed) { result.push({ id: pl.id, name: pl.name, count: pl.songPaths.length, playedAt: lastPlayedTime, firstSongPath: pl.songPaths.length > 0 ? pl.songPaths[0] : '' }); } }); return result.sort((a, b) => b.playedAt - a.playedAt); });
  const genreList = computed(() => { const map = new Map(); State.songList.value.forEach(s => { const k = s.genre || 'Unknown'; map.set(k, (map.get(k)||0)+1); }); return Array.from(map).map(([n,c]) => ({name:n, count:c})).sort((a,b)=>b.count-a.count); });
  const yearList = computed(() => { const map = new Map(); State.songList.value.forEach(s => { const k = (s.year && s.year.length>=4) ? s.year.substring(0,4) : 'Unknown'; map.set(k, (map.get(k)||0)+1); }); return Array.from(map).map(([n,c]) => ({name:n, count:c})).sort((a,b)=>b.name.localeCompare(a.name)); });

  const displaySongList = computed(() => {
    if (State.searchQuery.value.trim()) {
      const q = State.searchQuery.value.toLowerCase();
      if (State.currentViewMode.value === 'favorites') return favoriteSongList.value.filter(s => s.name.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q));
      if (State.currentViewMode.value === 'recent') return State.recentSongs.value.map(h => h.song).filter(s => s.name.toLowerCase().includes(q));
      return State.songList.value.filter(s => s.name.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q) || s.album.toLowerCase().includes(q));
    }
    if (State.currentViewMode.value === 'all') {
      if (State.localMusicTab.value === 'artist' && State.currentArtistFilter.value) return State.songList.value.filter(s => s.artist === State.currentArtistFilter.value);
      if (State.localMusicTab.value === 'album' && State.currentAlbumFilter.value) return State.songList.value.filter(s => s.album === State.currentAlbumFilter.value);
      return State.songList.value;
    }
    if (State.currentViewMode.value === 'folder' && State.currentFolderFilter.value) return State.songList.value.filter(s => s.path.startsWith(State.currentFolderFilter.value));
    if (State.currentViewMode.value === 'recent') return State.recentSongs.value.map(h => h.song);
    if (State.currentViewMode.value === 'favorites') {
      if (State.favTab.value === 'songs') return favoriteSongList.value;
      if (State.favTab.value === 'artists') return State.favDetailFilter.value?.type === 'artist' ? favoriteSongList.value.filter(s => s.artist === State.favDetailFilter.value!.name) : [];
      if (State.favTab.value === 'albums') return State.favDetailFilter.value?.type === 'album' ? favoriteSongList.value.filter(s => s.album === State.favDetailFilter.value!.name) : [];
      return favoriteSongList.value;
    }
    if (State.currentViewMode.value === 'playlist') { const pl = State.playlists.value.find(p=>p.id===State.filterCondition.value); return pl ? State.songList.value.filter(s=>pl.songPaths.includes(s.path)) : []; }
    return State.songList.value.filter(s => (s.artist||'Unknown') === State.filterCondition.value || (s.album||'Unknown') === State.filterCondition.value || (s.genre||'Unknown') === State.filterCondition.value || ((s.year?.substring(0,4))||'Unknown') === State.filterCondition.value);
  });

  watch(displaySongList, async (newList) => {
    if (State.currentViewMode.value === 'favorites' && (State.favTab.value === 'artists' || State.favTab.value === 'albums') && !State.favDetailFilter.value) return;
    if (newList.length > 0) { try { const cover = await invoke<string>('get_song_cover', { path: newList[0].path }); State.playlistCover.value = cover; } catch { State.playlistCover.value = ''; } } else { State.playlistCover.value = ''; }
  }, { immediate: true });

  // ... (addFoldersFromStructure, getSongsInFolder, createPlaylist, moveFilesToFolder 保持不变) ...
  async function addFoldersFromStructure() {
    try {
      const selectedPath = await open({ directory: true, multiple: false, title: '选择要扫描的根目录' });
      if (!selectedPath || typeof selectedPath !== 'string') return;
      const newFolders = await invoke<GeneratedFolder[]>('scan_folder_as_playlists', { rootPath: selectedPath });
      if (newFolders.length === 0) { alert("未在该目录下找到包含音乐文件的文件夹"); return; }
      let addedCount = 0;
      let allNewSongs: State.Song[] = [];
      newFolders.forEach(folder => {
        if (!State.watchedFolders.value.includes(folder.path)) { State.watchedFolders.value.push(folder.path); addedCount++; }
        allNewSongs.push(...folder.songs);
      });
      const existingPaths = new Set(State.songList.value.map(s => s.path));
      const uniqueNewSongs = allNewSongs.filter(s => !existingPaths.has(s.path));
      State.songList.value = [...State.songList.value, ...uniqueNewSongs];
      alert(`已添加 ${addedCount} 个文件夹到侧边栏`);
    } catch (e) { console.error("添加文件夹失败:", e); alert("添加文件夹失败: " + e); }
  }

  function getSongsInFolder(folderPath: string) { return State.songList.value.filter(s => s.path.startsWith(folderPath)); }
  function createPlaylist(n: string, initialSongs: string[] = []) { if(n.trim()) { State.playlists.value.push({ id: Date.now().toString() + Math.random().toString().slice(2), name: n, songPaths: [...initialSongs] }); } }
  
  async function moveFilesToFolder(paths: string[], targetFolder: string) { try { const count = await invoke<number>('batch_move_music_files', { paths, targetFolder }); const sep = targetFolder.includes('\\') ? '\\' : '/'; const basePath = targetFolder.endsWith(sep) ? targetFolder : targetFolder + sep; paths.forEach(oldPath => { const songToUpdate = State.songList.value.find(s => s.path === oldPath); if (songToUpdate) { const fileName = oldPath.split(/[/\\]/).pop(); if (fileName) { const newPath = basePath + fileName; songToUpdate.path = newPath; } } }); return count; } catch (e) { throw e; } }

  // 🟢 新增：刷新指定文件夹
  async function refreshFolder(folderPath: string) {
    try {
      // 1. 重新扫描该文件夹
      const newSongs = await invoke<State.Song[]>('scan_music_folder', { folderPath });
      
      // 2. 在现有列表中，移除属于该文件夹的旧数据
      // 注意：这里假设 folderPath 是根路径。我们保留所有 不以 该路径开头 的歌曲
      const otherSongs = State.songList.value.filter(s => !s.path.startsWith(folderPath));
      
      // 3. 将新扫描的歌曲与保留的歌曲合并
      State.songList.value = [...otherSongs, ...newSongs];
      
      // console.log(`已刷新文件夹: ${folderPath}, 找到 ${newSongs.length} 首歌曲`);
    } catch (e) {
      console.error("刷新失败:", e);
      throw e; // 抛出错误供 UI 处理
    }
  }

  // ... (其他原有函数保持不变) ...
  function deletePlaylist(id: string) { State.playlists.value = State.playlists.value.filter(p=>p.id!==id); if(State.currentViewMode.value==='playlist' && State.filterCondition.value===id) switchViewToAll(); }
  function addToPlaylist(pid:string, path:string) { const pl=State.playlists.value.find(p=>p.id===pid); if(pl && !pl.songPaths.includes(path)) pl.songPaths.push(path); }
  function removeFromPlaylist(pid:string, path:string) { const pl=State.playlists.value.find(p=>p.id===pid); if(pl) pl.songPaths=pl.songPaths.filter(p=>p!==path); }
  function addSongsToPlaylist(playlistId: string, songPaths: string[]): number { const pl = State.playlists.value.find(p => p.id === playlistId); if (!pl) return 0; let addedCount = 0; songPaths.forEach(path => { if (!pl.songPaths.includes(path)) { pl.songPaths.push(path); addedCount++; } }); return addedCount; }
  function viewPlaylist(id:string) { State.currentViewMode.value='playlist'; State.filterCondition.value=id; State.searchQuery.value=''; }
  function switchToFolderView() { State.currentViewMode.value = 'folder'; State.searchQuery.value = ''; if (!State.currentFolderFilter.value && State.watchedFolders.value.length > 0) State.currentFolderFilter.value = State.watchedFolders.value[0]; }
  function removeFolder(folderPath: string) { State.watchedFolders.value = State.watchedFolders.value.filter(p => p !== folderPath); State.songList.value = State.songList.value.filter(s => !s.path.startsWith(folderPath)); if (State.currentFolderFilter.value === folderPath) State.currentFolderFilter.value = State.watchedFolders.value.length > 0 ? State.watchedFolders.value[0] : ''; }
  function viewArtist(n:string) { State.currentViewMode.value='artist'; State.filterCondition.value=n; State.searchQuery.value=''; }
  function viewAlbum(n:string) { State.currentViewMode.value='album'; State.filterCondition.value=n; State.searchQuery.value=''; }
  function viewGenre(n:string) { State.currentViewMode.value='genre'; State.filterCondition.value=n; State.searchQuery.value=''; }
  function viewYear(n:string) { State.currentViewMode.value='year'; State.filterCondition.value=n; State.searchQuery.value=''; }
  function switchViewToAll() { State.currentViewMode.value='all'; State.filterCondition.value=''; State.searchQuery.value=''; }
  function switchViewToFolder(p:string) { State.currentViewMode.value='folder'; State.filterCondition.value=p; State.searchQuery.value=''; }
  function switchToRecent() { State.currentViewMode.value = 'recent'; State.searchQuery.value = ''; }
  function switchToFavorites() { State.currentViewMode.value = 'favorites'; State.searchQuery.value = ''; }
  function setSearch(q:string) { State.searchQuery.value=q; }
  function switchLocalTab(tab: 'default' | 'artist' | 'album') { State.localMusicTab.value = tab; State.currentArtistFilter.value = ''; State.currentAlbumFilter.value = ''; if (tab === 'artist' && artistList.value.length > 0) State.currentArtistFilter.value = artistList.value[0].name; if (tab === 'album' && albumList.value.length > 0) State.currentAlbumFilter.value = albumList.value[0].name; }
  function switchFavTab(tab: 'songs' | 'artists' | 'albums') { State.favTab.value = tab; }
  function isFavorite(s:State.Song|null) { if(!s)return false; return State.favoritePaths.value.includes(s.path); }
  function toggleFavorite(s:State.Song) { if(isFavorite(s)) State.favoritePaths.value=State.favoritePaths.value.filter(p=>p!==s.path); else State.favoritePaths.value.push(s.path); }
  function addToHistory(song: State.Song) { State.recentSongs.value = State.recentSongs.value.filter(item => item.song.path !== song.path); State.recentSongs.value.unshift({ song, playedAt: Date.now() }); if (State.recentSongs.value.length > 1000) State.recentSongs.value = State.recentSongs.value.slice(0, 1000); }
  function clearHistory() { State.recentSongs.value = []; }
  function clearLocalMusic() { State.songList.value = []; State.watchedFolders.value = []; }
  function clearFavorites() { State.favoritePaths.value = []; }
  async function addFolder() { try { const sel = await open({directory:true, multiple:false}); if(sel && typeof sel==='string') { if(!State.watchedFolders.value.includes(sel)) State.watchedFolders.value.push(sel); const newS = await invoke<State.Song[]>('scan_music_folder', {folderPath:sel}); const exist = new Set(State.songList.value.map(s=>s.path)); const uniq = newS.filter(s=>!exist.has(s.path)); State.songList.value=[...State.songList.value, ...uniq]; } } catch(e){console.error(e);} }
  function generateOrganizedPath(song: State.Song): string { const root = State.settings.value.organizeRoot || 'D:\\Music'; const sep = root.includes('/') ? '/' : '\\'; if (!State.settings.value.enableAutoOrganize) return ""; const clean = (s: string) => s.replace(/[<>:"/\\|?*]/g, '_').trim(); const artist = clean(song.artist && song.artist !== 'Unknown' ? song.artist : 'Unknown Artist'); const album = clean(song.album && song.album !== 'Unknown' ? song.album : 'Unknown Album'); const title = clean(song.title || song.name); const year = clean(song.year ? song.year.substring(0,4) : '0000'); let relativePath = State.settings.value.organizeRule.replace('{Artist}', artist).replace('{Album}', album).replace('{Title}', title).replace('{Year}', year); relativePath = relativePath.replace(/\/\//g, '/').replace(/\\\\/g, '\\'); return `${root}${sep}${relativePath}`; }
  async function moveFile(song: State.Song, newPath: string) { try { await invoke('move_music_file', { oldPath: song.path, newPath }); const oldPath = song.path; const target = State.songList.value.find(s => s.path === oldPath); if (target) target.path = newPath; if (State.currentSong.value && State.currentSong.value.path === oldPath) State.currentSong.value.path = newPath; State.playlists.value.forEach(pl => { const i = pl.songPaths.indexOf(oldPath); if(i!==-1) pl.songPaths[i]=newPath; }); const fi = State.favoritePaths.value.indexOf(oldPath); if(fi!==-1) State.favoritePaths.value[fi]=newPath; return true; } catch (e) { alert(`整理失败: ${e}`); return false; } }
  function handleAutoNext() { if (State.playMode.value===1 && State.currentSong.value) { playSong(State.currentSong.value); } else { nextSong(); } }
  async function handleVolume(e:Event) { const v=parseInt((e.target as HTMLInputElement).value); State.volume.value=v; await invoke('set_volume',{volume:v/100.0}); }
  async function toggleMute() { if (State.volume.value>0) { State.volume.value=0; await invoke('set_volume',{volume:0.0}); } else { State.volume.value=100; await invoke('set_volume',{volume:1.0}); } }
  function toggleMode() { State.playMode.value=(State.playMode.value+1)%3; }
  function togglePlaylist() { State.showPlaylist.value=!State.showPlaylist.value; }
  async function handleScan() { addFolder(); }
  function playNext(song: State.Song) { State.tempQueue.value.unshift(song); }
  function removeSongFromList(song: State.Song) { if (State.currentViewMode.value === 'all') { State.songList.value = State.songList.value.filter(s => s.path !== song.path); } else if (State.currentViewMode.value === 'favorites') { State.favoritePaths.value = State.favoritePaths.value.filter(p => p !== song.path); } else if (State.currentViewMode.value === 'recent') { State.recentSongs.value = State.recentSongs.value.filter(i => i.song.path !== song.path); } }
  async function openInFinder(path: string) { await invoke('show_in_folder', { path }); }
  async function deleteFromDisk(song: State.Song) { try { await invoke('delete_music_file', { path: song.path }); State.songList.value = State.songList.value.filter(s => s.path !== song.path); State.favoritePaths.value = State.favoritePaths.value.filter(p => p !== song.path); State.recentSongs.value = State.recentSongs.value.filter(i => i.song.path !== song.path); State.playlists.value.forEach(pl => { pl.songPaths = pl.songPaths.filter(p => p !== song.path); }); } catch (e) { alert("删除失败: " + e); } }

  function stopTimer() { 
    if (progressFrameId !== null) { cancelAnimationFrame(progressFrameId); progressFrameId = null; }
    if (syncIntervalId !== null) { clearInterval(syncIntervalId); syncIntervalId = null; }
  }

  function startTimer() { 
    stopTimer();
    playbackAnchorTime = performance.now();
    playbackStartOffset = State.currentTime.value;
    const update = () => {
      if (!State.currentSong.value || !State.isPlaying.value) return; 
      const now = performance.now();
      const delta = (now - playbackAnchorTime) / 1000.0;
      State.currentTime.value = playbackStartOffset + delta;
      if (State.currentTime.value >= State.currentSong.value.duration) { handleAutoNext(); return; }
      progressFrameId = requestAnimationFrame(update);
    };
    progressFrameId = requestAnimationFrame(update);
    syncIntervalId = setInterval(async () => {
      if (!State.isPlaying.value) return;
      try {
        const realTime = await invoke<number>('get_playback_progress');
        const uiTime = State.currentTime.value;
        if (Math.abs(realTime - uiTime) > 0.05) {
          State.currentTime.value = realTime;
          playbackAnchorTime = performance.now();
          playbackStartOffset = realTime;
        }
      } catch (e) {}
    }, 1000);
  }

  async function playSong(song: State.Song) { State.currentSong.value=song; State.isPlaying.value=true; State.isSongLoaded.value=true; State.currentTime.value=0; State.currentCover.value=''; addToHistory(song); loadLyrics(); startTimer(); try{ invoke('play_audio',{path:song.path}); invoke<string>('get_song_cover',{path:song.path}).then(c=>State.currentCover.value=c); }catch(e){State.isPlaying.value=false;} }
  async function togglePlay() { if(!State.currentSong.value)return; if(State.isPlaying.value){ await invoke('pause_audio'); State.isPlaying.value=false; stopTimer(); } else { if(!State.isSongLoaded.value){ await invoke('play_audio',{path:State.currentSong.value.path}); invoke<string>('get_song_cover',{path:State.currentSong.value.path}).then(c=>State.currentCover.value=c); State.isSongLoaded.value=true; loadLyrics(); } else { await invoke('resume_audio'); } State.isPlaying.value=true; startTimer(); } }
  function nextSong() { if (State.tempQueue.value.length > 0) { const next = State.tempQueue.value.shift(); if (next) { playSong(next); return; } } const l=displaySongList.value.length?displaySongList.value:State.songList.value; if(!l.length)return; let i=l.findIndex(s=>s.path===State.currentSong.value?.path); i=(i+1)%l.length; playSong(l[i]); }
  function prevSong() { const l=displaySongList.value.length?displaySongList.value:State.songList.value; if(!l.length)return; let i=l.findIndex(s=>s.path===State.currentSong.value?.path); i=(i-1+l.length)%l.length; playSong(l[i]); }
  async function seekTo(newTime: number) { if (!State.currentSong.value) return; if (seekTimeout) clearTimeout(seekTimeout); stopTimer(); let targetTime = Math.max(0, Math.min(newTime, State.currentSong.value.duration)); State.currentTime.value = targetTime; seekTimeout = setTimeout(async () => { const originalVolume = State.volume.value / 100.0; await invoke('set_volume', { volume: 0.0 }); await invoke('seek_audio', { time: Math.floor(targetTime) }); playbackStartOffset = targetTime; setTimeout(async () => { await invoke('set_volume', { volume: originalVolume }); }, 150); if (State.isPlaying.value) { startTimer(); } }, 100); }
  async function playAt(time: number) { await seekTo(time); if (!State.isPlaying.value) { setTimeout(async () => { if (!State.isPlaying.value) await togglePlay(); }, 150); } }
  async function handleSeek(e: MouseEvent) { if(!State.currentSong.value) return; const t = e.currentTarget as HTMLElement; const r = t.getBoundingClientRect(); const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); const tm = p * State.currentSong.value.duration; await seekTo(tm); }
  async function stepSeek(step: number) { if (!State.currentSong.value) return; await seekTo(State.currentTime.value + step); }
  async function toggleAlwaysOnTop(enable: boolean) { try { await getCurrentWindow().setAlwaysOnTop(enable); } catch (e) { console.error('Failed to set always on top:', e); } }
  function togglePlayerDetail() { State.showPlayerDetail.value = !State.showPlayerDetail.value; }
  function openAddToPlaylistDialog(songPath: string) { State.playlistAddTargetSongs.value = [songPath]; State.showAddToPlaylistModal.value = true; }

  // 🟢 恢复：init 函数 (包含了播放记忆逻辑)
  function init() {
    watch(State.volume, (v) => localStorage.setItem('player_volume', v.toString()));
    watch(State.playMode, (v) => localStorage.setItem('player_mode', v.toString()));
    watch(State.songList, (v) => localStorage.setItem('player_playlist', JSON.stringify(v)), { deep: true });
    watch(State.watchedFolders, (v) => localStorage.setItem('player_watched_folders', JSON.stringify(v)), { deep: true });
    watch(State.favoritePaths, (v) => localStorage.setItem('player_favorites', JSON.stringify(v)), { deep: true });
    watch(State.playlists, (v) => localStorage.setItem('player_custom_playlists', JSON.stringify(v)), { deep: true });
    watch(State.settings, (v) => localStorage.setItem('player_settings', JSON.stringify(v)), { deep: true });
    watch(State.recentSongs, (v) => localStorage.setItem('player_history', JSON.stringify(v)), { deep: true });

    // 1. 自动保存当前歌曲
    watch(State.currentSong, (newSong) => {
      if (newSong) {
        localStorage.setItem('player_last_song', JSON.stringify(newSong));
      } else {
        localStorage.removeItem('player_last_song');
      }
    }, { deep: true });

    // 2. 暂停时保存进度
    watch(State.isPlaying, (playing) => {
      if (!playing) {
        localStorage.setItem('player_last_time', State.currentTime.value.toString());
      }
    });

    onMounted(async () => {
      const sVol = localStorage.getItem('player_volume'); if (sVol) { State.volume.value = parseInt(sVol); await invoke('set_volume', { volume: State.volume.value / 100.0 }); }
      const sFolders = localStorage.getItem('player_watched_folders'); if (sFolders) try { State.watchedFolders.value = JSON.parse(sFolders); } catch(e) {}
      const sList = localStorage.getItem('player_playlist'); if (sList) try { State.songList.value = JSON.parse(sList); } catch(e) {}
      const sFavs = localStorage.getItem('player_favorites'); if (sFavs) try { State.favoritePaths.value = JSON.parse(sFavs); } catch(e) {}
      const sPlaylists = localStorage.getItem('player_custom_playlists'); if (sPlaylists) try { State.playlists.value = JSON.parse(sPlaylists); } catch(e) {}
      const sSettings = localStorage.getItem('player_settings'); if (sSettings) try { Object.assign(State.settings.value, JSON.parse(sSettings)); } catch(e) {}
      const sHistory = localStorage.getItem('player_history'); if (sHistory) try { State.recentSongs.value = JSON.parse(sHistory); } catch(e) {}

      // 3. 恢复上次播放的歌曲
      const lastSong = localStorage.getItem('player_last_song');
      if (lastSong) {
        try {
          const parsedSong = JSON.parse(lastSong);
          State.currentSong.value = parsedSong;
          if (parsedSong.path) {
            invoke<string>('get_song_cover', { path: parsedSong.path }).then(cover => State.currentCover.value = cover).catch(() => {});
          }
          State.isSongLoaded.value = false; 
        } catch (e) {}
      }

      // 4. 恢复上次播放进度
      const lastTime = localStorage.getItem('player_last_time');
      if (lastTime) {
        State.currentTime.value = parseFloat(lastTime);
      }

      window.addEventListener('beforeunload', () => {
        localStorage.setItem('player_last_time', State.currentTime.value.toString());
      });
    });
  }

  return {
    ...State,
    artistList, albumList, genreList, yearList, folderList, favoriteSongList, favArtistList, favAlbumList, recentAlbumList, recentPlaylistList, displaySongList, isLocalMusic, isFolderMode,
    init, formatDuration, formatTimeAgo,
    playSong, togglePlay, nextSong, prevSong, handleSeek, handleVolume, toggleMute, handleScan, toggleMode, togglePlaylist,
    addFolder, switchViewToAll, switchViewToFolder, switchToFolderView, switchToRecent, switchToFavorites, switchLocalTab, switchFavTab,
    removeFolder, addToHistory, clearHistory, clearLocalMusic, clearFavorites, addSongsToPlaylist, isFavorite, toggleFavorite,
    viewArtist, viewAlbum, viewGenre, viewYear, setSearch, createPlaylist, deletePlaylist, addToPlaylist, removeFromPlaylist, viewPlaylist,
    moveFile, generateOrganizedPath, playNext, removeSongFromList, openInFinder, deleteFromDisk,
    stepSeek, toggleAlwaysOnTop, togglePlayerDetail, seekTo, openAddToPlaylistDialog, playAt,
    addFoldersFromStructure, getSongsInFolder,
    moveFilesToFolder,
    refreshFolder // 🟢 导出这个新函数
  };
}