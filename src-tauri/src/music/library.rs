// music/library.rs - 音乐库管理命令

use super::scanner::ScanOptions;
use super::scanner::{scan_folder_recursive, scan_single_directory_internal};
use super::types::{
    AlbumCatalogItem, ArtistCatalogItem, FolderNode, LibraryFolder, LibrarySong,
    SongQualityMetadata,
};
use super::utils::{descendant_like_patterns, is_dot_prefixed_path, normalize_path};
use crate::database::DbState;
use serde::Deserialize;
use std::path::PathBuf;
use std::time::SystemTime;
use tauri::{AppHandle, State};

fn clamp_i64_to_u32(v: i64) -> u32 {
    if v <= 0 {
        0
    } else if v > u32::MAX as i64 {
        u32::MAX
    } else {
        v as u32
    }
}

fn i64_to_u64_opt(v: Option<i64>) -> Option<u64> {
    v.filter(|x| *x >= 0).map(|x| x as u64)
}

fn i64_to_u8_opt(v: Option<i64>) -> Option<u8> {
    v.filter(|x| *x >= 0 && *x <= u8::MAX as i64)
        .map(|x| x as u8)
}

fn clamp_i64_to_u32_count(v: i64) -> u32 {
    if v <= 0 {
        0
    } else if v > u32::MAX as i64 {
        u32::MAX
    } else {
        v as u32
    }
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum LibrarySongSortMode {
    Title,
    Artist,
    AddedAt,
    AddedAtAsc,
    FileModifiedAt,
    FileModifiedAtAsc,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum FolderSongSortMode {
    Title,
    Name,
    Artist,
    AddedAt,
    AddedAtAsc,
    TrackNumber,
}

#[derive(Debug)]
struct FolderViewSongRow {
    path: String,
    title: String,
    artist: String,
    album: String,
    album_artist: String,
    artist_names: Vec<String>,
    effective_artist_names: Vec<String>,
    added_at: Option<u64>,
    track_number: Option<String>,
    disc_number: Option<String>,
}

fn deserialize_string_list(raw: Option<String>) -> Vec<String> {
    raw.and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
        .unwrap_or_default()
}

fn is_descendant_path(song_path: &str, folder_path: &str) -> bool {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let sp_lower = song_path.to_lowercase();
        let fp_lower = folder_path.to_lowercase();
        sp_lower == fp_lower
            || sp_lower.starts_with(&format!("{fp_lower}\\"))
            || sp_lower.starts_with(&format!("{fp_lower}/"))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        song_path == folder_path
            || song_path.starts_with(&format!("{folder_path}\\"))
            || song_path.starts_with(&format!("{folder_path}/"))
    }
}

fn remove_library_folder_from_conn(
    conn: &mut rusqlite::Connection,
    folder_path: &str,
) -> Result<Vec<String>, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    let delete_folder_sql = "DELETE FROM library_folders WHERE path = ?1 COLLATE NOCASE";
    #[cfg(not(target_os = "windows"))]
    let delete_folder_sql = "DELETE FROM library_folders WHERE path = ?1";

    tx.execute(delete_folder_sql, [folder_path])
        .map_err(|e| e.to_string())?;

    let remaining_roots = {
        let mut stmt = tx
            .prepare("SELECT path FROM library_folders")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect::<Vec<_>>();
        rows
    };

    let (forward_like, backward_like) = descendant_like_patterns(folder_path);
    let candidate_paths = {
        #[cfg(target_os = "windows")]
        let query_songs_sql = "SELECT path FROM songs WHERE path = ?1 COLLATE NOCASE OR path LIKE ?2 ESCAPE '^' OR path LIKE ?3 ESCAPE '^'";
        #[cfg(not(target_os = "windows"))]
        let query_songs_sql = "SELECT path FROM songs WHERE path = ?1 OR path LIKE ?2 ESCAPE '^' OR path LIKE ?3 ESCAPE '^'";

        let mut stmt = tx
            .prepare(query_songs_sql)
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(
                rusqlite::params![folder_path, forward_like, backward_like],
                |row| row.get::<_, String>(0),
            )
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect::<Vec<_>>();
        rows
    };

    let deleted_paths = candidate_paths
        .into_iter()
        .filter(|path| {
            !remaining_roots
                .iter()
                .any(|root| is_descendant_path(path, root))
        })
        .collect::<Vec<_>>();

    {
        #[cfg(target_os = "windows")]
        let delete_song_sql = "DELETE FROM songs WHERE path = ?1 COLLATE NOCASE";
        #[cfg(not(target_os = "windows"))]
        let delete_song_sql = "DELETE FROM songs WHERE path = ?1";

        let mut delete_stmt = tx
            .prepare(delete_song_sql)
            .map_err(|e| e.to_string())?;
        for path in &deleted_paths {
            delete_stmt
                .execute([path])
                .map_err(|e| format!("delete failed for '{}': {}", path, e))?;
        }
    }

    tx.execute(
        "DELETE FROM artists
         WHERE id NOT IN (SELECT DISTINCT artist_id FROM song_artists)",
        [],
    )
    .ok();

    tx.commit().map_err(|e| e.to_string())?;
    Ok(deleted_paths)
}

