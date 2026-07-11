// music/library.rs - 音乐库管理命令

use super::scanner::ScanOptions;
use super::scanner::{scan_folder_recursive, scan_single_directory_summary_internal};
use super::types::{
    AlbumCatalogItem, ArtistCatalogItem, FolderNode, LibraryFolder, LibrarySong, LibrarySongLabel,
    LibrarySongPage,
};
use super::utils::{descendant_like_patterns, is_dot_prefixed_path, normalize_path};
use crate::database::DbState;
use serde::Deserialize;
use std::collections::HashMap;
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

        let mut stmt = tx.prepare(query_songs_sql).map_err(|e| e.to_string())?;
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

        let mut delete_stmt = tx.prepare(delete_song_sql).map_err(|e| e.to_string())?;
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
        let mut delete_stmt = conn.prepare(delete_song_sql).map_err(|e| e.to_string())?;
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

    let child_prefix = match normalized_child.rfind('/') {
        Some(index) => &normalized_child[..index],
        None => return false,
    };

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        normalized_parent.to_lowercase() == child_prefix.to_lowercase()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        normalized_parent == child_prefix
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
            "SELECT path, title, artist, artist_names, effective_artist_names, album, album_artist, album_key, is_various_artists_album, collapse_artist_credits, duration, cover_thumb_path, bitrate, sample_rate, bit_depth, format, track_number, disc_number, added_at, file_modified_at, source_type
             FROM songs",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], map_library_song_row)
        .map_err(|e| e.to_string())?;

    let mut songs: Vec<LibrarySong> = rows.filter_map(|row| row.ok()).collect();
    songs.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(songs)
}

fn load_cached_song_paths(conn: &rusqlite::Connection) -> Result<Vec<String>, String> {
    let mut statement = conn
        .prepare("SELECT path FROM songs")
        .map_err(|error| error.to_string())?;
    let paths = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(paths)
}

fn map_library_song_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<LibrarySong> {
    let path: String = row.get(0)?;
    let name = std::path::Path::new(&path)
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.clone());

    Ok(LibrarySong {
        name,
        path,
        title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
        artist: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
        artist_names: deserialize_string_list(row.get::<_, Option<String>>(3)?),
        effective_artist_names: deserialize_string_list(row.get::<_, Option<String>>(4)?),
        album: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
        album_artist: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
        album_key: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
        is_various_artists_album: row.get::<_, Option<i64>>(8)?.unwrap_or(0) != 0,
        collapse_artist_credits: row.get::<_, Option<i64>>(9)?.unwrap_or(0) != 0,
        duration: clamp_i64_to_u32(row.get::<_, Option<i64>>(10)?.unwrap_or(0)),
        cover_thumb_path: row.get(11)?,
        bitrate: clamp_i64_to_u32(row.get::<_, Option<i64>>(12)?.unwrap_or(0)),
        sample_rate: clamp_i64_to_u32(row.get::<_, Option<i64>>(13)?.unwrap_or(0)),
        bit_depth: i64_to_u8_opt(row.get(14)?),
        format: row.get::<_, Option<String>>(15)?.unwrap_or_default(),
        track_number: row.get(16)?,
        disc_number: row.get(17)?,
        added_at: i64_to_u64_opt(row.get(18)?),
        file_modified_at: i64_to_u64_opt(row.get(19)?),
        source_type: row
            .get::<_, Option<String>>(20)?
            .unwrap_or_else(|| "local".to_string()),
    })
}

const LIBRARY_SONG_BATCH_MAX_SIZE: usize = 512;

