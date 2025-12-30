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

export interface HistoryItem { 
  song: Song; 
  playedAt: number; 
}

export interface Playlist { 
  id: string; 
  name: string; 
  songPaths: string[]; 
  createdAt?: string; 
}

export interface ThemeSettings {
  mode: 'light' | 'dark' | 'custom';
  dynamicBgType: 'none' | 'flow' | 'blur';
  customBgPath: string; // Legacy field, keeping for compatibility if needed, but we'll use customBackground
  opacity: number;      // Legacy field
  blur: number;         // Legacy field
  customBackground: {
    imagePath: string;
    blur: number;
    opacity: number;
    maskColor: string;
    maskAlpha: number;
    scale: number;
  }
}

export interface SidebarSettings {
  showLocalMusic: boolean;
  showFavorites: boolean;
  showRecent: boolean;
  showFolders: boolean;
}

export interface AppSettings { 
  organizeRoot: string; 
  enableAutoOrganize: boolean; 
  organizeRule: string;
  theme: ThemeSettings;
  sidebar: SidebarSettings;
}