fn cleanup_orphaned_local_songs(conn: &rusqlite::Connection) -> Result<Vec<String>, String> {
    let folder_roots: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT path FROM library_folders")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.filter_map(Result::ok).collect()
    };

    let local_song_paths: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT path FROM songs WHERE COALESCE(source_type, 'local') = 'local'")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.filter_map(Result::ok).collect()
    };

    let delete_paths = local_song_paths
        .into_iter()
        .filter(|path| {
            !folder_roots
                .iter()
                .any(|root| is_descendant_path(path, root))
        })
        .collect::<Vec<_>>();

    if delete_paths.is_empty() {
        return Ok(delete_paths);
    }

    #[cfg(target_os = "windows")]
    let delete_song_sql = "DELETE FROM songs WHERE path = ?1 COLLATE NOCASE";
    #[cfg(not(target_os = "windows"))]
    let delete_song_sql = "DELETE FROM songs WHERE path = ?1";

    {
        let mut delete_stmt = conn
            .prepare(delete_song_sql)
            .map_err(|e| e.to_string())?;
        for path in &delete_paths {
            delete_stmt
                .execute([path])
                .map_err(|e| format!("delete failed for '{}': {}", path, e))?;
        }
    }

    let _ = conn.execute(
        "DELETE FROM artists
         WHERE id NOT IN (SELECT DISTINCT artist_id FROM song_artists)",
        [],
    );

    Ok(delete_paths)
}

fn normalize_for_compare(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_string()
}

fn is_direct_child_path(parent_path: &str, child_path: &str) -> bool {
    let normalized_parent = normalize_for_compare(parent_path);
    let normalized_child = child_path.replace('\\', "/");

    match normalized_child.rfind('/') {
        Some(index) => normalized_child[..index] == normalized_parent,
        None => false,
    }
}

fn file_name_from_path(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

fn song_title_label(title: &str, path: &str) -> String {
    if title.trim().is_empty() {
        file_name_from_path(path)
    } else {
        title.to_string()
    }
}

fn preferred_artist_search_names(row: &FolderViewSongRow) -> Vec<String> {
    if !row.effective_artist_names.is_empty() {
        return row.effective_artist_names.clone();
    }

    if !row.artist_names.is_empty() {
        return row.artist_names.clone();
    }

    vec![row.artist.clone()]
}

fn folder_song_matches_query(row: &FolderViewSongRow, query: &str) -> bool {
    let lowered_query = query.trim().to_lowercase();
    if lowered_query.is_empty() {
        return true;
    }

    file_name_from_path(&row.path)
        .to_lowercase()
        .contains(&lowered_query)
        || row.title.to_lowercase().contains(&lowered_query)
        || row.artist.to_lowercase().contains(&lowered_query)
        || row.album.to_lowercase().contains(&lowered_query)
        || row.album_artist.to_lowercase().contains(&lowered_query)
        || preferred_artist_search_names(row)
            .iter()
            .any(|name| name.to_lowercase().contains(&lowered_query))
}

fn load_cached_songs(conn: &rusqlite::Connection) -> Result<Vec<LibrarySong>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT path, title, artist, artist_names, effective_artist_names, album, album_artist, album_key, is_various_artists_album, collapse_artist_credits, duration, cover_thumb_path, track_number, disc_number, added_at, file_modified_at, source_type
             FROM songs",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            let path: String = row.get(0)?;
            let duration = clamp_i64_to_u32(row.get::<_, Option<i64>>(10)?.unwrap_or(0));
            let cover_thumb_path = row.get::<_, Option<String>>(11)?;
            let track_number = row.get::<_, Option<String>>(12)?;
            let disc_number = row.get::<_, Option<String>>(13)?;
            let added_at_i64 = row.get::<_, Option<i64>>(14)?;
            let file_modified_at_i64 = row.get::<_, Option<i64>>(15)?;
            let artist_names = deserialize_string_list(row.get::<_, Option<String>>(3)?);
            let effective_artist_names = deserialize_string_list(row.get::<_, Option<String>>(4)?);

            let name = std::path::Path::new(&path)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.clone());

            Ok(LibrarySong {
                name,
                path,
                title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                artist: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                artist_names,
                effective_artist_names,
                album: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                album_artist: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                album_key: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                is_various_artists_album: row.get::<_, Option<i64>>(8)?.unwrap_or(0) != 0,
                collapse_artist_credits: row.get::<_, Option<i64>>(9)?.unwrap_or(0) != 0,
                duration,
                cover_thumb_path,
                track_number,
                disc_number,
                added_at: i64_to_u64_opt(added_at_i64),
                file_modified_at: i64_to_u64_opt(file_modified_at_i64),
                source_type: row
                    .get::<_, Option<String>>(16)?
                    .unwrap_or_else(|| "local".to_string()),
            })
        })
        .map_err(|e| e.to_string())?;

    let mut songs: Vec<LibrarySong> = rows.filter_map(|row| row.ok()).collect();
    songs.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(songs)
}

const ALBUM_CATALOG_SQL: &str = "WITH normalized_songs AS (
                    SELECT
                        id,
                        path,
                        added_at,
                        COALESCE(NULLIF(TRIM(album_key), ''), '') AS album_key,
                        COALESCE(NULLIF(TRIM(album), ''), 'Unknown') AS album_name,
                        COALESCE(NULLIF(TRIM(album_artist), ''), NULLIF(TRIM(artist), ''), 'Unknown') AS album_artist_name
                    FROM songs
                 ),
                 ranked_songs AS (
                    SELECT
                        album_key,
                        album_name,
                        album_artist_name,
                        path,
                        COUNT(*) OVER (
                            PARTITION BY album_key, album_name, album_artist_name
                        ) AS song_count,
                        ROW_NUMBER() OVER (
                            PARTITION BY album_key, album_name, album_artist_name
                            ORDER BY added_at DESC, id ASC
                        ) AS representative_rank
                    FROM normalized_songs
                 )
                 SELECT
                    album_key,
                    album_name,
                    album_artist_name,
                    song_count,
                    path AS first_song_path
                 FROM ranked_songs
                 WHERE representative_rank = 1
                 ORDER BY album_name COLLATE NOCASE ASC, album_artist_name COLLATE NOCASE ASC";