fn load_library_songs_by_paths(
    conn: &rusqlite::Connection,
    paths: &[String],
) -> Result<Vec<LibrarySong>, String> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    if paths.len() > LIBRARY_SONG_BATCH_MAX_SIZE {
        return Err(format!(
            "Too many library song paths: {} (max {})",
            paths.len(),
            LIBRARY_SONG_BATCH_MAX_SIZE,
        ));
    }

    let placeholders = std::iter::repeat_n("?", paths.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT {LIBRARY_SONG_PAGE_COLUMNS} FROM songs WHERE songs.path IN ({placeholders})"
    );
    let mut statement = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            rusqlite::params_from_iter(paths.iter()),
            map_library_song_row,
        )
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let songs_by_path = rows
        .into_iter()
        .map(|song| (song.path.clone(), song))
        .collect::<HashMap<_, _>>();

    Ok(paths
        .iter()
        .filter_map(|path| songs_by_path.get(path).cloned())
        .collect())
}

#[tauri::command]
pub async fn get_library_songs_by_paths(
    paths: Vec<String>,
    db_state: State<'_, DbState>,
) -> Result<Vec<LibrarySong>, String> {
    let db_conn = db_state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|error| error.to_string())?;
        load_library_songs_by_paths(&conn, &paths)
    })
    .await
    .map_err(|error| error.to_string())?
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

#[tauri::command]
pub async fn get_library_song_paths_cached(
    db_state: State<'_, DbState>,
) -> Result<Vec<String>, String> {
    let db_conn = db_state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|error| error.to_string())?;
        load_cached_song_paths(&conn)
    })
    .await
    .map_err(|error| error.to_string())?
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
pub async fn get_library_album_catalog_by_artist(
    artist_name: String,
    db_state: State<'_, DbState>,
) -> Result<Vec<AlbumCatalogItem>, String> {
    let db_conn = db_state.conn.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|error| error.to_string())?;
        let mut stmt = conn
            .prepare(
                "WITH artist_songs AS (
                    SELECT DISTINCT songs.id, songs.path, songs.added_at,
                        COALESCE(NULLIF(TRIM(songs.album_key), ''), '') AS album_key,
                        COALESCE(NULLIF(TRIM(songs.album), ''), 'Unknown') AS album_name,
                        COALESCE(NULLIF(TRIM(songs.album_artist), ''), NULLIF(TRIM(songs.artist), ''), 'Unknown') AS album_artist_name
                    FROM songs
                    JOIN song_artists ON song_artists.song_id = songs.id
                    JOIN artists ON artists.id = song_artists.artist_id
                    WHERE artists.name = ?1 COLLATE NOCASE
                 ), ranked_songs AS (
                    SELECT album_key, album_name, album_artist_name, path,
                        COUNT(*) OVER (PARTITION BY album_key, album_name, album_artist_name) AS song_count,
                        ROW_NUMBER() OVER (
                            PARTITION BY album_key, album_name, album_artist_name
                            ORDER BY added_at DESC, id ASC
                        ) AS representative_rank
                    FROM artist_songs
                 )
                 SELECT album_key, album_name, album_artist_name, song_count, path
                 FROM ranked_songs
                 WHERE representative_rank = 1",
            )
            .map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map([artist_name], |row| {
                let album_key = row.get::<_, String>(0)?;
                let album_name = row.get::<_, String>(1)?;
                let artist = row.get::<_, String>(2)?;
                Ok(AlbumCatalogItem {
                    key: if album_key.trim().is_empty() {
                        format!("{}::{}", album_name.to_ascii_lowercase(), artist.to_ascii_lowercase())
                    } else {
                        album_key
                    },
                    name: album_name,
                    artist,
                    count: clamp_i64_to_u32_count(row.get::<_, i64>(3)?),
                    first_song_path: row.get::<_, String>(4)?,
                })
            })
            .map_err(|error| error.to_string())?;

        Ok::<Vec<AlbumCatalogItem>, String>(rows.filter_map(Result::ok).collect())
    })
    .await
    .map_err(|error| error.to_string())?
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
    sort_mode: Option<String>,
    db_state: State<'_, DbState>,
) -> Result<Vec<String>, String> {
    let db_conn = db_state.conn.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT path, title, artist, artist_names, effective_artist_names, album, album_artist, added_at, track_number, disc_number
                 FROM songs
                 WHERE LOWER(
                    COALESCE(
                      NULLIF(TRIM(album_key), ''),
                      COALESCE(NULLIF(TRIM(album), ''), 'Unknown') || '::' ||
                      COALESCE(NULLIF(TRIM(album_artist), ''), NULLIF(TRIM(artist), ''), 'Unknown')
                    )
                 ) = LOWER(?1)",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([album_key], |row| {
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
            })
            .map_err(|e| e.to_string())?;
        let mut songs: Vec<FolderViewSongRow> = rows.filter_map(Result::ok).collect();
        songs.sort_by(|left, right| {
            let compare_number = |left: &Option<String>, right: &Option<String>| {
                match (parse_track_or_disc_number(left), parse_track_or_disc_number(right)) {
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (Some(left), Some(right)) => left.cmp(&right),
                    (None, None) => std::cmp::Ordering::Equal,
                }
            };
            let track_order = compare_number(&left.disc_number, &right.disc_number)
                .then_with(|| compare_number(&left.track_number, &right.track_number))
                .then_with(|| song_title_label(&left.title, &left.path).to_lowercase()
                    .cmp(&song_title_label(&right.title, &right.path).to_lowercase()));
            match sort_mode.as_deref() {
                Some("track_number_desc") => track_order.reverse(),
                Some("track_number") => track_order,
                _ => song_title_label(&left.title, &left.path).to_lowercase()
                    .cmp(&song_title_label(&right.title, &right.path).to_lowercase()),
            }
        });

        Ok::<Vec<String>, String>(songs.into_iter().map(|song| song.path).collect())
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

