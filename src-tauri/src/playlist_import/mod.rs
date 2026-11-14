mod matcher;
mod normalization;
mod sources;
mod types;
mod watcher;

use crate::database::DbState;
use crate::music::{
    scanner::{apply_scan_changes, parse_audio_files_internal, ScanOptions},
    utils::normalize_path,
};
use rusqlite::{params, params_from_iter, Connection};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use tauri::State;
pub use types::*;
pub(crate) use watcher::__cmd__configure_playlist_files;
pub use watcher::{configure_playlist_files, PlaylistFileWatcher};

// Only indexed songs from enabled remote libraries can enter an imported playlist.
const CATALOG_FILTER: &str = "(COALESCE(s.source_type, 'local') = 'local' OR (s.source_type = 'remote' AND rs.enabled = 1 AND s.path LIKE 'remote://%'))";

pub fn ensure_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS playlist_import_paths (playlist_id TEXT NOT NULL, path TEXT NOT NULL, PRIMARY KEY(playlist_id, path)); CREATE INDEX IF NOT EXISTS playlist_import_paths_path ON playlist_import_paths(path);").map_err(|e| e.to_string())
}

pub(crate) fn retained_paths(conn: &Connection) -> Result<HashSet<String>, String> {
    let mut paths = HashSet::new();
    if conn
        .table_exists(None, "playlist_import_paths")
        .map_err(|e| e.to_string())?
    {
        let mut stmt = conn
            .prepare("SELECT DISTINCT path FROM playlist_import_paths")
            .map_err(|e| e.to_string())?;
        for path in stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
        {
            paths.insert(normalize_path(&path.map_err(|e| e.to_string())?));
        }
    }
    Ok(paths)
}

pub(super) fn retain_paths(conn: &Connection, id: &str, paths: &[String]) -> Result<(), String> {
    conn.execute(
        "DELETE FROM playlist_import_paths WHERE playlist_id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    let mut statement = conn
        .prepare("INSERT OR IGNORE INTO playlist_import_paths (playlist_id, path) VALUES (?1, ?2)")
        .map_err(|e| e.to_string())?;
    for path in paths.iter().filter(|path| !path.contains("://")) {
        statement
            .execute(params![id, normalize_path(path)])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(super) fn index_paths(
    db: &Arc<Mutex<Connection>>,
    paths: &[String],
) -> Result<Vec<String>, String> {
    let normalized: Vec<String> = paths
        .iter()
        .filter(|p| !p.contains("://") || p.starts_with("remote://"))
        .map(|p| {
            if p.starts_with("remote://") {
                p.clone()
            } else {
                normalize_path(p)
            }
        })
        .collect();
    if normalized.is_empty() {
        return Ok(vec![]);
    }
    let mut known = HashMap::new();
    {
        let conn = db.lock().map_err(|e| e.to_string())?;
        for chunk in normalized.chunks(256) {
            let placeholders = vec!["?"; chunk.len()].join(",");
            let sql = format!("SELECT s.path, COALESCE(s.cue_source_path, s.path), COALESCE(s.source_type, 'local') = 'remote' FROM songs s LEFT JOIN remote_sources rs ON rs.id = s.remote_source_id WHERE {} AND s.path IN ({placeholders})", CATALOG_FILTER);
            let mut statement = conn.prepare(&sql).map_err(|e| e.to_string())?;
            for row in statement
                .query_map(params_from_iter(chunk.iter()), |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, bool>(2)?,
                    ))
                })
                .map_err(|e| e.to_string())?
            {
                let (path, physical, remote) = row.map_err(|e| e.to_string())?;
                known.insert(path, (physical, remote));
            }
        }
    }
    let missing: Vec<String> = normalized
        .iter()
        .filter(|p| !p.starts_with("remote://") && !known.contains_key(*p))
        .cloned()
        .collect();
    let songs = parse_audio_files_internal(missing, ScanOptions::default());
    for song in &songs {
        known.insert(
            song.path.clone(),
            (
                song.cue_source_path
                    .clone()
                    .unwrap_or_else(|| song.path.clone()),
                false,
            ),
        );
    }
    if !songs.is_empty() {
        let mut conn = db.lock().map_err(|e| e.to_string())?;
        apply_scan_changes(&mut conn, &songs, &[], &[], None)?;
    }
    Ok(normalized
        .into_iter()
        .filter(|path| {
            known.get(path).is_some_and(|(physical, remote)| {
                *remote || std::path::Path::new(physical).is_file()
            })
        })
        .collect())
}