fn load_album_catalog(conn: &rusqlite::Connection) -> Result<Vec<AlbumCatalogItem>, String> {
    let mut stmt = conn.prepare(ALBUM_CATALOG_SQL).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let album_key = row.get::<_, String>(0)?;
            let album_name = row.get::<_, String>(1)?;
            let album_artist_name = row.get::<_, String>(2)?;
            let key = if album_key.trim().is_empty() {
                format!(
                    "{}::{}",
                    album_name.to_ascii_lowercase(),
                    album_artist_name.to_ascii_lowercase()
                )
            } else {
                album_key
            };

            Ok(AlbumCatalogItem {
                key,
                name: album_name,
                count: clamp_i64_to_u32_count(row.get::<_, i64>(3)?),
                artist: album_artist_name,
                first_song_path: row.get::<_, String>(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(Result::ok).collect())
}

#[tauri::command]
pub async fn get_library_folders(
    db_state: State<'_, DbState>,
) -> Result<Vec<LibraryFolder>, String> {
    let db_conn = db_state.conn.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT path FROM library_folders ORDER BY added_at DESC")
            .map_err(|e| e.to_string())?;

        let paths: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        let mut song_stmt = conn
            .prepare("SELECT path FROM songs")
            .map_err(|e| e.to_string())?;
        let song_paths: Vec<String> = song_stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        let mut folders = Vec::with_capacity(paths.len());
        for folder_path in paths {
            let count = song_paths
                .iter()
                .filter(|song_path| is_descendant_path(song_path, &folder_path))
                .count();

            folders.push(LibraryFolder {
                path: folder_path,
                song_count: count,
            });
        }
        Ok::<Vec<LibraryFolder>, String>(folders)
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(result)
}

#[tauri::command]
pub async fn add_library_folder(path: String, db_state: State<'_, DbState>) -> Result<(), String> {
    let db_conn = db_state.conn.clone();
    let normalized = normalize_path(&path);

    tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO library_folders (path, added_at) VALUES (?1, ?2)",
            [
                &normalized,
                &SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap()
                    .as_secs()
                    .to_string(),
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(())
}

#[tauri::command]
pub async fn remove_library_folder(
    path: String,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    let db_conn = db_state.conn.clone();
    let normalized = normalize_path(&path);

    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = db_conn.lock().map_err(|e| e.to_string())?;
        remove_library_folder_from_conn(&mut conn, &normalized)?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(())
}

#[tauri::command]
pub async fn get_library_songs_cached(
    db_state: State<'_, DbState>,
) -> Result<Vec<LibrarySong>, String> {
    let db_conn = db_state.conn.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|e| e.to_string())?;
        load_cached_songs(&conn)
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(result)
}

fn load_song_quality_metadata(
    conn: &rusqlite::Connection,
    paths: &[String],
) -> Result<Vec<SongQualityMetadata>, String> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = std::iter::repeat_n("?", paths.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT path, bitrate, sample_rate, bit_depth, format
         FROM songs
         WHERE path IN ({placeholders})"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(paths.iter()), |row| {
            Ok(SongQualityMetadata {
                path: row.get(0)?,
                bitrate: clamp_i64_to_u32(row.get::<_, Option<i64>>(1)?.unwrap_or(0)),
                sample_rate: clamp_i64_to_u32(row.get::<_, Option<i64>>(2)?.unwrap_or(0)),
                bit_depth: i64_to_u8_opt(row.get::<_, Option<i64>>(3)?),
                format: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(Result::ok).collect())
}

#[tauri::command]
pub async fn get_song_quality_metadata(
    paths: Vec<String>,
    db_state: State<'_, DbState>,
) -> Result<Vec<SongQualityMetadata>, String> {
    const MAX_PATHS_PER_REQUEST: usize = 256;
    if paths.len() > MAX_PATHS_PER_REQUEST {
        return Err(format!(
            "Too many song quality paths: {} (max {})",
            paths.len(),
            MAX_PATHS_PER_REQUEST
        ));
    }

    let db_conn = db_state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|e| e.to_string())?;
        load_song_quality_metadata(&conn, &paths)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_library_artist_catalog(
    db_state: State<'_, DbState>,
) -> Result<Vec<ArtistCatalogItem>, String> {
    let db_conn = db_state.conn.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT artists.id,
                        artists.name,
                        COUNT(song_artists.song_id) AS song_count,
                        COALESCE((
                            SELECT songs.path
                            FROM song_artists AS nested_song_artists
                            JOIN songs ON songs.id = nested_song_artists.song_id
                            WHERE nested_song_artists.artist_id = artists.id
                            ORDER BY songs.added_at DESC, songs.id ASC
                            LIMIT 1
                        ), ''),
                        artists.avatar_path
                 FROM artists
                 JOIN song_artists ON song_artists.artist_id = artists.id
                 GROUP BY artists.id, artists.name
                 ORDER BY artists.name COLLATE NOCASE ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(ArtistCatalogItem {
                    id: row.get::<_, i64>(0)?,
                    name: row.get::<_, String>(1)?,
                    count: clamp_i64_to_u32_count(row.get::<_, i64>(2)?),
                    first_song_path: row.get::<_, String>(3)?,
                    avatar_path: row.get::<_, Option<String>>(4)?,
                })
            })
            .map_err(|e| e.to_string())?;

        Ok::<Vec<ArtistCatalogItem>, String>(rows.filter_map(Result::ok).collect())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(result)
}

#[tauri::command]
pub async fn get_library_album_catalog(
    db_state: State<'_, DbState>,
) -> Result<Vec<AlbumCatalogItem>, String> {
    let db_conn = db_state.conn.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|e| e.to_string())?;
        load_album_catalog(&conn)
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(result)
}