const LIBRARY_SONG_PAGE_MAX_SIZE: u32 = 512;
const LIBRARY_SONG_PAGE_COLUMNS: &str =
    "songs.path, songs.title, songs.artist, songs.artist_names, songs.effective_artist_names, \
     songs.album, songs.album_artist, songs.album_key, songs.is_various_artists_album, \
     songs.collapse_artist_credits, songs.duration, songs.cover_thumb_path, songs.bitrate, \
     songs.sample_rate, songs.bit_depth, songs.format, songs.track_number, songs.disc_number, \
     songs.added_at, songs.file_modified_at, songs.source_type";

fn build_all_view_page_filter(
    query: Option<String>,
    artist_filter: Option<String>,
    album_filter: Option<String>,
) -> (String, Vec<String>) {
    let mut filter = String::from(" WHERE 1 = 1");
    let mut params = Vec::new();

    if let Some(artist_name) = artist_filter
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        filter.push_str(
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
        filter.push_str(
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
        let like = format!("%{search_query}%");
        filter.push_str(
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

    (filter, params)
}

fn load_all_view_song_labels(
    conn: &rusqlite::Connection,
    query: Option<String>,
    artist_filter: Option<String>,
    album_filter: Option<String>,
) -> Result<Vec<LibrarySongLabel>, String> {
    let (filter, params) = build_all_view_page_filter(query, artist_filter, album_filter);
    let sql = format!("SELECT songs.path, songs.title FROM songs{filter}");
    let mut statement = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let labels = statement
        .query_map(rusqlite::params_from_iter(params.iter()), |row| {
            let path: String = row.get(0)?;
            let title = row.get::<_, Option<String>>(1)?.unwrap_or_default();
            let label = if title.trim().is_empty() {
                file_name_from_path(&path)
            } else {
                title
            };
            Ok(LibrarySongLabel { path, label })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(labels)
}

#[tauri::command]
pub async fn get_library_song_labels_for_all_view(
    query: Option<String>,
    artist_filter: Option<String>,
    album_filter: Option<String>,
    db_state: State<'_, DbState>,
) -> Result<Vec<LibrarySongLabel>, String> {
    let db_conn = db_state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|error| error.to_string())?;
        load_all_view_song_labels(&conn, query, artist_filter, album_filter)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn all_view_page_order(sort_mode: &LibrarySongSortMode) -> &'static str {
    match sort_mode {
        LibrarySongSortMode::Title => {
            " ORDER BY COALESCE(NULLIF(TRIM(songs.title), ''), songs.path) COLLATE NOCASE ASC,
                       songs.path COLLATE NOCASE ASC"
        }
        LibrarySongSortMode::Artist => {
            " ORDER BY COALESCE(NULLIF(TRIM(songs.artist), ''), 'Unknown') COLLATE NOCASE ASC,
                       COALESCE(NULLIF(TRIM(songs.title), ''), songs.path) COLLATE NOCASE ASC,
                       songs.path COLLATE NOCASE ASC"
        }
        LibrarySongSortMode::AddedAt => {
            " ORDER BY COALESCE(songs.added_at, 0) DESC,
                       COALESCE(NULLIF(TRIM(songs.title), ''), songs.path) COLLATE NOCASE ASC,
                       songs.path COLLATE NOCASE ASC"
        }
        LibrarySongSortMode::AddedAtAsc => {
            " ORDER BY COALESCE(songs.added_at, 0) ASC,
                       COALESCE(NULLIF(TRIM(songs.title), ''), songs.path) COLLATE NOCASE ASC,
                       songs.path COLLATE NOCASE ASC"
        }
        LibrarySongSortMode::FileModifiedAt => {
            " ORDER BY COALESCE(songs.file_modified_at, 0) DESC,
                       COALESCE(NULLIF(TRIM(songs.title), ''), songs.path) COLLATE NOCASE ASC,
                       songs.path COLLATE NOCASE ASC"
        }
        LibrarySongSortMode::FileModifiedAtAsc => {
            " ORDER BY COALESCE(songs.file_modified_at, 0) ASC,
                       COALESCE(NULLIF(TRIM(songs.title), ''), songs.path) COLLATE NOCASE ASC,
                       songs.path COLLATE NOCASE ASC"
        }
    }
}

fn load_all_view_song_page(
    conn: &rusqlite::Connection,
    query: Option<String>,
    artist_filter: Option<String>,
    album_filter: Option<String>,
    sort_mode: LibrarySongSortMode,
    offset: u32,
    limit: u32,
) -> Result<LibrarySongPage, String> {
    let limit = limit.clamp(1, LIBRARY_SONG_PAGE_MAX_SIZE);
    let (filter, params) = build_all_view_page_filter(query, artist_filter, album_filter);
    let count_sql = format!("SELECT COUNT(*) FROM songs{filter}");
    let total = conn
        .query_row(
            &count_sql,
            rusqlite::params_from_iter(params.iter()),
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?
        .max(0) as u64;

    let page_sql = format!(
        "SELECT {LIBRARY_SONG_PAGE_COLUMNS} FROM songs{filter}{} LIMIT {limit} OFFSET {offset}",
        all_view_page_order(&sort_mode),
    );
    let mut statement = conn.prepare(&page_sql).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            rusqlite::params_from_iter(params.iter()),
            map_library_song_row,
        )
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    Ok(LibrarySongPage {
        total,
        offset,
        rows,
    })
}

#[tauri::command]
pub async fn get_library_song_page(
    query: Option<String>,
    artist_filter: Option<String>,
    album_filter: Option<String>,
    sort_mode: LibrarySongSortMode,
    offset: u32,
    limit: u32,
    db_state: State<'_, DbState>,
) -> Result<LibrarySongPage, String> {
    let db_conn = db_state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|error| error.to_string())?;
        load_all_view_song_page(
            &conn,
            query,
            artist_filter,
            album_filter,
            sort_mode,
            offset,
            limit,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

fn parse_track_or_disc_number(val: &Option<String>) -> Option<i32> {
    val.as_ref().and_then(|s| {
        let digits: String = s
            .chars()
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
) -> Result<Vec<String>, String> {
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
            let _ = scan_single_directory_summary_internal(
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
        load_cached_song_paths(&conn)
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
        conn.execute(
            "CREATE TABLE artists (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE
            )",
            [],
        )
        .expect("create cached artist schema");
        conn.execute(
            "CREATE TABLE song_artists (
                song_id INTEGER NOT NULL,
                artist_id INTEGER NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (song_id, artist_id)
            )",
            [],
        )
        .expect("create cached song artist schema");
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
            "INSERT INTO songs (path, title, artist, album, comment, bitrate, sample_rate, bit_depth, format)
             VALUES (?1, 'Title', 'Artist', 'Album', 'Live version', 1411, 96000, 24, 'flac')",
            ["/library/song.flac"],
        )
        .expect("insert cached song");

        let songs = load_cached_songs(&conn).expect("load cached songs");

        assert_eq!(songs.len(), 1);
        assert_eq!(songs[0].path, "/library/song.flac");
        assert_eq!(songs[0].title, "Title");
        assert_eq!(songs[0].artist, "Artist");
        assert_eq!(songs[0].album, "Album");
        assert_eq!(songs[0].bitrate, 1411);
        assert_eq!(songs[0].sample_rate, 96000);
        assert_eq!(songs[0].bit_depth, Some(24));
        assert_eq!(songs[0].format, "flac");
    }

    #[test]
    fn library_song_batch_preserves_requested_order_and_quality() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        create_cached_song_schema(&conn);
        conn.execute_batch(
            "INSERT INTO songs (path, title, artist, album, bitrate, sample_rate, bit_depth, format)
             VALUES
             ('/library/first.flac', 'First', 'Artist', 'Album', 1411, 96000, 24, 'flac'),
             ('/library/second.mp3', 'Second', 'Artist', 'Album', 320, 44100, NULL, 'mp3');",
        )
        .expect("insert batch songs");
        let paths = vec![
            "/library/second.mp3".to_string(),
            "/library/first.flac".to_string(),
        ];

        let songs = load_library_songs_by_paths(&conn, &paths).expect("load song batch");

        assert_eq!(songs.len(), 2);
        assert_eq!(songs[0].path, "/library/second.mp3");
        assert_eq!(songs[0].bitrate, 320);
        assert_eq!(songs[1].path, "/library/first.flac");
        assert_eq!(songs[1].sample_rate, 96000);
        assert_eq!(songs[1].bit_depth, Some(24));
    }

    #[test]
    fn library_song_batch_rejects_oversized_requests() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        create_cached_song_schema(&conn);
        let paths = (0..=LIBRARY_SONG_BATCH_MAX_SIZE)
            .map(|index| format!("/library/{index}.flac"))
            .collect::<Vec<_>>();

        let error = load_library_songs_by_paths(&conn, &paths).expect_err("reject large batch");

        assert!(error.contains("Too many library song paths"));
    }

    #[test]
    fn all_view_song_page_reports_total_and_keeps_quality_metadata() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        create_cached_song_schema(&conn);
        conn.execute_batch(
            "INSERT INTO songs (
                path, title, artist, artist_names, effective_artist_names, album,
                album_artist, album_key, duration, bitrate, sample_rate, bit_depth,
                format, source_type
             ) VALUES
             ('/library/c.flac', 'Charlie', 'Artist', '[\"Artist\"]', '[\"Artist\"]', 'Album', 'Artist', 'album::artist', 180, 1411, 96000, 24, 'flac', 'local'),
             ('/library/a.mp3', 'Alpha', 'Artist', '[\"Artist\"]', '[\"Artist\"]', 'Album', 'Artist', 'album::artist', 181, 320, 44100, NULL, 'mp3', 'local'),
             ('/library/b.flac', 'Bravo', 'Artist', '[\"Artist\"]', '[\"Artist\"]', 'Album', 'Artist', 'album::artist', 182, 900, 48000, 24, 'flac', 'local');",
        )
        .expect("insert paged songs");

        let page =
            load_all_view_song_page(&conn, None, None, None, LibrarySongSortMode::Title, 1, 1)
                .expect("load song page");

        assert_eq!(page.total, 3);
        assert_eq!(page.offset, 1);
        assert_eq!(page.rows.len(), 1);
        assert_eq!(page.rows[0].title, "Bravo");
        assert_eq!(page.rows[0].bitrate, 900);
        assert_eq!(page.rows[0].sample_rate, 48000);
        assert_eq!(page.rows[0].bit_depth, Some(24));
        assert_eq!(page.rows[0].format, "flac");
    }

    #[test]
    fn all_view_song_page_applies_search_and_caps_page_size() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        create_cached_song_schema(&conn);
        conn.execute_batch(
            "INSERT INTO songs (path, title, artist, album, source_type)
             VALUES
             ('/library/needle.flac', 'Needle Song', 'Artist', 'Album', 'local'),
             ('/library/other.flac', 'Other Song', 'Artist', 'Album', 'local');",
        )
        .expect("insert searchable songs");

        let page = load_all_view_song_page(
            &conn,
            Some("needle".to_string()),
            None,
            None,
            LibrarySongSortMode::Title,
            0,
            LIBRARY_SONG_PAGE_MAX_SIZE + 100,
        )
        .expect("load searched song page");

        assert_eq!(page.total, 1);
        assert_eq!(page.rows.len(), 1);
        assert_eq!(page.rows[0].path, "/library/needle.flac");
    }

    #[test]
    #[ignore = "manual 50k-song performance baseline"]
    fn benchmark_full_materialization_against_first_page() {
        use std::time::Instant;

        const SONG_COUNT: usize = 50_000;
        const PAGE_SIZE: u32 = 128;

        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        create_cached_song_schema(&conn);
        let transaction = conn.transaction().expect("start synthetic insert");
        {
            let mut insert = transaction
                .prepare(
                    "INSERT INTO songs (
                        path, title, artist, artist_names, effective_artist_names, album,
                        album_artist, album_key, duration, cover_thumb_path, bitrate,
                        sample_rate, bit_depth, format, track_number, disc_number,
                        added_at, file_modified_at, source_type
                     ) VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?3, ?6, 180, ?7, 1411, 96000, 24, 'flac', ?8, '1', ?9, ?9, 'local')",
                )
                .expect("prepare synthetic song insert");

            for index in 0..SONG_COUNT {
                let artist = format!("Artist {:04}", index % 1_000);
                let album = format!("Album {:05}", index % 10_000);
                let artist_names = serde_json::to_string(&vec![artist.clone()])
                    .expect("serialize synthetic artists");
                insert
                    .execute(rusqlite::params![
                        format!("C:/Synthetic/{artist}/{album}/track-{index:05}.flac"),
                        format!("Track {index:05}"),
                        artist,
                        artist_names,
                        album,
                        format!("album::{:05}", index % 10_000),
                        format!("C:/Synthetic/Covers/{:05}.webp", index % 10_000),
                        format!("{}", (index % 12) + 1),
                        index as i64,
                    ])
                    .expect("insert synthetic song");
            }
        }
        transaction.commit().expect("commit synthetic songs");

        let paths_started = Instant::now();
        let startup_paths = load_cached_song_paths(&conn).expect("load startup path index");
        let paths_elapsed = paths_started.elapsed();
        let paths_json_bytes = serde_json::to_vec(&startup_paths)
            .expect("serialize startup path index")
            .len();

        let full_started = Instant::now();
        let full = load_cached_songs(&conn).expect("materialize complete library");
        let full_elapsed = full_started.elapsed();
        let full_json_bytes = serde_json::to_vec(&full)
            .expect("serialize complete library")
            .len();

        let page_started = Instant::now();
        let page = load_all_view_song_page(
            &conn,
            None,
            None,
            None,
            LibrarySongSortMode::Title,
            0,
            PAGE_SIZE,
        )
        .expect("materialize first page");
        let page_elapsed = page_started.elapsed();
        let page_json_bytes = serde_json::to_vec(&page)
            .expect("serialize first page")
            .len();
        let batch_paths = full
            .iter()
            .take(PAGE_SIZE as usize)
            .map(|song| song.path.clone())
            .collect::<Vec<_>>();
        let batch_started = Instant::now();
        let batch = load_library_songs_by_paths(&conn, &batch_paths)
            .expect("materialize ordered visible batch");
        let batch_elapsed = batch_started.elapsed();
        let batch_json_bytes = serde_json::to_vec(&batch)
            .expect("serialize ordered visible batch")
            .len();

        assert_eq!(full.len(), SONG_COUNT);
        assert_eq!(startup_paths.len(), SONG_COUNT);
        assert!(paths_json_bytes < full_json_bytes);
        assert_eq!(page.total, SONG_COUNT as u64);
        assert_eq!(page.rows.len(), PAGE_SIZE as usize);
        assert_eq!(batch.len(), PAGE_SIZE as usize);
        assert_eq!(batch[0].path, batch_paths[0]);
        eprintln!(
            "50k benchmark: startup_paths={paths_elapsed:?}/{paths_json_bytes} bytes, full={full_elapsed:?}/{full_json_bytes} bytes, page={page_elapsed:?}/{page_json_bytes} bytes, ordered_batch={batch_elapsed:?}/{batch_json_bytes} bytes"
        );
    }

    #[test]
    #[ignore = "manual 50k/100k search and SQLite memory baseline"]
    fn benchmark_large_library_search_and_sort_memory() {
        use rusqlite::ffi;
        use std::time::{Duration, Instant};

        fn sqlite_memory_status(reset_highwater: bool) -> (i64, i64) {
            let mut current = 0_i64;
            let mut highwater = 0_i64;
            let result = unsafe {
                ffi::sqlite3_status64(
                    ffi::SQLITE_STATUS_MEMORY_USED,
                    &mut current,
                    &mut highwater,
                    i32::from(reset_highwater),
                )
            };
            assert_eq!(result, ffi::SQLITE_OK);
            (current, highwater)
        }

        fn percentile_95(samples: &mut [Duration]) -> Duration {
            samples.sort_unstable();
            samples[((samples.len() * 95).div_ceil(100)).saturating_sub(1)]
        }

        for song_count in [50_000_usize, 100_000] {
            let mut conn = Connection::open_in_memory().expect("open in-memory db");
            create_cached_song_schema(&conn);
            conn.pragma_update(None, "temp_store", "MEMORY")
                .expect("configure temp store");
            conn.execute(
                "CREATE INDEX idx_songs_all_view_title
                 ON songs (
                   COALESCE(NULLIF(TRIM(title), ''), path) COLLATE NOCASE,
                   path COLLATE NOCASE
                 )",
                [],
            )
            .expect("create title index");

            let transaction = conn.transaction().expect("start synthetic insert");
            {
                let mut insert = transaction
                    .prepare(
                        "INSERT INTO songs (
                            path, title, artist, album, album_artist, added_at,
                            file_modified_at, source_type
                         ) VALUES (?1, ?2, ?3, ?4, ?3, ?5, ?5, 'local')",
                    )
                    .expect("prepare synthetic insert");
                for index in 0..song_count {
                    insert
                        .execute(rusqlite::params![
                            format!(
                                "C:/Synthetic/Artist-{}/track-{index:06}.flac",
                                index % 2_000
                            ),
                            format!("Track {index:06}"),
                            format!("Artist {:04}", index % 2_000),
                            format!("Album {:05}", index % 10_000),
                            index as i64,
                        ])
                        .expect("insert synthetic song");
                }
            }
            transaction.commit().expect("commit synthetic songs");

            sqlite_memory_status(true);
            let mut title_samples = Vec::new();
            let mut title_without_index_samples = Vec::new();
            let mut search_samples = Vec::new();
            for index in 0..20 {
                let started = Instant::now();
                let page = load_all_view_song_page(
                    &conn,
                    None,
                    None,
                    None,
                    LibrarySongSortMode::Title,
                    (index % 4 * 128) as u32,
                    128,
                )
                .expect("load sorted page");
                assert_eq!(page.rows.len(), 128);
                title_samples.push(started.elapsed());

                let started = Instant::now();
                let mut statement = conn
                    .prepare(
                        "SELECT path FROM songs NOT INDEXED
                         ORDER BY COALESCE(NULLIF(TRIM(title), ''), path) COLLATE NOCASE ASC,
                                  path COLLATE NOCASE ASC
                         LIMIT 128",
                    )
                    .expect("prepare unindexed title page");
                let unindexed_paths = statement
                    .query_map([], |row| row.get::<_, String>(0))
                    .expect("load unindexed title page")
                    .collect::<Result<Vec<_>, _>>()
                    .expect("collect unindexed title page");
                assert_eq!(unindexed_paths.len(), 128);
                title_without_index_samples.push(started.elapsed());

                let started = Instant::now();
                let search_page = load_all_view_song_page(
                    &conn,
                    Some(format!("track {:03}", index % 10)),
                    None,
                    None,
                    LibrarySongSortMode::Title,
                    0,
                    128,
                )
                .expect("load search page");
                assert!(search_page.rows.len() <= 128);
                search_samples.push(started.elapsed());
            }
            let (memory_current, memory_highwater) = sqlite_memory_status(false);
            let title_p95 = percentile_95(&mut title_samples);
            let title_without_index_p95 = percentile_95(&mut title_without_index_samples);
            let search_p95 = percentile_95(&mut search_samples);

            eprintln!(
                "{song_count} songs: title_page_p95={title_p95:?}, title_without_index_p95={title_without_index_p95:?}, search_p95={search_p95:?}, sqlite_memory_current={memory_current}, sqlite_memory_highwater={memory_highwater}"
            );
        }
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
        assert_eq!(
            parse_track_or_disc_number(&Some("1/12".to_string())),
            Some(1)
        );
        assert_eq!(
            parse_track_or_disc_number(&Some("Disc 2".to_string())),
            Some(2)
        );
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

            disc_cmp
                .then_with(|| {
                    let left_track = parse_track_or_disc_number(&left.track_number);
                    let right_track = parse_track_or_disc_number(&right.track_number);
                    match (left_track, right_track) {
                        (None, Some(_)) => std::cmp::Ordering::Greater,
                        (Some(_), None) => std::cmp::Ordering::Less,
                        (Some(l), Some(r)) => l.cmp(&r),
                        (None, None) => std::cmp::Ordering::Equal,
                    }
                })
                .then_with(|| {
                    song_title_label(&left.title, &left.path)
                        .to_lowercase()
                        .cmp(&song_title_label(&right.title, &right.path).to_lowercase())
                })
                .then_with(|| left.path.cmp(&right.path))
        });

        assert_eq!(songs[0].path, "/a/song3.flac");
        assert_eq!(songs[1].path, "/a/song2.flac");
        assert_eq!(songs[2].path, "/a/song4.flac");
        assert_eq!(songs[3].path, "/a/song1.flac");
    }

    #[test]
    fn test_is_direct_child_path() {
        assert!(is_direct_child_path("/a/b", "/a/b/c.mp3"));
        assert!(is_direct_child_path("/a/b/", "/a/b/c.mp3"));
        assert!(is_direct_child_path("C:\\a\\b", "C:\\a\\b\\c.mp3"));
        assert!(is_direct_child_path("C:\\a\\b", "C:/a/b/c.mp3"));

        #[cfg(any(target_os = "windows", target_os = "macos"))]
        {
            assert!(is_direct_child_path("c:\\a\\b", "C:\\a\\B\\c.mp3"));
            assert!(is_direct_child_path("C:\\A\\B", "c:\\a\\b\\c.mp3"));
        }

        assert!(!is_direct_child_path("/a/b", "/a/b/c/d.mp3"));
        assert!(!is_direct_child_path("/a/b", "/a/c/d.mp3"));
        assert!(!is_direct_child_path("/a/b", "/a/b"));
    }
}
