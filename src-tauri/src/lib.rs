mod database;
pub mod error;
mod music;
mod player;
mod statistics;
mod toolbox;

use database::DbState;
use music::{
    add_library_folder,
    add_sidebar_folder,
    batch_move_music_files,
    delete_folder,
    delete_music_file,
    get_folder_first_song, // 🟢 New: Get first song for cover
    get_library_folders,
    get_library_hierarchy, // 引入新命令
    // Sidebar Commands
    get_sidebar_folders,
    get_sidebar_hierarchy,
    get_song_cover,
    get_song_cover_thumbnail,
    get_song_lyrics,
    move_file_to_folder, // Added this line
    move_music_file,
    remove_library_folder,
    remove_sidebar_folder,
    run_cache_cleanup,
    scan_folder_as_playlists,
    scan_library,
    scan_music_folder,
    search_online_tags,
    show_in_folder,
    write_music_tags,
    ImageConcurrencyLimit, // 引入新组件
};
use player::{
    get_output_devices, get_playback_progress, init_player, pause_audio, play_audio, resume_audio,
    seek_audio, set_output_device, set_volume,
};
use statistics::{
    get_behavior_stats, get_format_distribution, get_library_stats, get_quality_distribution,
    record_play,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tokio::sync::Semaphore;
use toolbox::{apply_rename, preview_rename};

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
                    } = event
                    {
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
            get_playback_progress,
            preview_rename,
            apply_rename,
            get_output_devices,
            set_output_device,
            get_library_folders,
            add_library_folder,
            remove_library_folder,
            scan_library,
            get_library_hierarchy,
            // Sidebar Commands
            get_sidebar_folders,
            add_sidebar_folder,
            remove_sidebar_folder,
            get_sidebar_hierarchy,
            delete_folder,
            move_file_to_folder,
            get_folder_first_song,
            // Statistics Commands
            get_library_stats,
            record_play,
            get_behavior_stats,
            get_quality_distribution,
            get_format_distribution,
            // Tag Matcher
            search_online_tags,
            write_music_tags
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