#[tauri::command]
pub async fn get_library_song_paths_by_artist(
    artist_name: String,
    db_state: State<'_, DbState>,
) -> Result<Vec<String>, String> {
    let db_conn = db_state.conn.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT songs.path
                 FROM songs
                 JOIN song_artists ON song_artists.song_id = songs.id
                 JOIN artists ON artists.id = song_artists.artist_id
                 WHERE artists.name = ?1 COLLATE NOCASE
                 GROUP BY songs.id, songs.path
                 ORDER BY COALESCE(NULLIF(TRIM(songs.title), ''), songs.path) COLLATE NOCASE ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([artist_name], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;

        Ok::<Vec<String>, String>(rows.filter_map(Result::ok).collect())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(result)
}

#[tauri::command]
pub async fn get_library_song_paths_by_album(
    album_key: String,
    db_state: State<'_, DbState>,
) -> Result<Vec<String>, String> {
    let db_conn = db_state.conn.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT path
                 FROM songs
                 WHERE LOWER(
                    COALESCE(
                      NULLIF(TRIM(album_key), ''),
                      COALESCE(NULLIF(TRIM(album), ''), 'Unknown') || '::' ||
                      COALESCE(NULLIF(TRIM(album_artist), ''), NULLIF(TRIM(artist), ''), 'Unknown')
                    )
                 ) = LOWER(?1)
                 ORDER BY COALESCE(NULLIF(TRIM(title), ''), path) COLLATE NOCASE ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([album_key], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;

        Ok::<Vec<String>, String>(rows.filter_map(Result::ok).collect())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(result)
}

#[tauri::command]
pub async fn get_library_song_paths_for_all_view(
    query: Option<String>,
    artist_filter: Option<String>,
    album_filter: Option<String>,
    sort_mode: LibrarySongSortMode,
    db_state: State<'_, DbState>,
) -> Result<Vec<String>, String> {
    let db_conn = db_state.conn.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|e| e.to_string())?;
        let mut sql = String::from(
            "SELECT songs.path
             FROM songs
             WHERE 1 = 1",
        );
        let mut params: Vec<String> = Vec::new();

        if let Some(artist_name) = artist_filter
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        {
            sql.push_str(
                " AND EXISTS (
                    SELECT 1
                    FROM song_artists
                    JOIN artists ON artists.id = song_artists.artist_id
                    WHERE song_artists.song_id = songs.id
                      AND artists.name = ? COLLATE NOCASE
                )",
            );
            params.push(artist_name);
        }

        if let Some(album_key) = album_filter
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        {
            sql.push_str(
                " AND LOWER(
                    COALESCE(
                      NULLIF(TRIM(songs.album_key), ''),
                      COALESCE(NULLIF(TRIM(songs.album), ''), 'Unknown') || '::' ||
                      COALESCE(NULLIF(TRIM(songs.album_artist), ''), NULLIF(TRIM(songs.artist), ''), 'Unknown')
                    )
                ) = LOWER(?)",
            );
            params.push(album_key);
        }

        if let Some(search_query) = query
            .map(|value| value.trim().to_lowercase())
            .filter(|value| !value.is_empty())
        {
            let like = format!("%{}%", search_query);
            sql.push_str(
                " AND (
                    LOWER(COALESCE(songs.title, '')) LIKE ?
                    OR LOWER(COALESCE(songs.artist, '')) LIKE ?
                    OR LOWER(COALESCE(songs.album, '')) LIKE ?
                    OR LOWER(COALESCE(songs.album_artist, '')) LIKE ?
                    OR LOWER(COALESCE(songs.path, '')) LIKE ?
                    OR EXISTS (
                        SELECT 1
                        FROM song_artists
                        JOIN artists ON artists.id = song_artists.artist_id
                        WHERE song_artists.song_id = songs.id
                          AND LOWER(artists.name) LIKE ?
                    )
                )",
            );
            for _ in 0..6 {
                params.push(like.clone());
            }
        }

        match sort_mode {
            LibrarySongSortMode::Title => {
                sql.push_str(
                    " ORDER BY COALESCE(NULLIF(TRIM(songs.title), ''), songs.path) COLLATE NOCASE ASC",
                );
            }
            LibrarySongSortMode::Artist => {
                sql.push_str(
                    " ORDER BY COALESCE(NULLIF(TRIM(songs.artist), ''), 'Unknown') COLLATE NOCASE ASC,
                             COALESCE(NULLIF(TRIM(songs.title), ''), songs.path) COLLATE NOCASE ASC",
                );
            }
            LibrarySongSortMode::AddedAt => {
                sql.push_str(
                    " ORDER BY COALESCE(songs.added_at, 0) DESC,
                             COALESCE(NULLIF(TRIM(songs.title), ''), songs.path) COLLATE NOCASE ASC",
                );
            }
            LibrarySongSortMode::AddedAtAsc => {
                sql.push_str(
                    " ORDER BY COALESCE(songs.added_at, 0) ASC,
                             COALESCE(NULLIF(TRIM(songs.title), ''), songs.path) COLLATE NOCASE ASC",
                );
            }
            LibrarySongSortMode::FileModifiedAt => {
                sql.push_str(
                    " ORDER BY COALESCE(songs.file_modified_at, 0) DESC,
                             COALESCE(NULLIF(TRIM(songs.title), ''), songs.path) COLLATE NOCASE ASC",
                );
            }
            LibrarySongSortMode::FileModifiedAtAsc => {
                sql.push_str(
                    " ORDER BY COALESCE(songs.file_modified_at, 0) ASC,
                             COALESCE(NULLIF(TRIM(songs.title), ''), songs.path) COLLATE NOCASE ASC",
                );
            }
        }

        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(params.iter()), |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;

        Ok::<Vec<String>, String>(rows.filter_map(Result::ok).collect())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(result)
}

