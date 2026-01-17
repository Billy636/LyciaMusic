// music/mod.rs - 模块入口，统一导出

pub mod covers;
pub mod files;
pub mod library;
pub mod scanner;
pub mod sidebar;
pub mod tag_matcher;
pub mod types;
pub mod utils;

// Re-export types
pub use types::*;

// Re-export commands for lib.rs registration
pub use covers::{get_song_cover, get_song_cover_thumbnail, run_cache_cleanup};
pub use files::{
    batch_move_music_files, delete_folder, delete_music_file, get_song_lyrics, move_file_to_folder,
    move_music_file, show_in_folder,
};
pub use library::{
    add_library_folder, get_library_folders, get_library_hierarchy, remove_library_folder,
    scan_library,
};
pub use scanner::{get_folder_first_song, scan_folder_as_playlists, scan_music_folder};
pub use sidebar::{
    add_sidebar_folder, get_sidebar_folders, get_sidebar_hierarchy, remove_sidebar_folder,
};
pub use tag_matcher::{search_online_tags, write_music_tags};
