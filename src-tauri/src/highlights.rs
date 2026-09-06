use crate::database::DbState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{BufReader, Read};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use uuid::Uuid;

const NEARBY_MARKER_MS: u64 = 2_000;
const END_GUARD_MS: u64 = 1_000;
const MAX_SECONDARY_MARKERS: usize = 3;

type SharedConnection = Arc<Mutex<Connection>>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongHighlightMarker {
    pub id: String,
    pub position_ms: u64,
    pub is_primary: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddSongHighlightResult {
    pub markers: Vec<SongHighlightMarker>,
    pub marker_id: String,
    pub created: bool,
    pub previous_position_ms: Option<u64>,
}

#[derive(Debug, Clone)]
struct FileSignature {
    size: u64,
    modified_at: i64,
}

fn unix_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

fn file_signature(path: &str) -> Result<FileSignature, String> {
    let metadata = std::fs::metadata(path).map_err(|_| "找不到本地歌曲文件".to_string())?;
    if !metadata.is_file() {
        return Err("当前歌曲不是可打点的本地文件".to_string());
    }

    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0);

    Ok(FileSignature {
        size: metadata.len(),
        modified_at,
    })
}

fn hash_file(path: &str) -> Result<String, String> {
    let file = File::open(path).map_err(|_| "无法读取本地歌曲文件".to_string())?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 128 * 1024];

    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(|_| "计算歌曲内容指纹失败".to_string())?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }

    Ok(hex::encode(hasher.finalize()))
}

fn mapped_hash(
    db: &SharedConnection,
    path: &str,
    signature: &FileSignature,
) -> Result<Option<String>, String> {
    let conn = db.lock().map_err(|error| error.to_string())?;
    conn.query_row(
        "SELECT content_hash, file_size, file_modified_at
         FROM song_highlight_paths WHERE path = ?1",
        [path],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        },
    )
    .optional()
    .map_err(|error| error.to_string())
    .map(|mapping| {
        mapping.and_then(|(content_hash, size, modified_at)| {
            (size == signature.size as i64 && modified_at == signature.modified_at)
                .then_some(content_hash)
        })
    })
}

fn has_identity_with_size(db: &SharedConnection, size: u64) -> Result<bool, String> {
    let conn = db.lock().map_err(|error| error.to_string())?;
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM song_highlight_identities WHERE file_size = ?1)",
        [size.min(i64::MAX as u64) as i64],
        |row| row.get(0),
    )
    .map_err(|error| error.to_string())
}

fn remember_identity(
    db: &SharedConnection,
    path: &str,
    signature: &FileSignature,
    content_hash: &str,
    create_identity: bool,
) -> Result<bool, String> {
    let mut conn = db.lock().map_err(|error| error.to_string())?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM song_highlight_identities WHERE content_hash = ?1)",
            [content_hash],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;

    if !exists && !create_identity {
        return Ok(false);
    }

    let now = unix_millis();
    if !exists {
        tx.execute(
            "INSERT INTO song_highlight_identities
                (content_hash, file_size, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3)",
            params![
                content_hash,
                signature.size.min(i64::MAX as u64) as i64,
                now
            ],
        )
        .map_err(|error| error.to_string())?;
    } else {
        tx.execute(
            "UPDATE song_highlight_identities SET updated_at = ?2 WHERE content_hash = ?1",
            params![content_hash, now],
        )
        .map_err(|error| error.to_string())?;
    }

    tx.execute(
        "INSERT INTO song_highlight_paths (path, content_hash, file_size, file_modified_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(path) DO UPDATE SET
            content_hash = excluded.content_hash,
            file_size = excluded.file_size,
            file_modified_at = excluded.file_modified_at",
        params![
            path,
            content_hash,
            signature.size.min(i64::MAX as u64) as i64,
            signature.modified_at
        ],
    )
    .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(true)
}

async fn resolve_content_hash(
    db: SharedConnection,
    path: String,
    create_identity: bool,
) -> Result<Option<String>, String> {
    if path.contains("::track") {
        return Err("CUE 分轨暂不支持高潮打点".to_string());
    }

    let signature_path = path.clone();
    let signature = tokio::task::spawn_blocking(move || file_signature(&signature_path))
        .await
        .map_err(|error| error.to_string())??;

    if let Some(content_hash) = mapped_hash(&db, &path, &signature)? {
        return Ok(Some(content_hash));
    }

    if !create_identity && !has_identity_with_size(&db, signature.size)? {
        return Ok(None);
    }

    let hash_path = path.clone();
    let content_hash = tokio::task::spawn_blocking(move || hash_file(&hash_path))
        .await
        .map_err(|error| error.to_string())??;

    if remember_identity(&db, &path, &signature, &content_hash, create_identity)? {
        Ok(Some(content_hash))
    } else {
        Ok(None)
    }
}

