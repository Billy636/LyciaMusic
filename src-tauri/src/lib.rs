mod app_runtime;
mod autostart;
mod custom_background;
mod artist_images;
mod custom_fonts;
mod database;
mod data_storage;
mod desktop_lyrics;
mod duplicates;
pub mod error;
mod foreground_window;
mod highlights;
mod music;
mod player;
mod playlist_import;
mod remote;
mod statistics;
mod system_fonts;
mod taskbar;
mod toolbox;
mod window_boundary;
mod window_fullscreen;
mod window_material;
mod window_theme;
mod window_z_order;

use app_runtime::{
    consume_pending_open_paths, exit_app, handle_single_instance, setup_app, update_tray_tooltip,
};
use autostart::{get_launch_on_startup, set_launch_on_startup};
use custom_background::{cancel_custom_background_image, prepare_custom_background_image};
use custom_fonts::{import_lyrics_font, read_lyrics_font_data_url};
use database::clear_all_app_data;
use duplicates::{delete_duplicate_songs, scan_duplicate_songs};
use foreground_window::get_foreground_fullscreen_state;
use highlights::{
    add_song_highlight_marker, delete_song_highlight_marker, get_song_highlight_markers,
    set_song_highlight_marker_position, set_song_highlight_primary, undo_song_highlight_add,
};
use music::{
    add_library_folder, add_sidebar_folder, batch_move_music_files, clear_cover_cache,
    create_folder, delete_folder, delete_music_file, get_folder_children, get_folder_first_song,
    get_library_album_catalog, get_library_album_catalog_by_artist, get_library_artist_catalog,
    get_library_genre_catalog, get_library_genre_groups,
    get_library_folders, get_library_scan_settings, set_library_scan_settings,
    get_library_hierarchy, get_library_song_artist_index_keys,
    get_library_song_labels_for_all_view,
    get_library_song_page, get_library_song_path_page_for_all_view,
    get_library_song_paths_by_album, get_library_song_paths_by_artist, get_library_song_paths_by_genre,
    get_library_song_paths_cached, get_library_song_paths_for_all_view,
    get_library_song_paths_for_folder_view, get_library_songs_by_paths, get_library_songs_cached,
    get_search_index_batch, get_search_index_status, get_sidebar_folders, get_sidebar_hierarchy,
    get_song_cover, get_song_cover_thumbnail, get_song_detail, get_song_lyrics,
    get_song_lyrics_for_edit, get_song_lyrics_source, get_song_runtime_metadata,
    is_directory, move_file_to_folder, move_folder_to_folder, move_music_file, parse_audio_files, remove_library_folder,
    refresh_song_metadata, remove_sidebar_folder, save_artist_avatar, save_song_info, save_song_lyrics,
    scan_folder_as_playlists, scan_library, scan_music_folder, scan_music_folder_paths, show_in_folder,
    upsert_search_index_batch,
};
use player::{
    get_audio_visualizer_samples, get_current_output_device, get_output_devices,
    get_playback_progress, get_track_loudness_info, pause_audio, play_audio, resume_audio,
    seek_audio, set_audio_output_mode, set_audio_visualizer_enabled, set_equalizer_settings,
    set_output_device, set_volume, stop_audio, update_loudness_settings, update_playback_metadata,
};
use remote::{
    add_remote_source, clear_remote_cache, get_remote_cache_usage, get_remote_sources,
    list_remote_directory, precache_remote_song, remove_remote_source, sync_remote_source,
    test_remote_source, update_remote_source,
};
use statistics::{
    add_to_history, clear_recent_history, export_statistics_file, get_behavior_stats,
    get_favorite_album_catalog, get_favorite_artist_catalog, get_favorite_song_paths_view,
    get_format_distribution, get_library_stats, get_quality_distribution, get_recent_album_catalog,
    get_recent_history, get_recent_playlist_catalog, get_recent_song_paths_view,
    import_recent_history, import_statistics_file, preview_statistics_import, record_play,
    remove_from_recent_history, remove_songs_from_history_and_statistics,
};
use system_fonts::get_system_fonts;
use taskbar::{
    cancel_taskbar_player_drag, drag_taskbar_player, get_taskbar_tray_geometry,
    install_taskbar_zorder_guard, refresh_taskbar_window_topmost, setup_taskbar_window,
    uninstall_taskbar_zorder_guard,
};
use tauri::Manager;
use toolbox::{
    apply_rename, check_update_by_rust, download_update_file, file_exists, open_external_program,
    preview_toolbox, refresh_folder_songs, run_installer, set_gpu_acceleration,
};

