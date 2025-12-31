mod database;
mod music;
mod player;
pub mod error;

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
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
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
            let player_state = init_player(app.handle());
            app.manage(player_state);

            // 3. 🟢 初始化图片处理并发限制 (限制为同时 4 个)
            // 这是一个全局信号量，所有图片生成请求都要先拿号
            app.manage(ImageConcurrencyLimit(Semaphore::new(4)));

            // 4. 🟢 启动时执行一次缓存清理 (后台运行，不卡启动)
            run_cache_cleanup(app.handle());

            // 5. System Tray Setup
            let handle = app.handle();
            let show_i = MenuItem::with_id(handle, "show", "显示主界面", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(handle, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(handle, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::with_id("tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app.handle())?;

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