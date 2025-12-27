import { ref, reactive } from 'vue';

export interface Song {
  name: string;
  title?: string; 
  path: string;
  artist: string;
  album: string;
  duration: number;
  genre?: string;
  year?: string;
  cover?: string;
}

export interface HistoryItem { song: Song; playedAt: number; }

// 🟢 修复：添加 createdAt 字段
export interface Playlist { 
  id: string; 
  name: string; 
  songPaths: string[]; 
  createdAt?: string; 
}

export interface ThemeSettings {
  mode: 'light' | 'dark' | 'custom';
  enableDynamicBg: boolean;
  customBgPath: string;
  opacity: number;
  blur: number;
}

export interface AppSettings { 
  organizeRoot: string; 
  enableAutoOrganize: boolean; 
  organizeRule: string;
  theme: ThemeSettings;
}

// --- 全局播放状态 ---
export const isPlaying = ref(false);
export const volume = ref(100);
export const currentTime = ref(0);
export const playMode = ref(0); 
export const showPlaylist = ref(false);
export const isSongLoaded = ref(false);
export const showPlayerDetail = ref(false); 
export const AUDIO_DELAY = ref(0.45); 

// --- 自定义拖拽状态 ---
export const dragSession = reactive({
  active: false,      
  songs: [] as Song[], 
  mouseX: 0,          
  mouseY: 0,          
  
  targetFolder: null as { name: string, path: string } | null,   
  targetPlaylist: null as { id: string, name: string } | null,   
  
  insertIndex: -1,    
  sortLineTop: -1,    
});

// 弹窗状态
export const showAddToPlaylistModal = ref(false);
export const playlistAddTargetSongs = ref<string[]>([]); 
export const songList = ref<Song[]>([]); 
export const tempQueue = ref<Song[]>([]);
export const currentSong = ref<Song | null>(null);
export const currentCover = ref<string>(''); 
export const playlistCover = ref<string>(''); 
export const watchedFolders = ref<string[]>([]); 
export const favoritePaths = ref<string[]>([]);
export const playlists = ref<Playlist[]>([]);
export const recentSongs = ref<HistoryItem[]>([]);

export const settings = ref<AppSettings>({ 
  organizeRoot: 'D:\\Music', 
  enableAutoOrganize: true, 
  organizeRule: '{Artist}/{Album}/{Title}',
  theme: {
    mode: 'light',
    enableDynamicBg: false,
    customBgPath: '',
    opacity: 0.8,
    blur: 20
  }
});

export const currentViewMode = ref<'all' | 'folder' | 'artist' | 'album' | 'genre' | 'year' | 'playlist' | 'recent' | 'favorites'>('all'); 
export const filterCondition = ref<string>(''); 
export const searchQuery = ref<string>('');
export const localMusicTab = ref<'default' | 'artist' | 'album'>('default');
export const currentArtistFilter = ref<string>('');
export const currentAlbumFilter = ref<string>('');
export const currentFolderFilter = ref<string>('');
export const favTab = ref<'songs' | 'artists' | 'albums'>('songs');
export const favDetailFilter = ref<{ type: 'artist' | 'album', name: string } | null>(null);
export const recentTab = ref<'songs' | 'playlists' | 'albums'>('songs');