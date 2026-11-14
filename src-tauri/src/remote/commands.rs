use super::cache;
use super::repository::{get_source, list_sources, remove_source, save_source};
use super::scanner;
use super::types::{
    RemoteCacheUsage, RemoteConnectionResult, RemoteFileEntry, RemoteSource,
    RemoteSourceCredentials, RemoteSourceInput, RemoteSyncResult,
};
use super::webdav;
use crate::database::DbState;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};

fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn input_to_credentials(input: RemoteSourceInput) -> Result<RemoteSourceCredentials, String> {
    if input.provider != "webdav" {
        return Err("第一版仅支持 WebDAV".to_string());
    }
    let now = now_seconds();
    Ok(RemoteSourceCredentials {
        id: input.id.unwrap_or_else(|| "test".to_string()),
        name: input.name,
        provider: input.provider,
        base_url: input.base_url.trim().trim_end_matches('/').to_string(),
        username: input.username,
        password: input.password,
        root_path: input.root_path.unwrap_or_else(|| "/".to_string()),
        enabled: true,
        last_sync_at: None,
        last_sync_error: None,
        created_at: now,
        updated_at: now,
    })
}

#[tauri::command]
pub(crate) async fn get_remote_sources(
    db_state: State<'_, DbState>,
) -> Result<Vec<RemoteSource>, String> {
    let conn = db_state.conn.lock().map_err(|error| error.to_string())?;
    list_sources(&conn)
}

#[tauri::command]
pub(crate) async fn test_remote_source(
    source: RemoteSourceInput,
) -> Result<RemoteConnectionResult, String> {
    let credentials = input_to_credentials(source)?;
    match webdav::test_connection(&credentials).await {
        Ok(()) => Ok(RemoteConnectionResult {
            ok: true,
            message: "连接成功".to_string(),
        }),
        Err(error) => Ok(RemoteConnectionResult {
            ok: false,
            message: error,
        }),
    }
}

#[tauri::command]
pub(crate) async fn add_remote_source(
    source: RemoteSourceInput,
    db_state: State<'_, DbState>,
) -> Result<RemoteSource, String> {
    let conn = db_state.conn.lock().map_err(|error| error.to_string())?;
    save_source(&conn, source)
}

#[tauri::command]
pub(crate) async fn update_remote_source(
    source: RemoteSourceInput,
    db_state: State<'_, DbState>,
) -> Result<RemoteSource, String> {
    let conn = db_state.conn.lock().map_err(|error| error.to_string())?;
    save_source(&conn, source)
}

#[tauri::command]
pub(crate) async fn remove_remote_source(
    source_id: String,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    let mut conn = db_state.conn.lock().map_err(|error| error.to_string())?;
    remove_source(&mut conn, &source_id)
}

#[tauri::command]
pub(crate) async fn sync_remote_source(
    app: AppHandle,
    source_id: String,
    db_state: State<'_, DbState>,
) -> Result<RemoteSyncResult, String> {
    let source = {
        let conn = db_state.conn.lock().map_err(|error| error.to_string())?;
        get_source(&conn, &source_id)?
    };

    scanner::sync_source(app, db_state.conn.clone(), source).await
}

#[tauri::command]
pub(crate) async fn precache_remote_song(
    app: AppHandle,
    remote_uri: String,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    if !cache::is_remote_uri(&remote_uri) {
        return Ok(());
    }
    cache::ensure_cached_path(&app, &db_state, &remote_uri)
        .await
        .map(|_| ())
}

#[tauri::command]
pub(crate) async fn get_remote_cache_usage(app: AppHandle) -> Result<RemoteCacheUsage, String> {
    cache::cache_usage(&app)
}

#[tauri::command]
pub(crate) async fn clear_remote_cache(app: AppHandle) -> Result<RemoteCacheUsage, String> {
    cache::clear_cache(&app)
}

#[tauri::command]
pub(crate) async fn list_remote_directory(
    source_id: Option<String>,
    source: Option<RemoteSourceInput>,
    path: String,
    db_state: State<'_, DbState>,
) -> Result<Vec<RemoteFileEntry>, String> {
    let source = match (source_id, source) {
        (Some(source_id), None) => {
            let conn = db_state.conn.lock().map_err(|error| error.to_string())?;
            get_source(&conn, &source_id)?
        }
        (None, Some(mut source)) => {
            if source.password.is_none() {
                if let Some(source_id) = source.id.as_deref() {
                    let conn = db_state.conn.lock().map_err(|error| error.to_string())?;
                    source.password = get_source(&conn, source_id)?.password;
                }
            }
            input_to_credentials(source)?
        }
        _ => return Err("请选择一个远程音乐源".to_string()),
    };
    webdav::list_directory(webdav::shared_client(), &source, &path).await
}
