mod database;
mod music;
mod player;

use database::DbState;
use music::{
    scan_music_folder, scan_folder_as_playlists, get_song_cover_thumbnail, 
    get_song_cover, get_song_lyrics, 
    batch_move_music_files, move_music_file, show_in_folder, delete_music_file
};
use player::{
    init_player, play_audio, pause_audio, resume_audio, seek_audio, set_volume, get_playback_progress
};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Initialize Database State
            let db_state = DbState::new(app.handle())?;
            app.manage(db_state);

            // Initialize Player State
            let player_state = init_player();
            app.manage(player_state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_music_folder, 
            scan_folder_as_playlists, 
            get_song_cover_thumbnail, 
            get_song_cover, 
            get_song_lyrics, 
            batch_move_music_files, 
            move_music_file, 
            show_in_folder, 
            delete_music_file,
            play_audio, 
            pause_audio, 
            resume_audio, 
            seek_audio, 
            set_volume, 
            get_playback_progress
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
