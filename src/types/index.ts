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