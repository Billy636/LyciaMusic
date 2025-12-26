mod database;
mod music;
mod player;

use database::DbState;
use music::{
    scan_music_folder, scan_folder_as_playlists, get_song_cover_thumbnail, 
    get_song_cover, get_song_lyrics, 
    batch_move_music_files, move_music_file, show_in_folder, delete_music_file,
    run_cache_cleanup, ImageConcurrencyLimit // 引入新组件
};
use player::{
    init_player, play_audio, pause_audio, resume_audio, seek_audio, set_volume, get_playback_progress
};
use tauri::Manager;
use tokio::sync::Semaphore; // 引入信号量

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 1. 初始化数据库状态
            let db_state = DbState::new(app.handle())?;
            app.manage(db_state);

            // 2. 初始化播放器状态
            let player_state = init_player();
            app.manage(player_state);

            // 3. 🟢 初始化图片处理并发限制 (限制为同时 4 个)
            // 这是一个全局信号量，所有图片生成请求都要先拿号
            app.manage(ImageConcurrencyLimit(Semaphore::new(4)));

            // 4. 🟢 启动时执行一次缓存清理 (后台运行，不卡启动)
            run_cache_cleanup(app.handle());

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