#[tauri::command]
pub async fn read_playlist_source(input: SourceInput) -> Result<SourceDocument, String> {
    let text_format = input.text_format;
    let mut document = match input.kind.as_str() {
        "url" => tokio::time::timeout(
            std::time::Duration::from_secs(90),
            sources::read_url(&input.value),
        )
        .await
        .map_err(|_| "读取平台歌单超时，请重试或使用歌曲清单文件")?,
        "file" => tauri::async_runtime::spawn_blocking(move || {
            sources::read_file(&input.value, input.mapping.as_ref())
        })
        .await
        .map_err(|e| e.to_string())?,
        "text" => sources::parse_list(&input.value, "txt", "导入的歌单", "粘贴的歌曲清单"),
        _ => Err("不支持的歌单来源".into()),
    }?;
    for track in &mut document.tracks {
        if track.text_line.is_some() {
            track.text_format = text_format;
        }
    }
    Ok(document)
}

#[tauri::command]
pub async fn match_playlist_tracks(
    tracks: Vec<SourceTrack>,
    fields: Option<MatchFields>,
    db: State<'_, DbState>,
) -> Result<Vec<TrackMatch>, String> {
    if fields.is_some_and(|fields| !fields.title) {
        return Err("自定义匹配必须勾选歌名".into());
    }
    if tracks.len() > sources::MAX_TRACKS {
        return Err("单次最多匹配 10000 首歌曲".into());
    }
    if tracks.is_empty() {
        return Ok(vec![]);
    }
    let db = db.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let catalog = {
            let conn = db.lock().map_err(|e| e.to_string())?;
            matcher::catalog(&conn)?
        };
        matcher::match_tracks(&catalog, &tracks, fields)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn prepare_playlist_paths(
    playlist_id: String,
    paths: Vec<String>,
    db: State<'_, DbState>,
) -> Result<Vec<String>, String> {
    if paths.len() > sources::MAX_TRACKS {
        return Err("单次最多导入 10000 首歌曲".into());
    }
    let db = db.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = db.lock().map_err(|e| e.to_string())?;
        ensure_schema(&conn)?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        retain_paths(&tx, &playlist_id, &paths)?;
        tx.commit().map_err(|e| e.to_string())?;
        drop(conn);
        index_paths(&db, &paths)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn export_playlist_m3u8(
    path: String,
    paths: Vec<String>,
    relative: bool,
) -> Result<(), String> {
    if paths.len() > sources::MAX_TRACKS {
        return Err("单次最多导出 10000 首歌曲".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let target = std::path::PathBuf::from(&path);
        let parent = target.parent().ok_or("请选择完整的导出路径")?;
        let mut content = String::from("#EXTM3U\n");
        for path in paths {
            if path.contains(['\r', '\n']) {
                return Err("歌曲路径包含换行，无法写入 M3U8".into());
            }
            if path.contains("://") {
                content.push_str(&path);
                content.push('\n');
                continue;
            }
            let path = std::path::PathBuf::from(path);
            let output = if relative {
                pathdiff::diff_paths(&path, parent).unwrap_or(path)
            } else {
                path
            };
            content.push_str(&output.to_string_lossy().replace('\\', "/"));
            content.push('\n');
        }
        std::fs::write(target, content).map_err(|e| format!("导出歌单失败：{e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}
