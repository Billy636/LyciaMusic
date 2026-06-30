// music/mod.rs - 模块入口，统一导出

pub mod covers;
pub mod cue;
pub mod files;
pub mod library;
pub mod lyrics;
pub mod scanner;
pub mod sidebar;
pub mod tags;
pub mod types;
pub mod utils;

// Re-export types
pub use types::*;

// Re-export commands for lib.rs registration
pub use covers::{clear_cover_cache, get_song_cover, get_song_cover_thumbnail, run_cache_cleanup};
pub use files::{
    batch_move_music_files, create_folder, delete_folder, delete_music_file, get_song_detail,
    get_song_lyrics, get_song_lyrics_for_edit, get_song_lyrics_payload,
    get_song_runtime_metadata, is_directory,
    move_file_to_folder, move_music_file, save_artist_avatar, save_song_info, save_song_lyrics, show_in_folder,
};
pub use library::{
    add_library_folder, get_folder_children, get_library_album_catalog, get_library_artist_catalog,
    get_library_folders, get_library_hierarchy, get_library_song_paths_by_album,
    get_library_song_paths_by_artist, get_library_song_paths_for_all_view,
    get_library_song_paths_for_folder_view, get_library_songs_cached, get_song_quality_metadata,
    remove_library_folder, scan_library,
};
pub use scanner::{
    get_folder_first_song, parse_audio_files, scan_folder_as_playlists, scan_music_folder,
};
// Deprecated compatibility exports. Keep registered for legacy data/tools only.
pub use sidebar::{
    add_sidebar_folder, get_sidebar_folders, get_sidebar_hierarchy, remove_sidebar_folder,
};