#[cfg(target_os = "windows")]
use toolbox::{append_webview2_browser_arg, should_disable_gpu_for_startup};
use window_boundary::{set_mini_boundary_enabled, set_retain_material_on_unfocus};
use window_fullscreen::set_immersive_fullscreen;
use window_material::{apply_transparent_window, get_window_material_capabilities};
use window_theme::set_dark_mode_for_window;
use window_z_order::{refresh_current_window_topmost, start_topmost_guard, stop_topmost_guard};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    {
        if should_disable_gpu_for_startup() {
            append_webview2_browser_arg("--disable-gpu");
        }
    }

    tauri::Builder::default()
        .manage(playlist_import::PlaylistFileWatcher::default())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            handle_single_instance(app, argv);
        }))
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::Destroyed = event {
                    window.app_handle().exit(0);
                }
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Initialize storage after the single-instance guard, before opening any files or WebViews.
            if let Err(error) = data_storage::initialize(app.handle()) {
                use tauri_plugin_dialog::DialogExt;
                app.dialog().message(&error).title("无法打开应用数据")
                    .kind(tauri_plugin_dialog::MessageDialogKind::Error).blocking_show();
                return Err(error.into());
            }
            let state_path = app.state::<data_storage::DataStorage>().paths.config.join(".window-state.json");
            app.handle().plugin(
                tauri_plugin_window_state::Builder::default()
                    .with_filename(state_path.to_string_lossy())
                    .with_denylist(&["desktop-lyrics", "mini-player", "taskbar-player", "tray-menu", "song-notification"])
                    .build(),
            )?;
            for config in &app.config().app.windows {
                tauri::WebviewWindowBuilder::from_config(app.handle(), config)?
                    .data_directory(data_storage::webview_dir(app.handle()))
                    .build()?;
            }
            setup_app(app)
        })
        .invoke_handler(tauri::generate_handler![
            playlist_import::read_playlist_source,
            playlist_import::match_playlist_tracks,
            playlist_import::prepare_playlist_paths,
            playlist_import::configure_playlist_files,
            playlist_import::export_playlist_m3u8,
            desktop_lyrics::native_desktop_lyrics_open,
            desktop_lyrics::native_desktop_lyrics_state,
            desktop_lyrics::native_desktop_lyrics_playback,
            desktop_lyrics::native_desktop_lyrics_reveal,
            desktop_lyrics::native_desktop_lyrics_close,
            scan_music_folder,
            scan_music_folder_paths,
            parse_audio_files,
            scan_folder_as_playlists,
            get_song_cover_thumbnail,
            get_song_cover,
            clear_cover_cache,
            prepare_custom_background_image,
            cancel_custom_background_image,
            get_song_lyrics,
            get_song_lyrics_source,
            get_song_lyrics_for_edit,
            save_song_lyrics,
            save_song_info,
            refresh_song_metadata,
            get_song_detail,
            get_song_runtime_metadata,
            get_song_highlight_markers,
            add_song_highlight_marker,
            set_song_highlight_marker_position,
            set_song_highlight_primary,
            delete_song_highlight_marker,
            undo_song_highlight_add,
            batch_move_music_files,
            move_folder_to_folder,
            move_music_file,
            show_in_folder,
            delete_music_file,
            play_audio,
            update_playback_metadata,
            pause_audio,
            stop_audio,
            resume_audio,
            seek_audio,
            set_volume,
            get_playback_progress,
            get_audio_visualizer_samples,
            set_audio_visualizer_enabled,
            get_track_loudness_info,
            update_loudness_settings,
            set_equalizer_settings,
            preview_toolbox,
            scan_duplicate_songs,
            delete_duplicate_songs,
            apply_rename,
            get_output_devices,
            get_current_output_device,
            set_output_device,
            set_audio_output_mode,
            get_library_folders,
            get_library_scan_settings,
            set_library_scan_settings,
            is_directory,
            save_artist_avatar,
            artist_images::scan_artist_images,
            add_library_folder,
            remove_library_folder,
            get_library_songs_cached,
            get_library_song_paths_cached,
            get_library_song_page,
            get_library_song_path_page_for_all_view,
            get_library_songs_by_paths,
            get_library_song_artist_index_keys,
            get_library_song_labels_for_all_view,
            get_search_index_status,
            get_search_index_batch,
            upsert_search_index_batch,
            get_library_artist_catalog,
            get_library_album_catalog,
            get_library_album_catalog_by_artist,
            get_library_genre_catalog,
            get_library_genre_groups,
            get_library_song_paths_by_artist,
            get_library_song_paths_by_album,
            get_library_song_paths_by_genre,
            get_library_song_paths_for_all_view,
            get_library_song_paths_for_folder_view,
            get_remote_sources,
            test_remote_source,
            add_remote_source,
            update_remote_source,
            remove_remote_source,
            sync_remote_source,
            precache_remote_song,
            get_remote_cache_usage,
            clear_remote_cache,
            list_remote_directory,
            scan_library,
            get_library_hierarchy,
            get_folder_children,
            // Deprecated compatibility commands for legacy sidebar_folders.
            get_sidebar_folders,
            add_sidebar_folder,
            remove_sidebar_folder,
            get_sidebar_hierarchy,
            create_folder,
            delete_folder,
            move_file_to_folder,
            get_folder_first_song,
            get_library_stats,
            add_to_history,
            record_play,
            get_recent_history,
            get_favorite_artist_catalog,
            get_favorite_album_catalog,
            get_favorite_song_paths_view,
            get_recent_album_catalog,
            get_recent_song_paths_view,
            get_recent_playlist_catalog,
            import_recent_history,
            export_statistics_file,
            preview_statistics_import,
            import_statistics_file,
            remove_from_recent_history,
            remove_songs_from_history_and_statistics,
            clear_recent_history,
            get_behavior_stats,
            get_quality_distribution,
            get_format_distribution,
            clear_all_app_data,
            data_storage::get_data_storage_info,
            data_storage::set_data_storage_directory,
            data_storage::cancel_data_storage_migration,
            data_storage::complete_data_storage_migration,
            data_storage::restart_app,
            open_external_program,
            file_exists,
            refresh_folder_songs,
            set_mini_boundary_enabled,
            set_retain_material_on_unfocus,
            get_window_material_capabilities,
            apply_transparent_window,
            get_foreground_fullscreen_state,
            set_immersive_fullscreen,
            set_dark_mode_for_window,
            refresh_current_window_topmost,
            start_topmost_guard,
            stop_topmost_guard,
            consume_pending_open_paths,
            get_system_fonts,
            import_lyrics_font,
            read_lyrics_font_data_url,
            setup_taskbar_window,
            get_taskbar_tray_geometry,
            drag_taskbar_player,
            cancel_taskbar_player_drag,
            install_taskbar_zorder_guard,
            refresh_taskbar_window_topmost,
            uninstall_taskbar_zorder_guard,
            exit_app,
            update_tray_tooltip,
            set_gpu_acceleration,
            get_launch_on_startup,
            set_launch_on_startup,
            check_update_by_rust,
            download_update_file,
            run_installer
        ])
        .run({
            let mut context = tauri::generate_context!();
            // Build windows in setup only after pending migrations have finished.
            for window in &mut context.config_mut().app.windows { window.create = false; }
            context
        })
        .expect("error while running tauri application");
}