fn list_markers(
    db: &SharedConnection,
    content_hash: &str,
) -> Result<Vec<SongHighlightMarker>, String> {
    let conn = db.lock().map_err(|error| error.to_string())?;
    let mut statement = conn
        .prepare(
            "SELECT id, position_ms, is_primary
             FROM song_highlight_markers
             WHERE content_hash = ?1
             ORDER BY position_ms ASC, id ASC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([content_hash], |row| {
            Ok(SongHighlightMarker {
                id: row.get(0)?,
                position_ms: row.get::<_, i64>(1)?.max(0) as u64,
                is_primary: row.get::<_, i64>(2)? != 0,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn validate_position(position_ms: u64, duration_ms: u64) -> Result<(), String> {
    if duration_ms < END_GUARD_MS || position_ms > duration_ms - END_GUARD_MS {
        return Err("距离歌曲结尾不足 1 秒，无法设置高潮点".to_string());
    }
    Ok(())
}

fn validate_marker_spacing(
    markers: &[SongHighlightMarker],
    marker_id: &str,
    position_ms: u64,
) -> Result<(), String> {
    if markers.iter().any(|marker| {
        marker.id != marker_id && marker.position_ms.abs_diff(position_ms) < NEARBY_MARKER_MS
    }) {
        return Err("与其他标记距离不能小于 2 秒".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn get_song_highlight_markers(
    path: String,
    db: State<'_, DbState>,
) -> Result<Vec<SongHighlightMarker>, String> {
    let shared = db.conn.clone();
    let Some(content_hash) = resolve_content_hash(shared.clone(), path, false).await? else {
        return Ok(Vec::new());
    };
    list_markers(&shared, &content_hash)
}

#[tauri::command]
pub async fn add_song_highlight_marker(
    path: String,
    position_ms: u64,
    duration_ms: u64,
    db: State<'_, DbState>,
) -> Result<AddSongHighlightResult, String> {
    validate_position(position_ms, duration_ms)?;
    let shared = db.conn.clone();
    let content_hash = resolve_content_hash(shared.clone(), path, true)
        .await?
        .ok_or_else(|| "无法创建歌曲内容指纹".to_string())?;
    let markers = list_markers(&shared, &content_hash)?;

    if let Some(nearest) = markers
        .iter()
        .filter(|marker| marker.position_ms.abs_diff(position_ms) < NEARBY_MARKER_MS)
        .min_by_key(|marker| marker.position_ms.abs_diff(position_ms))
    {
        validate_marker_spacing(&markers, &nearest.id, position_ms)?;
        let previous_position_ms = nearest.position_ms;
        let conn = shared.lock().map_err(|error| error.to_string())?;
        conn.execute(
            "UPDATE song_highlight_markers SET position_ms = ?2, updated_at = ?3 WHERE id = ?1",
            params![
                nearest.id,
                position_ms.min(i64::MAX as u64) as i64,
                unix_millis()
            ],
        )
        .map_err(|error| error.to_string())?;
        drop(conn);
        return Ok(AddSongHighlightResult {
            markers: list_markers(&shared, &content_hash)?,
            marker_id: nearest.id.clone(),
            created: false,
            previous_position_ms: Some(previous_position_ms),
        });
    }

    let has_primary = markers.iter().any(|marker| marker.is_primary);
    let secondary_count = markers.iter().filter(|marker| !marker.is_primary).count();
    if has_primary && secondary_count >= MAX_SECONDARY_MARKERS {
        return Err("普通标记最多添加 3 个".to_string());
    }

    let marker_id = Uuid::new_v4().to_string();
    let now = unix_millis();
    let conn = shared.lock().map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT INTO song_highlight_markers
            (id, content_hash, position_ms, is_primary, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![
            marker_id,
            content_hash,
            position_ms.min(i64::MAX as u64) as i64,
            (!has_primary) as i64,
            now
        ],
    )
    .map_err(|error| error.to_string())?;
    drop(conn);

    Ok(AddSongHighlightResult {
        markers: list_markers(&shared, &content_hash)?,
        marker_id,
        created: true,
        previous_position_ms: None,
    })
}

#[tauri::command]
pub async fn set_song_highlight_marker_position(
    path: String,
    marker_id: String,
    position_ms: u64,
    duration_ms: u64,
    db: State<'_, DbState>,
) -> Result<Vec<SongHighlightMarker>, String> {
    validate_position(position_ms, duration_ms)?;
    let shared = db.conn.clone();
    let content_hash = resolve_content_hash(shared.clone(), path, false)
        .await?
        .ok_or_else(|| "找不到歌曲高潮标记".to_string())?;
    let markers = list_markers(&shared, &content_hash)?;
    if !markers.iter().any(|marker| marker.id == marker_id) {
        return Err("找不到歌曲高潮标记".to_string());
    }
    validate_marker_spacing(&markers, &marker_id, position_ms)?;

    let conn = shared.lock().map_err(|error| error.to_string())?;
    conn.execute(
        "UPDATE song_highlight_markers SET position_ms = ?2, updated_at = ?3
         WHERE id = ?1 AND content_hash = ?4",
        params![
            marker_id,
            position_ms.min(i64::MAX as u64) as i64,
            unix_millis(),
            content_hash
        ],
    )
    .map_err(|error| error.to_string())?;
    drop(conn);
    list_markers(&shared, &content_hash)
}

#[tauri::command]
pub async fn set_song_highlight_primary(
    path: String,
    marker_id: String,
    db: State<'_, DbState>,
) -> Result<Vec<SongHighlightMarker>, String> {
    let shared = db.conn.clone();
    let content_hash = resolve_content_hash(shared.clone(), path, false)
        .await?
        .ok_or_else(|| "找不到歌曲高潮标记".to_string())?;
    let mut conn = shared.lock().map_err(|error| error.to_string())?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let belongs: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM song_highlight_markers WHERE id = ?1 AND content_hash = ?2)",
            params![marker_id, content_hash],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !belongs {
        return Err("找不到歌曲高潮标记".to_string());
    }
    tx.execute(
        "UPDATE song_highlight_markers SET is_primary = 0, updated_at = ?2 WHERE content_hash = ?1",
        params![content_hash, unix_millis()],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "UPDATE song_highlight_markers SET is_primary = 1, updated_at = ?2 WHERE id = ?1",
        params![marker_id, unix_millis()],
    )
    .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())?;
    drop(conn);
    list_markers(&shared, &content_hash)
}

#[tauri::command]
pub async fn delete_song_highlight_marker(
    path: String,
    marker_id: String,
    db: State<'_, DbState>,
) -> Result<Vec<SongHighlightMarker>, String> {
    let shared = db.conn.clone();
    let content_hash = resolve_content_hash(shared.clone(), path, false)
        .await?
        .ok_or_else(|| "找不到歌曲高潮标记".to_string())?;
    let conn = shared.lock().map_err(|error| error.to_string())?;
    conn.execute(
        "DELETE FROM song_highlight_markers WHERE id = ?1 AND content_hash = ?2",
        params![marker_id, content_hash],
    )
    .map_err(|error| error.to_string())?;
    drop(conn);
    list_markers(&shared, &content_hash)
}

#[tauri::command]
pub async fn undo_song_highlight_add(
    path: String,
    marker_id: String,
    created: bool,
    previous_position_ms: Option<u64>,
    db: State<'_, DbState>,
) -> Result<Vec<SongHighlightMarker>, String> {
    let shared = db.conn.clone();
    let content_hash = resolve_content_hash(shared.clone(), path, false)
        .await?
        .ok_or_else(|| "找不到歌曲高潮标记".to_string())?;
    let conn = shared.lock().map_err(|error| error.to_string())?;
    if created {
        conn.execute(
            "DELETE FROM song_highlight_markers WHERE id = ?1 AND content_hash = ?2",
            params![marker_id, content_hash],
        )
        .map_err(|error| error.to_string())?;
    } else if let Some(position_ms) = previous_position_ms {
        conn.execute(
            "UPDATE song_highlight_markers SET position_ms = ?2, updated_at = ?3
             WHERE id = ?1 AND content_hash = ?4",
            params![
                marker_id,
                position_ms.min(i64::MAX as u64) as i64,
                unix_millis(),
                content_hash
            ],
        )
        .map_err(|error| error.to_string())?;
    }
    drop(conn);
    list_markers(&shared, &content_hash)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_positions_inside_the_final_second() {
        assert!(validate_position(9_001, 10_000).is_err());
        assert!(validate_position(9_000, 10_000).is_ok());
    }

    #[test]
    fn rejects_marker_spacing_below_two_seconds() {
        let markers = vec![SongHighlightMarker {
            id: "existing".to_string(),
            position_ms: 5_000,
            is_primary: true,
        }];
        assert!(validate_marker_spacing(&markers, "moving", 6_999).is_err());
        assert!(validate_marker_spacing(&markers, "moving", 7_000).is_ok());
    }
}
