import { ref, reactive } from 'vue';
import { Song, Playlist, HistoryItem, AppSettings } from '../types';
export type { Song, Playlist, HistoryItem, AppSettings };

// --- 全局播放状态 ---
export const isPlaying = ref(false);
export const volume = ref(100);
export const currentTime = ref(0);
export const playMode = ref(0); 
export const showPlaylist = ref(false);
export const isSongLoaded = ref(false);
export const showPlayerDetail = ref(false); 
export const showQueue = ref(false);
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
export const playQueue = ref<Song[]>([]);
export const tempQueue = ref<Song[]>([]);
export const currentSong = ref<Song | null>(null);
export const currentCover = ref<string>(''); 
export const dominantColors = ref<string[]>(['transparent', 'transparent', 'transparent', 'transparent']); 
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
    dynamicBgType: 'flow',
    customBgPath: '',
    opacity: 0.8,
    blur: 20,
    customBackground: {
      imagePath: '',
      blur: 20,
      opacity: 1.0,
      maskColor: '#000000',
      maskAlpha: 0.4,
      scale: 1.0
    }
  },
  sidebar: {
    showLocalMusic: true,
    showFavorites: true,
    showRecent: true,
    showFolders: true
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