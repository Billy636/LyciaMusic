use crate::database::DbState;
use std::fs;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub async fn clear_all_app_data(
    app_handle: AppHandle,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    let db_conn = db_state.conn.clone();
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;

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
                DELETE FROM library_folders;
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
