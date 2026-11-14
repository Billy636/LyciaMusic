use crate::database::DbState;
use std::fs;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub async fn clear_all_app_data(
    app_handle: AppHandle,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    let db_conn = db_state.conn.clone();
    let app_dir = crate::data_storage::data_dir(&app_handle);
    if let Some(watcher) = app_handle.try_state::<crate::playlist_import::PlaylistFileWatcher>() {
        watcher.stop()?;
    }

    #[cfg(target_os = "windows")]
    crate::autostart::set_launch_on_startup(app_handle, false)
        .map_err(|e| format!("清除开机自动运行设置失败: {e}"))?;

    tauri::async_runtime::spawn_blocking(move || {
        {
            let mut conn = db_conn.lock().map_err(|e| e.to_string())?;
            let tx = conn.transaction().map_err(|e| e.to_string())?;

            tx.execute_batch(
                "
                DELETE FROM song_highlight_markers;
                DELETE FROM song_highlight_paths;
                DELETE FROM song_highlight_identities;
                DELETE FROM play_history;
                DELETE FROM song_artists;
                DELETE FROM artists;
                DELETE FROM songs;
                DELETE FROM playlist_import_paths;
                DELETE FROM library_folders;
                DELETE FROM library_scan_settings;
                DELETE FROM sidebar_folders;
                ",
            )
            .map_err(|e| e.to_string())?;

            tx.commit().map_err(|e| e.to_string())?;

            conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")
                .map_err(|e| e.to_string())?;
        }

        let cover_dir = app_dir.join("covers");
        if cover_dir.exists() {
            fs::remove_dir_all(&cover_dir).map_err(|e| e.to_string())?;
        }

        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(())
}