fn parse_track_or_disc_number(val: &Option<String>) -> Option<i32> {
    val.as_ref().and_then(|s| {
        let digits: String = s.chars()
            .skip_while(|c| !c.is_ascii_digit())
            .take_while(|c| c.is_ascii_digit())
            .collect();
        digits.parse::<i32>().ok()
    })
}

#[tauri::command]
pub async fn get_library_song_paths_for_folder_view(
    folder_path: String,
    query: Option<String>,
    sort_mode: FolderSongSortMode,
    db_state: State<'_, DbState>,
) -> Result<Vec<String>, String> {
    let db_conn = db_state.conn.clone();
    let normalized_folder = normalize_path(&folder_path);

    let result = tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|e| e.to_string())?;
        let (forward_like, backward_like) = super::utils::descendant_like_patterns(&normalized_folder);
        let mut stmt = conn
            .prepare(
                "SELECT path, title, artist, artist_names, effective_artist_names, album, album_artist, added_at, track_number, disc_number
                 FROM songs
                 WHERE path = ?1
                    OR path LIKE ?2 ESCAPE '^'
                    OR path LIKE ?3 ESCAPE '^'",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(
                rusqlite::params![normalized_folder, forward_like, backward_like],
                |row| {
                    Ok(FolderViewSongRow {
                        path: row.get::<_, String>(0)?,
                        title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                        artist: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                        artist_names: deserialize_string_list(row.get::<_, Option<String>>(3)?),
                        effective_artist_names: deserialize_string_list(row.get::<_, Option<String>>(4)?),
                        album: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                        album_artist: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                        added_at: i64_to_u64_opt(row.get::<_, Option<i64>>(7)?),
                        track_number: row.get::<_, Option<String>>(8)?,
                        disc_number: row.get::<_, Option<String>>(9)?,
                    })
                },
            )
            .map_err(|e| e.to_string())?;

        let lowered_query = query.map(|value| value.trim().to_lowercase());
        let mut song_rows: Vec<FolderViewSongRow> = rows
            .filter_map(Result::ok)
            .filter(|row| is_direct_child_path(&normalized_folder, &row.path))
            .filter(|row| {
                lowered_query
                    .as_deref()
                    .map(|value| folder_song_matches_query(row, value))
                    .unwrap_or(true)
            })
            .collect();

        song_rows.sort_by(|left, right| match sort_mode {
            FolderSongSortMode::Title => song_title_label(&left.title, &left.path)
                .to_lowercase()
                .cmp(&song_title_label(&right.title, &right.path).to_lowercase()),
            FolderSongSortMode::Name => file_name_from_path(&left.path)
                .to_lowercase()
                .cmp(&file_name_from_path(&right.path).to_lowercase()),
            FolderSongSortMode::Artist => left
                .artist
                .to_lowercase()
                .cmp(&right.artist.to_lowercase())
                .then_with(|| {
                    song_title_label(&left.title, &left.path)
                        .to_lowercase()
                        .cmp(&song_title_label(&right.title, &right.path).to_lowercase())
                }),
            FolderSongSortMode::AddedAt => right
                .added_at
                .unwrap_or_default()
                .cmp(&left.added_at.unwrap_or_default())
                .then_with(|| {
                    song_title_label(&left.title, &left.path)
                        .to_lowercase()
                        .cmp(&song_title_label(&right.title, &right.path).to_lowercase())
                }),
            FolderSongSortMode::AddedAtAsc => left
                .added_at
                .unwrap_or_default()
                .cmp(&right.added_at.unwrap_or_default())
                .then_with(|| {
                    song_title_label(&left.title, &left.path)
                        .to_lowercase()
                        .cmp(&song_title_label(&right.title, &right.path).to_lowercase())
                }),
            FolderSongSortMode::TrackNumber => {
                let left_disc = parse_track_or_disc_number(&left.disc_number);
                let right_disc = parse_track_or_disc_number(&right.disc_number);

                let disc_cmp = match (left_disc, right_disc) {
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (Some(l), Some(r)) => l.cmp(&r),
                    (None, None) => std::cmp::Ordering::Equal,
                };

                disc_cmp.then_with(|| {
                    let left_track = parse_track_or_disc_number(&left.track_number);
                    let right_track = parse_track_or_disc_number(&right.track_number);
                    match (left_track, right_track) {
                        (None, Some(_)) => std::cmp::Ordering::Greater,
                        (Some(_), None) => std::cmp::Ordering::Less,
                        (Some(l), Some(r)) => l.cmp(&r),
                        (None, None) => std::cmp::Ordering::Equal,
                    }
                }).then_with(|| {
                    song_title_label(&left.title, &left.path)
                        .to_lowercase()
                        .cmp(&song_title_label(&right.title, &right.path).to_lowercase())
                }).then_with(|| {
                    left.path.cmp(&right.path)
                })
            }
        });

        Ok::<Vec<String>, String>(song_rows.into_iter().map(|row| row.path).collect())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(result)
}

#[tauri::command]
pub async fn scan_library(
    minimum_duration_seconds: Option<u32>,
    app: AppHandle,
    db_state: State<'_, DbState>,
) -> Result<Vec<LibrarySong>, String> {
    let db_conn = db_state.conn.clone();
    let options = ScanOptions::from_minimum_duration_seconds(minimum_duration_seconds);

    let result = tauri::async_runtime::spawn_blocking(move || {
        let folder_paths: Vec<String> = {
            let conn = db_conn.lock().map_err(|e| e.to_string())?;
            let mut stmt = conn
                .prepare("SELECT path FROM library_folders")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            rows
        };

        let folder_total = folder_paths.len();
        for (index, folder) in folder_paths.into_iter().enumerate() {
            let _ = scan_single_directory_internal(
                folder,
                db_conn.clone(),
                Some(app.clone()),
                index + 1,
                folder_total.max(1),
                options,
            );
        }

        {
            let conn = db_conn.lock().map_err(|e| e.to_string())?;
            cleanup_orphaned_local_songs(&conn)?;
        }

        let conn = db_conn.lock().map_err(|e| e.to_string())?;
        load_cached_songs(&conn)
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(result)
}

#[tauri::command]
pub async fn get_library_hierarchy(
    db_state: State<'_, DbState>,
) -> Result<Vec<FolderNode>, String> {
    let db_conn = db_state.conn.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|e| e.to_string())?;

        let mut stmt = conn
            .prepare("SELECT path FROM library_folders ORDER BY added_at DESC")
            .map_err(|e| e.to_string())?;
        let roots: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        let mut tree = Vec::new();

        for root in roots {
            let root_path = PathBuf::from(&root);
            if let Some(root_node) = scan_folder_recursive(root_path.clone(), 0, 1, &conn) {
                tree.push(root_node);
            }
        }

        Ok::<Vec<FolderNode>, String>(tree)
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(result)
}

#[tauri::command]
pub async fn get_folder_children(
    folder_path: String,
    db_state: State<'_, DbState>,
) -> Result<Vec<FolderNode>, String> {
    let db_conn = db_state.conn.clone();
    let normalized_folder = normalize_path(&folder_path);

    let result = tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|e| e.to_string())?;
        let root_path = PathBuf::from(&normalized_folder);
        let read_dir = std::fs::read_dir(&root_path).map_err(|e| e.to_string())?;
        let mut subdirs: Vec<PathBuf> = read_dir
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| path.is_dir() && !is_dot_prefixed_path(path))
            .collect();

        subdirs.sort_by(|left, right| {
            let left_name = left
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| left.to_string_lossy().into_owned());
            let right_name = right
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| right.to_string_lossy().into_owned());
            left_name.cmp(&right_name)
        });

        let children = subdirs
            .into_iter()
            .filter_map(|path| scan_folder_recursive(path, 0, 0, &conn))
            .collect();

        Ok::<Vec<FolderNode>, String>(children)
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn create_minimal_schema(conn: &Connection) {
        conn.execute(
            "CREATE TABLE library_folders (
                path TEXT PRIMARY KEY,
                added_at INTEGER
            )",
            [],
        )
        .expect("create library_folders");
        conn.execute(
            "CREATE TABLE songs (
                id INTEGER PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                title TEXT,
                artist TEXT,
                album TEXT
            )",
            [],
        )
        .expect("create songs");
    }

    fn create_cached_song_schema(conn: &Connection) {
        conn.execute(
            "CREATE TABLE songs (
                id INTEGER PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                title TEXT,
                artist TEXT,
                artist_names TEXT,
                effective_artist_names TEXT,
                album TEXT,
                album_artist TEXT,
                album_key TEXT,
                is_various_artists_album INTEGER,
                collapse_artist_credits INTEGER,
                duration INTEGER,
                cover_thumb_path TEXT,
                bitrate INTEGER,
                sample_rate INTEGER,
                bit_depth INTEGER,
                format TEXT,
                container TEXT,
                codec TEXT,
                file_size INTEGER,
                track_number TEXT,
                disc_number TEXT,
                added_at INTEGER,
                file_modified_at INTEGER,
                cue_source_path TEXT,
                cue_start_offset INTEGER,
                cue_end_offset INTEGER,
                source_type TEXT,
                remote_source_id TEXT,
                comment TEXT
            )",
            [],
        )
        .expect("create cached song schema");
    }

    fn create_album_catalog_schema(conn: &Connection) {
        conn.execute(
            "CREATE TABLE songs (
                id INTEGER PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                artist TEXT,
                album TEXT,
                album_artist TEXT,
                album_key TEXT,
                added_at INTEGER
            )",
            [],
        )
        .expect("create album catalog schema");
    }

    fn insert_song(conn: &Connection, path: &str) {
        conn.execute(
            "INSERT INTO songs (path, title, artist, album) VALUES (?1, 'Title', 'Artist', 'Album')",
            [path],
        )
        .expect("insert song");
    }

    #[test]
    fn removing_library_folder_deletes_only_descendant_songs() {
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        create_minimal_schema(&conn);
        conn.execute(
            "INSERT INTO library_folders (path, added_at) VALUES (?1, 1), (?2, 2)",
            ["/library/a", "/library/ab"],
        )
        .expect("insert library folders");
        insert_song(&conn, "/library/a/root.flac");
        insert_song(&conn, "/library/a/sub/nested.flac");
        insert_song(&conn, "/library/ab/kept.flac");

        remove_library_folder_from_conn(&mut conn, "/library/a").expect("remove folder");

        let remaining: Vec<String> = conn
            .prepare("SELECT path FROM songs ORDER BY path")
            .expect("prepare remaining songs")
            .query_map([], |row| row.get::<_, String>(0))
            .expect("query remaining songs")
            .filter_map(Result::ok)
            .collect();
        let folders: Vec<String> = conn
            .prepare("SELECT path FROM library_folders ORDER BY path")
            .expect("prepare remaining folders")
            .query_map([], |row| row.get::<_, String>(0))
            .expect("query remaining folders")
            .filter_map(Result::ok)
            .collect();

        assert_eq!(remaining, vec!["/library/ab/kept.flac"]);
        assert_eq!(folders, vec!["/library/ab"]);
    }

    #[test]
    fn orphan_cleanup_removes_only_local_songs_outside_library_roots() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute(
            "CREATE TABLE library_folders (
                path TEXT PRIMARY KEY,
                added_at INTEGER
            )",
            [],
        )
        .expect("create library_folders");
        conn.execute(
            "CREATE TABLE songs (
                id INTEGER PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                source_type TEXT
            )",
            [],
        )
        .expect("create songs");
        conn.execute(
            "INSERT INTO library_folders (path, added_at) VALUES (?1, 1)",
            ["/library/a"],
        )
        .expect("insert library folder");
        conn.execute(
            "INSERT INTO songs (path, source_type) VALUES
             (?1, 'local'),
             (?2, 'local'),
             (?3, 'remote')",
            [
                "/library/a/kept.flac",
                "/downloads/orphan.flac",
                "remote://source/orphan.flac",
            ],
        )
        .expect("insert songs");

        let deleted = cleanup_orphaned_local_songs(&conn).expect("cleanup orphaned local songs");

        let remaining: Vec<String> = conn
            .prepare("SELECT path FROM songs ORDER BY path")
            .expect("prepare remaining songs")
            .query_map([], |row| row.get::<_, String>(0))
            .expect("query remaining songs")
            .filter_map(Result::ok)
            .collect();

        assert_eq!(deleted, vec!["/downloads/orphan.flac"]);
        assert_eq!(
            remaining,
            vec!["/library/a/kept.flac", "remote://source/orphan.flac"]
        );
    }

    #[test]
    fn cached_library_songs_load_list_metadata() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        create_cached_song_schema(&conn);
        conn.execute(
            "INSERT INTO songs (path, title, artist, album, comment)
             VALUES (?1, 'Title', 'Artist', 'Album', 'Live version')",
            ["/library/song.flac"],
        )
        .expect("insert cached song");

        let songs = load_cached_songs(&conn).expect("load cached songs");

        assert_eq!(songs.len(), 1);
        assert_eq!(songs[0].path, "/library/song.flac");
        assert_eq!(songs[0].title, "Title");
        assert_eq!(songs[0].artist, "Artist");
        assert_eq!(songs[0].album, "Album");
    }

    #[test]
    fn quality_metadata_is_loaded_only_for_requested_paths() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        create_cached_song_schema(&conn);
        conn.execute_batch(
            "INSERT INTO songs (path, title, artist, album, bitrate, sample_rate, bit_depth, format)
             VALUES
             ('/library/first.flac', 'First', 'Artist', 'Album', 1411, 96000, 24, 'flac'),
             ('/library/second.mp3', 'Second', 'Artist', 'Album', 320, 44100, NULL, 'mp3');",
        )
        .expect("insert quality songs");
        let paths = vec!["/library/second.mp3".to_string()];

        let metadata = load_song_quality_metadata(&conn, &paths).expect("load quality metadata");

        assert_eq!(metadata.len(), 1);
        assert_eq!(metadata[0].path, "/library/second.mp3");
        assert_eq!(metadata[0].bitrate, 320);
        assert_eq!(metadata[0].sample_rate, 44100);
        assert_eq!(metadata[0].bit_depth, None);
        assert_eq!(metadata[0].format, "mp3");
    }

    #[test]
    fn album_catalog_groups_songs_and_selects_the_latest_representative() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        create_album_catalog_schema(&conn);
        conn.execute_batch(
            "INSERT INTO songs (id, path, artist, album, album_artist, album_key, added_at) VALUES
             (1, '/album-a/older.flac', 'Artist A', 'Album A', 'Artist A', 'album-a', 100),
             (2, '/album-a/latest.flac', 'Artist A', 'Album A', 'Artist A', 'album-a', 200),
             (3, '/album-b/first.flac', 'Artist B', 'Album B', '', '   ', 300),
             (4, '/album-b/second.flac', 'Artist B', 'Album B', NULL, NULL, 300),
             (5, '/unknown/song.flac', '', '', '', NULL, NULL);",
        )
        .expect("insert album catalog songs");

        let catalog = load_album_catalog(&conn).expect("load album catalog");

        assert_eq!(catalog.len(), 3);
        assert_eq!(catalog[0].key, "album-a");
        assert_eq!(catalog[0].name, "Album A");
        assert_eq!(catalog[0].artist, "Artist A");
        assert_eq!(catalog[0].count, 2);
        assert_eq!(catalog[0].first_song_path, "/album-a/latest.flac");

        assert_eq!(catalog[1].key, "album b::artist b");
        assert_eq!(catalog[1].count, 2);
        assert_eq!(catalog[1].first_song_path, "/album-b/first.flac");

        assert_eq!(catalog[2].key, "unknown::unknown");
        assert_eq!(catalog[2].name, "Unknown");
        assert_eq!(catalog[2].artist, "Unknown");
        assert_eq!(catalog[2].count, 1);
        assert_eq!(catalog[2].first_song_path, "/unknown/song.flac");
    }

    #[test]
    fn album_catalog_query_does_not_use_a_correlated_subquery() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        create_album_catalog_schema(&conn);
        let mut stmt = conn
            .prepare(&format!("EXPLAIN QUERY PLAN {ALBUM_CATALOG_SQL}"))
            .expect("prepare album catalog query plan");
        let plan: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(3))
            .expect("query album catalog plan")
            .filter_map(Result::ok)
            .collect();

        assert!(
            plan.iter()
                .all(|detail| !detail.contains("CORRELATED SCALAR SUBQUERY")),
            "unexpected correlated subquery in plan: {plan:?}"
        );
    }

    #[test]
    fn test_parse_track_or_disc_number() {
        assert_eq!(parse_track_or_disc_number(&Some("02".to_string())), Some(2));
        assert_eq!(parse_track_or_disc_number(&Some("1/12".to_string())), Some(1));
        assert_eq!(parse_track_or_disc_number(&Some("Disc 2".to_string())), Some(2));
        assert_eq!(parse_track_or_disc_number(&Some("A".to_string())), None);
        assert_eq!(parse_track_or_disc_number(&None), None);
    }

    #[test]
    fn test_track_number_sort_logic() {
        let mut songs = vec![
            FolderViewSongRow {
                path: "/a/song1.flac".to_string(),
                title: "Song 1".to_string(),
                artist: "Artist".to_string(),
                album: "Album".to_string(),
                album_artist: "Artist".to_string(),
                artist_names: vec![],
                effective_artist_names: vec![],
                added_at: None,
                track_number: Some("1".to_string()),
                disc_number: Some("2".to_string()),
            },
            FolderViewSongRow {
                path: "/a/song2.flac".to_string(),
                title: "Song 2".to_string(),
                artist: "Artist".to_string(),
                album: "Album".to_string(),
                album_artist: "Artist".to_string(),
                artist_names: vec![],
                effective_artist_names: vec![],
                added_at: None,
                track_number: Some("2".to_string()),
                disc_number: Some("1".to_string()),
            },
            FolderViewSongRow {
                path: "/a/song3.flac".to_string(),
                title: "Song 3".to_string(),
                artist: "Artist".to_string(),
                album: "Album".to_string(),
                album_artist: "Artist".to_string(),
                artist_names: vec![],
                effective_artist_names: vec![],
                added_at: None,
                track_number: Some("1".to_string()),
                disc_number: Some("1".to_string()),
            },
            FolderViewSongRow {
                path: "/a/song4.flac".to_string(),
                title: "Song 4".to_string(),
                artist: "Artist".to_string(),
                album: "Album".to_string(),
                album_artist: "Artist".to_string(),
                artist_names: vec![],
                effective_artist_names: vec![],
                added_at: None,
                track_number: None,
                disc_number: Some("1".to_string()),
            },
        ];

        songs.sort_by(|left, right| {
            let left_disc = parse_track_or_disc_number(&left.disc_number);
            let right_disc = parse_track_or_disc_number(&right.disc_number);

            let disc_cmp = match (left_disc, right_disc) {
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (Some(_), None) => std::cmp::Ordering::Less,
                (Some(l), Some(r)) => l.cmp(&r),
                (None, None) => std::cmp::Ordering::Equal,
            };

            disc_cmp.then_with(|| {
                let left_track = parse_track_or_disc_number(&left.track_number);
                let right_track = parse_track_or_disc_number(&right.track_number);
                match (left_track, right_track) {
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (Some(l), Some(r)) => l.cmp(&r),
                    (None, None) => std::cmp::Ordering::Equal,
                }
            }).then_with(|| {
                song_title_label(&left.title, &left.path)
                    .to_lowercase()
                    .cmp(&song_title_label(&right.title, &right.path).to_lowercase())
            }).then_with(|| {
                left.path.cmp(&right.path)
            })
        });

        assert_eq!(songs[0].path, "/a/song3.flac");
        assert_eq!(songs[1].path, "/a/song2.flac");
        assert_eq!(songs[2].path, "/a/song4.flac");
        assert_eq!(songs[3].path, "/a/song1.flac");
    }
}
